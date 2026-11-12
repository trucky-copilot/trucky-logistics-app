// F3-15 fase 2: validación de Perfil personal.
import test from 'node:test'; import assert from 'node:assert/strict';
import { normalizeProfile, validateProfile } from '../src/lib/profileValidation.js';

test('normaliza: espacios en el nombre, MC/DOT solo dígitos', () => {
  assert.deepEqual(normalizeProfile({ nombre_completo: '  Luis   Bermudez ', telefono: ' +1 (305) 555-0101 ', mc_number: 'MC-123456', dot_number: 'DOT 7654321' }),
    { nombre_completo: 'Luis Bermudez', telefono: '+1 (305) 555-0101', mc_number: '123456', dot_number: '7654321' });
});
test('datos válidos → sin errores; teléfono, MC y DOT son opcionales', () => {
  assert.deepEqual(validateProfile(normalizeProfile({ nombre_completo: 'Luis Bermudez', telefono: '+57 321 487 7123', mc_number: '123456', dot_number: '1234567' })), {});
  assert.deepEqual(validateProfile(normalizeProfile({ nombre_completo: 'Luis' })), {});
});
test('errores: nombre vacío, teléfono con letras o corto, MC/DOT fuera de rango', () => {
  const e = validateProfile(normalizeProfile({ nombre_completo: ' ', telefono: '555-abc', mc_number: '12', dot_number: '123456789' }));
  assert.deepEqual(Object.keys(e).sort(), ['dot_number', 'mc_number', 'nombre_completo', 'telefono']);
  assert.ok(validateProfile(normalizeProfile({ nombre_completo: 'Ana', telefono: '12345' })).telefono);
});
