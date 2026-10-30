-- D1 counts every index update as an extra row written, so indexes that are not needed cost real quota.
-- account_presence holds one row per account, so a full scan is cheap, while its last_seen index
-- doubled the cost of every heartbeat.
DROP INDEX IF EXISTS account_presence_last_seen_idx;
-- members(name) is already covered by members(name, rank), because name is its first column.
DROP INDEX IF EXISTS members_name_idx;
