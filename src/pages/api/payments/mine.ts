import type {APIRoute} from "astro";
import {currentAuth} from "../../../lib/auth";
import {getDb,json} from "../../../lib/db";
export const GET:APIRoute=async(context)=>{
 try{const user=await currentAuth(context);if(!user||user.purpose!=="user"||user.user_type!=="public")return json({error:"Please sign in."},401);
 const sql=getDb(context);const [queries,subscriptions]=await Promise.all([
  sql`SELECT reference_code,query_type,subject,amount_inr,status,payment_status,refund_status,paid_at,first_response_at,response_message,created_at FROM paid_query_orders WHERE user_profile_id=${user.id} ORDER BY created_at DESC LIMIT 100`,
  sql`SELECT s.reference_code,p.name AS plan_name,p.query_credits,s.status,s.payment_status,s.starts_at,s.ends_at,s.cancel_requested_at FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.user_profile_id=${user.id} ORDER BY s.created_at DESC LIMIT 50`
 ]);
 return json({queries,subscriptions});
 }catch(error){console.error("Payment account list failed",error);return json({error:"Unable to load payments."},500);}
};
