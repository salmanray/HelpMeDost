import test from "node:test";
import assert from "node:assert/strict";
import { hmacSha256Hex, safeEqual } from "../src/lib/razorpay.ts";
import {
  checkoutCallbackRecoveryMessage,
  classifyRemotePayment,
  paymentHistoryState,
  processCapturedPaymentEvent,
  verifyPaidQueryCallback,
  verifyWebhookSignature
} from "../src/lib/payment-lifecycle.mjs";

const user = { id: "00000000-0000-4000-8000-000000000001", purpose: "user", user_type: "public" };
const record = {
  id: "00000000-0000-4000-8000-000000000002",
  reference_code: "HMD-P-MOCK123",
  razorpay_order_id: "order_mock123",
  razorpay_payment_id: null,
  payment_status: "pending",
  refund_status: "not_requested",
  amount_inr: 49
};
const callback = {
  referenceCode: record.reference_code,
  razorpay_order_id: record.razorpay_order_id,
  razorpay_payment_id: "pay_mock123",
  razorpay_signature: "valid-signature",
  orderType: "paid_query"
};
const captured = {
  id: callback.razorpay_payment_id,
  order_id: callback.razorpay_order_id,
  amount: 4900,
  currency: "INR",
  status: "captured",
  captured: true,
  amount_refunded: 0,
  refund_status: null
};

function verificationDeps(overrides = {}) {
  let state = { ...record };
  const calls = { lookup: 0, signature: 0, fetch: 0, paid: 0, refunded: 0 };
  return {
    calls,
    get state() { return state; },
    deps: {
      findRecord: async () => { calls.lookup++; return { ...state }; },
      verifySignature: async () => { calls.signature++; return true; },
      fetchPayment: async () => { calls.fetch++; return { ...captured }; },
      markCaptured: async (_row, payment) => {
        calls.paid++;
        if (state.payment_status === "refunded" || state.refund_status === "processed") return "refunded";
        if (state.payment_status === "paid" && state.razorpay_payment_id === payment.id) return "paid";
        state = { ...state, payment_status: "paid", status: "submitted", razorpay_payment_id: payment.id };
        return "paid";
      },
      markRefunded: async (_row, payment) => {
        calls.refunded++;
        state = { ...state, payment_status: "refunded", status: "refunded", refund_status: "processed", razorpay_payment_id: payment.id };
        return "refunded";
      },
      ...overrides
    }
  };
}

test("unauthenticated verification is rejected before reading an order", async () => {
  const mock = verificationDeps();
  const result = await verifyPaidQueryCallback({ user: null, body: callback, deps: mock.deps });
  assert.equal(result.status, 401);
  assert.equal(result.code, "AUTH_REQUIRED");
  assert.equal(mock.calls.lookup, 0);
});

test("wrong order ID is rejected before signature verification", async () => {
  const mock = verificationDeps();
  const result = await verifyPaidQueryCallback({ user, body: { ...callback, razorpay_order_id: "order_wrong" }, deps: mock.deps });
  assert.equal(result.code, "ORDER_MISMATCH");
  assert.equal(mock.calls.signature, 0);
});

test("invalid checkout signature is rejected before fetching Razorpay payment", async () => {
  const mock = verificationDeps({ verifySignature: async () => false });
  const result = await verifyPaidQueryCallback({ user, body: callback, deps: mock.deps });
  assert.equal(result.code, "SIGNATURE_INVALID");
  assert.equal(mock.calls.fetch, 0);
});

test("wrong amount from Razorpay is rejected and never updates the order", async () => {
  const mock = verificationDeps({ fetchPayment: async () => ({ ...captured, amount: 4901 }) });
  const result = await verifyPaidQueryCallback({ user, body: callback, deps: mock.deps });
  assert.equal(result.code, "PAYMENT_MISMATCH");
  assert.equal(mock.calls.paid, 0);
  assert.equal(mock.state.payment_status, "pending");
});

test("captured payment is verified with mocked Razorpay data and marked once", async () => {
  const mock = verificationDeps();
  const result = await verifyPaidQueryCallback({ user, body: callback, deps: mock.deps });
  assert.equal(result.paymentStatus, "paid");
  assert.equal(mock.calls.fetch, 1);
  assert.equal(mock.state.razorpay_payment_id, callback.razorpay_payment_id);
  assert.equal(paymentHistoryState(mock.state), "paid");

  const repeated = await verifyPaidQueryCallback({ user, body: callback, deps: mock.deps });
  assert.equal(repeated.code, "ALREADY_PAID");
  assert.equal(mock.calls.fetch, 1);
});

