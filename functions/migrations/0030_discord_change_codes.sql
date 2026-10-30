-- Verification code for changing the Discord ID from Account Settings.
-- The code is sent by the bot to the NEW Discord account, so only its owner can read it.
-- One row per account; the row stays after use so the hourly request count and the
-- 24-hour change limit are remembered. Only a keyed hash of the code is stored.
CREATE TABLE IF NOT EXISTS discord_change_codes (
  account_id TEXT PRIMARY KEY,
  new_discord_id TEXT NOT NULL DEFAULT '',
  code_hash TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL DEFAULT 0,
  requested_at INTEGER NOT NULL DEFAULT 0,
  last_changed_at INTEGER NOT NULL DEFAULT 0
);
