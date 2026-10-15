-- Change history for role permission profiles. before_json and after_json hold {permissions, scopes}.
CREATE TABLE IF NOT EXISTS role_permission_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  changed_by TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS role_permission_history_id_idx ON role_permission_history(id DESC);