-- Do Not Terminate list. Stored as a flag on members, like do_not_promote.
-- Apply once to the LVFR_DB D1 database before deploying the matching Pages code.
ALTER TABLE members ADD COLUMN do_not_terminate INTEGER NOT NULL DEFAULT 0;