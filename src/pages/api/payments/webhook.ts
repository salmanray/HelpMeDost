import type { APIRoute } from "astro";
import { getDb, json } from "../../../lib/db";
import { hmacSha256Hex, razorpayConfig, razorpayRequest, safeEqual } from "../../../lib/razorpay";
import { processCapturedPaymentEvent, verifyWebhookSignature } from "../../../lib/payment-lifecycle.mjs";

type GatewayPayment = {
  id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  captured?: boolean;
  amount_refunded?: number;
  refund_status?: "partial" | "full" | null;
  subscription_id?: string;
};

const suffix = (value: unknown) => typeof value === "string" && value.length ? value.slice(-6) : undefined;
function diagnostic(stage: string, eventId?: string, orderId?: string, paymentId?: string, result?: string) {
  console.info("Razorpay webhook", {
    stage,
    eventSuffix: suffix(eventId),
    orderSuffix: suffix(orderId),
    paymentSuffix: suffix(paymentId),
    result
  });
}

async function markRefunded(sql: ReturnType<typeof getDb>, payment: GatewayPayment) {
  return sql`
    UPDATE paid_query_orders
    SET payment_status='refunded', status='refunded', payment_provider='razorpay',
        payment_reference=${payment.id}, razorpay_payment_id=${payment.id},
        paid_at=COALESCE(paid_at,now()), refund_status='processed', updated_at=now()
    WHERE razorpay_order_id=${payment.order_id}
      AND amount_inr * 100=${payment.amount}
      AND (razorpay_payment_id IS NULL OR razorpay_payment_id=${payment.id})
      AND payment_status IN ('pending','paid','refunded')
    RETURNING id
  `;
}

