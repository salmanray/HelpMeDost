import type { APIRoute } from "astro";
import { currentAuth } from "../../../lib/auth";
import { cleanText, getDb, json } from "../../../lib/db";

const prices = {
  personal_guidance: 49,
  detailed_assistance: 149,
  document_review: 249
} as const;

function makeReference() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return "HMD-P-" + Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
}

export const POST: APIRoute = async (context) => {
  try {
    const user = await currentAuth(context);
    if (!user || user.purpose !== "user" || user.user_type !== "public") {
      return json({ error: "Sign in to create a paid request." }, 401);
    }
    const body = await context.request.json();
    const queryType = cleanText(body.queryType, 40) as keyof typeof prices;
    const phone = cleanText(body.phone, 20).replace(/\\D/g, "");
    const subject = cleanText(body.subject, 180);
    const description = cleanText(body.description, 4000);
    if (!(queryType in prices) || !subject || !description || phone.length < 10 || phone.length > 15) {
      return json({ error: "Enter a valid service type, phone number, subject and description." }, 400);
    }

    const sql = getDb(context);
    const referenceCode = makeReference();
    const rows = await sql`INSERT INTO paid_query_orders
      (reference_code, user_profile_id, customer_name, customer_email, customer_phone,
       query_type, subject, description, amount_inr, status, payment_status)
      VALUES (${referenceCode}, ${user.id}, ${user.full_name}, ${user.email}, ${phone},
       ${queryType}, ${subject}, ${description}, ${prices[queryType]}, 'awaiting_payment', 'pending')
      RETURNING reference_code, amount_inr`;
    return json({ ok: true, referenceCode: rows[0].reference_code, amountInr: rows[0].amount_inr }, 201);
  } catch (error) {
    console.error("Paid query creation failed", error);
    return json({ error: "Unable to create the paid request. Please try again." }, 500);
  }
};
