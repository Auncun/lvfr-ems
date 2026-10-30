-- One active password reset code per account, delivered by the Discord bot.
-- Only a keyed hash of the code is stored. The code expires after 10 minutes,
-- allows 5 wrong tries, and the row also counts requests (3 per hour per account).
CREATE TABLE IF NOT EXISTS password_reset_codes (
  account_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 1,
  window_started_at INTEGER NOT NULL,
  requested_at INTEGER NOT NULL
);
