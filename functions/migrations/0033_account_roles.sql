-- Several roles per account (Discord-style). The Accounts Sheet is the source of truth:
-- its Role column is the main role and its Roles column lists every role, comma separated.
CREATE TABLE IF NOT EXISTS account_roles (
  account_id TEXT NOT NULL,
  role TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT '',
  assigned_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (account_id, role),
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

-- Every existing account keeps its current role, so nothing changes until a Roles column is filled in.
INSERT OR IGNORE INTO account_roles(account_id, role, assigned_at, assigned_by)
  SELECT account_id, LOWER(role), COALESCE(NULLIF(admin_changed_at, ''), created_at), 'Migration'
  FROM accounts WHERE status <> 'removed' AND role <> '';
