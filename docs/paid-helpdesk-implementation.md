# Paid Helpdesk, Accounts & Payment Records — Implementation Plan

## Product behaviour
- Visitors may submit free public assistance requests without an account.
- Any paid service purchase requires a verified signed-in account.
- A paid request belongs to one account and one HelpMeDost reference code.
- A payment is considered successful only after server-side Razorpay signature/API verification or a verified captured webhook. Browser success alone is never proof.
- Customer dashboard: paid requests, payment history, receipt details, request status and full customer-visible conversation.
- Admin dashboard: customer/request/payment details, reply composer, internal notes, assignment/status history, payment reconciliation and refund record.
- Every message and operational action is timestamped and attributable.
- A paid request remains visible even if payment confirmation and request finalization are interrupted; reconciliation must recover it.

## No-investment policy
- Keep Firebase on Spark; no Blaze upgrade.
- Email/password and Google sign-in only; no phone OTP or mandatory email-link flow.
- No paid SMS/WhatsApp integration. Email notifications must be optional and must not block in-app messaging.
- Do not introduce a new paid SaaS dependency. Razorpay transaction fees, if any, are disclosed as payment-provider charges and not a subscription requirement.

## Security requirements before release
- Verify Firebase ID tokens server-side; never trust a client UID/email/role.
- Link legacy guest requests only through a verified ownership process; never auto-link by phone number alone.
- Enforce customer ownership on every request, payment, receipt and message endpoint.
- Keep admin authorization separate from customer Firebase authentication.
- Validate Razorpay order, amount, currency, signature, captured status and order ownership server-side.
- Make webhook processing idempotent and reconcile unmatched captured payments.
- Keep internal notes invisible to customers.
- Use append-only messages/activity records; protect personal data and uploaded documents.
- Apply migrations only to an isolated Neon test branch first; no production migration or secret change without explicit approval.

## Delivery sequence
1. Review existing auth/payment/admin code and current schema.
2. Add account ownership, payment ledger, conversation and activity schema.
3. Implement server-side Firebase session and customer ownership.
4. Integrate paid checkout with authenticated account ownership and durable payment records.
5. Build customer payment/request history and conversation UI.
6. Build admin request detail, reply, internal note, payment and reporting views.
7. Test guest free requests, registration/login, paid checkout (test mode), webhook duplicates, failed payments, ownership/authorization, refunds and mobile layouts.
8. Deploy preview; request user acceptance; only then consider production rollout.

## Migration note
`006_paid_helpdesk_records.sql` is a proposed migration only. It is not applied to any database. It assumes the existing `subscriptions`, `paid_query_orders`, and `service_requests` tables exist as defined by the repository's existing migrations; verify on a disposable Neon branch before applying.
