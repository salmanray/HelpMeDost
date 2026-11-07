import type { APIRoute } from "astro";
import { currentAuth } from "../../../../lib/auth";
import { getDb, json } from "../../../../lib/db";
import { isUuid, remainingChatSeconds } from "../../../../lib/chat";

export const GET: APIRoute = async (context) => {
  try {
    const user = await currentAuth(context);
    if (!user || user.purpose !== "user" || user.user_type !== "public") {
      return json({ code: "AUTH_REQUIRED", error: "Sign in to view your chat history." }, 401);
    }
    const sessionId = context.params.id;
    if (!isUuid(sessionId)) return json({ code: "SESSION_NOT_FOUND", error: "Chat session not found." }, 404);
    const sql = getDb(context);
    const rows = await sql`
      SELECT s.id,s.user_id,s.status,s.started_at,s.expires_at,s.created_at,s.updated_at,
        c.slug AS category_slug,c.name AS category_name,clock_timestamp() AS server_now
      FROM chat_sessions s JOIN service_categories c ON c.id=s.category_id
      WHERE s.id=${sessionId}::uuid AND s.user_id=${user.id}::uuid LIMIT 1
    `;
    const session = rows[0];
    if (!session) return json({ code: "SESSION_NOT_FOUND", error: "Chat session not found." }, 404);
    const messages = await sql`
      SELECT id,sender_type,message,metadata,created_at FROM chat_messages
      WHERE session_id=${sessionId}::uuid ORDER BY created_at ASC LIMIT 120
    `;
    const remainingSeconds = remainingChatSeconds(session.expires_at, session.server_now);
    return json({ session, messages, remainingSeconds, expired: remainingSeconds === 0 });
  } catch (error) {
    console.error("Dost AI history lookup failed", { errorName: error instanceof Error ? error.name : "unknown" });
    return json({ code: "CHAT_STORAGE_UNAVAILABLE", error: "Chat history is temporarily unavailable. Please retry." }, 503);
  }
};
