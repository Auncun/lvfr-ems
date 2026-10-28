-- Audit log for Discord actions taken by admins: termination (kick / remove roles / none),
-- manual Discord ID edits, and delinking. Written by the Worker; read by Operation Command.
CREATE TABLE IF NOT EXISTS discord_action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  callsign TEXT NOT NULL DEFAULT '',
  member_name TEXT NOT NULL DEFAULT '',
  discord_user_id TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS discord_action_log_created_idx ON discord_action_log(created_at);
