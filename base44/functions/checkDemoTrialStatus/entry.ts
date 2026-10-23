import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

const WHITELISTED_ADMIN_EMAILS = new Set([
  'daniel.vargas@ogm.com.co',
  'luisbermudezacero@gmail.com',
  'juan.grau@ogm.com.co',
  'luis.bermudez@ogm.com.co',
]);

const ALLOWED_ORIGIN_SUFFIXES = ['.base44.app', '.base44.com', '.trucky.site', 'trucky.site'];
const ALLOWED_ORIGIN_PREFIXES = ['http://localhost:', 'http://127.0.0.1:'];

function corsHeadersFor(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowed =
    !!origin &&
    (ALLOWED_ORIGIN_SUFFIXES.some((suffix) => origin.endsWith(suffix)) ||
      ALLOWED_ORIGIN_PREFIXES.some((prefix) => origin.startsWith(prefix)));

  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json',
  };
}

export default async function checkDemoTrialStatus(req: Request, _ctx: unknown) {
  const corsHeaders = corsHeadersFor(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const base44 = createClientFromRequest(req);
    let user;
    try {
      user = await base44.auth.me();
    } catch (_error) {
      user = null;
    }

    if (!user || !user.email) {
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const email = user.email.toLowerCase().trim();

    // 1. Administradores exentos
    if (WHITELISTED_ADMIN_EMAILS.has(email)) {
      return new Response(
        JSON.stringify({
          is_whitelisted: true,
          has_trial: true,
          is_expired: false,
          trial_started_at: null,
          trial_ends_at: null,
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    // 2. Consultar con permisos de servicio (asServiceRole) para omitir restricciones RLS de cliente
    const db = base44.asServiceRole.entities;
    const trials = await db.DemoTrial.filter({ user_email: email });

    if (!trials || trials.length === 0) {
      return new Response(
        JSON.stringify({
          is_whitelisted: false,
          has_trial: false,
          is_expired: true,
          trial_started_at: null,
          trial_ends_at: null,
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    const trial = trials[0];
    const endsAtMs = Date.parse(trial.trial_ends_at);
    const isExpired = !isNaN(endsAtMs) && endsAtMs <= Date.now();

    return new Response(
      JSON.stringify({
        is_whitelisted: false,
        has_trial: true,
        is_expired: isExpired,
        trial_started_at: trial.trial_started_at,
        trial_ends_at: trial.trial_ends_at,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'INTERNAL_ERROR';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: corsHeaders }
    );
  }
}
