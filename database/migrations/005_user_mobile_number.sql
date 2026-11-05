-- Add a verified user's Indian mobile number.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS mobile_number text;
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_mobile_number_unique
  ON user_profiles (mobile_number)
  WHERE mobile_number IS NOT NULL AND mobile_number <> '';
