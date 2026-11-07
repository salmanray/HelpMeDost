import type { APIRoute } from "astro";
import { currentAuth } from "../../../lib/auth";
import { getDb, json, cleanText } from "../../../lib/db";
import { findPaidQueryByReference, settlePaidQueryCaptured, settlePaidQueryRefunded } from "../../../lib/payments-db";
import { classifyRemotePayment, paymentHistoryState } from "../../../lib/payment-lifecycle.mjs";
import { razorpayConfig, razorpayRequest } from "../../../lib/razorpay";

type PaymentCollection = { items?: Array<{
  id: string; order_id: string; amount: number; currency: string; status: string;
  captured: boolean; amount_refunded?: number; refund_status?: "partial" | "full" | null;
}> };

const suffix = (value: string) => value.slice(-6);

export const GET: APIRoute = async (context) => {
  let referenceSuffix = "";
  try {
    const user = await currentAuth(context);
    if (!user || user.purpose !== "user" || user.user_type !== "public") {
      return json({ code: "AUTH_REQUIRED", error: "Please sign in to check payment status." }, 401);
    }

    const reference = cleanText(context.url.searchParams.get("referenceCode"), 40);
    referenceSuffix = suffix(reference || "");
    if (!reference) return json({ code: "INVALID_REFERENCE", error: "Payment reference is required." }, 400);

    const sql = getDb(context);
    const record = await findPaidQueryByReference(sql, reference, user.id);
    if (!record) return json({ code: "PAYMENT_NOT_FOUND", error: "Payment request not found." }, 404);
    if (record.payment_status === "refunded" || record.refund_status === "processed") {
      return json({ ok: true, referenceCode: reference, paymentStatus: "refunded" });
    }
    if (!record.razorpay_order_id) {
      return json({ ok: true, referenceCode: reference, paymentStatus: paymentHistoryState(record) });
    }

    const { keyId, keySecret } = razorpayConfig(context);
    const collection = await razorpayRequest<PaymentCollection>(
      "/orders/" + encodeURIComponent(record.razorpay_order_id) + "/payments?count=100",
      keyId,
      keySecret
    );
    const items = Array.isArray(collection.items) ? collection.items : [];
    const candidates = items.filter(payment =>
      payment.order_id === record.razorpay_order_id &&
      payment.amount === Number(record.amount_inr) * 100 &&
      payment.currency === "INR"
    );
    const captured = candidates.filter(payment => payment.status === "captured" || payment.status === "refunded" || payment.captured);
    if (captured.length > 1) {
      console.error("Payment reconciliation requires review", { referenceSuffix, orderSuffix: suffix(record.razorpay_order_id), candidateCount: captured.length });
      return json({ code: "PAYMENT_REVIEW_REQUIRED", error: "More than one captured payment is linked to this request. Support review is required." }, 409);
    }
    if (!captured.length) {
      if (candidates.some(payment => payment.status === "authorized" || payment.status === "created")) {
        return json({ ok: true, referenceCode: reference, paymentStatus: "authorised" });
      }
      if (candidates.some(payment => payment.status === "failed")) {
        return json({ ok: true, referenceCode: reference, paymentStatus: "not_paid" });
      }
      return json({ ok: true, referenceCode: reference, paymentStatus: record.payment_status === "paid" ? "review_required" : "not_paid" });
    }

    const payment = captured[0];
    const classification = classifyRemotePayment(payment, {
      paymentId: payment.id,
      orderId: record.razorpay_order_id,
      amountPaise: Number(record.amount_inr) * 100
    });
    if (classification.kind === "refunded") {
      const state = await settlePaidQueryRefunded(sql, record, payment, user.id);
      console.info("Payment status reconciliation", { referenceSuffix, orderSuffix: suffix(record.razorpay_order_id), result: state });
      return json({ ok: true, referenceCode: reference, paymentStatus: state === "refunded" ? "refunded" : "review_required" });
    }
    if (classification.kind === "partial_refund") {
      console.info("Payment status reconciliation", { referenceSuffix, orderSuffix: suffix(record.razorpay_order_id), result: "partial_refund" });
      return json({ code: "PARTIAL_REFUND_REVIEW", error: "This payment has a partial refund and needs support review." }, 409);
    }
    if (classification.kind !== "captured") {
      console.info("Payment status reconciliation", { referenceSuffix, orderSuffix: suffix(record.razorpay_order_id), result: classification.kind });
      return json({ ok: true, referenceCode: reference, paymentStatus: paymentHistoryState(record) });
    }

    const state = await settlePaidQueryCaptured(sql, record, payment, user.id);
    console.info("Payment status reconciliation", { referenceSuffix, orderSuffix: suffix(record.razorpay_order_id), result: state });
    if (state === "paid" || state === "refunded") {
      return json({ ok: true, referenceCode: reference, paymentStatus: state });
    }
    return json({ code: "PAYMENT_STATE_CONFLICT", error: "Payment state changed while it was being checked. Refresh payment history." }, 409);
  } catch (error) {
    console.error("Payment status reconciliation failed", { referenceSuffix, errorName: error instanceof Error ? error.name : "unknown" });
    return json({
      code: "PAYMENT_STATUS_UNAVAILABLE",
      error: "Payment status is temporarily unavailable. No new payment was started. Please retry shortly."
    }, 503);
  }
};
