-- Failed Google Sheet mirrors are kept here and replayed later.
-- D1 stays the source of truth; this table only remembers what the Sheet missed.
CREATE TABLE IF NOT EXISTS mirror_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL DEFAULT '',
  route TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'POST',
  query TEXT NOT NULL DEFAULT '',
  actor_account_id TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mirror_queue_due ON mirror_queue(status, next_attempt_at);
