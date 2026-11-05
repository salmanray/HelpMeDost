import type { APIRoute } from "astro";
import { getDb, json } from "../../../lib/db";
import { hmacSha256Hex, safeEqual } from "../../../lib/razorpay";

type CapturedPayment = {
  id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  captured?: boolean;
};

export const POST: APIRoute = async (context) => {
  try {
    // Verify the exact raw bytes sent by Razorpay before parsing JSON.
    const rawBody = await context.request.text();
    const signature = context.request.headers.get("x-razorpay-signature") || "";
    const eventId = context.request.headers.get("x-razorpay-event-id") || "";
    const webhookSecret = context.locals.runtime?.env?.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) return json({ error: "Webhook secret is not configured." }, 503);
    if (!eventId || !signature) return json({ error: "Missing webhook headers." }, 400);

    const expected = await hmacSha256Hex(webhookSecret, rawBody);
    if (!safeEqual(expected, signature)) return json({ error: "Invalid webhook signature." }, 400);

    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return json({ error: "Invalid webhook payload." }, 400);
    }

    if (event.event !== "payment.captured") return json({ ok: true, ignored: true });

    const payment = event.payload?.payment?.entity as CapturedPayment | undefined;
    if (
      !payment?.order_id ||
      !payment.id ||
      payment.status !== "captured" ||
      payment.captured !== true ||
      !Number.isSafeInteger(payment.amount) ||
      payment.amount! <= 0 ||
      payment.currency !== "INR"
    ) {
      return json({ error: "Invalid captured-payment event." }, 400);
    }

    const sql = getDb(context);

    // One atomic statement: only claim the event when its order, amount and
    // currency match a pending HelpMeDost payment. A failed statement rolls
    // back both the event claim and the corresponding payment update.
    const result = await sql`
      WITH matching_subscription AS (
        SELECT s.id
        FROM subscriptions s
        JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.razorpay_order_id = ${payment.order_id}
          AND s.payment_status = 'pending'
          AND p.price_inr * 100 = ${payment.amount}
        LIMIT 1
      ),
      matching_query AS (
        SELECT q.id
        FROM paid_query_orders q
        WHERE q.razorpay_order_id = ${payment.order_id}
          AND q.payment_status = 'pending'
          AND q.amount_inr * 100 = ${payment.amount}
        LIMIT 1
      ),
      event_claim AS (
        INSERT INTO razorpay_webhook_events (event_id, event_type)
        SELECT ${eventId}, 'payment.captured'
        WHERE (SELECT count(*) FROM matching_subscription) + (SELECT count(*) FROM matching_query) = 1
        ON CONFLICT (event_id) DO NOTHING
        RETURNING event_id
      ),
      activate_subscription AS (
        UPDATE subscriptions s
        SET payment_status = 'paid',
            status = 'active',
            payment_provider = 'razorpay',
            payment_reference = ${payment.id},
            razorpay_payment_id = ${payment.id},
            starts_at = COALESCE(s.starts_at, now()),
            ends_at = COALESCE(
              s.ends_at,
              CASE p.billing_period
                WHEN 'month' THEN now() + interval '1 month'
                WHEN 'quarter' THEN now() + interval '3 months'
                WHEN 'year' THEN now() + interval '1 year'
                ELSE now()
              END
            ),
            updated_at = now()
        FROM subscription_plans p, event_claim ec
        WHERE s.plan_id = p.id
          AND s.razorpay_order_id = ${payment.order_id}
          AND s.payment_status = 'pending'
          AND p.price_inr * 100 = ${payment.amount}
        RETURNING s.id
      ),
      activate_query AS (
        UPDATE paid_query_orders q
        SET payment_status = 'paid',
            status = 'submitted',
            payment_provider = 'razorpay',
            payment_reference = ${payment.id},
            razorpay_payment_id = ${payment.id},
            updated_at = now()
        FROM event_claim ec
        WHERE q.razorpay_order_id = ${payment.order_id}
          AND q.payment_status = 'pending'
          AND q.amount_inr * 100 = ${payment.amount}
        RETURNING q.id
      )
      SELECT
        (SELECT count(*)::int FROM activate_subscription) AS subscriptions_activated,
        (SELECT count(*)::int FROM activate_query) AS queries_activated,
        (SELECT count(*)::int FROM event_claim) AS events_claimed
    `;

    const outcome = result[0] as {
      subscriptions_activated: number;
      queries_activated: number;
      events_claimed: number;
    } | undefined;

    if (!outcome || outcome.events_claimed === 0) {
      // Either the order/amount did not match, or Razorpay redelivered an
      // event already processed. Do not mark an unmatched event as handled.
      const duplicate = await sql`SELECT 1 FROM razorpay_webhook_events WHERE event_id = ${eventId} LIMIT 1`;
      if (duplicate.length) return json({ ok: true, duplicate: true });
      return json({ error: "No matching pending HelpMeDost order for this payment." }, 409);
    }

    if (outcome.subscriptions_activated + outcome.queries_activated !== 1) {
      console.error("Razorpay webhook did not activate exactly one payment record", {
        eventId,
        orderId: payment.order_id
      });
      return json({ error: "Payment could not be matched to exactly one order." }, 409);
    }

    return json({ ok: true, processed: true });
  } catch (error) {
    console.error("Razorpay webhook processing failed", error);
    return json({ error: "Webhook processing failed." }, 500);
  }
};
