-- Add the separately controlled full roster sync capability. Commander keeps
-- the existing full-sync access; Member and Leader start without it.
UPDATE role_permissions
SET permissions_json = json_set(permissions_json, '$.full_sync_manage', json('true'))
WHERE role = 'commander';

UPDATE role_permissions
SET permissions_json = json_set(permissions_json, '$.full_sync_manage', json('false'))
WHERE role IN ('member', 'leader');
