import type { APIRoute } from "astro";
import { getDb, json, cleanText } from "../../../lib/db";
import { currentAuth } from "../../../lib/auth";
import { hmacSha256Hex, razorpayConfig, razorpayRequest, safeEqual } from "../../../lib/razorpay";

export const POST: APIRoute = async (context) => {
  try {
    const user = await currentAuth(context);
    if (!user || user.purpose !== "user" || user.user_type !== "public") {
      return json({ error: "Please sign in to verify payment." }, 401);
    }
    const body = await context.request.json();
    const reference = cleanText(body.referenceCode, 40);
    const paymentId = cleanText(body.razorpay_payment_id, 80);
    const orderId = cleanText(body.razorpay_order_id, 80);
    const signature = cleanText(body.razorpay_signature, 128);
    const type = cleanText(body.orderType, 30);
    if (!reference || !paymentId || !orderId || !signature || type !== "paid_query") {
      return json({ error: "Invalid payment verification details." }, 400);
    }

    const sql = getDb(context);
    const rows = await sql`SELECT id, razorpay_order_id, payment_status, amount_inr
      FROM paid_query_orders
      WHERE reference_code = ${reference} AND user_profile_id = ${user.id}
      LIMIT 1`;
    const record = rows[0];
    if (!record || record.razorpay_order_id !== orderId) return json({ error: "Payment order mismatch." }, 400);
    if (record.payment_status === "paid") return json({ ok: true, alreadyVerified: true });

    const { keyId, keySecret } = razorpayConfig(context);
    const expected = await hmacSha256Hex(keySecret, orderId + "|" + paymentId);
    if (!safeEqual(expected, signature)) return json({ error: "Payment signature verification failed." }, 400);
    const payment = await razorpayRequest<{id:string;order_id:string;amount:number;currency:string;status:string}>("/payments/" + encodeURIComponent(paymentId), keyId, keySecret);
    if (payment.id !== paymentId || payment.order_id !== orderId || payment.amount !== Number(record.amount_inr) * 100 || payment.currency !== "INR" || payment.status !== "captured") {
      return json({ error: "Payment is not captured or does not match this order." }, 409);
    }

    const updated = await sql`UPDATE paid_query_orders
      SET payment_status = 'paid', status = 'submitted', payment_provider = 'razorpay',
          payment_reference = ${paymentId}, razorpay_payment_id = ${paymentId},
          paid_at = COALESCE(paid_at, now()), updated_at = now()
      WHERE id = ${record.id} AND user_profile_id = ${user.id} AND payment_status = 'pending'
      RETURNING id`;
    if (!updated.length) {
      const current = await sql`SELECT payment_status FROM paid_query_orders WHERE id = ${record.id} AND user_profile_id = ${user.id} LIMIT 1`;
      if (current[0]?.payment_status !== "paid") return json({ error: "Payment state changed. Refresh and check your account." }, 409);
    }
    return json({ ok: true });
  } catch (error) {
    console.error("Razorpay payment verification failed", error);
    return json({ error: "Unable to verify payment right now." }, 500);
  }
};
