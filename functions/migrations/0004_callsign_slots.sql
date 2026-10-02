CREATE TABLE IF NOT EXISTS callsign_slots (
  rank TEXT NOT NULL,
  callsign TEXT NOT NULL,
  sheet_row INTEGER,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (rank, callsign),
  UNIQUE (callsign)
);
