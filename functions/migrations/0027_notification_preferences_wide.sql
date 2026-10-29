-- Notification preferences as one row per account, one column per kind.
-- NULL means "not set", so the default for that kind applies. The old notification_preferences table
-- is copied from and then left untouched; it is no longer written to and can be dropped later.
CREATE TABLE IF NOT EXISTS notification_preferences_wide (
  account_id TEXT PRIMARY KEY,
  termination INTEGER CHECK (termination IN (0,1)),
  inactive INTEGER CHECK (inactive IN (0,1)),
  overdue INTEGER CHECK (overdue IN (0,1)),
  promotion INTEGER CHECK (promotion IN (0,1)),
  eligible INTEGER CHECK (eligible IN (0,1)),
  callsign INTEGER CHECK (callsign IN (0,1)),
  training INTEGER CHECK (training IN (0,1)),
  training_time INTEGER CHECK (training_time IN (0,1)),
  loi INTEGER CHECK (loi IN (0,1)),
  exam INTEGER CHECK (exam IN (0,1)),
  note INTEGER CHECK (note IN (0,1)),
  activity INTEGER CHECK (activity IN (0,1)),
  instructor INTEGER CHECK (instructor IN (0,1)),
  do_not_promote INTEGER CHECK (do_not_promote IN (0,1)),
  do_not_terminate INTEGER CHECK (do_not_terminate IN (0,1)),
  request INTEGER CHECK (request IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO notification_preferences_wide(account_id) SELECT DISTINCT account_id FROM notification_preferences;
UPDATE notification_preferences_wide SET
  termination=(SELECT p.enabled FROM notification_preferences p WHERE p.account_id=notification_preferences_wide.account_id AND p.kind='termination'),
  inactive=(SELECT p.enabled FROM notification_preferences p WHERE p.account_id=notification_preferences_wide.account_id AND p.kind='inactive'),
  overdue=(SELECT p.enabled FROM notification_preferences p WHERE p.account_id=notification_preferences_wide.account_id AND p.kind='overdue'),
  promotion=(SELECT p.enabled FROM notification_preferences p WHERE p.account_id=notification_preferences_wide.account_id AND p.kind='promotion'),
  eligible=(SELECT p.enabled FROM notification_preferences p WHERE p.account_id=notification_preferences_wide.account_id AND p.kind='eligible'),
  callsign=(SELECT p.enabled FROM notification_preferences p WHERE p.account_id=notification_preferences_wide.account_id AND p.kind='callsign'),
  training=(SELECT p.enabled FROM notification_preferences p WHERE p.account_id=notification_preferences_wide.account_id AND p.kind='training'),
  training_time=(SELECT p.enabled FROM notification_preferences p WHERE p.account_id=notification_preferences_wide.account_id AND p.kind='training_time'),
  loi=(SELECT p.enabled FROM notification_preferences p WHERE p.account_id=notification_preferences_wide.account_id AND p.kind='loi'),
  exam=(SELECT p.enabled FROM notification_preferences p WHERE p.account_id=notification_preferences_wide.account_id AND p.kind='exam'),
  note=(SELECT p.enabled FROM notification_preferences p WHERE p.account_id=notification_preferences_wide.account_id AND p.kind='note'),
  activity=(SELECT p.enabled FROM notification_preferences p WHERE p.account_id=notification_preferences_wide.account_id AND p.kind='activity'),
  instructor=(SELECT p.enabled FROM notification_preferences p WHERE p.account_id=notification_preferences_wide.account_id AND p.kind='instructor'),
  do_not_promote=(SELECT p.enabled FROM notification_preferences p WHERE p.account_id=notification_preferences_wide.account_id AND p.kind='do_not_promote'),
  do_not_terminate=(SELECT p.enabled FROM notification_preferences p WHERE p.account_id=notification_preferences_wide.account_id AND p.kind='do_not_terminate'),
  request=(SELECT p.enabled FROM notification_preferences p WHERE p.account_id=notification_preferences_wide.account_id AND p.kind='request');
