-- Secure customer-owned Razorpay checkout, recurring plans, and no-reply refund tracking.
-- Additive migration; apply to Preview first and inspect before production rollout.
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS razorpay_plan_id text;
CREATE UNIQUE INDEX IF NOT EXISTS subscription_plans_razorpay_plan_id_uq
  ON subscription_plans(razorpay_plan_id) WHERE razorpay_plan_id IS NOT NULL;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS user_profile_id uuid REFERENCES user_profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS razorpay_plan_id text,
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id text,
  ADD COLUMN IF NOT EXISTS authorization_payment_id text,
  ADD COLUMN IF NOT EXISTS last_payment_id text,
  ADD COLUMN IF NOT EXISTS total_count integer,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS refund_requested_at timestamptz;

ALTER TABLE paid_query_orders
  ADD COLUMN IF NOT EXISTS user_profile_id uuid REFERENCES user_profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS razorpay_customer_id text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS refund_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_payment_id text;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_razorpay_subscription_id_uq
  ON subscriptions(razorpay_subscription_id) WHERE razorpay_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS subscriptions_user_profile_created_idx
  ON subscriptions(user_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS paid_query_orders_user_profile_created_idx
  ON paid_query_orders(user_profile_id, created_at DESC);

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_refund_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_refund_status_check
  CHECK (refund_status IN ('not_requested','requested','processed','rejected'));
ALTER TABLE paid_query_orders DROP CONSTRAINT IF EXISTS paid_query_orders_refund_status_check;
ALTER TABLE paid_query_orders ADD CONSTRAINT paid_query_orders_refund_status_check
  CHECK (refund_status IN ('not_requested','requested','processed','rejected'));
