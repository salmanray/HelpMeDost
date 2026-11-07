import type { APIRoute } from "astro";
import { CHAT_CATEGORY_SLUGS } from "../../../lib/chat";
import { getDb, json } from "../../../lib/db";

export const GET: APIRoute = async (context) => {
  try {
    const sql = getDb(context);
    const rows = await sql`SELECT slug, name FROM service_categories WHERE is_active=true ORDER BY display_order, name`;
    const categories = rows.filter((row: any) => CHAT_CATEGORY_SLUGS.includes(row.slug));
    return json({ categories });
  } catch (error) {
    console.error("Dost AI categories unavailable", { errorName: error instanceof Error ? error.name : "unknown" });
    return json({ code: "CHAT_UNAVAILABLE", error: "Dost AI is being prepared. Please try again later." }, 503);
  }
};
