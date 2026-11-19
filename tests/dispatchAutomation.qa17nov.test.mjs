// QA 17-nov (F3, F4, F5): automatización Emails → Verificador → Carga.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRiskGuards, buildThreadSummaryForLoad, classifyLoadDocument, summarizeThreadForChecker } from '../src/lib/dispatchAutomation.js';

const DOC = "RATE CONFIRMATION QA TEST DOCUMENT Broker: QA Test Brokerage LLC Load #: QA-LD-1001 Carrier: GrauLogistics Pickup: POMTOC Terminal, Miami, FL 33132 Pickup date/time: 11/25/2026 08:00 Delivery: Bartow Cold Storage, Bartow, FL 33830 Delivery date/time: 11/25/2026 15:00 Equipment: 40' Reefer container (Overweight, tri-axle) Miles: 215 Total rate (All-In USD): $1,600.00 Payment terms: Net 30 Penalties: Late delivery penalty: $150";

test('F5: la carga lleva horas, equipo y penalidades del documento', () => {
  const r = buildThreadSummaryForLoad({ rawDocumentText: DOC, extracted: { origen: 'POMTOC Terminal, Miami, FL', destino: 'Bartow Cold Storage, Bartow, FL', pickup_fecha: '11/25/2026', delivery_fecha: '11/25/2026' } });
  assert.equal(r.hora_recogida, '08:00');
  assert.equal(r.hora_entrega, '15:00');
  assert.match(r.equipo, /40' Reefer container \(Overweight, tri-axle\)/);
  assert.equal(r.penalidades, 'Late delivery penalty: $150');
});

test('F5: lo que extrajo el verificador tiene prioridad', () => {
  const r = buildThreadSummaryForLoad({ rawDocumentText: DOC, extracted: { pickup_hora: '7:30 AM', delivery_hora: '2:00 PM', tipo_equipo: 'Reefer', tamano_contenedor: "40'", penalidades: 'Late fee $200' } });
  assert.equal(r.hora_recogida, '7:30 AM');
  assert.equal(r.hora_entrega, '2:00 PM');
  // la línea "Equipment:" completa del documento gana (conserva Overweight, tri-axle)
  assert.equal(r.equipo, "40' Reefer container (Overweight, tri-axle)");
  // sin esa línea en el documento, se usa lo de la IA
  assert.equal(buildThreadSummaryForLoad({ rawDocumentText: 'Load #: X1 Miles: 20', extracted: { tipo_equipo: 'Reefer', tamano_contenedor: "40'" } }).equipo, "Reefer · 40'");
  assert.equal(r.penalidades, 'Late fee $200');
});

test('F4: las notas llevan el resumen (direcciones, fechas, horas, equipo), no solo "Load #"', () => {
  const r = buildThreadSummaryForLoad({ rawDocumentText: DOC, extracted: { origen: 'POMTOC Terminal, Miami, FL', destino: 'Bartow Cold Storage, Bartow, FL', pickup_fecha: '11/25/2026', delivery_fecha: '11/25/2026' } });
  assert.match(r.notas, /^Load #QA-LD-1001 · Pickup: POMTOC Terminal, Miami, FL \(2026-11-25 08:00\) · Delivery: Bartow Cold Storage, Bartow, FL \(2026-11-25 15:00\)/);
  assert.match(r.notas, /Equipo: 40' Reefer/);
  assert.match(r.notas, /Penalidad: Late delivery penalty: \$150/);
});

test('F4: una "Rate Inquiry" es solicitud de tarifa (no crea carga)', () => {
  assert.equal(classifyLoadDocument('EMAIL THREAD Can you handle it? How much would you charge?', 'Rate Inquiry'), 'rate_request');
  assert.equal(classifyLoadDocument('Rate Inquiry: Miami POMTOC to Bartow', ''), 'rate_request');
  assert.equal(classifyLoadDocument(DOC, 'Rate Confirmation'), 'confirmation');
});

test('F4: el hilo se resume y sin texto citado, con encabezados en inglés', () => {
  const s = summarizeThreadForChecker([
    { remitente_nombre: 'Broker', remitente_email: 'ops@broker.com', fecha: '2026-11-17', cuerpo: 'Hi,\nPlease quote Miami to Bartow.\n\nOn Mon, Nov 16 Juan wrote:\n> old text' },
    { remitente_nombre: 'Juan', remitente_email: 'juan@x.com', fecha: '2026-11-18', cuerpo: 'x '.repeat(600) },
  ]);
  assert.match(s, /^From: Broker <ops@broker\.com>\nDate: 2026-11-17\nHi, Please quote Miami to Bartow\.\n---/);
  assert.doesNotMatch(s, /old text|De:|Fecha:|Asunto:/);
  assert.ok(s.length < 1000);
});

test('F3: la penalidad no se repite si el servidor ya la puso', () => {
  const analysis = { categorias: [{ categoriaKey: 'clause', semaforo: 'amarillo', hallazgos: ['❌ Penalidad: Late delivery penalty $150', '⚠ Detention no especificada'] }], alertas_criticas: ['❌ Penalidad: Late delivery penalty $150'] };
  const r = applyRiskGuards(analysis, 'Late delivery penalty $150.');
  const pen = r.categorias[0].hallazgos.filter(h => h.startsWith('❌ Penalidad'));
  assert.equal(pen.length, 1);
  assert.equal(r.alertas_criticas.filter(h => h.startsWith('❌ Penalidad')).length, 1);
  assert.equal(r.categorias[0].semaforo, 'rojo');
});

test('QA: la penalidad se corta en el monto, sin la frase siguiente', async () => {
  const { findRiskClauses } = await import('../src/lib/dispatchAutomation.js');
  const r = findRiskClauses('Notes: Genset included. Penalties: Late delivery penalty: $150 Carrier agrees to transport the load described above at the agreed rate.');
  assert.equal(r[0].text, '❌ Penalidad: "Late delivery penalty: $150"');
  const r2 = findRiskClauses('Late delivery penalty: $250 per hour of delay. Thanks');
  assert.equal(r2[0].text, '❌ Penalidad: "Late delivery penalty: $250 per hour"');
});

test('QA: glosario de traducción (fee → rate, charges → loads)', async () => {
  const { glosarioEn } = await import('../src/lib/translationGlossary.js');
  assert.equal(glosarioEn('Total fee: $1,600 — Profitable rate'), 'Total rate: $1,600 — Profitable rate');
  assert.equal(glosarioEn('Known broker: QA Test Brokerage LLC — 0 charges'), 'Known broker: QA Test Brokerage LLC — 0 loads');
  assert.equal(glosarioEn('Fee deductions detected'), 'Fee deductions detected');
});

test('F4: las notas incluyen lo conversado en el hilo (sin texto citado)', () => {
  const threadMessages = [
    { remitente_nombre: 'luis bermudez', fecha: '2026-11-19T20:07:00', cuerpo: 'Hi,\nPlease find attached the rate confirmation for load QA-LD-1001.' },
    { remitente_nombre: 'luis bermudez', fecha: '2026-11-19T20:08:38', cuerpo: 'Received, we will confirm the driver today.\n\nEl jue, 19 nov 2026 a las 15:07, luis (<l@x.com>)\nescribió:\n> Hi,' },
    { remitente_nombre: 'luis bermudez', fecha: '2026-11-19T20:10:08', cuerpo: 'Confirmed. Pickup 08:00, please arrive 30 min early.\n\nOn Thu wrote:\n> Received' },
  ];
  const r = buildThreadSummaryForLoad({ rawDocumentText: DOC, extracted: {}, threadMessages });
  assert.match(r.notas, /Hilo: luis \(19\/11 20:08\): Received, we will confirm the driver today\. \| luis \(19\/11 20:10\): Confirmed\. Pickup 08:00, please arrive 30 min early\.$/);
  assert.doesNotMatch(r.notas, /attached|escribió|> /);
});
