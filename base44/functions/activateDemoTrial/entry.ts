import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { demoRedis } from './demoRegistry.ts';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
interface GoogleIdentity { sub: string; email: string; }
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}});
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

function isAuthorizedServer(req: Request): boolean {
  const expected = Deno.env.get('TRUCKY_SERVER_SECRET');
  if (!expected) return false;
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return !!match && timingSafeEqual(match[1].trim(), expected);
}

async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity | null> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  if (!clientId) return null;

  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );
  if (!res.ok) return null;

  const claims = await res.json();
  const nowSec = Math.floor(Date.now() / 1000);

  if (claims.aud !== clientId) return null;
  if (!GOOGLE_ISSUERS.has(claims.iss)) return null;
  if (!claims.exp || Number(claims.exp) <= nowSec) return null;
  if (claims.email_verified !== 'true' && claims.email_verified !== true) return null;
  if (!claims.sub || !claims.email) return null;

  return { sub: String(claims.sub), email: String(claims.email).toLowerCase() };
}


export default async function activateDemoTrial(req: Request, _ctx: unknown) {
 if(req.method !== 'POST') return json({code:'METHOD_NOT_ALLOWED'},405);
 if(!isAuthorizedServer(req)) return json({code:'UNAUTHORIZED'},401);
 if(Deno.env.get('DEMO_TRIAL_ACTIVATION_ENABLED') !== 'true') return json({code:'ACTIVATION_NOT_ENABLED'},503);
 try {
  const body=await req.json();
  if(typeof body.google_id_token !== 'string' || body.google_id_token.length>4096) return json({code:'INVALID_TOKEN'},400);
  const identity=await verifyGoogleIdToken(body.google_id_token);
  if(!identity) return json({code:'UNAUTHORIZED'},401);
  const now=Date.now();
  const key=`trucky:demo:trial:v1:${identity.sub}`;
  const dates={started_at:new Date(now).toISOString(),ends_at:new Date(now+30*86400000).toISOString()};
  // This record is never expired: same identity cannot reset the trial.
  await demoRedis(['SET',key,JSON.stringify(dates),'NX']);
  const raw=await demoRedis(['GET',key]);
  if(!raw) throw Error('REGISTRY_UNAVAILABLE');
  const trial=JSON.parse(raw);
  const db=createClientFromRequest(req).asServiceRole.entities;
  const rows=await db.DemoTrial.filter({google_sub:identity.sub});
  if(!rows?.length) {
   // Database projection may duplicate after uncertain writes. Redis is canonical;
   // all projections retain the SAME dates, never extending access.
   await db.DemoTrial.create({google_sub:identity.sub,user_email:identity.email,
     trial_started_at:trial.started_at,trial_ends_at:trial.ends_at});
  }
  return json({code:'DEMO_TRIAL_ACTIVATED',trial_started_at:trial.started_at,
    trial_ends_at:trial.ends_at,expired:Date.parse(trial.ends_at)<=Date.now()});
 } catch {return json({code:'ACTIVATION_REQUIRES_REVIEW'},503);}
}
