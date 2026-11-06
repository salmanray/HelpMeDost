import type { APIRoute } from "astro";
import { getDb, json, cleanText } from "../../lib/db";

const labels: Record<string, string> = {
  submitted: "Submitted / Open",
  assigned: "Assigned",
  in_progress: "Reply & Research",
  under_review: "Reply & Research",
  waiting_for_user: "Reply Delivered",
  resolved: "Resolved",
  closed: "Closed"
};

export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json();
    const reference = cleanText(body.referenceCode, 24).toUpperCase();
    const phone = cleanText(body.phone, 20);
    const phoneDigits = phone.replace(/\D/g, "");
    if (!reference || !phone) return json({ error: "Enter both your reference number and phone number." }, 400);
    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      return json({ error: "Please enter a valid phone number with 10 to 15 digits." }, 400);
    }
    const sql = getDb(context);
    const rows = await sql`SELECT reference_code, subject, status, updated_at
      FROM service_requests
      WHERE reference_code = ${reference}
        AND RIGHT(regexp_replace(COALESCE(requester_phone, ''), '[^0-9]', '', 'g'), 10)
          = RIGHT(regexp_replace(${phone}, '[^0-9]', '', 'g'), 10)
      LIMIT 1`;
    if (!rows.length) return json({ error: "We could not find a request with those details. Please check and try again." }, 404);
    const item = rows[0];
    const history = await sql`SELECT action, details, created_at
      FROM audit_events
      WHERE entity_type = 'service_request'
        AND entity_id = (SELECT id FROM service_requests WHERE reference_code = ${reference} LIMIT 1)
        AND action IN ('request_submitted', 'status_updated')
      ORDER BY created_at ASC`;
    const messages = await sql`SELECT sender_name, message, created_at
      FROM request_messages
      WHERE request_id = (SELECT id FROM service_requests WHERE reference_code = ${reference} LIMIT 1)
        AND is_internal = false
      ORDER BY created_at ASC LIMIT 50`;
    return json({
      referenceCode: item.reference_code,
      subject: item.subject,
      status: item.status,
      statusLabel: labels[item.status] || "In progress",
      updatedAt: item.updated_at,
      history: history.map(event => ({
        action: event.action,
        status: event.details?.status || (event.action === "request_submitted" ? "submitted" : null),
        createdAt: event.created_at
      })),
      messages
    });
  } catch (error) {
    console.error("Request tracking failed", error);
    return json({ error: "Unable to check the request right now." }, 500);
  }
};
