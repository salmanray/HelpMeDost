/**
 * Shared payment lifecycle rules. Kept free of Cloudflare, Astro, and database
 * dependencies so the security-sensitive decisions can be tested with mocks.
 */

export function classifyRemotePayment(payment, expected) {
  if (!payment || typeof payment !== "object") return { kind: "invalid" };
  if (payment.id !== expected.paymentId || payment.order_id !== expected.orderId) {
    return { kind: "mismatch" };
  }
  if (payment.amount !== expected.amountPaise || payment.currency !== "INR") {
    return { kind: "mismatch" };
  }

  const amountRefunded = payment.amount_refunded ?? 0;
  if (!Number.isSafeInteger(amountRefunded) || amountRefunded < 0 || amountRefunded > expected.amountPaise) {
    return { kind: "invalid" };
  }
  if (payment.refund_status === "full" || payment.status === "refunded" || amountRefunded === expected.amountPaise) {
    return { kind: "refunded" };
  }
  if (payment.refund_status === "partial" || amountRefunded > 0) {
    return { kind: "partial_refund" };
  }
  if (payment.status !== "captured" || payment.captured !== true) {
    return { kind: "pending" };
  }
  return { kind: "captured" };
}

export async function verifyPaidQueryCallback({ user, body, deps }) {
  if (!user || user.purpose !== "user" || user.user_type !== "public") {
    return { status: 401, code: "AUTH_REQUIRED", error: "Please sign in to verify payment." };
  }

  const reference = typeof body?.referenceCode === "string" ? body.referenceCode.trim() : "";
  const paymentId = typeof body?.razorpay_payment_id === "string" ? body.razorpay_payment_id.trim() : "";
  const orderId = typeof body?.razorpay_order_id === "string" ? body.razorpay_order_id.trim() : "";
  const signature = typeof body?.razorpay_signature === "string" ? body.razorpay_signature.trim() : "";
  if (!reference || !paymentId || !orderId || !signature || body?.orderType !== "paid_query") {
    return { status: 400, code: "INVALID_REQUEST", error: "Invalid payment verification details." };
  }

  const record = await deps.findRecord(reference, user.id);
  if (!record) return { status: 404, code: "PAYMENT_NOT_FOUND", error: "Payment request not found." };
  if (record.razorpay_order_id !== orderId) {
    return { status: 409, code: "ORDER_MISMATCH", error: "Payment order does not match this request." };
  }
  if (record.payment_status === "refunded" || record.refund_status === "processed") {
    return { status: 200, code: "REFUNDED", ok: true, paymentStatus: "refunded" };
  }
  if (record.razorpay_payment_id && record.razorpay_payment_id !== paymentId) {
    return { status: 409, code: "PAYMENT_MISMATCH", error: "A different payment is already linked to this request." };
  }
  if (record.payment_status === "paid" && record.razorpay_payment_id === paymentId) {
    return { status: 200, code: "ALREADY_PAID", ok: true, paymentStatus: "paid", alreadyVerified: true };
  }

  deps.log?.("signature_check_started", { reference, orderId, paymentId });
  if (!await deps.verifySignature(orderId, paymentId, signature)) {
    deps.log?.("signature_check_failed", { reference, orderId, paymentId });
    return { status: 400, code: "SIGNATURE_INVALID", error: "Payment signature verification failed." };
  }
  deps.log?.("signature_check_passed", { reference, orderId, paymentId });

  const payment = await deps.fetchPayment(paymentId);
  const classification = classifyRemotePayment(payment, {
    paymentId,
    orderId,
    amountPaise: Number(record.amount_inr) * 100
  });
  deps.log?.("gateway_payment_checked", { reference, orderId, paymentId, result: classification.kind });

  if (classification.kind === "refunded") {
    const state = await deps.markRefunded(record, payment);
    deps.log?.("database_refund_state", { reference, orderId, paymentId, result: state });
    return { status: 200, code: "REFUNDED", ok: true, paymentStatus: "refunded" };
  }
  if (classification.kind === "partial_refund") {
    return { status: 409, code: "PARTIAL_REFUND_REVIEW", error: "This payment has a partial refund and needs support review." };
  }
  if (classification.kind === "mismatch") {
    return { status: 409, code: "PAYMENT_MISMATCH", error: "Payment details do not match this request." };
  }
  if (classification.kind !== "captured") {
    return { status: 409, code: "PAYMENT_PENDING", error: "Razorpay has not confirmed a captured payment yet." };
  }

  const state = await deps.markCaptured(record, payment);
  deps.log?.("database_payment_state", { reference, orderId, paymentId, result: state });
  if (state === "paid") return { status: 200, code: "PAID", ok: true, paymentStatus: "paid" };
  if (state === "refunded") return { status: 200, code: "REFUNDED", ok: true, paymentStatus: "refunded" };
  return { status: 409, code: "PAYMENT_STATE_CONFLICT", error: "Payment state changed. Check your payment history before trying again." };
}

