-- One row per account for notification read and hide state.
-- "Read" and "clear" now mark everything up to a notification id, so one write covers any number of notifications.
-- Older per-notification rows in notification_reads and notification_hidden are still honoured, so no data is rewritten.
CREATE TABLE IF NOT EXISTS account_notification_marks (
  account_id TEXT PRIMARY KEY,
  read_through_id INTEGER NOT NULL DEFAULT 0,
  hidden_through_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
