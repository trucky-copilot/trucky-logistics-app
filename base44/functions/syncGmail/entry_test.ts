import { classifyEmail, getFetchLimit, getPlainText } from './entry.ts';

Deno.test('limits Gmail search to at most 45 messages', () => {
  if (getFetchLimit(100) !== 45) throw new Error('Gmail search exceeded 45 messages');
  if (getFetchLimit(undefined) !== 45) throw new Error('Default Gmail search limit is not 45');
});

Deno.test('classifies a Trucky logistics email from its content', () => {
  const result = classifyEmail(
    'Logistica Trucky',
    'carrier flota fleet loads brokers',
    'lanatanbermudez@gmail.com',
  );
  if (!result.es_logistico) throw new Error('Trucky logistics message was filtered out');
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
