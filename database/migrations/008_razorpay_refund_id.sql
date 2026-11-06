-- Store Razorpay's refund object ID separately from the original payment ID.
ALTER TABLE paid_query_orders ADD COLUMN IF NOT EXISTS razorpay_refund_id text;
CREATE UNIQUE INDEX IF NOT EXISTS paid_query_orders_razorpay_refund_id_uq
  ON paid_query_orders(razorpay_refund_id) WHERE razorpay_refund_id IS NOT NULL;
