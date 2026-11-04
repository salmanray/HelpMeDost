import type { APIRoute } from "astro";
import { getDb, json, cleanText } from "../../lib/db";

const categories: Record<string, string> = {
  "student-help": "School or student-related help",
  admissions: "Admission or application guidance",
  documents: "Forms and documents",
  "digital-support": "Online or digital service help",
  "parent-guidance": "Parent guidance",
  other: "Something else"
};

function makeReference() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return "HMD-" + Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json();
    const name = cleanText(body.name, 120);
    const phone = cleanText(body.phone, 20);
    const email = cleanText(body.email, 180).toLowerCase();
    const category = cleanText(body.category, 50);
    const subject = cleanText(body.subject, 180);
    const description = cleanText(body.description, 4000);
    const preferredContact = body.contact === "email" ? "email" : "phone";
    if (!name || !phone || !subject || !description || !categories[category] || body.consent !== "on") {
      return json({ error: "Please complete all required fields and accept the consent notice." }, 400);
    }
    if (phone.replace(/\D/g, "").length < 10) return json({ error: "Please enter a valid phone number." }, 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Please enter a valid email address." }, 400);

    const sql = getDb(context);
    const rows = await sql`INSERT INTO service_requests
      (reference_code, category_id, requester_name, requester_email, requester_phone, subject, description, preferred_contact, priority, status, privacy_consent_at)
      VALUES (${makeReference()}, (SELECT id FROM service_categories WHERE slug = ${category} LIMIT 1), ${name}, ${email || null}, ${phone}, ${subject}, ${description}, ${preferredContact}, 'normal', 'submitted', now())
      RETURNING id, reference_code`;
    await sql`INSERT INTO audit_events (entity_type, entity_id, action, details)
      VALUES ('service_request', ${rows[0].id}, 'request_submitted', jsonb_build_object('category', ${categories[category]}))`;
    return json({ ok: true, referenceCode: rows[0].reference_code }, 201);
  } catch (error) {
    console.error("Request submission failed", error);
    return json({ error: "We could not submit your request right now. Please try again later." }, 500);
  }
};