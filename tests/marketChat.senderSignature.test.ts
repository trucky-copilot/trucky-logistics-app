import { assertEquals } from 'jsr:@std/assert@1';
import { fillSenderFields, missingSenderFields, senderData } from '../base44/functions/marketChat/senderSignature.ts';

const user = { email: 'luis@x.com', full_name: 'luis' };

Deno.test('firma: el Perfil personal manda sobre el CarrierProfile; la empresa es la de la cuenta', () => {
  const s = senderData({ userProfile: { nombre_completo: 'Luis Bermudez', telefono: '+57 321 487 7123', mc_number: '789456', dot_number: '147963' }, carrierProfile: { mc_number: '111' }, organizationName: 'Truck USA', user });
  assertEquals(s, { nombre: 'Luis Bermudez', empresa: 'Truck USA', mc: '789456', dot: '147963', telefono: '+57 321 487 7123', email: 'luis@x.com' });
  assertEquals(missingSenderFields(s), []);
});

Deno.test('firma: rellena los campos que el LLM dejó sin llenar', () => {
  const s = senderData({ userProfile: { nombre_completo: 'Luis Bermudez', telefono: '+573214877123', mc_number: '789456', dot_number: '147963' }, organizationName: 'Truck USA', user });
  const txt = 'Hello Team,\n\nBest regards,\n[Your name]\n[Company]\nMC# (Configura tu Carrier Profile) | DOT# [DOT]\nPhone: [Phone]\nEmail: [email]';
  assertEquals(fillSenderFields(txt, s), 'Hello Team,\n\nBest regards,\nLuis Bermudez\nTruck USA\nMC# 789456 | DOT# 147963\nPhone: +573214877123\nEmail: luis@x.com');
});

Deno.test('firma: si falta un dato se quita, no se deja el texto de relleno; el MC del broker no se toca', () => {
  const s = senderData({ userProfile: { mc_number: '789456' }, organizationName: 'Truck USA', user });
  const txt = 'MC#: [MC]\nSaludos,\nMC# (Configura tu Carrier Profile) | DOT# [DOT]\nTeléfono: [Phone]\nCorreo: luis@x.com';
  assertEquals(fillSenderFields(txt, s), 'MC#: [MC]\nSaludos,\nMC# 789456\nCorreo: luis@x.com');
  const vacio = senderData({ organizationName: 'Truck USA', user });
  assertEquals(fillSenderFields('MC# [MC] | DOT# [DOT]\nPhone: [phone]\nok', vacio), 'ok');
  assertEquals(missingSenderFields(vacio), ['mc', 'dot', 'telefono']);
});

Deno.test('firma: plantilla de seguimiento "[Company] · MC# [MC]"', () => {
  const s = senderData({ userProfile: { mc_number: '789456' }, organizationName: 'Truck USA', user });
  assertEquals(fillSenderFields('[Company] · MC# [MC]', s), 'Truck USA · MC# 789456');
  assertEquals(fillSenderFields('[Company] · MC# [MC]', senderData({ organizationName: 'Truck USA', user })), 'Truck USA');
});
