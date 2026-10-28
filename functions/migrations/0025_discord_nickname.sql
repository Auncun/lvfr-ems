-- Last known Discord server nickname for each link, shown in Linked members.
-- Filled when a member is linked or edited, when a nickname is saved, and after a successful roster update.
-- Run once; re-running fails because the column already exists.
ALTER TABLE discord_member_links ADD COLUMN discord_nickname TEXT NOT NULL DEFAULT '';
