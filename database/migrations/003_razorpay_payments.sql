-- Depends on 002_revenue_model.sql.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS razorpay_order_id text, ADD COLUMN IF NOT EXISTS razorpay_payment_id text;
ALTER TABLE paid_query_orders ADD COLUMN IF NOT EXISTS razorpay_order_id text, ADD COLUMN IF NOT EXISTS razorpay_payment_id text;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_razorpay_order_id_uq ON subscriptions (razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS paid_query_orders_razorpay_order_id_uq ON paid_query_orders (razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS razorpay_webhook_events (event_id text PRIMARY KEY, event_type text NOT NULL, processed_at timestamptz NOT NULL DEFAULT now());
