-- Rank limits per role (promote, demote, terminate). An empty object means no limits.
ALTER TABLE role_permissions ADD COLUMN scopes_json TEXT NOT NULL DEFAULT '{}';
