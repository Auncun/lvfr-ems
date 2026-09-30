# Faster member views and saves

Member **View** opens immediately from the roster already loaded in the browser. It refreshes full profile details in the background and updates the open profile when they arrive.

Roster edits are sent directly to Apps Script and Google Sheets. The page does not wait for the write before returning control; it reports success or failure when the direct request finishes. This avoids the time-trigger queue and its up-to-one-minute delay. Google Sheets write latency still applies, but it no longer blocks the interface.

## Deployment

1. Copy `apps-script/Code.gs` into the existing Apps Script project and save it.
2. Deploy a new Web App version.
3. Deploy the updated files from `dist` to Cloudflare Pages.

No background trigger or `script.scriptapp` permission is required for this version. If you created a `processBackgroundJobs` trigger during setup, remove it from the Apps Script **Triggers** page.
