import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base='base44/functions/';
test('all six packaged guards are identical and return before lookup when off',()=>{
 const names=['marketChat','analyzeDocument','extractDocumentText','translateChat','syncGmail','sendGmail'];
 const sources=names.map(n=>readFileSync(base+n+'/liveBillingGuard.ts','utf8'));
 assert.ok(sources.every(s=>s===sources[0]));
 assert.ok(sources[0].indexOf("!=='true')return null")<sources[0].indexOf('client.auth.me()'));
 for(const name of names){const source=readFileSync(base+name+'/entry.ts','utf8');assert.ok(source.includes('if(billingDenied)return billingDenied;'));}
});
test('frontend state endpoint returns legacy path before auth when disabled',()=>{
 const source=readFileSync(base+'getBillingLinkState/entry.ts','utf8');
 assert.ok(source.indexOf('return reply({enforced:false})')<source.indexOf('client.auth.me()'));
 const gate=readFileSync('src/components/LiveBillingGate.jsx','utf8');
 assert.ok(gate.includes("state==='legacy'||state==='allowed'"));
 assert.ok(gate.includes("setState('error')"));
});
