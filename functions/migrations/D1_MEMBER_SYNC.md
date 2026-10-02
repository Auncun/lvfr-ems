# Member reads and synchronization

Google Sheets remains the authoritative roster. With `D1_AUTH_MODE=enabled`,
member reads (`/api/members`, `/api/member/{callsign}`, eligibility, inactive,
instructor, and Do not Promote lists) use the D1 `members` cache. The first
read seeds an empty cache from Sheets. Successful site roster writes are still
applied by Apps Script to Sheets first; Cloudflare then refreshes D1. A failed
refresh is reported so an operator can use **Sync now** after connectivity is
restored.

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
4. In the Apps Script editor, run `installRosterD1SyncTriggers` once and grant
   its requested spreadsheet and external-request permissions. It installs
   edit triggers for the roster and private spreadsheets. Direct edits to the
   roster, HERT/FORT certification sheets, and Do not Promote sheet then send
   a fresh roster snapshot to D1. Script Properties are private; never put the
   worker secret in the site bundle.
5. Use the site's **Sync now** action once after deployment to initialize or
   refresh D1.

Changes made by the website do not rely on edit triggers: the Worker refreshes
D1 after Apps Script confirms the Sheets write. If that refresh fails, the
response explains that Sheets was updated but the D1 cache needs **Sync now**.

## Troubleshooting HTTP 405 from the edit trigger

The edit trigger posts to `/internal/members/sync`. If Apps Script reports an
empty HTTP 405 response, confirm Cloudflare deployed the Pages **Functions**
from this repository, not just the static `dist/` assets. The Pages project
root must include the `functions/` directory and its `[[path]].js` catch-all.
In Cloudflare Pages, open the latest deployment's build log and confirm
Functions were built for the `lvfr-ems` project. Redeploy from the connected
Git repository (or with Wrangler from the repository root), then retry a
manual cell edit. Do not use a static-only drag-and-drop upload for this app.
