import type { APIRoute } from "astro";
import { currentAuth } from "../../../lib/auth";
import { cleanText, getDb, json } from "../../../lib/db";
import { razorpayConfig, razorpayRequest } from "../../../lib/razorpay";
function indiaDate(value:Date){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(value);}
function workingDaysBetween(start:Date,end:Date){
  const a=indiaDate(start),b=indiaDate(end);
  let d=new Date(a+"T00:00:00Z"),last=new Date(b+"T00:00:00Z"),count=0;
  while(d<last){d.setUTCDate(d.getUTCDate()+1);if(d>=last)break;const day=d.getUTCDay();if(day!==0&&day!==6)count++;}
  return count;
}
export const POST:APIRoute=async(context)=>{
  try{
    const user=await currentAuth(context);
    if(!user||user.purpose!=="user"||user.user_type!=="public")return json({error:"Please sign in to request a refund."},401);
    const body=await context.request.json(),ref=cleanText(body.referenceCode,40);
    if(!ref)return json({error:"Request reference is required."},400);
    const sql=getDb(context);
    const rows=await sql`SELECT id,amount_inr,payment_status,razorpay_payment_id,paid_at,first_response_at,refund_status FROM paid_query_orders WHERE reference_code=${ref} AND user_profile_id=${user.id} LIMIT 1`;
    const q=rows[0];
    if(!q)return json({error:"Paid query not found."},404);
    if(q.payment_status!=="paid"||!q.razorpay_payment_id||!q.paid_at)return json({error:"This payment is not eligible for a refund request."},409);
    if(q.first_response_at)return json({error:"A response has already been recorded, so this no-reply refund policy does not apply."},409);
    if(workingDaysBetween(new Date(q.paid_at),new Date())<3)return json({error:"You can request this refund after three working days without a reply."},409);
    if(q.refund_status==="processed")return json({ok:true,alreadyProcessed:true});
    const claimed=await sql`UPDATE paid_query_orders SET refund_status='requested',refund_requested_at=COALESCE(refund_requested_at,now()),updated_at=now() WHERE id=${q.id} AND user_profile_id=${user.id} AND payment_status='paid' AND first_response_at IS NULL AND refund_status IN ('not_requested','rejected') RETURNING id`;
    if(!claimed.length)return json({error:"A refund request is already being processed."},409);
    const {keyId,keySecret}=razorpayConfig(context);
    try{
      const refund=await razorpayRequest<{id:string;status:string}>("/payments/"+encodeURIComponent(q.razorpay_payment_id)+"/refund",keyId,keySecret,{amount:Number(q.amount_inr)*100,notes:{helpmedost_reference:ref,reason:"No response within three working days"}});
      if(!refund.id)throw new Error("Missing refund ID");
      await sql`UPDATE paid_query_orders SET refund_payment_id=${q.razorpay_payment_id},razorpay_refund_id=COALESCE(razorpay_refund_id,${refund.id}),refund_status=CASE WHEN refund_status='processed' THEN 'processed' ELSE 'requested' END,payment_status=CASE WHEN refund_status='processed' THEN 'refunded' ELSE payment_status END,status=CASE WHEN refund_status='processed' THEN 'refunded' ELSE status END,updated_at=now() WHERE id=${q.id}`;
      return json({ok:true,status:refund.status,refundId:refund.id},202);
    }catch(error){
      console.error("Refund submitted or gateway response uncertain; requires reconciliation",error);
      return json({ok:true,status:"requested",message:"Your request is recorded for payment reconciliation. We will confirm the refund status shortly."},202);
    }
  }catch(error){console.error("Refund request failed",error);return json({error:"Unable to process refund request right now."},500);}
};
