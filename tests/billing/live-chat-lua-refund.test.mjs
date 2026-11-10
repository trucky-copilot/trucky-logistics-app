// Optional local Lua interpreter. No real Redis calls or project dependencies.
// LUA_ENGINE_PATH=/tmp/.../node_modules/fengari node --experimental-strip-types --test <this file>
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {consumeLiveChat,settleLiveChat,CONSUME_PAID_CHAT,SETTLE_PAID_CHAT} from '../../base44/shared/liveChatQuota.ts';
const modulePath=process.env.LUA_ENGINE_PATH;
function world(){
 const require=createRequire(import.meta.url);const{lua,lauxlib,lualib,to_luastring:s,to_jsstring:js}=require(modulePath);
 const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
 function run(code){if(lauxlib.luaL_dostring(L,s(code))!==lua.LUA_OK){const message=js(lua.lua_tostring(L,-1));lua.lua_pop(L,1);throw Error(message);}}
 run(`store={};audits={};auditBroken=false;redis={call=function(op,key,...) local a={...};if op=='RPUSH' then if auditBroken then error('WRONGTYPE') end table.insert(audits,a[1]);return #audits end;store[key]=store[key] or {};local h=store[key];if op=='HGET' then return h[a[1]] elseif op=='HEXISTS' then if h[a[1]] then return 1 else return 0 end elseif op=='HSET' then for i=1,#a,2 do h[a[i]]=tostring(a[i+1]) end return 1 else error('unexpected') end end};function consume() ${CONSUME_PAID_CHAT} end;function settle() ${SETTLE_PAID_CHAT} end`);
 const redis=async c=>{
  assert.equal(c[0],'EVAL');const n=Number(c[2]),keys=c.slice(3,3+n),args=c.slice(3+n);
  run(`KEYS={${keys.map(JSON.stringify).join(',')}};ARGV={${args.map(x=>JSON.stringify(String(x))).join(',')}};result=${c[1]===CONSUME_PAID_CHAT?'consume':'settle'}()`);
  lua.lua_getglobal(L,s('result'));
  if(lua.lua_istable(L,-1)){lua.lua_rawgeti(L,-1,1);const a=lua.lua_tointeger(L,-1);lua.lua_pop(L,1);lua.lua_rawgeti(L,-1,2);const b=lua.lua_tointeger(L,-1);lua.lua_pop(L,2);return[a,b];}
  const r=lua.lua_tointeger(L,-1);lua.lua_pop(L,1);return r;
 };
 function auditCount(){run('count=#audits');lua.lua_getglobal(L,s('count'));const r=lua.lua_tointeger(L,-1);lua.lua_pop(L,1);return r;}
 return{redis,auditCount,broken:value=>run(`auditBroken=${value?'true':'false'}`),close:()=>lua.lua_close(L)};
}
const access={allowed:true,plan:'plan_29',organizationId:'org',subscriptionId:'sub_real',credit:{invoiceId:'in_paid',paidAt:100}};
test('Lua concurrent requests at cap, duplicate refunds exactly once, old refund does not change new invoice',{skip:!modulePath},async()=>{const w=world();try{
 const calls=await Promise.all(Array.from({length:1005},(_,i)=>consumeLiveChat(access,'r'+i,w.redis)));assert.equal(calls.filter(r=>r.allowed).length,1000);
 const refunds=await Promise.all(Array.from({length:20},()=>settleLiveChat(access,'r0','confirmed_failure',w.redis)));assert.equal(refunds.filter(r=>r.code==='CHAT_REFUNDED').length,1);assert.equal(w.auditCount(),1);
 assert.equal((await consumeLiveChat(access,'r0',w.redis)).allowed,false);assert.equal((await consumeLiveChat(access,'replacement',w.redis)).allowed,true);assert.equal((await consumeLiveChat(access,'overflow',w.redis)).allowed,false);
 const next={...access,credit:{invoiceId:'in_new',paidAt:200}};assert.equal((await consumeLiveChat(next,'new',w.redis)).used,1);
 await settleLiveChat(access,'r1','confirmed_failure',w.redis);assert.equal((await consumeLiveChat(next,'next',w.redis)).used,2);
 assert.equal((await consumeLiveChat(access,'old',w.redis)).code,'STALE_PAID_CREDIT');
 }finally{w.close();}});
test('Lua completion/uncertain cannot later refund; audit failure preserves debit; lost-ack retry idempotent',{skip:!modulePath},async()=>{const w=world();try{
 for(const outcome of ['completed','uncertain']){await consumeLiveChat(access,outcome,w.redis);await settleLiveChat(access,outcome,outcome,w.redis);assert.equal((await settleLiveChat(access,outcome,'confirmed_failure',w.redis)).code,'CHAT_ALREADY_SETTLED');}
 await consumeLiveChat(access,'failure',w.redis);w.broken(true);await assert.rejects(settleLiveChat(access,'failure','confirmed_failure',w.redis));w.broken(false);
 const count=w.auditCount();await assert.rejects(settleLiveChat(access,'failure','confirmed_failure',async c=>{await w.redis(c);throw Error('ack lost');}));assert.equal(w.auditCount(),count+1);
 assert.equal((await settleLiveChat(access,'failure','confirmed_failure',w.redis)).code,'CHAT_ALREADY_SETTLED');assert.equal(w.auditCount(),count+1);
 assert.equal((await consumeLiveChat(access,'last',w.redis)).used,3);
 }finally{w.close();}});
