/**
 * One-time importer for existing Training Hours rows in Sheet1 into D1.
 * Add this file to the LVFR Apps Script project, then run
 * migrateTrainingHoursToD1 from the Apps Script function picker.
 */
function migrateTrainingHoursToD1() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = String(properties.getProperty('LVFR_ROSTER_SPREADSHEET_ID') || '').trim();
  const workerUrl = String(properties.getProperty('LVFR_D1_SYNC_URL') || '').trim().replace(/\/$/, '');
  const workerSecret = String(properties.getProperty('LVFR_D1_WORKER_SECRET') || '');
  if (!spreadsheetId) throw new Error('Apps Script setting LVFR_ROSTER_SPREADSHEET_ID is missing.');
  if (!workerUrl || !workerSecret) throw new Error('Configure LVFR_D1_SYNC_URL and LVFR_D1_WORKER_SECRET in Script Properties.');

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const roster = spreadsheet.getSheetByName('Ranks🎖️');
  const hours = spreadsheet.getSheetByName('Sheet1') || spreadsheet.getSheetByName('Training Hours') || spreadsheet.getSheetByName('Sheet2');
  if (!roster) throw new Error('Roster tab Ranks🎖️ was not found.');
  if (!hours) throw new Error('Training Hours tab Sheet1 was not found.');

  const rosterCount = Math.max(0, roster.getLastRow() - 1);
  const callsignByName = new Map();
  if (rosterCount) roster.getRange(2, 2, rosterCount, 2).getDisplayValues().forEach(([rawCallsign, rawName]) => {
    const callsign = String(rawCallsign || '').trim().toUpperCase();
    const name = String(rawName || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (!name || !/^[A-Z]+-\d+$/.test(callsign)) return;
    if (callsignByName.has(name)) callsignByName.set(name, null);
    else callsignByName.set(name, callsign);
  });

  const unmatched = [];
  const count = Math.max(0, hours.getLastRow() - 1);
  const records = count ? hours.getRange(2, 2, count, 5).getDisplayValues().reduce((result, row, index) => {
    const name = String(row[0] || '').trim().replace(/\s+/g, ' ');
    const time = String(row[4] || '').trim();
    // The source tab may have a second header row below a title/blank row.
    if (!name || /^(name|member|member name|callsign|date|time|training hours?)$/i.test(name)) return result;
    if (!time) return result;
    const callsign = callsignByName.get(name.toLowerCase());
    // One name that is not on the roster must not block every other row from
    // syncing. Send it anyway so D1 keeps its place; the Worker skips it.
    if (!callsign) unmatched.push('row ' + (index + 2) + ': ' + name);
    result.push({ callsign: callsign || '', name, date: String(row[2] || '').trim(), time, source_row: index + 2 });
    return result;
  }, []) : [];

  const response = UrlFetchApp.fetch(workerUrl + '/internal/training-hours/import', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-LVFR-Worker-Secret': workerSecret },
    payload: JSON.stringify({ records, reconcile: true }),
    muteHttpExceptions: true
  });
  let result = null;
  try { result = JSON.parse(response.getContentText()); } catch (ignored) {}
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || !result || result.ok !== true) {
    throw new Error('Training Hours D1 import failed: HTTP ' + response.getResponseCode() + ' ' + response.getContentText());
  }
  const imported = Number(result.imported || 0), skipped = Number(result.skipped || 0);
  console.log('Training Hours import result: source=' + records.length + ', imported=' + imported + ', skipped=' + skipped + '.');
  if (skipped || unmatched.length) {
    console.warn('Training Hours rows not matched to one current roster member (kept in D1 as-is, not synced): ' + unmatched.join('; '));
  }
  return result;
}

// Installable Sheet edit trigger calls this after a Training Hours row changes.
// Importing the full snapshot keeps add, edit, and removal changes aligned with D1.
function syncTrainingHoursSheetToD1_() {
  return withScriptLock_(() => migrateTrainingHoursToD1(), 30000);
}

