-- Operation remains the internal `admin` role for compatibility. Commander
-- keeps its existing elevated operational capabilities, while its default
-- permission profile is now explicit and editable only by Operation.
ALTER TABLE accounts ADD COLUMN permissions_override_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE role_permissions_new (
  role TEXT PRIMARY KEY CHECK (role IN ('member', 'leader', 'commander')),
  permissions_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);

INSERT INTO role_permissions_new(role, permissions_json, updated_at, updated_by)
SELECT role, permissions_json, updated_at, updated_by FROM role_permissions
WHERE role IN ('member', 'leader');

INSERT INTO role_permissions_new(role, permissions_json, updated_at, updated_by)
VALUES ('commander', '{"portal_access":true,"watch_command_view":true,"watch_command_edit":true,"watch_command_roster":true,"members_view":true,"eligible_view":true,"profile_view":true,"inactive_view":true,"logs_view":true,"training_view":true,"training_fort_manage":true,"training_hert_manage":true,"training_hours_view":true,"training_hours_manage":true,"statistics_view":true,"notes_manage":true,"promotion_manage":true,"callsign_manage":true,"activity_manage":true,"exam_manage":true,"rank_date_manage":true,"rank_manage":true,"termination_manage":true,"do_not_promote_view":true,"do_not_promote_manage":true,"instructor_manage":true,"sync_view":true,"sync_manage":true}', datetime('now'), 'System default');

DROP TABLE role_permissions;
ALTER TABLE role_permissions_new RENAME TO role_permissions;
