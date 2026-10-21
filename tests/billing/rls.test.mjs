import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
for (const entity of ['Organization', 'OrganizationMember']) {
  test(`${entity}: direct writes require trusted app admin`, () => {
    const schema = JSON.parse(readFileSync(`base44/entities/${entity}.jsonc`, 'utf8'));
    for (const operation of ['create', 'update', 'delete']) {
      assert.deepEqual(schema.rls[operation], { user_condition: { role: 'admin' } });
    }
  });
}
test('onboarding no longer writes organization or owner membership directly', () => {
  const source = readFileSync('src/pages/Onboarding.jsx', 'utf8');
  assert.ok(source.includes("functions.invoke('ensureOwnOrganization'"));
  assert.ok(!/entities\.Organization(?:Member)?\.(create|update)/.test(source));
});
