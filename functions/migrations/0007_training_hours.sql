-- Training Hours is operational data owned by D1, alongside the roster.
CREATE TABLE IF NOT EXISTS training_hours (
  callsign TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  training_date TEXT NOT NULL,
  time TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS training_hours_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date TEXT NOT NULL,
  callsign TEXT NOT NULL,
  member_name TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_time TEXT NOT NULL DEFAULT '',
  new_time TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS training_hours_log_date_idx
  ON training_hours_log(log_date DESC, id DESC);
