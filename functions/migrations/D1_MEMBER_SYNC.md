# Member reads and synchronization

D1 is the live roster read store. Site roster mutations commit to D1 before
returning; Cloudflare sends the matching Apps Script write as a background
task. The UI keeps its immediate optimistic display and only reads D1 again on
the user's next page refresh. D1 does not fetch roster data from Sheets during
ordinary reads or site mutations. **Sync now** replaces D1 members and empty
Callsign slots from a fresh Sheets snapshot. Manual Sheet edits post the latest
members and Callsign slots to D1 through the installed Apps Script triggers.

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
4. After updating `apps-script/Code.gs`, deploy the latest Apps Script web app,
   then run `installRosterD1SyncTriggers`
   again in the Apps Script editor and grant its requested permissions. It
   installs edit triggers for roster/private sheet value edits and a change
   trigger for formatting changes in the roster spreadsheet. The formatting
   trigger is needed because activity, training, exam, and instructor status
   are stored as cell colors; direct color changes do not fire `onEdit`. The
   installer also adds a five-minute fingerprint check as a fallback, so a
   missed formatting event is still synced without sending unchanged snapshots.
   Script Properties are private; never put the worker secret in the site
   bundle.
5. Apply `0004_callsign_slots.sql`. Before the first Commander bootstrap, run
   `initializeRosterD1Sync` once from the Apps Script editor; this seeds D1 and
   available Callsigns. Later, use the site's **Sync now** action to refresh.
6. Apply `0005_ordered_members_view.sql` to add the `members_roster_ordered`
   view. In the D1 console, query `SELECT * FROM members_roster_ordered` to see
   members grouped by Callsign rank and ordered numerically within each group
   (for example, M-02 immediately after M-01). The base `members` table itself
   has no guaranteed row order.

Website changes write D1 first and Sheet in the background; they do not trigger
a Sheet read or a D1 replacement. **Sync now** compares the current Sheet
snapshot with D1 and writes only added, changed, or removed roster rows and
Callsign slots. An unchanged snapshot is skipped by the Apps Script fingerprint.
Direct Google Sheets edits use the installed edit and format triggers to update
D1; the site displays that D1 data on manual page refresh.

## LOI lists and history

LOI entries and LOI history are served from D1. Website changes commit to D1,
then Apps Script mirrors them to `HERT Certified`, `FIREFIGHTER CERT`, and the
`PWA Activity Log` in the background. Direct edits to the LOI sections of those
Sheets sync back to D1 through the installed roster triggers. The LOI screen
loads when opened and after a change; it does not poll Apps Script or reload the
list every few seconds. LOI history reads from `operational_logs` in D1.

To enable this flow:

1. Apply `0013_loi_d1.sql` to the `LVFR_DB` database.
2. Deploy the updated Worker and Apps Script code so `/internal/loi/import`,
   Sheet mirroring, and Sheet edit triggers are active.
3. In the Apps Script editor, run `migrateLoiToD1` once to copy the existing
   HERT and FORT LOI lists into D1. Run `installRosterD1SyncTriggers` if the
   existing roster edit/change triggers are not installed; the installer
   updates them to sync manual LOI Sheet edits too.
4. If historical LOI log rows have not already been imported, run
   `migrateLogsAndNotificationsToD1` once. It imports the existing
   `PWA Activity Log` records using stable source keys, so repeating it does
   not duplicate those rows.

## Troubleshooting HTTP 405 from the edit trigger

The edit trigger posts to `/internal/members/sync`. If Apps Script reports an
empty HTTP 405 response, confirm Cloudflare deployed the Pages **Functions**
from this repository, not just the static `dist/` assets. The Pages project
root must include the `functions/` directory and its `[[path]].js` catch-all.
In Cloudflare Pages, open the latest deployment's build log and confirm
Functions were built for the `lvfr-ems` project. Redeploy from the connected
Git repository (or with Wrangler from the repository root), then retry a
manual cell edit. Do not use a static-only drag-and-drop upload for this app.
