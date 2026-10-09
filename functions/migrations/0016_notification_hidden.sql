-- Per-account "clear my notifications": hides a notification for one account only.
CREATE TABLE IF NOT EXISTS notification_hidden (
  account_id TEXT NOT NULL,
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  hidden_at TEXT NOT NULL,
  PRIMARY KEY(account_id, notification_id)
);
