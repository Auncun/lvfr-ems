# Faster member views and saves

Member **View** opens immediately from the roster already loaded in the browser. It refreshes full profile details in the background and updates the open profile when they arrive.

Roster snapshots are cached in Apps Script in small pieces so rosters larger than the CacheService per-entry limit still benefit from caching. Recent activity pages scan only the tail of the log sheets needed to produce the latest 200 entries, and cache those results briefly. Commander account overviews, account audits, and instructor directories are cached briefly too; writes clear the related data. On initial page load, the health check no longer starts a second roster read before the main roster request completes.

The open EMS session also keeps successful `/api/*` reads in memory for 15 seconds. Any write or manual Sync clears this client cache. Reopening tabs and profiles during that window reuses the latest response instead of waiting for another network round trip.

Promotion, rank change, and termination update or remove the visible roster row immediately and close the old profile/manage view. The later success response refreshes server data without reopening that view. Profile refreshes are cancelled when the modal is closed or changed to another view, preventing stale responses from restoring old content.

Roster edits and account changes update the local view immediately and are sent directly to Apps Script and Google Sheets. The page does not show a background success message. If a write fails, it keeps the optimistic view, reports that it may differ from the Sheet, and asks the user to run **Sync now** to reload authoritative data. Google Sheets write latency still applies, but it does not block the interface.

## Deployment

1. Copy `apps-script/Code.gs` into the existing Apps Script project and save it. The API version should report `2026-09-30-fast-cache-6`.
2. Deploy a new Web App version. Manual Sync now invalidates the Apps Script roster cache before it reads the roster and is available to approved Leaders as well as Command ranks.
3. Deploy the updated files from `dist` to Cloudflare Pages.

No background trigger or `script.scriptapp` permission is required for this version. If you created a `processBackgroundJobs` trigger during setup, remove it from the Apps Script **Triggers** page.
