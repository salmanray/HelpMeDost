import type { APIRoute } from "astro";
import { currentAuth } from "../../../lib/auth";
import { cleanText, getDb, json } from "../../../lib/db";
import { driveEnv, uploadDrivePdf } from "../../../lib/google-drive";
async function admin(context: Parameters<APIRoute>[0]) { const user=await currentAuth(context); return user && user.purpose==="admin" && user.user_type==="admin" ? user : null; }
export const GET: APIRoute = async (context) => {
  if (!await admin(context)) return json({error:"Admin sign-in required."},401);
  try { const sql=getDb(context); const circulars=await sql`SELECT id,title,summary,category,issue_date,notification_type,status,expires_at,original_filename,file_size_bytes,active_object_key,archive_object_key,created_at,archived_at FROM circular_notifications ORDER BY created_at DESC LIMIT 200`; return json({circulars}); }
  catch(error){console.error("Circular admin list failed",error);return json({error:"Unable to load circulars."},500);}
};
export const POST: APIRoute = async (context) => {
  const user=await admin(context); if(!user)return json({error:"Admin sign-in required."},401);
  try {
    const form=await context.request.formData(), file=form.get("file");
    if(!(file instanceof File))return json({error:"Select a PDF file."},400);
    if(file.type!=="application/pdf" || !file.name.toLowerCase().endsWith(".pdf"))return json({error:"Only PDF files are allowed."},400);
    if(file.size<1 || file.size>20*1024*1024)return json({error:"PDF must be between 1 byte and 20 MB."},400);
    const title=cleanText(form.get("title"),240),summary=cleanText(form.get("summary"),1200),category=cleanText(form.get("category"),80),issueDate=cleanText(form.get("issue_date"),10),type=cleanText(form.get("notification_type"),20),expiry=cleanText(form.get("expires_at"),40);
    if(title.length<3 || category.length<2 || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate) || !["temporary","permanent","custom"].includes(type))return json({error:"Check title, category, issue date and notification type."},400);
    if(type==="permanent" ? Boolean(expiry) : !expiry || !Number.isFinite(Date.parse(expiry)))return json({error:"Permanent circulars must not have an expiry; temporary/custom circulars need one."},400);
    const uploaded=await uploadDrivePdf(driveEnv(context),file,title);
    try {
      const sql=getDb(context);
      const rows=await sql`INSERT INTO circular_notifications(title,summary,category,issue_date,notification_type,status,expires_at,archive_action,active_object_key,original_filename,file_size_bytes,mime_type,created_by)
      VALUES(${title},${summary},${category},${issueDate}::date,${type},'published',${type==="permanent"?null: new Date(expiry).toISOString()}::timestamptz,'move',${uploaded.id},${file.name},${uploaded.size},'application/pdf',${user.id}::uuid)
      RETURNING id,title,status`;
      return json({ok:true,circular:rows[0]});
    } catch(error) {
      console.error("Circular database insert failed after Drive upload",error);
      return json({error:"PDF reached Drive, but its circular record could not be saved. Contact admin before retrying to avoid a duplicate upload."},500);
    }
  } catch(error){console.error("Circular upload failed",error);return json({error:error instanceof Error?error.message:"Unable to upload circular."},500);}
};
export const PATCH: APIRoute = async (context) => {
  if(!await admin(context))return json({error:"Admin sign-in required."},401);
  try{
    const body=await context.request.json(),id=cleanText(body.id,50),action=cleanText(body.action,30);
    if(!id || !["unpublish","republish"].includes(action))return json({error:"Invalid circular action."},400);
    const sql=getDb(context);
    const rows=action==="unpublish"
      ? await sql`UPDATE circular_notifications SET status='unpublished',updated_at=now() WHERE id=${id}::uuid AND status IN ('published','archived') RETURNING id`
      : await sql`UPDATE circular_notifications SET status='published',archived_at=NULL,updated_at=now() WHERE id=${id}::uuid AND status IN ('unpublished','archived') AND (notification_type='permanent' OR expires_at>now()) RETURNING id`;
    if(!rows.length)return json({error:"Circular not found or action is not allowed."},404);
    return json({ok:true});
  }catch(error){console.error("Circular update failed",error);return json({error:"Unable to update circular."},500);}
};
