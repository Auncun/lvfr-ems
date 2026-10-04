/**
 * One-time importer for existing Training Hours rows in Sheet2 into D1.
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
  const hours = spreadsheet.getSheetByName('Sheet2') || spreadsheet.getSheetByName('Training Hours');
  if (!roster) throw new Error('Roster tab Ranks🎖️ was not found.');
  if (!hours) throw new Error('Training Hours tab Sheet2 was not found.');

  const rosterCount = Math.max(0, roster.getLastRow() - 1);
  const callsignByName = new Map();
  if (rosterCount) roster.getRange(2, 2, rosterCount, 2).getDisplayValues().forEach(([rawCallsign, rawName]) => {
    const callsign = String(rawCallsign || '').trim().toUpperCase();
    const name = String(rawName || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (!name || !/^[A-Z]+-\d+$/.test(callsign)) return;
    if (callsignByName.has(name)) callsignByName.set(name, null);
    else callsignByName.set(name, callsign);
  });

  const count = Math.max(0, hours.getLastRow() - 1);
  const records = count ? hours.getRange(2, 2, count, 5).getDisplayValues().reduce((result, row, index) => {
    const name = String(row[0] || '').trim().replace(/\s+/g, ' ');
    const time = String(row[4] || '').trim();
    // Sheet2 may have a second header row below a title/blank row.
    if (!name || /^(name|member|member name|callsign|date|time|training hours?)$/i.test(name)) return result;
    if (!time) return result;
    const callsign = callsignByName.get(name.toLowerCase());
    if (!callsign) throw new Error('Training Hours row ' + (index + 2) + ' has a missing or ambiguous roster name: ' + name);
    result.push({ callsign, date: String(row[2] || '').trim(), time });
    return result;
  }, []) : [];

  const response = UrlFetchApp.fetch(workerUrl + '/internal/training-hours/import', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-LVFR-Worker-Secret': workerSecret },
    payload: JSON.stringify({ records }),
    muteHttpExceptions: true
  });
  let result = null;
  try { result = JSON.parse(response.getContentText()); } catch (ignored) {}
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || !result || result.ok !== true) {
    throw new Error('Training Hours D1 import failed: HTTP ' + response.getResponseCode() + ' ' + response.getContentText());
  }
  console.log('Training Hours imported to D1: ' + Number(result.imported || 0) + ' row(s).');
  return result;
}
