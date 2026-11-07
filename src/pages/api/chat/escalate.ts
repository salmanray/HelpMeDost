import type { APIRoute } from "astro";
import { currentAuth } from "../../../lib/auth";
import { createChatEscalation } from "../../../lib/chat-escalation";
import { isUuid } from "../../../lib/chat";
import { getDb, json } from "../../../lib/db";

export const POST: APIRoute = async (context) => {
  try {
    const origin = context.request.headers.get("origin");
    if (origin && origin !== new URL(context.request.url).origin) return json({ code: "ORIGIN_REJECTED", error: "Request origin was rejected." }, 403);
    const user = await currentAuth(context);
    if (!user || user.purpose !== "user" || user.user_type !== "public") return json({ code: "AUTH_REQUIRED", error: "Sign in to contact the HelpMeDost team." }, 401);
    const body = await context.request.json().catch(() => ({}));
    const sessionId = body?.sessionId;
    if (!isUuid(sessionId)) return json({ code: "SESSION_NOT_FOUND", error: "Chat session not found." }, 404);
    const sql = getDb(context);
    const rows = await sql`SELECT s.id,s.user_id,s.category_id,c.name AS category_name
      FROM chat_sessions s JOIN service_categories c ON c.id=s.category_id
      WHERE s.id=${sessionId}::uuid AND s.user_id=${user.id}::uuid LIMIT 1`;
    const session = rows[0];
    if (!session) return json({ code: "SESSION_NOT_FOUND", error: "Chat session not found." }, 404);
    const escalation = await createChatEscalation(sql, session, user.id, body?.priority === "urgent" ? "urgent" : "normal");
    return json({ ok: true, escalation }, 201);
  } catch (error) {
    console.error("Dost AI escalation failed", { errorName: error instanceof Error ? error.name : "unknown" });
    return json({ code: "ESCALATION_UNAVAILABLE", error: "We could not save your human support request. Your conversation is still available; please retry." }, 503);
  }
};
