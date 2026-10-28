# LVFR EMS Discord Sync — Cloudflare Setup

This feature runs in the existing Cloudflare Pages Functions / D1 backend. It does **not** require a separate always-on bot process, VPS, or external hosting provider.

## What it does

- Adds an **Operation Command → Discord Sync** section.
- The **Sync Discord Members** button refreshes the roster snapshot from Google Sheets, scans Discord guild members by nickname callsign, and saves verified Discord User IDs in D1.
- Initial linking does not change Discord nicknames or roles.
- After linking, website callsign/rank changes queue automatic Discord nickname/role synchronization using the saved Discord User ID.
- Failed changes are stored in D1 and can be retried from **Retry Failed Discord Updates**.
- Only Admin/Commander accounts can use the initial sync and retry endpoints.

## 1. Create and invite the Discord bot

1. Open https://discord.com/developers/applications and create an application.
2. Open **Bot** and create the bot user.
3. Copy the bot token once. Store it only as a Cloudflare secret; never commit it to GitHub or put it in frontend code.
4. Under **Bot → Privileged Gateway Intents**, enable **Server Members Intent** so the bot can enumerate guild members during the initial link scan. The implementation uses REST calls; it does not keep a Gateway connection open.
5. Invite the bot to the LVFR Discord server using OAuth2 URL Generator with the `bot` scope and these permissions:
   - Manage Nicknames
   - Manage Roles
6. In Server Settings → Roles, move the bot's role above every EMS role it needs to assign/remove. Discord does not allow bots to manage roles at or above their own highest role.
7. Copy the Discord server (guild) ID and each managed EMS role ID. Enable Developer Mode in Discord if needed, then use **Copy Server ID** / **Copy Role ID**.

## 2. Configure Cloudflare

In the Cloudflare dashboard, open **Workers & Pages → lvfr-ems → Settings → Variables and Secrets**. Add:

- `DISCORD_BOT_TOKEN` — Secret, the bot token.
- `DISCORD_GUILD_ID` — the Discord server ID (Secret or Variable).
- `DISCORD_ROLE_MAP` — JSON object mapping the exact website rank names to Discord role IDs. Use a Secret or Variable, for example:

```json
{
  "EMT": "111111111111111111",
  "AEMT": "222222222222222222",
  "Paramedic": "333333333333333333",
  "Lead Paramedic": "444444444444444444"
}
```

The IDs above are examples only. Replace them with the actual IDs from your server. Add every website rank that should have an EMS Discord role. Rank names are matched case-insensitively after trimming whitespace; role IDs must be real Discord snowflake IDs.

You may set the values using Wrangler from PowerShell (run in the project folder):

```powershell
npx wrangler pages secret put DISCORD_BOT_TOKEN --project-name lvfr-ems
npx wrangler pages secret put DISCORD_GUILD_ID --project-name lvfr-ems
npx wrangler pages secret put DISCORD_ROLE_MAP --project-name lvfr-ems
```

Wrangler prompts for each value. If your Cloudflare Pages project has a different name, replace `lvfr-ems` with the exact project name. Add the variables to both Production and Preview environments only if you intend to test the integration in Preview.

## 3. Apply the D1 migration

Back up your D1 database before applying a production migration. The migration only creates the Discord mapping and synchronization-lock tables; it does not delete roster data.

From the project root, run:

```powershell
npx wrangler d1 execute lvfr-accounts-prod --remote --file=functions/migrations/0023_discord_sync.sql
```

Replace `lvfr-accounts-prod` if the database bound to `LVFR_DB` in your Cloudflare Pages project has a different name. The migration must be applied before deploying code that uses the new endpoints.

## 4. Build and deploy

Use the project's existing Cloudflare Pages deployment workflow. The repository's documented build command is:

```powershell
python build_static.py
```

Deploy the updated project through the existing Pages Git integration or your usual Wrangler Pages deployment process. Do not change the existing Google Sheets, Apps Script, D1 authentication, or source-of-truth configuration.

## 5. Run the initial link scan

1. Sign in with an Admin or Commander account.
2. Open **Operation Command → Discord Sync**.
3. Click **Sync Discord Members** and confirm.
4. The backend first requests a Full Sync from Google Sheets, then scans the Discord server and matches exact callsigns found at the beginning of nicknames such as `[R-13] J.Smith` and `[R-13] J. Smith`.
5. Review the report. Ambiguous/duplicate callsigns, malformed nicknames, and conflicts are skipped rather than guessed.
6. Initial linking does not modify Discord nicknames or roles.

The initial scan is bounded to 10,000 members per invocation. If the guild has 10,000 or more members, the endpoint stops before writing mappings and reports the limit instead of performing a partial link.

## 6. Test automatic updates safely

1. Start with one test member whose nickname begins with their unique current callsign.
2. Run the initial link scan and verify that member appears in the linked count.
3. Confirm `DISCORD_ROLE_MAP` contains the exact current and target rank labels and the bot can manage those roles.
4. Change the test member's callsign or rank through the website.
5. Verify the nickname changes while the name portion is preserved, and only configured EMS roles are changed. Unrelated Discord roles should remain untouched.
6. If an update fails, check the mapping status/report and click **Retry Failed Discord Updates** after fixing the configuration or permissions.

## Safety notes

- Google Sheets remains the primary roster source of truth. D1 stores Discord identity mappings and retry status only.
- Do not add a Discord token to the repository, browser code, or a screenshot.
- The bot cannot manage roles above its own role in Discord's hierarchy.
- The initial linking scan only creates mappings; it does not change any Discord member.
- Discord updates happen after the roster mutation is saved. A Discord failure does not undo the roster change; it is recorded for retry.
- The current implementation processes a bounded initial scan in one request. Very large guilds may need a resumable multi-request scan before use.
