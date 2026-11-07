import { makeChatReference } from "./chat";

type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;

export async function createChatEscalation(sql: Sql, session: any, userId: string, priority: "normal" | "high" | "urgent" = "normal") {
  const profiles = await sql`SELECT full_name,email FROM user_profiles WHERE id=${userId}::uuid LIMIT 1`;
  const profile = profiles[0];
  if (!profile) throw new Error("Chat requester profile not found.");

  const recentMessages = await sql`SELECT sender_type,message FROM chat_messages
    WHERE session_id=${session.id}::uuid ORDER BY created_at DESC LIMIT 12`;
  const transcript = recentMessages.reverse().map((row: any) => {
    const speaker = row.sender_type === "user" ? "Customer" : row.sender_type === "staff" ? "HelpMeDost staff" : "Dost AI";
    return `${speaker}: ${String(row.message).slice(0, 700)}`;
  }).join("\n").slice(0, 3400);
  const reference = makeChatReference();
  const subject = `Dost AI follow-up · ${session.category_name || "Help request"}`.slice(0, 180);
  const description = [
    "The customer requested Human Assistance from Dost AI.",
    `Chat reference: ${session.id}`,
    `Category: ${session.category_name || "Help request"}`,
    "Recent conversation:",
    transcript || "No chat messages were recorded."
  ].join("\n").slice(0, 4000);
  const rows = await sql`
    INSERT INTO service_requests(
      reference_code,requester_id,category_id,requester_name,requester_email,requester_phone,
      subject,description,preferred_contact,priority,status,privacy_consent_at,chat_session_id
    ) VALUES(
      ${reference},${userId}::uuid,${session.category_id}::uuid,${profile.full_name},${profile.email},NULL,
      ${subject},${description},'email',${priority},'submitted',now(),${session.id}::uuid
    )
    ON CONFLICT(chat_session_id) WHERE chat_session_id IS NOT NULL DO UPDATE SET
      priority=CASE WHEN service_requests.priority='urgent' OR EXCLUDED.priority='urgent' THEN 'urgent'
                    WHEN service_requests.priority='high' OR EXCLUDED.priority='high' THEN 'high'
                    ELSE service_requests.priority END,
      updated_at=now()
    RETURNING reference_code,status,created_at,priority
  `;
  await sql`UPDATE chat_sessions SET status='escalated',updated_at=now()
    WHERE id=${session.id}::uuid AND user_id=${userId}::uuid AND status NOT IN ('resolved','closed')`;
  return rows[0];
}
