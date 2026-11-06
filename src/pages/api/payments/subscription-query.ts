import type {APIRoute} from "astro";
import {currentAuth} from "../../../lib/auth";
import {cleanText,getDb,json} from "../../../lib/db";
const types=["personal_guidance","detailed_assistance","document_review"];
function reference(){return "HMD-C-"+Array.from(crypto.getRandomValues(new Uint8Array(10)),b=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b%32]).join("");}
export const POST:APIRoute=async(context)=>{
 try{
  const user=await currentAuth(context);if(!user||user.purpose!=="user"||user.user_type!=="public")return json({error:"Please sign in."},401);
  const b=await context.request.json(),subscriptionRef=cleanText(b.subscriptionReference,40),type=cleanText(b.queryType,40),subject=cleanText(b.subject,180),description=cleanText(b.description,4000);
  if(!subscriptionRef||!types.includes(type)||!subject||!description)return json({error:"Choose a subscription, query type and enter the subject and details."},400);
  const sql=getDb(context),ref=reference();
  const rows=await sql`
    WITH used AS (
      UPDATE subscriptions s SET query_credits_remaining=s.query_credits_remaining-1,updated_at=now()
      WHERE s.reference_code=${subscriptionRef} AND s.user_profile_id=${user.id} AND s.status='active'
        AND s.payment_status='paid' AND s.query_credits_remaining>0 AND s.ends_at>now()
      RETURNING s.id,s.user_profile_id
    ), created AS (
      INSERT INTO subscription_queries(reference_code,subscription_id,user_profile_id,query_type,subject,description)
      SELECT ${ref},id,user_profile_id,${type},${subject},${description} FROM used
      RETURNING reference_code,subscription_id
    ) SELECT created.reference_code,s.query_credits_remaining FROM created JOIN subscriptions s ON s.id=created.subscription_id
  `;
  if(!rows.length)return json({error:"No available query credit on this active subscription."},409);
  return json({ok:true,referenceCode:rows[0].reference_code,creditsRemaining:rows[0].query_credits_remaining},201);
 }catch(error){console.error("Subscription query submission failed",error);return json({error:"Unable to submit query."},500);}
};
