# Background roster operations

Roster mutations are accepted into the private `PWA Background Jobs` sheet. An Apps Script time trigger processes up to five jobs per run. The portal reports that the change is queued, then reports success or failure and refreshes the member view.

## Required setup

Copy both `apps-script/Code.gs` and `apps-script/appsscript.json` into the existing Apps Script project. Save the project so it requests the `script.scriptapp` permission. Then:

1. Select `installBackgroundWorker` from the function list.
2. Click **Run** and approve the newly requested Apps Script management permission.
3. Confirm the one-minute `processBackgroundJobs` trigger appears under **Triggers**.
4. Deploy a new Web App version, then deploy the updated static files from `dist` to Cloudflare Pages.

The trigger can take about a minute to start a queued operation. The worker rechecks that the account is still approved. It does not retry jobs that stop while running, because retrying a partially completed rank change could apply it twice; such jobs are marked failed and should be checked in the roster before trying again.
