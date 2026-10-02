# Member reads and synchronization

Google Sheets remains the authoritative roster. With `D1_AUTH_MODE=enabled`,
member reads (`/api/members`, `/api/member/{callsign}`, eligibility, inactive,
instructor, and Do not Promote lists) use the D1 `members` cache. The first
read seeds an empty cache from Sheets. Successful site roster writes are still
applied by Apps Script to Sheets first; Cloudflare starts the D1 refresh in the
background, so the site can report the Sheets save without waiting for a full
roster read and D1 rewrite. D1 may lag briefly while that refresh runs. If the
background refresh fails, Cloudflare logs the error and an operator can use
**Sync now** to refresh the cache. A forced refresh calls Apps Script
`/api/sync`, which invalidates its roster cache before reading the current
Sheet values and status colors; ordinary D1 cache seeding can still use the
cached read endpoint.

## Setup

1. Apply `0003_members.sql` to the Cloudflare D1 database bound as `LVFR_DB`.
2. Confirm the Pages Worker has `D1_AUTH_MODE=enabled`,
   `LVFR_D1_WORKER_SECRET`, `LVFR_D1_AUTH_BRIDGE_SECRET`, and `GAS_WEB_APP_URL`
   configured. `LVFR_D1_WORKER_SECRET` must match the Apps Script property of
   the same name. Deploy the latest Pages Functions code, including the
   `/internal/` route in `functions/[[path]].js` and the `/internal/*` entries
   in `static/_routes.json`; direct Sheet edits send their snapshots to
   `/internal/members/sync` using POST.
3. In Apps Script Script Properties, set `LVFR_D1_SYNC_URL` to the deployed
   Cloudflare site origin, `https://lvfr-ems.pages.dev` (no `/internal` path),
   and set `LVFR_D1_WORKER_SECRET` to the same secret used by the Worker.
4. After updating `apps-script/Code.gs`, run `installRosterD1SyncTriggers`
   again in the Apps Script editor and grant its requested permissions. It
   installs edit triggers for roster/private sheet value edits and a change
   trigger for formatting changes in the roster spreadsheet. The formatting
   trigger is needed because activity, training, exam, and instructor status
   are stored as cell colors; direct color changes do not fire `onEdit`.
   Script Properties are private; never put the worker secret in the site
   bundle.
5. Use the site's **Sync now** action once after deployment to initialize or
   refresh D1.

Changes made by the website do not rely on edit triggers: after Apps Script
confirms the Sheets write, the Worker uses Pages `waitUntil()` to refresh D1 in
the background. **Sync now** remains synchronous and waits until the roster is
refreshed. Direct edits in Google Sheets use the Apps Script edit/change
triggers and `/internal/members/sync` endpoint.

## Troubleshooting HTTP 405 from the edit trigger

The edit trigger posts to `/internal/members/sync`. If Apps Script reports an
empty HTTP 405 response, confirm Cloudflare deployed the Pages **Functions**
from this repository, not just the static `dist/` assets. The Pages project
root must include the `functions/` directory and its `[[path]].js` catch-all.
In Cloudflare Pages, open the latest deployment's build log and confirm
Functions were built for the `lvfr-ems` project. Redeploy from the connected
Git repository (or with Wrangler from the repository root), then retry a
manual cell edit. Do not use a static-only drag-and-drop upload for this app.
