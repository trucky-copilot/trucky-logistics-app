import { buildEmailDedupeKey, classifyEmail, getFetchLimit, getPlainText } from './entry.ts';

Deno.test('limits Gmail search to at most 45 messages', () => {
  if (getFetchLimit(100) !== 45) throw new Error('Gmail search exceeded 45 messages');
  if (getFetchLimit(undefined) !== 45) throw new Error('Default Gmail search limit is not 45');
});

Deno.test('keeps duplicate detection isolated by organization and profile', () => {
  const key = buildEmailDedupeKey(
    'sender@example.com',
    'Trucky load',
    '2026-10-26T14:30:00.000Z',
    'user@gmail.com',
    'org-1',
    'profile-1',
  );
  const sameScopeKey = buildEmailDedupeKey(
    'sender@example.com',
    'Trucky load',
    '2026-10-26T14:30:59.000Z',
    'user@gmail.com',
    'org-1',
    'profile-1',
  );
  const differentProfileKey = buildEmailDedupeKey(
    'sender@example.com',
    'Trucky load',
    '2026-10-26T14:30:00.000Z',
    'user@gmail.com',
    'org-1',
    'profile-2',
  );
  if (key !== sameScopeKey) throw new Error('Same-scope email was not deduplicated');
  if (key === differentProfileKey) throw new Error('Email from another profile was incorrectly deduplicated');
});

Deno.test('classifies a Trucky logistics email from its content', () => {
  const result = classifyEmail(
    'Logistica Trucky',
    'carrier flota fleet loads brokers',
    'lanatanbermudez@gmail.com',
  );
  if (!result.es_logistico) throw new Error('Trucky logistics message was filtered out');
});

Deno.test('classifies the Trucky email subject shown in the inbox screenshot', () => {
  const result = classifyEmail(
    'logistica Trucky - carrier flota fleet loads brokers',
    'carrier flota fleet loads brokers',
    'lanatanbermudez@gmail.com',
  );
  if (!result.es_logistico) throw new Error('The Trucky inbox example was filtered out');
});

Deno.test('keeps Trucky logistics emails with generic privacy or footer text', () => {
  const result = classifyEmail(
    'Logistica Trucky',
    'carrier flota fleet loads brokers. Review our privacy policy and unsubscribe.',
    'lanatanbermudez@gmail.com',
  );
  if (!result.es_logistico) throw new Error('Trucky email was rejected because of generic footer text');
});

Deno.test('does not classify download notifications as logistics loads', () => {
  const result = classifyEmail(
    'Congratulations! You are in!',
    'Download the latest update and start learning.',
    'notification@microsoft.com',
  );
  if (result.es_logistico) throw new Error('Non-logistics download message was included');
});

Deno.test('does not match logistics words inside longer words', () => {
  const result = classifyEmail(
    'Your account update',
    'Download your document from the portal.',
    'updates@example.com',
  );
  if (result.es_logistico) throw new Error('The substring "load" matched "download"');
});

Deno.test('extracts nested Gmail text/plain payloads', () => {
  const encoded = btoa('Carrier load');
  const text = getPlainText({
    mimeType: 'multipart/alternative',
    parts: [{ mimeType: 'text/plain', body: { data: encoded } }],
  });
  if (text !== 'Carrier load') throw new Error('Gmail plain text body was not decoded');
});

Deno.test('shows email when it has both importante and broker/carrier/trucky labels', () => {
  const result = classifyEmail(
    'Actualización de cuenta',
    'Hola adjunto información de la cuenta.',
    'contacto@empresa.com',
    ['IMPORTANT', 'broker']
  );
  if (!result.es_logistico) throw new Error('Email with both importante and broker label was not shown');
  if (result.categoria !== 'brokers') throw new Error('Category should be brokers');

  const resultCarrier = classifyEmail(
    'Aviso general',
    'Por favor revisar.',
    'contacto@empresa.com',
    ['importante', 'carrier']
  );
  if (!resultCarrier.es_logistico) throw new Error('Email with both importante and carrier label was not shown');

  const resultTrucky = classifyEmail(
    'Notificación interna',
    'Mensaje directo',
    'info@customdomain.com',
    ['IMPORTANT', 'trucky']
  );
  if (!resultTrucky.es_logistico) throw new Error('Email with both importante and trucky label was not shown');
});
