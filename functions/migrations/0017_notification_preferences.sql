-- Per-account notification choices. A missing row means the notification type is enabled.
CREATE TABLE IF NOT EXISTS notification_preferences (
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(account_id, kind)
);
