import type { APIRoute } from "astro";
import { currentAuth } from "../../../lib/auth";
import { cleanText, getDb, json } from "../../../lib/db";
import { razorpayConfig, razorpayRequest } from "../../../lib/razorpay";

function safePaymentError(error: unknown) {\n  if (error instanceof Error && /^(Razorpay|Payment gateway)/i.test(error.message)) return error.message.slice(0, 300);\n  return "Unable to start subscription. Please try again.";\n}\ntype Plan={id:string;code:string;name:string;price_inr:number;billing_period:string;query_credits:number;razorpay_plan_id:string|null};
type RazorPlan={id:string};
type RazorSubscription={id:string;plan_id:string;status:string;short_url?:string;total_count:number};
const periods:Record<string,{period:"monthly"|"quarterly"|"yearly";count:number}>={month:{period:"monthly",count:1200},quarter:{period:"quarterly",count:400},year:{period:"yearly",count:100}};
export const POST:APIRoute=async(context)=>{
  let createdSubscriptionId="";
  try {
    const user=await currentAuth(context);
    if(!user||user.purpose!=="user"||user.user_type!=="public") return json({error:"Please sign in to subscribe."},401);
    const body=await context.request.json();
    const code=cleanText(body.planCode,30),phone=cleanText(body.phone,20).replace(/\D/g,"");
    if(!["monthly","quarterly","annual"].includes(code)||phone.length<10||phone.length>15) return json({error:"Choose a plan and enter a valid phone number."},400);
    const sql=getDb(context);
    const rows=await sql`SELECT id,code,name,price_inr,billing_period,query_credits,razorpay_plan_id FROM subscription_plans WHERE code=${code} AND is_active=true LIMIT 1`;
    const plan=rows[0] as Plan|undefined;
    if(!plan) return json({error:"That plan is not available."},404);
    const period=periods[plan.billing_period];
    if(!period) return json({error:"This billing period is not supported."},409);
    const {keyId,keySecret}=razorpayConfig(context);
    let planId=plan.razorpay_plan_id;
    if(!planId){
      const remote=await razorpayRequest<RazorPlan>("/plans",keyId,keySecret,{period:period.period,interval:1,item:{name:"HelpMeDost "+plan.name+" subscription",amount:plan.price_inr*100,currency:"INR",description:plan.query_credits+" eligible queries per billing period"}});
      if(!remote.id) return json({error:"Could not prepare this subscription plan."},502);
      const saved=await sql`UPDATE subscription_plans SET razorpay_plan_id=${remote.id} WHERE id=${plan.id} AND (razorpay_plan_id IS NULL OR razorpay_plan_id=${remote.id}) RETURNING razorpay_plan_id`;
      if(!saved.length) return json({error:"Plan setup changed. Please retry."},409);
      planId=saved[0].razorpay_plan_id;
    }
    const ref="HMD-S-"+Array.from(crypto.getRandomValues(new Uint8Array(10)),b=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b%32]).join("");
    const pending=await sql`INSERT INTO subscriptions(reference_code,plan_id,user_profile_id,customer_name,customer_email,customer_phone,status,payment_status,payment_provider,razorpay_plan_id,total_count)
      VALUES(${ref},${plan.id},${user.id},${user.full_name},${user.email},${phone},'pending_payment','pending','razorpay',${planId},${period.count}) RETURNING id`;
    const sub=await razorpayRequest<RazorSubscription>("/subscriptions",keyId,keySecret,{plan_id:planId,total_count:period.count,customer_notify:1,notes:{helpmedost_reference:ref,profile_id:user.id,plan_code:plan.code}});
    createdSubscriptionId=sub.id||"";
    if(!sub.id||sub.plan_id!==planId) throw new Error("Unexpected gateway subscription response.");
    await sql`UPDATE subscriptions SET razorpay_subscription_id=${sub.id} WHERE id=${pending[0].id} AND user_profile_id=${user.id}`;
    return json({ok:true,referenceCode:ref,subscriptionId:sub.id,planCode:plan.code,planName:plan.name,amountInr:plan.price_inr,queryCredits:plan.query_credits,keyId,status:sub.status},201);
  } catch(error) {
    if(createdSubscriptionId) {
      try {
        const {keyId,keySecret}=razorpayConfig(context);
        await razorpayRequest("/subscriptions/"+encodeURIComponent(createdSubscriptionId)+"/cancel",keyId,keySecret,{cancel_at_cycle_end:0});
      } catch {}
    }
    console.error("Razorpay subscription creation failed",error);
    return json({error:safePaymentError(error)},500);
  }
};
