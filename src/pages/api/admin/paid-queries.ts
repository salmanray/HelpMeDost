import type { APIRoute } from "astro";
import {currentAuth} from "../../../lib/auth";
import {cleanText,getDb,json} from "../../../lib/db";
async function authorised(context:Parameters<APIRoute>[0]){const user=await currentAuth(context);return Boolean(user&&user.purpose==="admin"&&user.user_type==="admin");}
export const GET:APIRoute=async(context)=>{
 if(!await authorised(context))return json({error:"Admin sign-in required."},401);
 try{const sql=getDb(context);const queries=await sql`SELECT id,reference_code,customer_name,customer_email,customer_phone,query_type,subject,description,amount_inr,status,payment_status,refund_status,paid_at,first_response_at,response_message,created_at FROM paid_query_orders WHERE payment_status IN ('paid','refunded') ORDER BY created_at DESC LIMIT 100`;return json({queries});}
 catch(error){console.error("Paid query admin list failed",error);return json({error:"Unable to load paid queries."},500);}
};
export const PATCH:APIRoute=async(context)=>{
 if(!await authorised(context))return json({error:"Admin sign-in required."},401);
 try{const body=await context.request.json(),id=cleanText(body.id,50),response=cleanText(body.response,4000);if(!id||!response)return json({error:"Enter a response."},400);
 const sql=getDb(context);const rows=await sql`UPDATE paid_query_orders SET response_message=${response},first_response_at=COALESCE(first_response_at,now()),status=CASE WHEN status='submitted' THEN 'under_review' ELSE status END,updated_at=now() WHERE id=${id}::uuid AND payment_status='paid' RETURNING id`;
 if(!rows.length)return json({error:"Paid query not found or not paid."},404);return json({ok:true});
 }catch(error){console.error("Paid query response update failed",error);return json({error:"Unable to save response."},500);}
};
