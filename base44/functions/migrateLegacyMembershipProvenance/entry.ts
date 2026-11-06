import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6';
import { demoRedis } from './redis.ts';
import { route, type VerifiedGoogleIdentity } from './migration.ts';

/**
 * migrateLegacyMembershipProvenance — migración ÚNICA (ver migration.ts).
 * Contrato: docs/legacy-provenance-migration.md
 *
 * Variables del servidor:
 *   LEGACY_PROVENANCE_MIGRATION_ENABLED = 'true'  (apagar al terminar)
 *   LEGACY_PROVENANCE_MIGRATION_ADMIN_IDS = '<base44 user id>[,<id>]'
 *   TRUCKY_SERVER_SECRET (llamada servidor-a-servidor de la landing)
 *   GOOGLE_CLIENT_ID, CHECKOUT_REDIS_REST_URL, CHECKOUT_REDIS_REST_TOKEN
 */

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function isTrustedServer(req: Request): boolean {
  const expected = Deno.env.get('TRUCKY_SERVER_SECRET');
  if (!expected) return false;
  const match = (req.headers.get('authorization') ?? '').match(/^Bearer\s+(.+)$/i);
  return !!match && timingSafeEqual(match[1].trim(), expected);
}

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

async function verifyGoogleIdToken(token: string): Promise<VerifiedGoogleIdentity | null> {
  const audience = Deno.env.get('GOOGLE_CLIENT_ID');
  if (!audience) return null;
  // Firma RS256 contra las llaves públicas de Google + emisor, audiencia y expiración.
  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience,
    algorithms: ['RS256'],
  });
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || typeof payload.iat !== 'number') return null;
  return {
    sub: payload.sub,
    email: payload.email,
    email_verified: payload.email_verified === true || payload.email_verified === 'true',
    iat: payload.iat,
  };
}

Deno.serve(async (req: Request) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (req.method !== 'POST') return new Response(JSON.stringify({ code: 'METHOD_NOT_ALLOWED' }), { status: 405, headers });
  try {
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;
    let body: unknown = null;
    try { body = await req.json(); } catch (_) { /* validado en runMigration */ }

    const result = await route(body, {
      enabled: Deno.env.get('LEGACY_PROVENANCE_MIGRATION_ENABLED') === 'true',
      allowedAdminIds: new Set((Deno.env.get('LEGACY_PROVENANCE_MIGRATION_ADMIN_IDS') || '')
        .split(',').map((s) => s.trim()).filter(Boolean)),
      isTrustedServer: () => isTrustedServer(req),
      getCaller: () => base44.auth.me(),
      verifyGoogleIdToken,
      getMember: async (id) => (await db.OrganizationMember.filter({ id }))?.[0] ?? null,
      getOrganization: async (id) => (await db.Organization.filter({ id }))?.[0] ?? null,
      listActiveOwners: (orgId) => db.OrganizationMember.filter({ organization_id: orgId, role: 'owner', active: true }),
      redis: demoRedis,
      now: () => Date.now(),
      newId: () => crypto.randomUUID(),
    });
    const { status, ...payload } = result;
    return new Response(JSON.stringify(payload), { status, headers });
  } catch (_err) {
    // Sin detalles ni tokens en la respuesta/log.
    console.error('legacy_provenance_migration_failed');
    return new Response(JSON.stringify({ code: 'MIGRATION_REQUIRES_REVIEW' }), { status: 503, headers });
  }
});
