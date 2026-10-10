-- Promotions waiting for confirmation in the NARCOS Portal and Discord.
CREATE TABLE IF NOT EXISTS promotion_confirmations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  callsign TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  old_rank TEXT NOT NULL DEFAULT '',
  new_rank TEXT NOT NULL DEFAULT '',
  old_callsign TEXT NOT NULL DEFAULT '',
  new_callsign TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  portal_done INTEGER NOT NULL DEFAULT 0,
  discord_done INTEGER NOT NULL DEFAULT 0,
  confirmed_at TEXT,
  confirmed_by TEXT NOT NULL DEFAULT ''
); 
