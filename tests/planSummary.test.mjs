import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSummary } from '../src/lib/planSummary.js';

const now = Date.parse('2026-11-12T12:00:00Z');

test('mi plan: cuenta demo identificada, con días restantes de prueba', () => {
  const s = planSummary({ planType: 'demo', trialData: { hasTrial: true, isExpired: false, trialEndsAt: '2026-11-22T12:00:00Z' } }, { account_type: 'carrier' }, 'es', now);
  assert.equal(s.nombre, 'Cuenta de demostración');
  assert.equal(s.estado, 'Demo');
  assert.equal(s.diasRestantes, 10);
  assert.equal(s.pruebaVencida, false);
  assert.equal(s.tipo, 'Carrier');
});

test('mi plan: demo sin prueba o vencida se marca como vencida', () => {
  assert.equal(planSummary({ planType: 'demo', trialData: { hasTrial: false } }, null, 'es', now).pruebaVencida, true);
  const s = planSummary({ planType: 'demo', trialData: { hasTrial: true, trialEndsAt: '2026-11-01T00:00:00Z' } }, null, 'en', now);
  assert.equal(s.estado, 'Demo · trial ended');
});

test('mi plan: plan pagado en período gratis muestra la fecha de fin; activo y pago pendiente', () => {
  const t = planSummary({ planType: 'plan_29' }, { subscription_status: 'trialing', trial_ends_at: '2026-12-12T12:00:00Z' }, 'es', now);
  assert.equal(t.nombre, 'Plan $29 / mes'); assert.equal(t.estado, 'Período gratis'); assert.equal(t.diasRestantes, 30);
  assert.equal(planSummary({ planType: 'plan_99' }, { subscription_status: 'active' }, 'es', now).estado, 'Activa');
  assert.equal(planSummary({ planType: 'plan_99' }, { subscription_status: 'past_due' }, 'es', now).tono, 'red');
});
