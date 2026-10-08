-- Allow intentional physical account deletion from D1 while preserving audit history.
-- Sessions and presence are disposable account-owned records; account_audit has
-- no foreign key so historical actions remain available after deletion.

CREATE TABLE auth_sessions_new (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  remember_me INTEGER NOT NULL DEFAULT 0 CHECK (remember_me IN (0, 1))
);

INSERT INTO auth_sessions_new(token_hash, account_id, expires_at, created_at, remember_me)
SELECT token_hash, account_id, expires_at, created_at, remember_me FROM auth_sessions;

DROP TABLE auth_sessions;
ALTER TABLE auth_sessions_new RENAME TO auth_sessions;
CREATE INDEX auth_sessions_account_id_idx ON auth_sessions(account_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions(expires_at);

CREATE TABLE account_presence_new (
  account_id TEXT PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
  last_seen INTEGER NOT NULL
);

INSERT INTO account_presence_new(account_id, last_seen)
SELECT account_id, last_seen FROM account_presence;

DROP TABLE account_presence;
ALTER TABLE account_presence_new RENAME TO account_presence;
CREATE INDEX account_presence_last_seen_idx ON account_presence(last_seen);
