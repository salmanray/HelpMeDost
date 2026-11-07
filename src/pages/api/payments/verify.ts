import type { APIRoute } from "astro";
import { currentAuth } from "../../../lib/auth";
import { getDb, json } from "../../../lib/db";
import { findPaidQueryByReference, settlePaidQueryCaptured, settlePaidQueryRefunded } from "../../../lib/payments-db";
import { hmacSha256Hex, razorpayConfig, razorpayRequest, safeEqual } from "../../../lib/razorpay";
import { verifyPaidQueryCallback } from "../../../lib/payment-lifecycle.mjs";

const suffix = (value: unknown) => typeof value === "string" && value.length ? value.slice(-6) : undefined;
function diagnostic(stage: string, data: Record<string, unknown> = {}) {
  console.info("Payment verification", {
    stage,
    referenceSuffix: suffix(data.reference),
    orderSuffix: suffix(data.orderId),
    paymentSuffix: suffix(data.paymentId),
    result: typeof data.result === "string" ? data.result : undefined
  });
}

export const POST: APIRoute = async (context) => {
  let recordReference = "";
  let orderId = "";
  let paymentId = "";
  diagnostic("started");

  try {
    const user = await currentAuth(context);
    const authenticated = Boolean(user && user.purpose === "user" && user.user_type === "public");
    diagnostic("authentication_result", { result: authenticated ? "authenticated" : "unauthenticated" });
    if (!authenticated) return json({ code: "AUTH_REQUIRED", error: "Please sign in to verify payment." }, 401);
    const body = await context.request.json();
    recordReference = typeof body?.referenceCode === "string" ? body.referenceCode.trim() : "";
    orderId = typeof body?.razorpay_order_id === "string" ? body.razorpay_order_id.trim() : "";
    paymentId = typeof body?.razorpay_payment_id === "string" ? body.razorpay_payment_id.trim() : "";
    diagnostic("reference_order_received", { reference: recordReference, orderId, paymentId });

    const sql = getDb(context);
    const { keyId, keySecret } = razorpayConfig(context);
    const result = await verifyPaidQueryCallback({
      user,
      body,
      deps: {
        findRecord: (reference: string, userId: string) => findPaidQueryByReference(sql, reference, userId),
        verifySignature: async (expectedOrderId: string, expectedPaymentId: string, signature: string) => {
          const expected = await hmacSha256Hex(keySecret, expectedOrderId + "|" + expectedPaymentId);
          return safeEqual(expected, signature);
        },
        fetchPayment: (id: string) => razorpayRequest<{
          id: string; order_id: string; amount: number; currency: string; status: string;
          captured: boolean; amount_refunded?: number; refund_status?: "partial" | "full" | null;
        }>("/payments/" + encodeURIComponent(id), keyId, keySecret),
        markCaptured: (record: any, payment: any) => settlePaidQueryCaptured(sql, record, payment, user?.id),
        markRefunded: (record: any, payment: any) => settlePaidQueryRefunded(sql, record, payment, user?.id),
        log: (stage: string, data: Record<string, unknown>) => diagnostic(stage, data)
      }
    });
    return json(result, result.status);
  } catch (error) {
    diagnostic("verification_exception", { reference: recordReference, orderId, paymentId, result: error instanceof Error ? error.name : "unknown" });
    return json({
      code: "VERIFICATION_UNAVAILABLE",
      error: "Payment verification is temporarily unavailable. Do not pay again; retry verification or check payment status."
    }, 503);
  }
};
