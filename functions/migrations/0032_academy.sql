-- LVFR Academy: recruits in training and their progress. The roster itself stays in
-- members; this table only holds what the academy tracks (trainings, patrol, exam).
CREATE TABLE IF NOT EXISTS academy_recruits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  callsign TEXT NOT NULL,
  name TEXT NOT NULL,
  discord_user_id TEXT NOT NULL DEFAULT '',
  recruit_type TEXT NOT NULL CHECK (recruit_type IN ('Probationary','Probationary Volunteer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','graduated')),
  recruited_at TEXT NOT NULL,
  recruited_by TEXT NOT NULL DEFAULT '',
  bm_at TEXT NOT NULL DEFAULT '', bm_by TEXT NOT NULL DEFAULT '',
  ec_at TEXT NOT NULL DEFAULT '', ec_by TEXT NOT NULL DEFAULT '',
  bv_at TEXT NOT NULL DEFAULT '', bv_by TEXT NOT NULL DEFAULT '',
  patrol_at TEXT NOT NULL DEFAULT '', patrol_by TEXT NOT NULL DEFAULT '',
  exam_result TEXT NOT NULL DEFAULT '' CHECK (exam_result IN ('','passed','failed')),
  exam_at TEXT NOT NULL DEFAULT '', exam_by TEXT NOT NULL DEFAULT '',
  graduated_to TEXT NOT NULL DEFAULT '', graduated_callsign TEXT NOT NULL DEFAULT '',
  graduated_at TEXT NOT NULL DEFAULT '', graduated_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS academy_recruits_status_idx ON academy_recruits(status);

CREATE TABLE IF NOT EXISTS academy_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  callsign TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
