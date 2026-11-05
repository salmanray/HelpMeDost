import type { APIRoute } from "astro";
import { getDb, json, cleanText } from "../../../lib/db";
import { hmacSha256Hex, razorpayConfig, razorpayRequest, safeEqual } from "../../../lib/razorpay";

export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json();
    const reference = cleanText(body.referenceCode, 40);
    const paymentId = cleanText(body.razorpay_payment_id, 80);
    const orderId = cleanText(body.razorpay_order_id, 80);
    const signature = cleanText(body.razorpay_signature, 128);
    const type = cleanText(body.orderType, 30);
    if (!reference || !paymentId || !orderId || !signature || !["subscription", "paid_query"].includes(type)) return json({ error: "Invalid payment verification details." }, 400);

    const sql = getDb(context);
    const rows = type === "subscription"
      ? await sql`SELECT s.id, s.razorpay_order_id, s.payment_status, p.price_inr, p.billing_period FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.reference_code = ${reference} LIMIT 1`
      : await sql`SELECT id, razorpay_order_id, payment_status, amount_inr AS price_inr FROM paid_query_orders WHERE reference_code = ${reference} LIMIT 1`;
    const record: any = rows[0];
    if (!record || record.razorpay_order_id !== orderId) return json({ error: "Payment order mismatch." }, 400);
    if (record.payment_status === "paid") return json({ ok: true, alreadyVerified: true });

    const { keyId, keySecret } = razorpayConfig(context);
    const expected = await hmacSha256Hex(keySecret, orderId + "|" + paymentId);
    if (!safeEqual(expected, signature)) return json({ error: "Payment signature verification failed." }, 400);
    const payment = await razorpayRequest<{id:string;order_id:string;amount:number;currency:string;status:string}>("/payments/" + encodeURIComponent(paymentId), keyId, keySecret);
    if (payment.id !== paymentId || payment.order_id !== orderId || payment.amount !== Number(record.price_inr) * 100 || payment.currency !== "INR" || payment.status !== "captured") return json({ error: "Payment is not captured or does not match this order." }, 409);

    if (type === "subscription") {
      await sql`UPDATE subscriptions SET payment_status = 'paid', status = 'active', payment_provider = 'razorpay', payment_reference = ${paymentId}, razorpay_payment_id = ${paymentId}, starts_at = now(), ends_at = CASE WHEN ${record.billing_period} = 'month' THEN now() + interval '1 month' WHEN ${record.billing_period} = 'quarter' THEN now() + interval '3 months' WHEN ${record.billing_period} = 'year' THEN now() + interval '1 year' ELSE now() END, updated_at = now() WHERE id = ${record.id} AND payment_status = 'pending'`;
    } else {
      await sql`UPDATE paid_query_orders SET payment_status = 'paid', status = 'submitted', payment_provider = 'razorpay', payment_reference = ${paymentId}, razorpay_payment_id = ${paymentId}, updated_at = now() WHERE id = ${record.id} AND payment_status = 'pending'`;
    }
    return json({ ok: true });
  } catch (error) {
    console.error("Razorpay payment verification failed", error);
    return json({ error: "Unable to verify payment right now." }, 500);
  }
};
