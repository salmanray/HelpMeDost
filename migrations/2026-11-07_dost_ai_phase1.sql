-- Dost AI Phase 1 schema. Review and apply to a non-production Neon branch first.
-- This file is intentionally not executed by the implementation task.
BEGIN;

INSERT INTO service_categories (slug, name, display_order) VALUES
  ('student-help', 'Student Help', 1),
  ('parent-guidance', 'Parent Guidance', 2),
  ('cyber-assistance', 'Cyber Assistance', 3),
  ('legal-assistance', 'Legal Assistance', 4),
  ('women-child-support', 'Women & Child Support', 5),
  ('counselling', 'Counselling', 6),
  ('special-education', 'Special Education', 7),
  ('government-services', 'Government Services', 8),
  ('career-jobs', 'Career & Jobs', 9),
  ('professional-network', 'Professional Network', 10)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES service_categories(id),
  session_type text NOT NULL DEFAULT 'free_preview' CHECK (session_type IN ('free_preview')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','waiting_for_user','waiting_for_staff','escalated','resolved','closed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '120 seconds'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_sessions_one_free_preview_per_user
  ON chat_sessions(user_id) WHERE session_type='free_preview';
CREATE INDEX IF NOT EXISTS chat_sessions_user_updated_idx ON chat_sessions(user_id, updated_at DESC);

ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS chat_session_id uuid REFERENCES chat_sessions(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS service_requests_chat_session_key ON service_requests(chat_session_id) WHERE chat_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_usage (
  user_id uuid PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  free_session_id uuid NOT NULL UNIQUE REFERENCES chat_sessions(id) ON DELETE CASCADE,
  preview_started_at timestamptz NOT NULL,
  preview_expires_at timestamptz NOT NULL,
  message_window_started_at timestamptz NOT NULL DEFAULT now(),
  messages_in_window integer NOT NULL DEFAULT 0 CHECK (messages_in_window >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  client_message_id uuid,
  sender_type text NOT NULL CHECK (sender_type IN ('user','assistant','staff','system')),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, client_message_id)
);
CREATE INDEX IF NOT EXISTS chat_messages_session_created_idx ON chat_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS chat_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  staff_user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES user_profiles(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz
);
CREATE INDEX IF NOT EXISTS chat_assignments_request_idx ON chat_assignments(service_request_id, assigned_at DESC);

CREATE TABLE IF NOT EXISTS chat_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES service_categories(id) ON DELETE CASCADE,
  model text NOT NULL,
  system_prompt text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id)
);

COMMIT;
