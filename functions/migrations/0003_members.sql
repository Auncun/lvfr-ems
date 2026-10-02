-- Fast read cache for the operational roster.
-- Google Sheets remains the source of truth.

CREATE TABLE IF NOT EXISTS members (
  callsign TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rank TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  rank_assigned_date TEXT NOT NULL DEFAULT '',
  days_in_rank INTEGER NOT NULL DEFAULT 0,
  discord_id TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  has_basic_firefighting INTEGER NOT NULL DEFAULT 0,
  has_advanced_firefighting INTEGER NOT NULL DEFAULT 0,
  has_supervisor_exam INTEGER NOT NULL DEFAULT 0,
  has_hert INTEGER NOT NULL DEFAULT 0,
  activity TEXT NOT NULL DEFAULT 'Active',
  instructor_type TEXT NOT NULL DEFAULT '',
  do_not_promote INTEGER NOT NULL DEFAULT 0,
  sheet_row INTEGER,
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS members_name_idx
  ON members(name);

CREATE INDEX IF NOT EXISTS members_rank_idx
  ON members(rank);

CREATE INDEX IF NOT EXISTS members_activity_idx
  ON members(activity);

CREATE INDEX IF NOT EXISTS members_name_rank_idx
  ON members(name, rank);