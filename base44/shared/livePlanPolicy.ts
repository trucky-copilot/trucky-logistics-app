export type PaidPlan='plan_29'|'plan_99';
const safe=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
export function validateLivePlan(org:any,sub:any,prices:{owner_op?:string;fleet?:string}) {
 const fail=(code:string)=>({allowed:false as const,code});
 if(!safe(org?.id)||org.active!==true)return fail('LIVE_ORGANIZATION_UNAVAILABLE');
 if(!/^sub_[A-Za-z0-9]+$/.test(org.stripe_live_subscription_id||'')||!/^cus_[A-Za-z0-9]+$/.test(org.stripe_live_customer_id||''))return fail('LIVE_MAPPING_REQUIRED');
 const customer=typeof sub?.customer==='string'?sub.customer:sub?.customer?.id;
 if(sub?.id!==org.stripe_live_subscription_id||sub.livemode!==true||sub.metadata?.org_id!==org.id||customer!==org.stripe_live_customer_id)return fail('LIVE_SUBSCRIPTION_MISMATCH');
 if(sub.status!=='active'||sub.trial_end&&sub.trial_end>Date.now()/1000)return fail('LIVE_PAYMENT_REQUIRED');
 if(!/^price_[A-Za-z0-9]+$/.test(prices.owner_op||'')||!/^price_[A-Za-z0-9]+$/.test(prices.fleet||'')||prices.owner_op===prices.fleet)return fail('LIVE_PRICES_REQUIRED');
 const items=sub.items?.data;if(!Array.isArray(items)||items.length!==1||sub.items?.has_more||items[0].quantity!==1)return fail('LIVE_PLAN_MISMATCH');
 const price=items[0].price;
 const plan:PaidPlan|null=price?.id===prices.owner_op?'plan_29':price?.id===prices.fleet?'plan_99':null;
 // Tickets 91/100: el plan se reconoce SOLO por el ID de precio configurado en los
 // secretos (STRIPE_LIVE_PRICE_OWNER_OP / _FLEET), nunca por un monto fijo: para
 // cambiar el precio se crea el precio nuevo en Stripe y se actualiza el secreto.
 if(!plan||price.livemode!==true||price.currency!=='usd'||!(Number.isSafeInteger(price.unit_amount)&&price.unit_amount>0)||price.type!=='recurring'||price.recurring?.interval!=='month'||price.recurring.interval_count!==1||price.billing_scheme!=='per_unit')return fail('LIVE_PLAN_MISMATCH');
 const paid=sub.verifiedPaidCredit;
 if(paid){
  if(!/^in_[A-Za-z0-9]+$/.test(paid.invoiceId||'')||!Number.isSafeInteger(paid.paidAt)||paid.paidAt<=0||!['plan_29','plan_99'].includes(paid.plan)||paid.priceId!==(paid.plan==='plan_29'?prices.owner_op:prices.fleet))return fail('LIVE_INVOICE_MISMATCH');
  return {allowed:true as const,plan:paid.plan as PaidPlan,organizationId:String(org.id),code:'LIVE_PLAN_VERIFIED',subscriptionId:sub.id,credit:paid};
 }
 const invoice=sub.latest_invoice;
 if(!invoice||typeof invoice!=='object'||invoice.livemode!==true||(['subscription_create','subscription_update'].includes(invoice.billing_reason)&&invoice.status!=='paid')||(typeof invoice.customer==='string'?invoice.customer:invoice.customer?.id)!==customer)return fail('LIVE_INVOICE_PAYMENT_REQUIRED');
 if(!['subscription_create','subscription_cycle','subscription_update'].includes(invoice.billing_reason))return fail('LIVE_INVOICE_PAYMENT_REQUIRED');
 const ref=invoice.parent?.subscription_details?.subscription??invoice.subscription;
 if((typeof ref==='string'?ref:ref?.id)!==sub.id)return fail('LIVE_INVOICE_MISMATCH');
 return {allowed:true as const,plan,organizationId:String(org.id),code:'LIVE_PLAN_VERIFIED'};
}
export type ReadDeps={enabled:boolean;redis:(c:unknown[])=>Promise<unknown>;members:(q:any)=>Promise<any[]>;orgs:(id:string)=>Promise<any[]>;subscription:(id:string)=>Promise<any>;prices:{owner_op?:string;fleet?:string}};
export async function resolveLivePlan(user:any,d:ReadDeps){
 const legacy={managed:false as const};if(!d.enabled)return legacy;
 const fail=(code:string)=>({managed:true as const,allowed:false as const,code});
 if(!safe(user?.id))return fail('NATIVE_SESSION_REQUIRED');
 // Resolve native-bound server rows first: unrelated existing users never acquire
 // a Redis/Stripe dependency merely because live checks are enabled.
 const nativeMembers=await d.members({base44_user_id:user.id,active:true});
 if(!nativeMembers.length)return legacy;
 const candidates=[];
 for(const member of nativeMembers){
  if(!safe(member.organization_id))return fail('VERIFIED_MEMBERSHIP_REQUIRED');
  const rows=await d.orgs(member.organization_id);
  if(rows.length!==1||rows[0].id!==member.organization_id||rows[0].active!==true)return fail('LIVE_ORGANIZATION_UNAVAILABLE');
  const candidate=rows[0];
  if(candidate.stripe_live_subscription_id||candidate.stripe_live_customer_id||candidate.stripe_live_subscription_status||candidate.stripe_live_price_id||candidate.stripe_live_plan_type||candidate.stripe_live_sync_operation_id)candidates.push({member,org:candidate});
 }
 if(!candidates.length)return legacy;
 if(nativeMembers.length!==1||candidates.length!==1)return fail('CANONICAL_ORGANIZATION_REQUIRED');
 const {member:m,org}=candidates[0];
 const sub=await d.redis(['GET',`trucky:billing:native:v1:${user.id}`]);
 if(!safe(sub)||await d.redis(['GET',`trucky:billing:identity:v1:${sub}`])!==user.id)return fail('IDENTITY_REQUIRES_REVIEW');
 if(!safe(m.id)||m.base44_user_id!==user.id||m.google_sub!==sub||m.active!==true||!['owner','admin'].includes(m.role))return fail('VERIFIED_MEMBERSHIP_REQUIRED');
 const raw=await d.redis(['GET',`trucky:billing:member:v1:${m.organization_id}:${sub}`]);
 if(typeof raw!=='string')return fail('MEMBERSHIP_PROVENANCE_REQUIRED');const proof=JSON.parse(raw);
 if(proof.memberId!==m.id||proof.orgId!==m.organization_id||proof.googleSub!==sub||proof.role!==m.role)return fail('MEMBERSHIP_PROVENANCE_MISMATCH');
 // Do not authorize while state is in an operator-reconciliation workflow.
 if(await d.redis(['EXISTS',`trucky:billing:sync:live:org:${org.id}`,`trucky:billing:sync:live:pending:org:${org.id}`])!==0)return fail('LIVE_SYNC_PENDING');
 // Existing functions pick membership by native email; make sure that context cannot
 // resolve another company than the proven company before any AI/mail/data use.
 const operational=await d.members({user_email:String(user.email||'').toLowerCase(),active:true});
 if(!operational.length||operational.some(x=>x.organization_id!==org.id))return fail('CANONICAL_ORGANIZATION_REQUIRED');
 return {managed:true as const,...validateLivePlan(org,await d.subscription(org.stripe_live_subscription_id),d.prices)};
}
