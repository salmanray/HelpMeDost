import type { APIRoute } from "astro";
import { currentAuth } from "../../../lib/auth";
import { createChatEscalation } from "../../../lib/chat-escalation";
import {
  CHAT_MESSAGE_MAX_LENGTH, CHAT_MESSAGES_PER_MINUTE, DEFAULT_CHAT_MODEL,
  detectSensitiveEmergency, isUuid, makeAssistantSystemPrompt, redactChatPromptText
} from "../../../lib/chat";
import { getDb, json } from "../../../lib/db";

const unavailableMessage = "Dost AI is unavailable right now. Your message is saved. Please request Human Assistance or try AI again later.";
const emergencyMessage = "This sounds urgent. I’m connecting your request to our Human Helpdesk with high priority. If you or someone else is in immediate danger, contact local emergency services and a trusted person now.";

export const POST: APIRoute = async (context) => {
  let sessionSuffix = "";
  try {
    const origin = context.request.headers.get("origin");
    if (origin && origin !== new URL(context.request.url).origin) return json({ code: "ORIGIN_REJECTED", error: "Request origin was rejected." }, 403);
    const user = await currentAuth(context);
    if (!user || user.purpose !== "user" || user.user_type !== "public") return json({ code: "AUTH_REQUIRED", error: "Sign in to use Dost AI." }, 401);

    const body = await context.request.json().catch(() => ({}));
    const sessionId = body?.sessionId;
    const clientMessageId = body?.clientMessageId;
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    sessionSuffix = isUuid(sessionId) ? sessionId.slice(-6) : "";
    if (!isUuid(sessionId) || !isUuid(clientMessageId) || !message || message.length > CHAT_MESSAGE_MAX_LENGTH) {
      return json({ code: "INVALID_MESSAGE", error: `Enter a message of 1–${CHAT_MESSAGE_MAX_LENGTH} characters.` }, 400);
    }

    const sql = getDb(context);
    const sessionRows = await sql`
      SELECT s.id,s.user_id,s.category_id,s.expires_at,s.status,c.name AS category_name,
        (s.expires_at > now()) AS is_active
      FROM chat_sessions s JOIN service_categories c ON c.id=s.category_id
      WHERE s.id=${sessionId}::uuid AND s.user_id=${user.id}::uuid LIMIT 1
    `;
    const session = sessionRows[0];
    if (!session) return json({ code: "SESSION_NOT_FOUND", error: "Chat session not found." }, 404);
    if (!session.is_active) return json({ code: "PREVIEW_EXPIRED", error: "Your free chat session has ended. Continue with a Paid Question or request assistance from our Human Helpdesk." }, 410);
    if (["resolved", "closed"].includes(session.status)) return json({ code: "SESSION_CLOSED", error: "This conversation is closed. Start a Human Helpdesk request for more help." }, 409);

    const duplicate = await sql`SELECT id,message,created_at FROM chat_messages
      WHERE session_id=${session.id}::uuid AND client_message_id=${clientMessageId}::uuid AND sender_type='user' LIMIT 1`;
    if (duplicate.length) return json({ ok: true, duplicate: true, message: duplicate[0], aiAvailable: false });

    const allowed = await sql`
      UPDATE chat_usage SET
        message_window_started_at=CASE WHEN message_window_started_at <= now()-interval '1 minute' THEN now() ELSE message_window_started_at END,
        messages_in_window=CASE WHEN message_window_started_at <= now()-interval '1 minute' THEN 1 ELSE messages_in_window+1 END,
        updated_at=now()
      WHERE user_id=${user.id}::uuid AND free_session_id=${session.id}::uuid
        AND preview_expires_at > now()
        AND (messages_in_window < ${CHAT_MESSAGES_PER_MINUTE} OR message_window_started_at <= now()-interval '1 minute')
      RETURNING user_id
    `;
    if (!allowed.length) {
      const stillActive = await sql`SELECT expires_at > now() AS active FROM chat_sessions WHERE id=${session.id}::uuid AND user_id=${user.id}::uuid LIMIT 1`;
      if (!stillActive[0]?.active) return json({ code: "PREVIEW_EXPIRED", error: "Your free chat session has ended. Continue with a Paid Question or request assistance from our Human Helpdesk." }, 410);
      return json({ code: "RATE_LIMITED", error: "You’ve sent several messages recently. Please wait a minute before sending another." }, 429);
    }

    const saved = await sql`INSERT INTO chat_messages(session_id,client_message_id,sender_type,message)
      VALUES(${session.id}::uuid,${clientMessageId}::uuid,'user',${message})
      ON CONFLICT(session_id,client_message_id) DO NOTHING
      RETURNING id,sender_type,message,created_at`;
    if (!saved.length) {
      const existing = await sql`SELECT id,sender_type,message,created_at FROM chat_messages WHERE session_id=${session.id}::uuid AND client_message_id=${clientMessageId}::uuid LIMIT 1`;
      return json({ ok: true, duplicate: true, message: existing[0], aiAvailable: false });
    }

    await sql`UPDATE chat_sessions SET updated_at=now() WHERE id=${session.id}::uuid AND user_id=${user.id}::uuid`;
    const urgency = detectSensitiveEmergency(message);
    let reply = "";
    let aiAvailable = false;
    let escalation: any = null;
    let replyKind = "ai";

    if (urgency) {
      reply = emergencyMessage;
      replyKind = "safety_escalation";
      escalation = await createChatEscalation(sql, session, user.id, "urgent");
    } else {
      const env = context.locals.runtime?.env as RuntimeEnv;
      const ai = env?.AI;
      if (env?.DOST_AI_ENABLED === "true" && ai?.run) {
        try {
          const history = await sql`SELECT sender_type,message FROM chat_messages
            WHERE session_id=${session.id}::uuid AND sender_type IN ('user','assistant')
            ORDER BY created_at DESC LIMIT 10`;
          const messages = [{ role: "system", content: makeAssistantSystemPrompt(session.category_name) },
            ...history.reverse().map((item: any) => ({
              role: item.sender_type === "assistant" ? "assistant" : "user",
              content: redactChatPromptText(String(item.message).slice(0, CHAT_MESSAGE_MAX_LENGTH))
            }))];
          const model = env.DOST_AI_MODEL?.trim() || DEFAULT_CHAT_MODEL;
          const result = await ai.run(model, { messages, max_tokens: 350, temperature: 0.35 });
          reply = typeof result?.response === "string" ? result.response.trim()
            : typeof result?.choices?.[0]?.message?.content === "string" ? result.choices[0].message.content.trim()
              : "";
          if (!reply || reply.length > 6000) throw new Error("Invalid model response");
          aiAvailable = true;
        } catch (error) {
          console.warn("Dost AI inference unavailable", { sessionSuffix, errorName: error instanceof Error ? error.name : "unknown" });
          reply = unavailableMessage;
          replyKind = "ai_unavailable";
        }
      } else {
        reply = unavailableMessage;
        replyKind = "ai_unavailable";
      }
    }

    const assistantRows = await sql`INSERT INTO chat_messages(session_id,sender_type,message,metadata)
      VALUES(${session.id}::uuid,'assistant',${reply},${JSON.stringify({ kind: replyKind, model: aiAvailable ? (context.locals.runtime?.env as RuntimeEnv)?.DOST_AI_MODEL?.trim() || DEFAULT_CHAT_MODEL : null })}::jsonb)
      RETURNING id,sender_type,message,metadata,created_at`;
    return json({ ok: true, userMessage: saved[0], assistantMessage: assistantRows[0], aiAvailable, escalation });
  } catch (error) {
    console.error("Dost AI message failed", { sessionSuffix, errorName: error instanceof Error ? error.name : "unknown" });
    return json({ code: "CHAT_STORAGE_UNAVAILABLE", error: "We could not save your message. Please retry; it has not been confirmed as saved." }, 503);
  }
};
