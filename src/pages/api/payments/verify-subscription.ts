import type { APIRoute } from "astro";
import { currentAuth } from "../../../lib/auth";
import { cleanText, getDb, json } from "../../../lib/db";
import { hmacSha256Hex, razorpayConfig, razorpayRequest, safeEqual } from "../../../lib/razorpay";
export const POST:APIRoute=async(context)=>{
  try{
    const user=await currentAuth(context);
    if(!user||user.purpose!=="user"||user.user_type!=="public")return json({error:"Please sign in to verify subscription."},401);
    const b=await context.request.json();
    const ref=cleanText(b.referenceCode,40),subId=cleanText(b.razorpay_subscription_id,80),paymentId=cleanText(b.razorpay_payment_id,80),sig=cleanText(b.razorpay_signature,128);
    if(!ref||!subId||!paymentId||!sig)return json({error:"Invalid subscription verification details."},400);
    const sql=getDb(context);
    const rows=await sql`SELECT id,razorpay_subscription_id,status FROM subscriptions WHERE reference_code=${ref} AND user_profile_id=${user.id} LIMIT 1`;
    const rec=rows[0];
    if(!rec||rec.razorpay_subscription_id!==subId)return json({error:"Subscription does not match your account."},400);
    const {keyId,keySecret}=razorpayConfig(context);
    const expected=await hmacSha256Hex(keySecret,paymentId+"|"+subId);
    if(!safeEqual(expected,sig))return json({error:"Subscription signature verification failed."},400);
    const remote=await razorpayRequest<{id:string;plan_id:string;status:string}>("/subscriptions/"+encodeURIComponent(subId),keyId,keySecret);
    if(remote.id!==subId||!["authenticated","active","pending"].includes(remote.status))return json({error:"Subscription is not authorised by Razorpay."},409);
    await sql`UPDATE subscriptions SET authorization_payment_id=${paymentId},updated_at=now() WHERE id=${rec.id} AND user_profile_id=${user.id}`;
    return json({ok:true,status:remote.status,message:"Payment authorisation received. Subscription activates after Razorpay confirms it."});
  }catch(error){console.error("Razorpay subscription verification failed",error);return json({error:"Unable to verify subscription right now."},500);}
};
