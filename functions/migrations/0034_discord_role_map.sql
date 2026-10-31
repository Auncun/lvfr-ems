-- Discord role ID for each website rank, entered on the website (Discord section).
CREATE TABLE IF NOT EXISTS discord_role_map (
  rank TEXT PRIMARY KEY,
  role_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);
