-- Role-level access profiles for Members and Leaders.
-- Commanders retain full access and are not limited by these profiles.
CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT PRIMARY KEY CHECK (role IN ('member', 'leader')),
  permissions_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO role_permissions(role, permissions_json, updated_at, updated_by) VALUES
('member', '{"portal_access":false,"watch_command_view":true,"watch_command_edit":true,"watch_command_roster":true,"members_view":false,"eligible_view":false,"profile_view":false,"inactive_view":false,"logs_view":false,"training_view":false,"training_fort_manage":false,"training_hert_manage":false,"training_hours_view":false,"training_hours_manage":false,"statistics_view":false,"notes_manage":false,"promotion_manage":false,"callsign_manage":false,"activity_manage":false,"exam_manage":false,"rank_date_manage":false,"rank_manage":false,"termination_manage":false,"do_not_promote_view":false,"do_not_promote_manage":false,"instructor_manage":false,"sync_view":false,"sync_manage":false}', datetime('now'), 'System default'),
('leader', '{"portal_access":true,"watch_command_view":true,"watch_command_edit":true,"watch_command_roster":true,"members_view":true,"eligible_view":true,"profile_view":true,"inactive_view":false,"logs_view":true,"training_view":true,"training_fort_manage":true,"training_hert_manage":true,"training_hours_view":true,"training_hours_manage":true,"statistics_view":true,"notes_manage":true,"promotion_manage":true,"callsign_manage":true,"activity_manage":false,"exam_manage":false,"rank_date_manage":false,"rank_manage":false,"termination_manage":false,"do_not_promote_view":false,"do_not_promote_manage":false,"instructor_manage":false,"sync_view":true,"sync_manage":true}', datetime('now'), 'System default');
