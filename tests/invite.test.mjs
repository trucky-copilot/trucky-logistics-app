// PM-03: enlace de invitación personal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarCodigo, nuevoCodigo, enlaceInvitacion, CODIGO_VALIDO } from '../src/lib/invite.js';
import { markReferral, REFERRAL_CODE } from '../base44/shared/referral.ts';

test('código nuevo: 8 caracteres válidos y distintos', () => {
  const a = nuevoCodigo(), b = nuevoCodigo();
  assert.match(a, CODIGO_VALIDO); assert.match(b, CODIGO_VALIDO); assert.notEqual(a, b);
  assert.equal(String(CODIGO_VALIDO), String(REFERRAL_CODE)); // misma regla en app, Base44 y web
});

test('normaliza mayúsculas y rechaza formas raras', () => {
  assert.equal(normalizarCodigo(' k7q2m9xa '), 'K7Q2M9XA');
  for (const v of ['', null, 'ABC', 'K7Q2M9XA1', 'K7Q2M9X0', '<script>', 'ACADEMY']) assert.equal(normalizarCodigo(v), null);
});

test('el enlace abre la web de pago', () => {
  assert.equal(enlaceInvitacion('K7Q2M9XA'), 'https://www.trucky-ai.com/?invita=K7Q2M9XA');
});

function deps({ org = { id: 'org_b' }, refs = [{ usuario: 'a@x.com', codigo_invitacion: 'K7Q2M9XA' }], members = [{ user_email: 'b@x.com' }] } = {}) {
  const writes = [];
  return { writes, d: {
    organization: async () => org, referrers: async () => refs, members: async () => members,
    update: async (id, f) => { writes.push([id, f]); }, now: () => 0,
  } };
}
const sub = (m) => ({ metadata: { org_id: 'org_b', referral_code: 'K7Q2M9XA', ...m } });

test('pago con código de invitación marca la empresa como referida', async () => {
  const { d, writes } = deps();
  assert.equal(await markReferral(sub(), 'org_b', d), 'MARKED');
  assert.deepEqual(writes, [['org_b', { referido_por: 'K7Q2M9XA', referido_en: '1970-01-01T00:00:00.000Z' }]]);
});

test('no marca: sin código, código inválido, otra empresa, ya marcada, código inexistente o propio', async () => {
  const casos = [
    [sub({ referral_code: undefined }), {}, 'NO_REFERRAL'],
    [sub({ referral_code: 'ACADEMY' }), {}, 'NO_REFERRAL'],
    [sub({ org_id: 'org_x' }), {}, 'ORG_MISMATCH'],
    [sub(), { org: { id: 'org_b', referido_por: 'ZZZZZZZZ' } }, 'ALREADY_MARKED'],
    [sub(), { refs: [] }, 'REFERRER_NOT_FOUND'],
    [sub(), { members: [{ user_email: 'A@x.com' }] }, 'SELF_REFERRAL'],
  ];
  for (const [s, o, esperado] of casos) {
    const { d, writes } = deps(o);
    assert.equal(await markReferral(s, 'org_b', d), esperado);
    assert.equal(writes.length, 0);
  }
});
