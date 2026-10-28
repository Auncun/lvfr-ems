-- Discord identity mapping and retry state for LVFR EMS.
-- This table stores integration metadata only; Google Sheets remains the roster source of truth.
CREATE TABLE IF NOT EXISTS discord_member_links (
  callsign TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL UNIQUE,
  member_name TEXT NOT NULL DEFAULT '',
  rank TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'linked' CHECK (status IN ('linked','pending','failed','left')),
  pending_callsign TEXT NOT NULL DEFAULT '',
  pending_rank TEXT NOT NULL DEFAULT '',
  pending_update_roles INTEGER NOT NULL DEFAULT 0 CHECK (pending_update_roles IN (0,1)),
  last_error TEXT NOT NULL DEFAULT '',
  last_synced_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS discord_member_links_pending_callsign_idx
  ON discord_member_links(pending_callsign) WHERE pending_callsign <> '';
CREATE INDEX IF NOT EXISTS discord_member_links_status_idx
  ON discord_member_links(status, updated_at);

CREATE TABLE IF NOT EXISTS discord_sync_lock (
  lock_id INTEGER PRIMARY KEY CHECK (lock_id = 1),
  locked_until INTEGER NOT NULL DEFAULT 0,
  locked_by TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO discord_sync_lock(lock_id,locked_until,locked_by) VALUES(1,0,'');
