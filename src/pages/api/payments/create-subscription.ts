import type { APIRoute } from "astro";
import { currentAuth } from "../../../lib/auth";
import { cleanText, getDb, json } from "../../../lib/db";
import { razorpayConfig, razorpayRequest } from "../../../lib/razorpay";

type Plan = { id:string; code:string; name:string; price_inr:number; billing_period:string; query_credits:number; razorpay_plan_id:string|null };
type RazorPlan = { id:string };
type RazorSubscription = { id:string; plan_id:string; status:string; short_url?:string; total_count:number };

const periods: Record<string,{period:"monthly"|"quarterly"|"yearly"; interval:number; count:number}> = {
  month:{period:"monthly",interval:1,count:120},
  quarter:{period:"quarterly",interval:1,count:40},
  year:{period:"yearly",interval:1,count:10}
};

export const POST: APIRoute = async (context) => {
  try {
    const user = await currentAuth(context);
    if (!user || user.purpose !== "user" || user.user_type !== "public") return json({error:"Please sign in to subscribe."},401);
    const body = await context.request.json();
    const code = cleanText(body.planCode,30);
    const phone = cleanText(body.phone,20).replace(/\D/g,"");
    if (!["monthly","quarterly","annual"].includes(code) || phone.length < 10 || phone.length > 15) return json({error:"Choose a plan and enter a valid phone number."},400);
    const sql = getDb(context);
    const rows = await sql`SELECT id,code,name,price_inr,billing_period,query_credits,razorpay_plan_id FROM subscription_plans WHERE code=${code} AND is_active=true LIMIT 1`;
    const plan = rows[0] as Plan | undefined;
    if (!plan) return json({error:"That plan is not available."},404);
    const period = periods[plan.billing_period];
    if (!period) return json({error:"This billing period is not supported."},409);
    const {keyId,keySecret} = razorpayConfig(context);
    let razorpayPlanId = plan.razorpay_plan_id;
    if (!razorpayPlanId) {
      const created = await razorpayRequest<RazorPlan>("/plans",keyId,keySecret,{
        period:period.period, interval:period.interval,
        item:{name:"HelpMeDost "+plan.name+" subscription",amount:plan.price_inr*100,currency:"INR",description:plan.query_credits+" eligible queries per billing period"}
      });
      if (!created.id) return json({error:"Could not prepare this subscription plan."},502);
      const saved = await sql`UPDATE subscription_plans SET razorpay_plan_id=${created.id} WHERE id=${plan.id} AND (razorpay_plan_id IS NULL OR razorpay_plan_id=${created.id}) RETURNING razorpay_plan_id`;
      if (!saved.length) return json({error:"Plan setup changed. Please retry."},409);
      razorpayPlanId = saved[0].razorpay_plan_id;
    }
    const ref = "HMD-S-"+Array.from(crypto.getRandomValues(new Uint8Array(10)),b=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b%32]).join("");
    const sub = await razorpayRequest<RazorSubscription>("/subscriptions",keyId,keySecret,{
      plan_id:razorpayPlanId,total_count:period.count,customer_notify:1,
      notes:{helpmedost_reference:ref,profile_id:user.id,plan_code:plan.code}
    });
    if (!sub.id || sub.plan_id !== razorpayPlanId) return json({error:"Unexpected subscription response."},502);
    const inserted = await sql`INSERT INTO subscriptions
      (reference_code,plan_id,user_profile_id,customer_name,customer_email,customer_phone,status,payment_status,payment_provider,razorpay_plan_id,razorpay_subscription_id,total_count)
      VALUES (${ref},${plan.id},${user.id},${user.full_name},${user.email},${phone},'pending','pending','razorpay',${razorpayPlanId},${sub.id},${period.count})
      RETURNING reference_code`;
    if (!inserted.length) return json({error:"Unable to save subscription."},500);
    return json({ok:true,subscriptionId:sub.id,planCode:plan.code,planName:plan.name,amountInr:plan.price_inr,queryCredits:plan.query_credits,keyId,status:sub.status},201);
  } catch(error) {
    console.error("Razorpay subscription creation failed",error);
    return json({error:"Unable to start subscription. Please try again."},500);
  }
};
