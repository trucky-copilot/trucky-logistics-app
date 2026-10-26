# Demo form trial activation

New entity DemoTrial and function activateDemoTrial. Native Google ID token is verified; stable sub identifies eligibility. Server computes started_at and ends_at (30*24h) once using atomic Redis SET NX with no TTL. Resends use same dates. Base44 DemoTrial is a projection; concurrent/uncertain inserts may duplicate rows but cannot extend canonical Redis period. Do not delete Redis trial records to reset demos.

Deploy DemoTrial + activateDemoTrial with colocated demoRegistry.ts. Uses existing GOOGLE_CLIENT_ID, TRUCKY_SERVER_SECRET and CHECKOUT_REDIS_REST_URL/TOKEN. Default OFF via DEMO_TRIAL_ACTIVATION_ENABLED; enable in Base44 only after publication and Vercel code deployment. Same flag required on website. Website activates before sending Gmail; a mail failure does not undo or restart the trial. Expired trials do not get another invitation.

This stores trial dates and connects the form; it DOES NOT close accounts, enforce operations, implement native Base44 user/Google binding or modify existing-user access. Those remain separate work. DemoTrial is admin-readable/writable only (service role used). No existing RLS/entities modified. User data is not logged. New Google subject and full acceptance testing required before enabling.
