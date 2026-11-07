import type { APIRoute } from "astro";
import { getDb, json } from "../../lib/db";
export const GET: APIRoute = async (context) => {
  try {
    const sql=getDb(context), url=new URL(context.request.url), q=(url.searchParams.get("q")||"").trim().slice(0,100), category=(url.searchParams.get("category")||"").trim().slice(0,80), year=(url.searchParams.get("year")||"").trim();
    const rows=await sql`SELECT id,title,summary,category,issue_date,notification_type,expires_at,original_filename,active_object_key FROM circular_notifications
      WHERE status='published' AND (expires_at IS NULL OR expires_at>now())
      AND (${q}='' OR title ILIKE ${'%'+q+'%'} OR summary ILIKE ${'%'+q+'%'})
      AND (${category}='' OR category=${category})
      AND (${year}='' OR EXTRACT(YEAR FROM issue_date)::text=${year})
      ORDER BY issue_date DESC,created_at DESC LIMIT 100`;
    return json({circulars:rows});
  }catch(error){console.error("Public circular list failed",error);return json({error:"Circulars are temporarily unavailable."},500);}
};
