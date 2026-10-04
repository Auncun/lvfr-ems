-- Operational logs and notifications are served from D1 instead of Sheets.
CREATE TABLE IF NOT EXISTS operational_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  log_date TEXT NOT NULL,
  callsign TEXT NOT NULL DEFAULT '',
  member_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL DEFAULT '',
  old_rank TEXT NOT NULL DEFAULT '',
  new_rank TEXT NOT NULL DEFAULT '',
  old_callsign TEXT NOT NULL DEFAULT '',
  new_callsign TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS operational_logs_kind_date_idx
  ON operational_logs(kind, log_date DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS operational_logs_source_unique
  ON operational_logs(source_key) WHERE source_key<>'';

CREATE UNIQUE INDEX IF NOT EXISTS account_audit_source_unique
  ON account_audit(source_key) WHERE source_key<>'';

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  callsign TEXT NOT NULL DEFAULT '',
  target_rank TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_created_at_idx
  ON notifications(created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS notification_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_reads (
  account_id TEXT NOT NULL,
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY(account_id, notification_id)
);
