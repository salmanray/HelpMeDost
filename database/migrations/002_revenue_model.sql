-- HelpMeDost revenue model: subscriptions and paid query orders.
-- Apply after reviewing the matching Neon migration.
CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  price_inr integer NOT NULL CHECK (price_inr >= 0),
  billing_period text NOT NULL CHECK (billing_period IN ('month','quarter','year')),
  query_credits integer NOT NULL CHECK (query_credits >= 0),
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code text NOT NULL UNIQUE,
  plan_id uuid NOT NULL REFERENCES subscription_plans(id),
  customer_name text NOT NULL,
  customer_email text,
  customer_phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','active','expired','cancelled','payment_failed')),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','refunded')),
  payment_provider text,
  payment_reference text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS paid_query_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code text NOT NULL UNIQUE,
  customer_name text NOT NULL,
  customer_email text,
  customer_phone text NOT NULL,
  query_type text NOT NULL CHECK (query_type IN ('personal_guidance','detailed_assistance','document_review')),
  subject text NOT NULL,
  description text NOT NULL,
  amount_inr integer NOT NULL CHECK (amount_inr > 0),
  status text NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN ('awaiting_payment','submitted','under_review','resolved','cancelled','refunded')),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','refunded')),
  payment_provider text,
  payment_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_customer_phone_idx ON subscriptions (customer_phone);
CREATE INDEX IF NOT EXISTS paid_query_orders_customer_phone_idx ON paid_query_orders (customer_phone);
INSERT INTO subscription_plans (code,name,price_inr,billing_period,query_credits,display_order)
VALUES ('monthly','Monthly',99,'month',5,1),('quarterly','Quarterly',249,'quarter',15,2),('annual','Annual',799,'year',60,3)
ON CONFLICT (code) DO NOTHING;
