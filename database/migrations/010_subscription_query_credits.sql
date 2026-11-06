-- Track subscription allowances and customer requests submitted against a credit.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS query_credits_remaining integer NOT NULL DEFAULT 0;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_query_credits_remaining_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_query_credits_remaining_check CHECK (query_credits_remaining >= 0);
CREATE TABLE IF NOT EXISTS subscription_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code text NOT NULL UNIQUE,
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  user_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  query_type text NOT NULL CHECK (query_type IN ('personal_guidance','detailed_assistance','document_review')),
  subject text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','under_review','waiting_for_user','resolved','closed')),
  response_message text,
  first_response_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_queries_user_created_idx ON subscription_queries(user_profile_id,created_at DESC);
CREATE INDEX IF NOT EXISTS subscription_queries_subscription_idx ON subscription_queries(subscription_id,created_at DESC);
