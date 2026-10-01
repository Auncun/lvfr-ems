-- Supporting tables for D1 authentication and online account presence.
CREATE TABLE IF NOT EXISTS auth_login_attempts (
  login_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS auth_login_attempts_window_idx
  ON auth_login_attempts(window_started_at);

CREATE TABLE IF NOT EXISTS account_presence (
  account_id TEXT PRIMARY KEY REFERENCES accounts(account_id),
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_presence_last_seen_idx
  ON account_presence(last_seen);
