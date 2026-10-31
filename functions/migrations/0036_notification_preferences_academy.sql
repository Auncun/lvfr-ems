-- One column per notification type: the Exit Exam Overdue type and the four Academy log types.
ALTER TABLE notification_preferences_wide ADD COLUMN exit_exam_overdue INTEGER CHECK (exit_exam_overdue IN (0,1));
ALTER TABLE notification_preferences_wide ADD COLUMN academy_recruited INTEGER CHECK (academy_recruited IN (0,1));
ALTER TABLE notification_preferences_wide ADD COLUMN academy_graduated INTEGER CHECK (academy_graduated IN (0,1));
ALTER TABLE notification_preferences_wide ADD COLUMN academy_resigned INTEGER CHECK (academy_resigned IN (0,1));
ALTER TABLE notification_preferences_wide ADD COLUMN academy_switched INTEGER CHECK (academy_switched IN (0,1));