test("already-refunded database state cannot transition back to paid", async () => {
  const mock = verificationDeps({
    findRecord: async () => ({ ...record, payment_status: "refunded", refund_status: "processed" })
  });
  const result = await verifyPaidQueryCallback({ user, body: callback, deps: mock.deps });
  assert.equal(result.paymentStatus, "refunded");
  assert.equal(mock.calls.fetch, 0);
  assert.equal(paymentHistoryState({ payment_status: "pending", refund_status: "processed" }), "refunded");
});

test("Razorpay-confirmed full refund is persisted as refunded, never paid", async () => {
  const mock = verificationDeps({
    fetchPayment: async () => ({ ...captured, status: "refunded", amount_refunded: 4900, refund_status: "full" })
  });
  const result = await verifyPaidQueryCallback({ user, body: callback, deps: mock.deps });
  assert.equal(result.paymentStatus, "refunded");
  assert.equal(mock.calls.paid, 0);
  assert.equal(mock.state.payment_status, "refunded");
});

test("webhook signature check uses exact request bytes and rejects an invalid signature", async () => {
  const rawBody = new TextEncoder().encode('{"event":"payment.captured","unicode":"₹"}');
  const validSignature = await hmacSha256Hex("mock-webhook-secret", rawBody);
  const valid = await verifyWebhookSignature({ rawBody, signature: validSignature, secret: "mock-webhook-secret", hmac: hmacSha256Hex, safeEqual });
  const invalid = await verifyWebhookSignature({ rawBody, signature: "00", secret: "mock-webhook-secret", hmac: hmacSha256Hex, safeEqual });
  assert.equal(valid.ok, true);
  assert.equal(invalid.code, "WEBHOOK_SIGNATURE_INVALID");
});

test("valid simulated captured webhook and duplicate event are idempotent", async () => {
  const seen = new Set();
  const event = { event: "payment.captured", payload: { payment: { entity: { ...captured } } } };
  const deps = {
    fetchPayment: async () => ({ ...captured }),
    markCaptured: async (_payment, eventId) => {
      if (seen.has(eventId)) return "duplicate";
      seen.add(eventId);
      return "paid";
    },
    markRefunded: async () => "refunded"
  };
  const first = await processCapturedPaymentEvent({ event, eventId: "evt_mock_1", deps });
  const duplicate = await processCapturedPaymentEvent({ event, eventId: "evt_mock_1", deps });
  assert.equal(first.status, 200);
  assert.equal(first.body.processed, true);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(seen.size, 1);
});

test("captured webhook rejects a mismatched gateway order and full refund", async () => {
  const event = { event: "payment.captured", payload: { payment: { entity: { ...captured } } } };
  const mismatch = await processCapturedPaymentEvent({ event, eventId: "evt_mock_2", deps: {
    fetchPayment: async () => ({ ...captured, order_id: "order_other" }),
    markCaptured: async () => assert.fail("mismatch must not update"), markRefunded: async () => assert.fail("mismatch must not update")
  } });
  assert.equal(mismatch.status, 409);

  const refunded = await processCapturedPaymentEvent({ event, eventId: "evt_mock_3", deps: {
    fetchPayment: async () => ({ ...captured, status: "refunded", amount_refunded: 4900, refund_status: "full" }),
    markCaptured: async () => assert.fail("refunded payment must not be marked paid"), markRefunded: async () => "refunded"
  } });
  assert.equal(refunded.body.paymentStatus, "refunded");
});

test("partial refund is not treated as a paid query", () => {
  assert.equal(classifyRemotePayment({ ...captured, amount_refunded: 100, refund_status: "partial" }, {
    paymentId: captured.id, orderId: captured.order_id, amountPaise: 4900
  }).kind, "partial_refund");
});

test("callback recovery tells the customer not to pay again", () => {
  const message = checkoutCallbackRecoveryMessage(record.reference_code);
  assert.match(message, /Do not pay again/);
  assert.match(message, /Retry verification/);
});
