-- One row with a counter. It goes up whenever something the Academy page shows changes
-- (an Academy action, a roster or callsign-slot sync that changed rows, a confirmation,
-- a Discord link change). The page asks for this one row every few seconds instead of
-- reading several tables, so each check costs one row read.
CREATE TABLE IF NOT EXISTS academy_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  n INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO academy_version(id, n) VALUES (1, 0);
