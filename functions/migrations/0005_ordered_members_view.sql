-- Query this view in D1 to see the roster in rank and Callsign order.
-- The underlying members table remains an unordered relational table.
CREATE VIEW IF NOT EXISTS members_roster_ordered AS
SELECT * FROM members
ORDER BY CASE substr(upper(callsign), 1, instr(callsign, '-') - 1)
  WHEN 'COM' THEN 0
  WHEN 'CHIEF' THEN 1
  WHEN 'B' THEN 2
  WHEN 'DIV' THEN 3
  WHEN 'C' THEN 4
  WHEN 'E' THEN 5
  WHEN 'L' THEN 6
  WHEN 'M' THEN 7
  WHEN 'A' THEN 8
  WHEN 'R' THEN 9
  WHEN 'P' THEN 10
  WHEN 'S' THEN 11
  WHEN 'V' THEN CASE
    WHEN CAST(substr(callsign, instr(callsign, '-') + 1) AS INTEGER)
      IN (1,2,3,4,5,6,7,8,9,14,21,22,23,24,25,26,27,28,29,36,37,38,39,40)
    THEN 13 ELSE 12 END
  ELSE 999
END,
CAST(substr(callsign, instr(callsign, '-') + 1) AS INTEGER),
callsign COLLATE NOCASE;
