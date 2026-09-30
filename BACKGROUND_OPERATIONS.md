# Faster member views and saves

Member **View** opens immediately from the roster already loaded in the browser. It refreshes full profile details in the background and updates the open profile when they arrive.

Roster edits and account changes update the local view immediately and are sent directly to Apps Script and Google Sheets. The page does not show a background success message. If a write fails, it keeps the optimistic view, reports that it may differ from the Sheet, and asks the user to run **Sync now** to reload authoritative data. Google Sheets write latency still applies, but it does not block the interface.

## Deployment

1. Copy `apps-script/Code.gs` into the existing Apps Script project and save it. The API version should report `2026-09-30-optimistic-sync-5`.
2. Deploy a new Web App version. Manual Sync now invalidates the Apps Script roster cache before it reads the roster and is available to approved Leaders as well as Command ranks.
3. Deploy the updated files from `dist` to Cloudflare Pages.

No background trigger or `script.scriptapp` permission is required for this version. If you created a `processBackgroundJobs` trigger during setup, remove it from the Apps Script **Triggers** page.