export async function verifyWebhookSignature({ rawBody, signature, secret, hmac, safeEqual }) {
  if (!secret) return { ok: false, code: "WEBHOOK_SECRET_MISSING" };
  if (!signature) return { ok: false, code: "WEBHOOK_SIGNATURE_MISSING" };
  const expected = await hmac(secret, rawBody);
  return safeEqual(expected, signature)
    ? { ok: true }
    : { ok: false, code: "WEBHOOK_SIGNATURE_INVALID" };
}

export async function processCapturedPaymentEvent({ event, eventId, deps }) {
  const payloadPayment = event?.payload?.payment?.entity;
  if (payloadPayment?.subscription_id) {
    return { status: 200, body: { ok: true, ignored: true, reason: "subscription lifecycle is handled by subscription webhooks" } };
  }
  const paymentId = typeof payloadPayment?.id === "string" ? payloadPayment.id : "";
  const orderId = typeof payloadPayment?.order_id === "string" ? payloadPayment.order_id : "";
  if (!paymentId || !orderId || payloadPayment.status !== "captured" || payloadPayment.captured !== true ||
      !Number.isSafeInteger(payloadPayment.amount) || payloadPayment.amount <= 0 || payloadPayment.currency !== "INR") {
    return { status: 400, body: { code: "WEBHOOK_PAYMENT_INVALID", error: "Invalid captured-payment event." } };
  }

  const payment = await deps.fetchPayment(paymentId);
  const classification = classifyRemotePayment(payment, {
    paymentId,
    orderId,
    amountPaise: payloadPayment.amount
  });
  deps.log?.(classification.kind, { eventId, orderId, paymentId });

  if (classification.kind === "refunded") {
    const state = await deps.markRefunded(payment, eventId);
    return state === "refunded" || state === "duplicate"
      ? { status: 200, body: { ok: true, processed: true, paymentStatus: "refunded" } }
      : { status: 409, body: { code: "WEBHOOK_ORDER_UNMATCHED", error: "No matching payment request was found." } };
  }
  if (classification.kind === "partial_refund") {
    return { status: 409, body: { code: "WEBHOOK_PARTIAL_REFUND", error: "Payment has a partial refund and needs review." } };
  }
  if (classification.kind !== "captured") {
    return { status: 409, body: { code: "WEBHOOK_GATEWAY_MISMATCH", error: "Current Razorpay payment does not match this event." } };
  }

  const state = await deps.markCaptured(payment, eventId);
  if (state === "duplicate") return { status: 200, body: { ok: true, duplicate: true } };
  if (state === "paid" || state === "already_paid") {
    return { status: 200, body: { ok: true, processed: true, alreadyPaid: state === "already_paid" } };
  }
  if (state === "refunded") return { status: 200, body: { ok: true, processed: true, paymentStatus: "refunded" } };
  return { status: 409, body: { code: "WEBHOOK_ORDER_UNMATCHED", error: "No matching payment request was found." } };
}

export function paymentHistoryState(record) {
  if (record?.payment_status === "refunded" || record?.refund_status === "processed") return "refunded";
  if (record?.payment_status === "paid") return "paid";
  return "pending";
}

export function checkoutCallbackRecoveryMessage(reference) {
  return `Payment verification is still pending for ${reference}. Do not pay again. Retry verification or check payment status.`;
}
