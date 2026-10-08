ALTER TABLE role_permissions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 100;

UPDATE role_permissions SET sort_order = CASE role
  WHEN 'commander' THEN 2
  WHEN 'leader' THEN 3
  WHEN 'member' THEN 4
  ELSE 100
END;

UPDATE role_permissions SET sort_order = 1 WHERE role = 'admin';
