-- LOI candidates are served from D1 and mirrored to the roster spreadsheet.
CREATE TABLE IF NOT EXISTS loi_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('HERT', 'FORT')),
  callsign TEXT NOT NULL,
  name TEXT NOT NULL,
  test_percent REAL,
  source_row INTEGER,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  UNIQUE(type, callsign)
);

CREATE INDEX IF NOT EXISTS loi_entries_type_name_idx
  ON loi_entries(type, name COLLATE NOCASE);
