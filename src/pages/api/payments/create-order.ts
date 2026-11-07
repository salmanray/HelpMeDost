import type { APIRoute } from "astro";
import { getDb, json, cleanText } from "../../../lib/db";
import { currentAuth } from "../../../lib/auth";
import { razorpayConfig, razorpayRequest } from "../../../lib/razorpay";

function safePaymentError(error: unknown) {
  if (error instanceof Error && /^(Razorpay|Payment gateway)/i.test(error.message)) return error.message.slice(0, 300);
  return "Unable to start payment. Please try again.";
}

export const POST: APIRoute = async (context) => {
  try {
    const user = await currentAuth(context);
    if (!user || user.purpose !== "user" || user.user_type !== "public") {
      return json({ error: "Please sign in to continue with payment." }, 401);
    }
    const body = await context.request.json();
    const type = cleanText(body.orderType, 30);
    const reference = cleanText(body.referenceCode, 40);
    if (!reference || type !== "paid_query") {
      return json({ error: "Invalid payment order request." }, 400);
    }

    const sql = getDb(context);
    const rows = await sql`SELECT id, status, payment_status, amount_inr, razorpay_order_id
      FROM paid_query_orders
      WHERE reference_code = ${reference} AND user_profile_id = ${user.id}
      LIMIT 1`;
    const record = rows[0];
    if (!record) return json({ error: "Payment request not found." }, 404);
    if (record.payment_status !== "pending" || record.status !== "awaiting_payment") {
      return json({ error: "This request is not awaiting payment." }, 409);
    }

    const { keyId, keySecret } = razorpayConfig(context);
    const amount = Number(record.amount_inr) * 100;
    if (!Number.isSafeInteger(amount) || amount <= 0) return json({ error: "Invalid order amount." }, 400);

    if (record.razorpay_order_id) {
      const existing = await razorpayRequest<{id:string;amount:number;currency:string;status:string}>(
        "/orders/" + encodeURIComponent(record.razorpay_order_id), keyId, keySecret
      );
      if (existing.id !== record.razorpay_order_id || existing.amount !== amount || existing.currency !== "INR") {
        return json({ code: "ORDER_MISMATCH", error: "Existing payment order does not match this request." }, 409);
      }
      if (existing.status === "paid") {
        return json({ code: "PAYMENT_RECONCILIATION_REQUIRED", error: "This order already has a payment attempt. Check its status before continuing." }, 409);
      }
      console.info("Razorpay order reused", { referenceSuffix: reference.slice(-6), orderSuffix: existing.id.slice(-6), orderStatus: existing.status });
      return json({ orderId: existing.id, amount: existing.amount, currency: existing.currency, keyId });
    }

    const order = await razorpayRequest<{id:string;amount:number;currency:string}>("/orders", keyId, keySecret, {
      amount, currency: "INR", receipt: reference, notes: { helpmedost_reference: reference, order_type: type, profile_id: user.id }
    });
    if (order.amount !== amount || order.currency !== "INR") return json({ error: "Unexpected payment order details." }, 502);

    const updated = await sql`UPDATE paid_query_orders
      SET payment_provider = 'razorpay', payment_reference = ${order.id},
          razorpay_order_id = ${order.id}, updated_at = now()
      WHERE id = ${record.id} AND user_profile_id = ${user.id} AND payment_status = 'pending'
        AND razorpay_order_id IS NULL
      RETURNING id`;
    if (!updated.length) {
      console.warn("Razorpay order could not be attached", { referenceSuffix: reference.slice(-6), orderSuffix: order.id.slice(-6) });
      return json({ code: "ORDER_STATE_CHANGED", error: "This payment request changed. Check payment status before retrying." }, 409);
    }
    return json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId });
  } catch (error) {
    console.error("Razorpay order creation failed", error);
    return json({ error: safePaymentError(error) }, 500);
  }
};
