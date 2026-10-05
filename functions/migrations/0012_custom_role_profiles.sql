-- Allow Operation and Commander to define additional permission profiles.
CREATE TABLE role_permissions_new (
  role TEXT PRIMARY KEY,
  permissions_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);

INSERT INTO role_permissions_new(role, permissions_json, updated_at, updated_by)
SELECT role, permissions_json, updated_at, updated_by FROM role_permissions;

DROP TABLE role_permissions;
ALTER TABLE role_permissions_new RENAME TO role_permissions;