// One-time history import. It copies existing Sheets logs/notifications into D1;
// it does not modify or clear any source Sheet.
function migrateLogsAndNotificationsToD1() {
  const properties = PropertiesService.getScriptProperties();
  const privateId = String(properties.getProperty('LVFR_PRIVATE_SPREADSHEET_ID') || '').trim();
  const workerUrl = String(properties.getProperty('LVFR_D1_SYNC_URL') || '').trim().replace(/\/$/, '');
  const workerSecret = String(properties.getProperty('LVFR_D1_WORKER_SECRET') || '');
  if (!privateId) throw new Error('Apps Script setting LVFR_PRIVATE_SPREADSHEET_ID is missing.');
  if (!workerUrl || !workerSecret) throw new Error('Configure LVFR_D1_SYNC_URL and LVFR_D1_WORKER_SECRET in Script Properties.');
  const spreadsheet = SpreadsheetApp.openById(privateId);
  const cellRows = name => {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) return [];
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues();
  };
  const operational = [];
  cellRows('PWA Activity Log').forEach(row => {
    if (!row[0] || !row[1]) return;
    operational.push({ source_key: 'app:' + row[0], kind: row[1], log_date: row[2], callsign: row[3], member_name: row[4], action: row[5], details: row[6], changed_by: row[7], old_rank: row[8], new_rank: row[9], old_callsign: row[10], new_callsign: row[11] });
  });
  cellRows('Logs').forEach(row => {
    const event = String(row[1] || ''), lower = event.toLowerCase();
    const kind = lower.includes('terminat') ? 'termination'
      : lower.includes('training') || lower.includes('hert') ? 'training'
      : lower.includes('exam') ? 'exam'
      : lower.includes('note') ? 'note'
      : lower.includes('activity') ? 'activity'
      : lower.includes('instructor') ? 'instructor'
      : lower.includes('callsign') ? 'callsign'
      : lower.includes('promot') || lower.includes('demot') || lower.includes('rank') ? 'promotion' : '';
    if (!kind || !row[0]) return;
    operational.push({ source_key: 'archive:' + row[0] + ':' + row[1], kind, log_date: row[0], callsign: row[3], member_name: row[2], action: event,
      details: row[8], changed_by: row[9], old_rank: row[6], new_rank: row[7], old_callsign: row[4], new_callsign: row[5] });
  });
  const accountAudit = cellRows('Account Audit').filter(row => row[0] && row[4]).map((row, index) => ({
    source_key: 'account-audit:' + row[0] + ':' + (row[1] || index), created_at: row[0], account_id: row[1], name: row[2], callsign: row[3], action: row[4], actor_name: row[5]
  }));
  const notifications = cellRows('Notifications').filter(row => row[0] && row[1]).map(row => ({
    id: row[0], kind: row[1], event_key: row[1] === 'eligible' ? 'eligible:' + String(row[4] || '').toUpperCase() + ':' + String(row[5] || '')
      : row[1] === 'inactive' ? 'inactive:' + String(row[4] || '').toUpperCase() : '',
    title: row[2], message: row[3], callsign: row[4], target_rank: row[5], created_at: row[6]
  }));
  const eventKeyById = new Map(notifications.map(row => [String(row.id), row.event_key || 'legacy-sheet:' + String(row.id)]));
  const notificationReads = cellRows('Notification Reads').filter(row => row[0] && row[1]).map(row => ({
    account_id: row[0], notification_id: row[1], event_key: eventKeyById.get(String(row[1])) || 'legacy-sheet:' + String(row[1]), read_at: row[2]
  }));
  const notificationState = cellRows('Notification State').filter(row => row[0]).map(row => ({ key: row[0], value: row[1] }));
  const size = 200;
  const batches = Math.max(1, Math.ceil(Math.max(operational.length, accountAudit.length, notifications.length) / size));
  let totals = { operational_logs: 0, account_audit: 0, notifications: 0 };
  for (let i = 0; i < batches; i++) {
    const payload = {
      operational_logs: operational.slice(i * size, (i + 1) * size),
      account_audit: accountAudit.slice(i * size, (i + 1) * size),
      notifications: notifications.slice(i * size, (i + 1) * size),
      notification_reads: i === batches - 1 ? notificationReads : [],
      notification_state: i === 0 ? notificationState : []
    };
    const response = UrlFetchApp.fetch(workerUrl + '/internal/logs/import', {
      method: 'post', contentType: 'application/json', headers: { 'X-LVFR-Worker-Secret': workerSecret },
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    let result = null;
    try { result = JSON.parse(response.getContentText()); } catch (ignored) {}
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || !result || result.ok !== true) {
      const body = response.getContentText();
      const setupHint = response.getResponseCode() === 401 && /No session token|login cookie/i.test(body)
        ? ' Cloudflare routed this internal import to the Apps Script proxy. Set Pages variable D1_AUTH_MODE=enabled, confirm the LVFR_DB binding and internal route deployment, then retry.'
        : '';
      throw new Error('D1 log import failed on batch ' + (i + 1) + ': HTTP ' + response.getResponseCode() + ' ' + body + setupHint);
    }
    totals.operational_logs += Number(result.operational_logs || 0);
    totals.account_audit += Number(result.account_audit || 0);
    totals.notifications += Number(result.notifications || 0);
  }
  console.log('D1 history import complete: ' + JSON.stringify(totals));
  return { ok: true, ...totals, message: 'Existing logs and notifications copied to D1. The Sheets were not changed.' };
}
