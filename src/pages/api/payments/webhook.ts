import type { APIRoute } from "astro";
import { getDb, json } from "../../../lib/db";
import { hmacSha256Hex, safeEqual } from "../../../lib/razorpay";

export const POST: APIRoute = async (context) => {
  try {
    const rawBody=await context.request.text();
    const signature=context.request.headers.get("x-razorpay-signature")||"";
    const eventId=context.request.headers.get("x-razorpay-event-id")||"";
    const secret=context.locals.runtime?.env?.RAZORPAY_WEBHOOK_SECRET;
    if(!secret) return json({error:"Webhook secret is not configured."},503);
    if(!eventId||!signature) return json({error:"Missing webhook headers."},400);
    if(!safeEqual(await hmacSha256Hex(secret,rawBody),signature)) return json({error:"Invalid webhook signature."},400);
    let event:any;
    try { event=JSON.parse(rawBody); } catch { return json({error:"Invalid webhook payload."},400); }
    const eventType=String(event?.event||"");
    const sql=getDb(context);

    if(eventType==="payment.captured") {
      const p=event.payload?.payment?.entity;
      if(!p?.id||!p?.order_id||p.status!=="captured"||p.captured!==true||!Number.isSafeInteger(p.amount)||p.amount<=0||p.currency!=="INR") return json({error:"Invalid captured-payment event."},400);
      const result=await sql`
        WITH match AS (
          SELECT id FROM paid_query_orders WHERE razorpay_order_id=${p.order_id}
            AND payment_status='pending' AND amount_inr*100=${p.amount} LIMIT 1
        ), claim AS (
          INSERT INTO razorpay_webhook_events(event_id,event_type)
          SELECT ${eventId},${eventType} WHERE EXISTS(SELECT 1 FROM match)
          ON CONFLICT(event_id) DO NOTHING RETURNING event_id
        ), done AS (
          UPDATE paid_query_orders q SET payment_status='paid',status='submitted',payment_provider='razorpay',
            payment_reference=${p.id},razorpay_payment_id=${p.id},paid_at=COALESCE(q.paid_at,now()),updated_at=now()
          FROM match,claim WHERE q.id=match.id RETURNING q.id
        ) SELECT (SELECT count(*)::int FROM claim) AS claimed,(SELECT count(*)::int FROM done) AS updated
      `;
      const x=result[0];
      if(!x?.claimed) {
        const dup=await sql`SELECT 1 FROM razorpay_webhook_events WHERE event_id=${eventId} LIMIT 1`;
        if(dup.length) return json({ok:true,duplicate:true});
        return json({error:"No matching pending paid query."},409);
      }
      return json({ok:true,processed:Number(x.updated)===1});
    }

    const subscription=event.payload?.subscription?.entity;
    const subscriptionId=subscription?.id;
    const mapped:Record<string,string>={"subscription.activated":"active","subscription.charged":"active","subscription.cancelled":"cancelled","subscription.completed":"expired","subscription.halted":"payment_failed"};
    const nextStatus=mapped[eventType];
    if(nextStatus && subscriptionId) {
      const payment=event.payload?.payment?.entity;
      const result=await sql`
        WITH match AS (SELECT id FROM subscriptions WHERE razorpay_subscription_id=${subscriptionId} LIMIT 1),
        claim AS (
          INSERT INTO razorpay_webhook_events(event_id,event_type)
          SELECT ${eventId},${eventType} WHERE EXISTS(SELECT 1 FROM match)
          ON CONFLICT(event_id) DO NOTHING RETURNING event_id
        ), done AS (
          UPDATE subscriptions s SET status=${nextStatus},
            payment_status=CASE WHEN ${eventType}='subscription.charged' THEN 'paid' ELSE s.payment_status END,
            payment_provider='razorpay',
            payment_reference=COALESCE(${payment?.id||null},s.payment_reference),
            razorpay_payment_id=COALESCE(${payment?.id||null},s.razorpay_payment_id),
            authorization_payment_id=CASE WHEN ${eventType}='subscription.activated' THEN COALESCE(${payment?.id||null},s.authorization_payment_id) ELSE s.authorization_payment_id END,
            last_payment_id=CASE WHEN ${eventType}='subscription.charged' THEN COALESCE(${payment?.id||null},s.last_payment_id) ELSE s.last_payment_id END,
            paid_at=CASE WHEN ${eventType}='subscription.charged' THEN now() ELSE s.paid_at END,
            starts_at=CASE WHEN ${eventType}='subscription.activated' THEN COALESCE(s.starts_at,now()) ELSE s.starts_at END,
            updated_at=now()
          FROM match,claim WHERE s.id=match.id RETURNING s.id
        ) SELECT (SELECT count(*)::int FROM claim) AS claimed,(SELECT count(*)::int FROM done) AS updated
      `;
      const x=result[0];
      if(!x?.claimed) {
        const dup=await sql`SELECT 1 FROM razorpay_webhook_events WHERE event_id=${eventId} LIMIT 1`;
        if(dup.length) return json({ok:true,duplicate:true});
        return json({error:"Subscription not found."},404);
      }
      return json({ok:true,processed:Number(x.updated)===1});
    }

    if(eventType==="refund.processed") {
      const refund=event.payload?.refund?.entity;
      if(!refund?.id||!refund?.payment_id) return json({error:"Invalid refund event."},400);
      const result=await sql`
        WITH match AS (SELECT id FROM paid_query_orders WHERE razorpay_payment_id=${refund.payment_id} AND refund_status='requested' LIMIT 1),
        claim AS (
          INSERT INTO razorpay_webhook_events(event_id,event_type)
          SELECT ${eventId},${eventType} WHERE EXISTS(SELECT 1 FROM match)
          ON CONFLICT(event_id) DO NOTHING RETURNING event_id
        ), done AS (
          UPDATE paid_query_orders q SET razorpay_refund_id=${refund.id},refund_status='processed',
            payment_status='refunded',status='refunded',updated_at=now()
          FROM match,claim WHERE q.id=match.id RETURNING q.id
        ) SELECT (SELECT count(*)::int FROM claim) AS claimed,(SELECT count(*)::int FROM done) AS updated
      `;
      const x=result[0];
      if(!x?.claimed) {
        const dup=await sql`SELECT 1 FROM razorpay_webhook_events WHERE event_id=${eventId} LIMIT 1`;
        if(dup.length) return json({ok:true,duplicate:true});
        return json({error:"No matching pending refund."},409);
      }
      return json({ok:true,processed:Number(x.updated)===1});
    }

    // Persist a verified event once, so gateway retries do not cause repeated work.
    const saved=await sql`INSERT INTO razorpay_webhook_events(event_id,event_type) VALUES(${eventId},${eventType||"unknown"}) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`;
    return json({ok:true,ignored:true,duplicate:saved.length===0});
  } catch(error) {
    console.error("Razorpay webhook processing failed",error);
    return json({error:"Webhook processing failed."},500);
  }
};
