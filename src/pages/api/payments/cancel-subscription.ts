import type { APIRoute } from "astro";
import { currentAuth } from "../../../lib/auth";
import { cleanText, getDb, json } from "../../../lib/db";
import { razorpayConfig, razorpayRequest } from "../../../lib/razorpay";

export const POST: APIRoute = async (context) => {
  try {
    const user = await currentAuth(context);
    if (!user || user.purpose!=="user" || user.user_type!=="public") return json({error:"Please sign in."},401);
    const body=await context.request.json();
    const reference=cleanText(body.referenceCode,40);
    if(!reference) return json({error:"Subscription reference is required."},400);
    const sql=getDb(context);
    const rows=await sql`SELECT id,razorpay_subscription_id,status FROM subscriptions WHERE reference_code=${reference} AND user_profile_id=${user.id} LIMIT 1`;
    const record=rows[0];
    if(!record) return json({error:"Subscription not found."},404);
    if(!record.razorpay_subscription_id) return json({error:"This subscription is not linked to Razorpay."},409);
    if(["cancelled","completed","expired"].includes(record.status)) return json({ok:true,alreadyCancelled:true});
    const {keyId,keySecret}=razorpayConfig(context);
    const cancelled=await razorpayRequest<{id:string;status:string}>("/subscriptions/"+encodeURIComponent(record.razorpay_subscription_id)+"/cancel",keyId,keySecret,{cancel_at_cycle_end:1});
    if(cancelled.id!==record.razorpay_subscription_id) return json({error:"Unexpected cancellation response."},502);
    await sql`UPDATE subscriptions SET cancel_requested_at=COALESCE(cancel_requested_at,now()),updated_at=now() WHERE id=${record.id} AND user_profile_id=${user.id}`;
    return json({ok:true,status:cancelled.status,cancelAtCycleEnd:true});
  } catch(error) {
    console.error("Razorpay subscription cancellation failed",error);
    return json({error:"Unable to cancel subscription right now."},500);
  }
};
