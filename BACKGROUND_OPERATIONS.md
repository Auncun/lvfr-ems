# Background operations and data flow
test
## Source of truth

Cloudflare D1 is the application's runtime data store. The website reads from and commits its operational changes to D1 first. Google Sheets remains an integration surface: it provides roster and legacy data for deliberate sync operations, receives mirrors of selected website changes, and can send supported spreadsheet edits back to D1.

Do not assume that every Sheet is the live source for the website, or that a successful website write means its Sheet mirror has already completed. The sync behavior depends on the data set and operation.

## Website writes

For ordinary member and account operations, the Cloudflare handler validates permissions and writes the change and applicable audit/log rows to D1. It then schedules the Apps Script mirror with Cloudflare `waitUntil`, so the response does not wait for Google Sheets. If this mirror fails, the D1 write remains committed; the failure is logged by the Worker. There is no durable background retry queue in this path.

Some paths report Sheet mirror status directly:

- Training Hours changes are committed to D1 first, then mirrored to the roster spreadsheet. The response includes `sheet_synced` and `sheet_sync_error`; a mirror failure does not undo the D1 change. Its activity log is also mirrored to Sheets.
- HERT/FORT LOI changes are committed to D1 and the response returns immediately. The Sheet list mirror and the LOI activity-log mirror run in the background via `waitUntil`. A Sheet failure is logged by the Worker and is not reported in the response. Marking an LOI **passed** also records the matching training in D1 in the same request (HERT LOI -> HERT certification; FORT LOI -> the Basic and/or Advanced Firefighting the coordinator selects, and trainings already held are left unchanged). Apps Script then certifies the member on the roster sheet through the `/internal/loi` mirror.
- Instructor changes update the D1 member record and return immediately. The Apps Script mirror runs in the background with up to three attempts; a failure is logged, and D1 remains the saved state. Check the Worker logs and D1 before retrying.
- HERT training changes (`/api/training` with `Hert`) commit to D1 and return immediately. The roster mirror runs in the background with retries, as with instructor changes. FORT training uses the same path.
- Notification reads and read receipts are stored in D1, with Sheet mirrors in the background. Notification cleanup mirrors the cleanup to Sheets first and then deletes the D1 rows.
- Log cleanup checks the Sheet cleanup before deleting the selected D1 log rows.

The browser may update a view optimistically while a request is pending. D1 is still authoritative after the request completes; a stale or failed Sheet mirror should not be treated as saved data based only on the browser's prior state.

## Spreadsheet edits flowing to D1

`installRosterD1SyncTriggers()` installs the Apps Script edit triggers for the roster and private spreadsheet plus a roster formatting-change trigger. Install or reinstall these triggers when setting up the Apps Script project.

- Supported roster data edits and formatting changes send a roster snapshot to D1.
- Training Hours edits in the roster spreadsheet are imported into D1 by the edit trigger.
- HERT/FORT LOI list edits are imported into D1 by the edit trigger.
- Row insertions and removals in the roster spreadsheet refresh the Training Hours and LOI imports.

These are installable spreadsheet triggers, not a timed polling job. Verify they exist in the Apps Script **Triggers** page if spreadsheet edits stop reaching D1.

## Sync actions

**Sync now** asks Apps Script to read the current Sheet roster and compare its fingerprint with the previous snapshot. If it changed, Apps Script sends the roster and callsign-slot snapshot to D1; unchanged snapshots are skipped. This operation is specifically a Sheet-to-D1 roster sync. It does not restore operational logs or reset the whole database.

**Full Sync** forces the roster and callsign-slot snapshot into D1, then imports operational logs from the `PWA Activity Log` and legacy `Logs` Sheets. The log import replaces D1's `operational_logs` before loading the Sheet records. It does not replace accounts, notifications, Training Hours records, or every D1 table. Training Hours has its own import/mirror flow.

Full Sync consists of separate roster and log operations. If log restoration fails, the roster may already have been synchronized; the error message indicates that partial outcome. Since Sheets are used as the source for this log restoration, a log deleted only from D1 can return on Full Sync if it is still present in either Sheet log.

## Caches and user experience

Apps Script caches roster snapshots in chunks, and briefly caches log results, account overviews, and instructor directories. Relevant Apps Script writes invalidate their caches. The website also refreshes open roster views periodically. These caches are performance aids; they are not the source of truth and should not be used to diagnose whether a D1 write committed.

## Deployment and configuration

When changing the Apps Script API, deploy a new Apps Script Web App version. When changing Cloudflare handlers, deploy the updated Pages/Functions application as well. Confirm that `GAS_WEB_APP_URL` points to the active `/exec` URL, the Web App executes as its owner and allows the worker to reach it, and the D1 database binding is configured.

Apps Script needs `LVFR_D1_SYNC_URL` and `LVFR_D1_WORKER_SECRET` in Script Properties. The Cloudflare environment must have the matching worker secret and the D1 auth bridge configuration used by the Apps Script bridge. Do not use a `/dev` or `script.googleusercontent.com` URL for `GAS_WEB_APP_URL`.

After deployment or trigger setup, check Worker logs for mirror errors and Apps Script **Executions** for failed syncs. Ordinary background mirrors do not automatically retry, so resolve the failure and use the appropriate sync or source-specific repair path.


## Training Hours sheet layout

Training Hours data in Sheet1 starts on row 5 (`TRAINING_HOURS_FIRST_ROW` in `Code.gs`). Rows 1-4 are not read or written by the website, the Sheet-to-D1 import, or add operations.