import test from 'node:test';
import assert from 'node:assert/strict';
import { detectEquipment, stripAccessorials } from '../src/lib/emailEquipment.js';
const eq = (asunto, cuerpo) => detectEquipment({ asunto, cuerpo });

test('40HQ y sus variantes se reconocen como 40\' HC', () => {
  assert.deepEqual(eq('RFQ |MIAMI TO FL 33010', 'Equipment: 1 × 40HQ - Weight: 10,000 KG'), ["40' HC"]);
  assert.deepEqual(eq('RFQ | MIAMI TO FL 33762', 'Pickup: PORT EVERGLADES 1*40HQ'), ["40' HC"]);
  assert.deepEqual(eq("Miami Port to FL 34986 // 40'HQ", ''), ["40' HC"]);
  assert.deepEqual(eq("Miami Port to FL 33122 // 40’HQ", ''), ["40' HC"]);
  assert.deepEqual(eq('1x40HQ to Doral', ''), ["40' HC"]);
  assert.deepEqual(eq('40 HQ reefer', ''), ["40' HC", 'Reefer']);
  assert.deepEqual(eq('1x40 HC', ''), ["40' HC"]);
});

test('Juan D Cifuentes: reefer legal, sin Tri-axle ni Overweight por la lista de accesoriales', () => {
  const cuerpo = [
    'Hi team Hope you are well, We are looking at rates for this movement, could you please please share your current rates for the following',
    '*ORIGIN: Miami Ports',
    '*DESTINATION: FL 34142, USA',
    '*EQUIPMENT: 40HC - REEF CONTAINER (LEGAL W)',
    '',
    'Please also include the following accessorials:',
    '- Tri-axle chassis',
    '- Overweight fee',
    '- Pre-pull',
    '- Storage',
    '',
    'Thanks',
  ].join('\n');
  const tags = eq('LOAD OPPORTUNITY IMPO REEF (Miami Ports TO FL. 34142, USA)', cuerpo);
  assert.deepEqual(tags, ["40' HC", 'Reefer']);
});

test('cargos sueltos en una línea no generan etiqueta', () => {
  assert.deepEqual(eq('20GP to Orlando', 'Rate incl. overweight fee and tri-axle chassis fee if applies'), ["20' GP"]);
});

test('carga realmente overweight / tri-axle sigue etiquetada', () => {
  assert.deepEqual(eq('DRAYAGE RATE REQUEST- 20" CONTAINER // TRI-AXEL // OVERWEIGHT 60000lbs// Live Load', ''), ["20'", 'Tri-axle', 'Overweight']);
  assert.deepEqual(eq('20ft PortMiami to Orlando', '- Chassis: Tri-axle required\nWeight 62,000 lbs'), ["20'", 'Tri-axle', 'Overweight']);
});

test('peso legal no se marca Overweight', () => {
  assert.deepEqual(eq('40DC legal weight to Hialeah', ''), ["40' DC"]);
});

test('sin datos de equipo: drayage queda como Container', () => {
  assert.deepEqual(eq('Drayage request', 'Container from Port Everglades'), ['Container']);
});

test('stripAccessorials conserva el detalle de la carga después de la lista', () => {
  const out = stripAccessorials('Accessorials:\n- Overweight fee\n\n40HC heavy load 65,000 lbs');
  assert.match(out, /40HC heavy load/);
  assert.doesNotMatch(out, /Overweight fee/);
});

test('lista de cargos sin encabezado también se ignora; lista de datos de carga se conserva', () => {
  const cargos = 'Rates for 40HC REEF (LEGAL W):\n- Tri-axle chassis\n- Overweight\n- Pre-pull\n- Storage per day';
  assert.deepEqual(eq('IMPO REEF', cargos), ["40' HC", 'Reefer']);
  const datos = '- Pickup: PortMiami (G-Gate)\n- Delivery: Orlando DC\n- Chassis: Tri-axle required';
  assert.deepEqual(eq('20ft container', datos), ["20'", 'Tri-axle']);
});