export const POST: APIRoute = async (context) => {
  let eventId = "";
  let eventType = "";
  let orderId = "";
  let paymentId = "";
  try {
    // HMAC must use the exact incoming bytes, not a decoded/re-encoded JSON body.
    const rawBytes = new Uint8Array(await context.request.arrayBuffer());
    const signature = context.request.headers.get("x-razorpay-signature") || "";
    eventId = context.request.headers.get("x-razorpay-event-id") || "";
    const webhookSecret = context.locals.runtime?.env?.RAZORPAY_WEBHOOK_SECRET?.trim();

    diagnostic("received", eventId);
    if (!webhookSecret) {
      diagnostic("signature_check_unavailable", eventId, undefined, undefined, "secret_missing");
      return json({ code: "WEBHOOK_SECRET_MISSING", error: "Webhook secret is not configured." }, 503);
    }
    if (!eventId) return json({ code: "WEBHOOK_HEADERS_MISSING", error: "Missing webhook event ID." }, 400);
    const signatureCheck = await verifyWebhookSignature({
      rawBody: rawBytes,
      signature,
      secret: webhookSecret,
      hmac: hmacSha256Hex,
      safeEqual
    });
    if (!signatureCheck.ok) {
      diagnostic("signature_check_failed", eventId, undefined, undefined, signatureCheck.code);
      return json({ code: signatureCheck.code, error: signatureCheck.code === "WEBHOOK_SIGNATURE_MISSING" ? "Missing webhook signature." : "Invalid webhook signature." }, 400);
    }
    diagnostic("signature_check_passed", eventId);

    let event: any;
    try {
      event = JSON.parse(new TextDecoder().decode(rawBytes));
    } catch {
      return json({ code: "WEBHOOK_PAYLOAD_INVALID", error: "Invalid webhook payload." }, 400);
    }

    eventType = typeof event?.event === "string" ? event.event : "";
    const sql = getDb(context);

    if (eventType === "payment.captured") {
      const { keyId, keySecret } = razorpayConfig(context);
      const outcome = await processCapturedPaymentEvent({
        event,
        eventId,
        deps: {
          fetchPayment: (id: string) => razorpayRequest<GatewayPayment>("/payments/" + encodeURIComponent(id), keyId, keySecret),
          markRefunded: async (payment: GatewayPayment) => {
            const updated = await markRefunded(sql, payment);
            if (!updated.length) return "unmatched";
            const saved = await sql`INSERT INTO razorpay_webhook_events(event_id,event_type) VALUES(${eventId},${eventType}) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`;
            return saved.length ? "refunded" : "duplicate";
          },
          markCaptured: async (payment: GatewayPayment) => {
            paymentId = payment.id || "";
            orderId = payment.order_id || "";
            const result = await sql`
        WITH matching AS (
          SELECT id, payment_status, refund_status, razorpay_payment_id
          FROM paid_query_orders
          WHERE razorpay_order_id=${payment.order_id}
            AND amount_inr * 100=${payment.amount}
            AND (
              (payment_status='pending' AND refund_status NOT IN ('requested','processed')
                AND (razorpay_payment_id IS NULL OR razorpay_payment_id=${payment.id}))
              OR (payment_status='paid' AND razorpay_payment_id=${payment.id})
              OR payment_status='refunded'
              OR refund_status='processed'
            )
          LIMIT 1
        ), claim AS (
          INSERT INTO razorpay_webhook_events(event_id,event_type)
          SELECT ${eventId},${eventType} WHERE EXISTS(SELECT 1 FROM matching)
          ON CONFLICT(event_id) DO NOTHING RETURNING event_id
        ), activated AS (
          UPDATE paid_query_orders q
          SET payment_status='paid', status='submitted', payment_provider='razorpay',
              payment_reference=${payment.id}, razorpay_payment_id=${payment.id},
              paid_at=COALESCE(q.paid_at,now()), updated_at=now()
          FROM matching m, claim c
          WHERE q.id=m.id AND m.payment_status='pending'
            AND m.refund_status NOT IN ('requested','processed')
            AND (m.razorpay_payment_id IS NULL OR m.razorpay_payment_id=${payment.id})
          RETURNING q.id
        )
        SELECT (SELECT count(*)::int FROM matching) AS matches,
               (SELECT count(*)::int FROM claim) AS claimed,
               (SELECT count(*)::int FROM activated) AS activated
      `;
            const x = result[0];
            if (!x?.matches) {
              const duplicate = await sql`SELECT 1 FROM razorpay_webhook_events WHERE event_id=${eventId} LIMIT 1`;
              return duplicate.length ? "duplicate" : "unmatched";
            }
            if (!x.claimed) {
              const duplicate = await sql`SELECT 1 FROM razorpay_webhook_events WHERE event_id=${eventId} LIMIT 1`;
              return duplicate.length ? "duplicate" : "conflict";
            }
            if (x.activated) return "paid";
            const current = await sql`
          SELECT payment_status, refund_status, razorpay_payment_id
          FROM paid_query_orders WHERE razorpay_order_id=${payment.order_id} LIMIT 1
        `;
            const state = current[0];
            if (state?.payment_status === "paid" && state.razorpay_payment_id === payment.id) return "already_paid";
            if (state?.payment_status === "refunded" || state?.refund_status === "processed") return "refunded";
            return "conflict";
          },
          log: (result: string, details: { orderId?: string; paymentId?: string }) => diagnostic("captured_payment_checked", eventId, details.orderId, details.paymentId, result)
        }
      });
      const payloadPayment = event.payload?.payment?.entity as GatewayPayment | undefined;
      paymentId = payloadPayment?.id || paymentId;
      orderId = payloadPayment?.order_id || orderId;
      diagnostic("event_processing_result", eventId, orderId, paymentId, outcome.body.code || (outcome.body.duplicate ? "duplicate" : outcome.body.paymentStatus || "processed"));
      return json(outcome.body, outcome.status);
    }

    const subscription = event.payload?.subscription?.entity;
    const subscriptionId = subscription?.id;
    const mapped: Record<string, string> = {
      "subscription.activated": "active",
      "subscription.charged": "active",
      "subscription.cancelled": "cancelled",
      "subscription.completed": "expired",
      "subscription.halted": "payment_failed"
    };
    const nextStatus = mapped[eventType];
    if (nextStatus && subscriptionId) {
      const payment = event.payload?.payment?.entity;
      if (eventType === "subscription.charged" && (
        !payment?.id || payment.subscription_id !== subscriptionId || payment.status !== "captured" ||
        payment.captured !== true || !Number.isSafeInteger(payment.amount) || payment.amount <= 0 || payment.currency !== "INR"
      )) return json({ code: "WEBHOOK_SUBSCRIPTION_PAYMENT_INVALID", error: "Invalid subscription charge event." }, 400);

      const result = await sql`
        WITH matching AS (
          SELECT s.id FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id
          WHERE s.razorpay_subscription_id=${subscriptionId}
            AND (${eventType}<>'subscription.charged' OR (
              p.price_inr*100=${payment?.amount||0} AND p.billing_period IN ('month','quarter','year')
              AND ${payment?.currency||"''"}='INR'
            ))
          LIMIT 1
        ), claim AS (
          INSERT INTO razorpay_webhook_events(event_id,event_type)
          SELECT ${eventId},${eventType} WHERE EXISTS(SELECT 1 FROM matching)
          ON CONFLICT(event_id) DO NOTHING RETURNING event_id
        ), updated AS (
          UPDATE subscriptions s SET status=${nextStatus},
            payment_status=CASE WHEN ${eventType}='subscription.charged' THEN 'paid' WHEN ${eventType}='subscription.halted' THEN 'failed' ELSE s.payment_status END,
            payment_provider='razorpay',
            payment_reference=COALESCE(${payment?.id||null},s.payment_reference),
            razorpay_payment_id=COALESCE(${payment?.id||null},s.razorpay_payment_id),
            authorization_payment_id=CASE WHEN ${eventType}='subscription.activated' THEN COALESCE(${payment?.id||null},s.authorization_payment_id) ELSE s.authorization_payment_id END,
            last_payment_id=CASE WHEN ${eventType}='subscription.charged' THEN COALESCE(${payment?.id||null},s.last_payment_id) ELSE s.last_payment_id END,
            paid_at=CASE WHEN ${eventType}='subscription.charged' THEN now() ELSE s.paid_at END,
            starts_at=CASE WHEN ${eventType}='subscription.activated' THEN COALESCE(s.starts_at,now()) ELSE s.starts_at END,
            query_credits_remaining=CASE WHEN ${eventType}='subscription.charged' THEN p.query_credits ELSE s.query_credits_remaining END,
            ends_at=CASE WHEN ${eventType}='subscription.charged' THEN CASE p.billing_period WHEN 'month' THEN now()+interval '1 month' WHEN 'quarter' THEN now()+interval '3 months' WHEN 'year' THEN now()+interval '1 year' ELSE s.ends_at END ELSE s.ends_at END,
            updated_at=now()
          FROM matching m,claim c,subscription_plans p WHERE s.id=m.id AND p.id=s.plan_id RETURNING s.id
        )
        SELECT (SELECT count(*)::int FROM matching) AS matches,
               (SELECT count(*)::int FROM claim) AS claimed,
               (SELECT count(*)::int FROM updated) AS updated
      `;
      const outcome = result[0];
      if (!outcome?.matches) return json({ code: "WEBHOOK_SUBSCRIPTION_UNMATCHED", error: "Subscription not found." }, 404);
      if (!outcome.claimed) {
        const duplicate = await sql`SELECT 1 FROM razorpay_webhook_events WHERE event_id=${eventId} LIMIT 1`;
        if (duplicate.length) return json({ ok: true, duplicate: true });
        return json({ code: "WEBHOOK_EVENT_NOT_CLAIMED", error: "Webhook event could not be claimed." }, 409);
      }
      diagnostic("subscription_event_processed", eventId, undefined, payment?.id, eventType);
      return json({ ok: true, processed: Number(outcome.updated) === 1 });
    }

    if (eventType === "refund.processed") {
      const refund = event.payload?.refund?.entity;
      paymentId = refund?.payment_id || "";
      if (!refund?.id || !paymentId || refund.status !== "processed") {
        return json({ code: "WEBHOOK_REFUND_INVALID", error: "Invalid processed-refund event." }, 400);
      }
      const { keyId, keySecret } = razorpayConfig(context);
      const payment = await razorpayRequest<GatewayPayment>("/payments/" + encodeURIComponent(paymentId), keyId, keySecret);
      orderId = payment.order_id || "";
      if (!payment.id || payment.id !== paymentId || !orderId || payment.currency !== "INR" ||
          typeof payment.amount !== "number" || !Number.isSafeInteger(payment.amount) || payment.amount <= 0) {
        return json({ code: "WEBHOOK_REFUND_PAYMENT_INVALID", error: "Refund payment does not match a valid Razorpay payment." }, 409);
      }
      const fullRefund = payment.refund_status === "full" ||
        (Number.isSafeInteger(payment.amount_refunded) && Number(payment.amount_refunded) >= payment.amount);
      if (!fullRefund) {
        diagnostic("partial_or_pending_refund", eventId, orderId, paymentId, "not_activated");
        await sql`INSERT INTO razorpay_webhook_events(event_id,event_type) VALUES(${eventId},${eventType}) ON CONFLICT(event_id) DO NOTHING`;
        return json({ ok: true, ignored: true, reason: "Only a full refund changes the paid-query status." });
      }
      const matching = await sql`
        SELECT id FROM paid_query_orders
        WHERE razorpay_order_id=${orderId} AND amount_inr*100=${payment.amount}
          AND (razorpay_payment_id IS NULL OR razorpay_payment_id=${paymentId})
          AND payment_status IN ('pending','paid','refunded')
        LIMIT 1
      `;
      if (!matching.length) {
        diagnostic("refund_order_match_failed", eventId, orderId, paymentId, "unmatched");
        return json({ code: "WEBHOOK_REFUND_UNMATCHED", error: "No matching payment request was found." }, 409);
      }
      const claimed = await sql`INSERT INTO razorpay_webhook_events(event_id,event_type) VALUES(${eventId},${eventType}) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`;
      if (!claimed.length) return json({ ok: true, duplicate: true });
      const updated = await markRefunded(sql, payment);
      diagnostic("refund_event_processed", eventId, orderId, paymentId, updated.length ? "refunded" : "state_conflict");
      return updated.length ? json({ ok: true, processed: true, paymentStatus: "refunded" })
        : json({ code: "WEBHOOK_REFUND_CONFLICT", error: "Refund state could not be matched to the payment request." }, 409);
    }

    const saved = await sql`INSERT INTO razorpay_webhook_events(event_id,event_type) VALUES(${eventId},${eventType||"unknown"}) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`;
    diagnostic("event_ignored", eventId, undefined, undefined, eventType || "unknown");
    return json({ ok: true, ignored: true, duplicate: saved.length === 0 });
  } catch (error) {
    diagnostic("processing_exception", eventId, orderId, paymentId, error instanceof Error ? error.name : "unknown");
    return json({ code: "WEBHOOK_PROCESSING_FAILED", error: "Webhook processing failed. Razorpay may retry this event." }, 500);
  }
};
