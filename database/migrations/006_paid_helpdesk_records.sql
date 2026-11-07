-- HelpMeDost paid helpdesk: account ownership, payment linkage and conversation history.
-- Review and test on an isolated Neon branch before applying anywhere.
-- This migration does not run automatically and does not modify production data.

CREATE TABLE IF NOT EXISTS user_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid text NOT NULL UNIQUE,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  display_name text NOT NULL,
  mobile_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_accounts_email_format CHECK (position('@' in email) > 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS user_accounts_email_lower_uq ON user_accounts (lower(email));

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS user_account_id uuid REFERENCES user_accounts(id) ON DELETE SET NULL;
ALTER TABLE paid_query_orders
  ADD COLUMN IF NOT EXISTS user_account_id uuid REFERENCES user_accounts(id) ON DELETE SET NULL;
ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS user_account_id uuid REFERENCES user_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS subscriptions_user_account_idx ON subscriptions(user_account_id);
CREATE INDEX IF NOT EXISTS paid_query_orders_user_account_idx ON paid_query_orders(user_account_id);
CREATE INDEX IF NOT EXISTS service_requests_user_account_idx ON service_requests(user_account_id);

-- Every paid query gets a durable conversation thread. Messages are append-only;
-- edits/deletes are intentionally not exposed by the customer/admin API.
CREATE TABLE IF NOT EXISTS paid_query_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paid_query_order_id uuid NOT NULL REFERENCES paid_query_orders(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('customer','admin','staff','system')),
  sender_user_account_id uuid REFERENCES user_accounts(id) ON DELETE SET NULL,
  sender_label text NOT NULL,
  message_body text NOT NULL CHECK (length(trim(message_body)) BETWEEN 1 AND 10000),
  is_internal_note boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paid_query_messages_order_created_idx
  ON paid_query_messages(paid_query_order_id, created_at);

-- Durable payment events support reconciliation and prevent losing the payment-to-query trail.
CREATE TABLE IF NOT EXISTS payment_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id uuid REFERENCES user_accounts(id) ON DELETE SET NULL,
  paid_query_order_id uuid REFERENCES paid_query_orders(id) ON DELETE SET NULL,
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN ('razorpay')),
  provider_order_id text NOT NULL UNIQUE,
  provider_payment_id text UNIQUE,
  receipt_number text NOT NULL UNIQUE,
  amount_inr integer NOT NULL CHECK (amount_inr > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  payment_status text NOT NULL DEFAULT 'created' CHECK (payment_status IN ('created','authorized','captured','failed','refunded','partially_refunded')),
  provider_signature_verified boolean NOT NULL DEFAULT false,
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((paid_query_order_id IS NOT NULL)::int + (subscription_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS payment_records_user_created_idx ON payment_records(user_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_records_query_idx ON payment_records(paid_query_order_id);

CREATE TABLE IF NOT EXISTS payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_record_id uuid NOT NULL REFERENCES payment_records(id) ON DELETE RESTRICT,
  provider_refund_id text UNIQUE,
  amount_inr integer NOT NULL CHECK (amount_inr > 0),
  refund_status text NOT NULL CHECK (refund_status IN ('requested','processed','failed')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS helpdesk_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paid_query_order_id uuid REFERENCES paid_query_orders(id) ON DELETE SET NULL,
  payment_record_id uuid REFERENCES payment_records(id) ON DELETE SET NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('customer','admin','staff','system')),
  actor_user_account_id uuid REFERENCES user_accounts(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS helpdesk_activity_query_created_idx
  ON helpdesk_activity_log(paid_query_order_id, created_at DESC);
