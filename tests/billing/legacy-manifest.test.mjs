import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLegacyManifest } from '../../scripts/billing/legacy-manifest.mjs';
const cutoff='2026-11-01T00:00:00Z';
test('preserves old users without companies and does not reactivate disabled records',()=>{
 const manifest=buildLegacyManifest({complete:true,organizations:[{id:'old',created_date:'2026-10-01',active:false},{id:'new',created_date:cutoff}],users:[{id:'no_org_yet',created_date:'2026-10-01'}]},cutoff);
 assert.deepEqual(manifest.legacyOrganizations,[{id:'old',wasDisabled:true}]);
 assert.deepEqual(manifest.legacyUsers,[{id:'no_org_yet',wasDisabled:false}]);
});
test('rejects incomplete export, missing timestamps and duplicate identities',()=>{
 assert.throws(()=>buildLegacyManifest({organizations:[],users:[]},cutoff),/COMPLETE/);
 assert.throws(()=>buildLegacyManifest({complete:true,organizations:[],users:[{id:'a'}]},cutoff),/TIMESTAMP/);
 assert.throws(()=>buildLegacyManifest({complete:true,organizations:[],users:[{id:'a',created_date:cutoff},{id:'a',created_date:cutoff}]},cutoff),/DUPLICATE/);
});
test('manifest checksum is reproducible and changes with eligibility',()=>{
 const snapshot={complete:true,organizations:[],users:[{id:'a',created_date:'2026-10-01'}]};
 assert.equal(buildLegacyManifest(snapshot,cutoff).sha256,buildLegacyManifest(snapshot,cutoff).sha256);
 assert.notEqual(buildLegacyManifest(snapshot,cutoff).sha256,buildLegacyManifest({...snapshot,users:[]},cutoff).sha256);
});
