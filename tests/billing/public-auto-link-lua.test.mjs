import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {AUTO_BIND_PUBLIC} from '../../base44/shared/autoLinkPublicAccount.ts';
const engine=process.env.LUA_ENGINE_PATH;
test('actual public auto-bind Lua checks snapshots, rejects identity conflict, audits once and fails closed on audit error',{skip:!engine},()=>{
 const require=createRequire(import.meta.url);const {lua,lauxlib,lualib,to_luastring:s,to_jsstring:js}=require(engine);const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
 function run(code){if(lauxlib.luaL_dostring(L,s(code))!==lua.LUA_OK){const err=js(lua.lua_tostring(L,-1));lua.lua_pop(L,1);throw Error(err);}}
 function result(){lua.lua_getglobal(L,s('result'));const r=lua.lua_tointeger(L,-1);lua.lua_pop(L,1);return r;}
 try{
 run(`store={enrollment='entry',proof='proof',receipt='org'};count=0;broken=false;redis={call=function(op,k,...) local a={...};if op=='GET' then return store[k] elseif op=='RPUSH' then if broken then error('WRONGTYPE') end count=count+1;return count elseif op=='MSET' then store[k]=a[1];store[a[2]]=a[3];return 'OK' else error('unexpected') end end};KEYS={'identity','native','enrollment','proof','audit','receipt'};ARGV={'user','google','entry','proof','audit-entry','org'};function bind() ${AUTO_BIND_PUBLIC} end`);
 run(`result=bind()`);assert.equal(result(),1);run(`result=bind()`);assert.equal(result(),1);run(`result=count`);assert.equal(result(),1);
 run(`ARGV[1]='other';result=bind()`);assert.equal(result(),0);run(`ARGV[1]='user';store.proof='different';result=bind()`);assert.equal(result(),-1);
 run(`store.proof='proof';store.identity=nil;store.native=nil;broken=true`);assert.throws(()=>run(`result=bind()`),/WRONGTYPE/);run(`result=(store.identity==nil and store.native==nil) and 1 or 0`);assert.equal(result(),1);
 }finally{lua.lua_close(L);}
});
