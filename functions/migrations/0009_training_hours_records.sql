-- Convert Training Hours from one row per member to a repeatable session log.
-- After applying, rerun migrateTrainingHoursToD1 to import every Sheet2 row
-- and attach its source_row so later edits/removals mirror the correct record.
CREATE TABLE training_hours_records_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_row INTEGER UNIQUE,
  callsign TEXT NOT NULL,
  name TEXT NOT NULL,
  training_date TEXT NOT NULL,
  time TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);

INSERT INTO training_hours_records_new(source_row,callsign,name,training_date,time,updated_at,updated_by)
SELECT NULL,callsign,name,training_date,time,updated_at,updated_by FROM training_hours;

DROP TABLE training_hours;
ALTER TABLE training_hours_records_new RENAME TO training_hours;

CREATE INDEX training_hours_member_date_idx
  ON training_hours(callsign,training_date,id);
