import type { APIRoute } from "astro";
import { currentAuth } from "../../../lib/auth";
import { CHAT_CATEGORY_SLUGS, remainingChatSeconds } from "../../../lib/chat";
import { getDb, json } from "../../../lib/db";

const validOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
};

export const GET: APIRoute = async (context) => {
  try {
    const user = await currentAuth(context);
    if (!user || user.purpose !== "user" || user.user_type !== "public") {
      return json({ code: "AUTH_REQUIRED", error: "Sign in to view your Dost AI history." }, 401);
    }
    const sql = getDb(context);
    const rows = await sql`
      SELECT s.id,s.user_id,s.category_id,s.session_type,s.status,s.started_at,s.expires_at,s.created_at,s.updated_at,
        c.slug AS category_slug,c.name AS category_name,clock_timestamp() AS server_now
      FROM chat_sessions s JOIN service_categories c ON c.id=s.category_id
      WHERE s.user_id=${user.id}::uuid AND s.session_type='free_preview' LIMIT 1
    `;
    const session = rows[0];
    if (!session) return json({ session: null });
    const messages = await sql`SELECT id,sender_type,message,metadata,created_at FROM chat_messages
      WHERE session_id=${session.id}::uuid ORDER BY created_at ASC LIMIT 120`;
    const remainingSeconds = remainingChatSeconds(session.expires_at, session.server_now);
    return json({ session, messages, remainingSeconds, expired: remainingSeconds === 0 });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "unknown";
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Dost AI history lookup failed", { errorName, errorMessage });
    const host = new URL(context.request.url).hostname;
    const previewDebug = host.endsWith(".helpmedost.pages.dev") && host !== "helpmedost.pages.dev"
      ? { diagnostic: errorName, detail: errorMessage.slice(0, 180) }
      : {};
    return json({ code: "CHAT_STORAGE_UNAVAILABLE", error: "Chat history is temporarily unavailable. Please retry.", ...previewDebug }, 503);
  }
};

export const POST: APIRoute = async (context) => {
  try {
    if (!validOrigin(context.request)) return json({ code: "ORIGIN_REJECTED", error: "Request origin was rejected." }, 403);
    const user = await currentAuth(context);
    if (!user || user.purpose !== "user" || user.user_type !== "public") {
      return json({ code: "AUTH_REQUIRED", error: "Sign in to start your free Dost AI preview." }, 401);
    }
    const body = await context.request.json().catch(() => ({}));
    const categorySlug = typeof body?.category === "string" ? body.category.trim().slice(0, 80) : "";
    if (!CHAT_CATEGORY_SLUGS.includes(categorySlug)) return json({ code: "CATEGORY_REQUIRED", error: "Choose an available service category to begin." }, 400);

    const sql = getDb(context);
    const categoryRows = await sql`SELECT id, slug, name FROM service_categories WHERE slug=${categorySlug} AND is_active=true LIMIT 1`;
    const category = categoryRows[0];
    if (!category) return json({ code: "CATEGORY_NOT_FOUND", error: "Choose an available service category." }, 400);

    let createdNew = false;
    let session = (await sql`
      WITH new_session AS (
        INSERT INTO chat_sessions(user_id,category_id,session_type,status)
        VALUES(${user.id}::uuid,${category.id}::uuid,'free_preview','open')
        ON CONFLICT (user_id) WHERE session_type='free_preview' DO NOTHING
        RETURNING id,user_id,category_id,session_type,status,started_at,expires_at,created_at,updated_at
      ), new_usage AS (
        INSERT INTO chat_usage(user_id,free_session_id,preview_started_at,preview_expires_at)
        SELECT user_id,id,started_at,expires_at FROM new_session
        ON CONFLICT(user_id) DO NOTHING RETURNING free_session_id
      )
      SELECT s.* FROM new_session s JOIN new_usage u ON u.free_session_id=s.id
    `)[0];
    if (session) createdNew = true;
    session = (await sql`
      SELECT s.id,s.user_id,s.category_id,s.session_type,s.status,s.started_at,s.expires_at,s.created_at,s.updated_at,
        clock_timestamp() AS server_now
      FROM chat_sessions s WHERE s.user_id=${user.id}::uuid AND s.session_type='free_preview' LIMIT 1
    `)[0];
    if (!session) return json({ code: "SESSION_RETRY", error: "Could not start the preview. Please retry." }, 503);

    const categoryForSession = (await sql`SELECT slug,name FROM service_categories WHERE id=${session.category_id}::uuid LIMIT 1`)[0];
    const remainingSeconds = remainingChatSeconds(session.expires_at, session.server_now);
    return json({
      session: { ...session, category: categoryForSession },
      remainingSeconds,
      isNew: createdNew
    }, 201);
  } catch (error) {
    console.error("Dost AI session creation failed", { errorName: error instanceof Error ? error.name : "unknown" });
    return json({ code: "CHAT_STORAGE_UNAVAILABLE", error: "We could not save your chat session. Please retry." }, 503);
  }
};
