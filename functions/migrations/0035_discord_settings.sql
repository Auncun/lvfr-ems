-- Discord settings entered on the website (currently the server ID).
CREATE TABLE IF NOT EXISTS discord_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);
