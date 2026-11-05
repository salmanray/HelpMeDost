import type { APIRoute } from "astro";
import { getDb, json, cleanText } from "../../../lib/db";
import { razorpayConfig, razorpayRequest } from "../../../lib/razorpay";

export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json();
    const type = cleanText(body.orderType, 30);
    const reference = cleanText(body.referenceCode, 40);
    if (!reference || !["subscription", "paid_query"].includes(type)) return json({ error: "Invalid payment order request." }, 400);

    const sql = getDb(context);
    const rows = type === "subscription"
      ? await sql`SELECT s.id, s.status, s.payment_status, p.price_inr FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.reference_code = ${reference} LIMIT 1`
      : await sql`SELECT id, status, payment_status, amount_inr AS price_inr FROM paid_query_orders WHERE reference_code = ${reference} LIMIT 1`;
    const record: any = rows[0];
    if (!record) return json({ error: "Payment request not found." }, 404);
    const expectedStatus = type === "subscription" ? "pending_payment" : "awaiting_payment";
    if (record.payment_status !== "pending" || record.status !== expectedStatus) return json({ error: "This request is not awaiting payment." }, 409);

    const { keyId, keySecret } = razorpayConfig(context);
    const amount = Number(record.price_inr) * 100;
    if (!Number.isSafeInteger(amount) || amount <= 0) return json({ error: "Invalid order amount." }, 400);
    const order = await razorpayRequest<{id:string;amount:number;currency:string}>("/orders", keyId, keySecret, {
      amount, currency: "INR", receipt: reference, notes: { helpmedost_reference: reference, order_type: type }
    });
    if (order.amount !== amount || order.currency !== "INR") return json({ error: "Unexpected payment order details." }, 502);

    if (type === "subscription") {
      await sql`UPDATE subscriptions SET payment_provider = 'razorpay', payment_reference = ${order.id}, razorpay_order_id = ${order.id}, updated_at = now() WHERE id = ${record.id} AND payment_status = 'pending'`;
    } else {
      await sql`UPDATE paid_query_orders SET payment_provider = 'razorpay', payment_reference = ${order.id}, razorpay_order_id = ${order.id}, updated_at = now() WHERE id = ${record.id} AND payment_status = 'pending'`;
    }
    return json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId });
  } catch (error) {
    console.error("Razorpay order creation failed", error);
    return json({ error: "Unable to start payment. Please try again." }, 500);
  }
};
