import type { APIRoute } from "astro";
import { getDb, json } from "../../lib/db";
export const GET: APIRoute = async (context) => {
  try {
    const sql=getDb(context),url=new URL(context.request.url),q=(url.searchParams.get("q")||"").trim().slice(0,100),category=(url.searchParams.get("category")||"").trim().slice(0,80),year=(url.searchParams.get("year")||"").trim();
    const rows=await sql`SELECT id,title,summary,category,issue_date,notification_type,archived_at,original_filename,archive_object_key,active_object_key FROM circular_notifications
      WHERE status='archived' AND (${q}='' OR title ILIKE ${'%'+q+'%'} OR summary ILIKE ${'%'+q+'%'})
      AND (${category}='' OR category=${category})
      AND (${year}='' OR EXTRACT(YEAR FROM issue_date)::text=${year})
      ORDER BY issue_date DESC,archived_at DESC LIMIT 100`;
    return json({circulars:rows});
  }catch(error){console.error("Circular archive list failed",error);return json({error:"Archive is temporarily unavailable."},500);}
};
