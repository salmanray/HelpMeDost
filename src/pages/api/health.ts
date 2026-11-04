import type { APIRoute } from "astro";
import { getDb, json } from "../../lib/db";

export const GET: APIRoute = async (context) => {
  try {
    const sql = getDb(context);
    await sql`SELECT 1`;
    return json({ ok: true, service: "HelpMeDost", database: "connected" });
  } catch {
    return json({ ok: false, service: "HelpMeDost", database: "not_configured_or_unavailable" }, 503);
  }
};