-- Reason shown on Academy Resigned / Terminated confirmations (Portal and Discord queue).
ALTER TABLE promotion_confirmations ADD COLUMN detail TEXT NOT NULL DEFAULT '';
