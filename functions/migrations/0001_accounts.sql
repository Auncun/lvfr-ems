-- LVFR account store for Cloudflare D1.
-- This migration only creates empty tables. It does not import, change, or
-- delete any records in the Google Sheets Accounts tab.

CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  callsign TEXT NOT NULL DEFAULT '',
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_hash_version TEXT NOT NULL DEFAULT 'gas-v3',
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'deactivated', 'denied', 'removed')),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'leader', 'admin', 'commander')),
  created_at TEXT NOT NULL,
  activated_at TEXT NOT NULL DEFAULT '',
  approved_by TEXT NOT NULL DEFAULT '',
  admin_changed_at TEXT NOT NULL DEFAULT '',
  admin_changed_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_name_key_unique
  ON accounts(name_key) WHERE status NOT IN ('removed', 'denied');
CREATE INDEX IF NOT EXISTS accounts_callsign_idx ON accounts(callsign);
CREATE INDEX IF NOT EXISTS accounts_status_role_idx ON accounts(status, role);

CREATE TABLE IF NOT EXISTS account_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  callsign TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  source_key TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS account_audit_created_at_idx
  ON account_audit(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS account_audit_account_id_idx
  ON account_audit(account_id, id DESC);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  remember_me INTEGER NOT NULL DEFAULT 0 CHECK (remember_me IN (0, 1))
);
CREATE INDEX IF NOT EXISTS auth_sessions_account_id_idx ON auth_sessions(account_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS account_migration_state (
  migration_key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
