import { hasSubscriptionAccess, billingGuard } from '../../base44/functions/sendGmail/billingGuard.ts';
Deno.test('trial access ends at exact boundary; no implicit free access', () => {
 const end = Date.parse('2026-12-01T00:00:00Z');
 const trial = { subscription_status: 'trialing', trial_ends_at: new Date(end).toISOString() };
 if (!hasSubscriptionAccess(trial, end - 1) || hasSubscriptionAccess(trial, end)) throw Error('boundary');
 for (const status of ['none','canceled','past_due','unpaid','incomplete']) if (hasSubscriptionAccess({subscription_status:status})) throw Error(status);
 if (!hasSubscriptionAccess({subscription_status:'active'})) throw Error('active');
});
Deno.test('disabled guard preserves existing behavior without backend calls', async () => {
 Deno.env.delete('BILLING_ACCESS_TEST_ENABLED');
 if (await billingGuard(new Request('https://example.test'), {}) !== null) throw Error('changed access');
});
Deno.test('test actor without paid access denied; nontest actor unchanged', async () => {
 Deno.env.set('BILLING_ACCESS_TEST_ENABLED','true');
 Deno.env.set('BILLING_ACCESS_TEST_USER_EMAILS','test@example.test');
 Deno.env.set('STRIPE_TEST_ORGANIZATION_IDS','org_test');
 const client = (email: string) => ({auth:{me:async()=>({email})},asServiceRole:{entities:{OrganizationMember:{filter:async()=>[{organization_id:'org_test'}]},Organization:{filter:async()=>[{active:true,subscription_status:'none'}]}}}});
 const request=()=>new Request('https://example.test',{method:'POST',body:'{}'});
 if ((await billingGuard(request(),client('test@example.test')))?.status !== 402) throw Error('bypass');
 if (await billingGuard(request(),client('existing@example.test')) !== null) throw Error('legacy regression');
 Deno.env.delete('BILLING_ACCESS_TEST_ENABLED');
});

Deno.test('multiple memberships cannot authorize a different operational tenant', async () => {
 Deno.env.set('BILLING_ACCESS_TEST_ENABLED','true');
 Deno.env.set('BILLING_ACCESS_TEST_USER_EMAILS','test@example.test');
 const client = {auth:{me:async()=>({email:'test@example.test'})},asServiceRole:{entities:{OrganizationMember:{filter:async()=>[{organization_id:'org_old'},{organization_id:'org_paid'}]}}}};
 const req = new Request('https://example.test',{method:'POST',body:JSON.stringify({organization_id:'org_paid'})});
 const result = await billingGuard(req,client);
 if (result?.status !== 403 || (await result.json()).code !== 'TENANT_CONTEXT_NOT_SUPPORTED') throw Error('tenant mismatch allowed');
 Deno.env.delete('BILLING_ACCESS_TEST_ENABLED');
});
Deno.test('lookup exceptions fail closed instead of entering legacy fallback', async () => {
 Deno.env.set('BILLING_ACCESS_TEST_ENABLED','true');
 const response = await billingGuard(new Request('https://example.test'),{auth:{me:async()=>{throw Error('network');}}});
 if (response?.status !== 503) throw Error('fail open');
 Deno.env.delete('BILLING_ACCESS_TEST_ENABLED');
});
Deno.test('all six packaged guards stay identical', async () => {
 const folders=['marketChat','analyzeDocument','extractDocumentText','translateChat','syncGmail','sendGmail'];
 const copies=await Promise.all(folders.map(f=>Deno.readTextFile(`base44/functions/${f}/billingGuard.ts`)));
 if (!copies.every(s=>s===copies[0])) throw Error('guards diverged');
});
