import type { APIRoute } from "astro";
import { getDb, json, cleanText } from "../../lib/db";

const labels: Record<string, string> = {
  submitted: "Received",
  under_review: "Under review",
  waiting_for_user: "Waiting for your response",
  resolved: "Resolved",
  closed: "Closed"
};

export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json();
    const reference = cleanText(body.referenceCode, 24).toUpperCase();
    const phone = cleanText(body.phone, 20);
    if (!reference || !phone) return json({ error: "Enter both your reference number and phone number." }, 400);
    const sql = getDb(context);
    const rows = await sql`SELECT reference_code, subject, status, updated_at
      FROM service_requests
      WHERE reference_code = ${reference} AND requester_phone = ${phone}
      LIMIT 1`;
    if (!rows.length) return json({ error: "We could not find a request with those details. Please check and try again." }, 404);
    const item = rows[0];
    return json({ referenceCode: item.reference_code, subject: item.subject, status: item.status, statusLabel: labels[item.status] || "In progress", updatedAt: item.updated_at });
  } catch (error) {
    console.error("Request tracking failed", error);
    return json({ error: "Unable to check the request right now." }, 500);
  }
};