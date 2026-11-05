import type { APIRoute } from "astro";
import { getDb, json } from "../../../lib/db";
import { hmacSha256Hex, razorpayConfig, safeEqual } from "../../../lib/razorpay";

export const POST: APIRoute = async (context) => {
  try {
    const rawBody = await context.request.text();
    const signature = context.request.headers.get("x-razorpay-signature") || "";
    const eventId = context.request.headers.get("x-razorpay-event-id") || "";
    const { webhookSecret } = razorpayConfig(context);
    if (!webhookSecret) return json({ error: "Webhook secret is not configured." }, 503);
    if (!eventId || !signature) return json({ error: "Missing webhook headers." }, 400);
    const expected = await hmacSha256Hex(webhookSecret, rawBody);
    if (!safeEqual(expected, signature)) return json({ error: "Invalid webhook signature." }, 400);

    const event = JSON.parse(rawBody);
    if (event.event !== "payment.captured") return json({ ok: true, ignored: true });
    const payment = event.payload?.payment?.entity;
    if (!payment?.order_id || !payment?.id || payment.status !== "captured") return json({ error: "Invalid captured-payment event." }, 400);

    const sql = getDb(context);
    const inserted = await sql`INSERT INTO razorpay_webhook_events (event_id, event_type) VALUES (${eventId}, ${event.event}) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`;
    if (!inserted.length) return json({ ok: true, duplicate: true });

    await sql`UPDATE subscriptions SET payment_status = 'paid', status = 'active', payment_provider = 'razorpay', payment_reference = ${payment.id}, razorpay_payment_id = ${payment.id}, starts_at = COALESCE(starts_at, now()), ends_at = COALESCE(ends_at, CASE WHEN (SELECT billing_period FROM subscription_plans WHERE id = subscriptions.plan_id) = 'month' THEN now() + interval '1 month' WHEN (SELECT billing_period FROM subscription_plans WHERE id = subscriptions.plan_id) = 'quarter' THEN now() + interval '3 months' WHEN (SELECT billing_period FROM subscription_plans WHERE id = subscriptions.plan_id) = 'year' THEN now() + interval '1 year' ELSE now() END), updated_at = now() WHERE razorpay_order_id = ${payment.order_id} AND payment_status = 'pending'`;
    await sql`UPDATE paid_query_orders SET payment_status = 'paid', status = 'submitted', payment_provider = 'razorpay', payment_reference = ${payment.id}, razorpay_payment_id = ${payment.id}, updated_at = now() WHERE razorpay_order_id = ${payment.order_id} AND payment_status = 'pending'`;
    return json({ ok: true });
  } catch (error) {
    console.error("Razorpay webhook processing failed", error);
    return json({ error: "Webhook processing failed." }, 500);
  }
};
