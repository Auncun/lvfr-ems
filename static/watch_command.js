const form = document.querySelector('#watchForm');
const history = document.querySelector('#watchHistory');
const watchTimeZonePicker = document.querySelector('#watchTimeZone');
const message = document.querySelector('#watchMessage');
const saveButton = document.querySelector('#saveWatch');
const quickButton = document.querySelector('#quickSignIn');
const quickMessage = document.querySelector('#quickMessage');
const callsignInput = document.querySelector('#activityCallsign');
const memberLookup = document.querySelector('#memberLookup');
const initialCallsignInput = document.querySelector('#initialCallsign');
const initialUnitInput = document.querySelector('#initialUnit');
const initialMemberLookup = document.querySelector('#initialMemberLookup');
const initialRollcallMessage = document.querySelector('#initialRollcallMessage');
const initialIsTraining = document.querySelector('#initialIsTraining');
const initialAttachedUnit = document.querySelector('#initialAttachedUnit');
const activityTraining = document.querySelector('#activityTraining');
const activityAttachedUnit = document.querySelector('#activityAttachedUnit');
const rollCallLabel = document.querySelector('#rollCallLabel');
const initialUnitOptions = document.querySelector('#initialUnitOptions');
const targetUnitWrap = document.querySelector('#targetUnitWrap');
const targetUnitSelect = document.querySelector('#activityTargetUnit');
const onDutyPicker = document.querySelector('#onDutyCallsign');
const onDutyCallsignList = document.querySelector('#onDutyCallsignList');
const formUnitPanel = document.querySelector('#formUnitPanel');
const formUnitCount = document.querySelector('#formUnitCount');
const formUnitMembers = document.querySelector('#formUnitMembers');
const formUnitSubmit = document.querySelector('#submitFormUnit');
const formUnitMessage = document.querySelector('#formUnitMessage');
const activeUnitSummary = document.querySelector('#activeUnitSummary');
const activeEmsSummary = document.querySelector('#activeEmsSummary');
const activeEmsWrap = document.querySelector('#activeEmsWrap');
const activeMergeButton = document.querySelector('#toggleActiveMerge');
const callLocationInput = document.querySelector('#callLocation');
const savedCallLocations = document.querySelector('#savedCallLocations');
const WATCH_LOCATION_HISTORY_KEY = 'lvfr.watch.call-locations.v1';
function readSavedCallLocations() {
  try {
    const values = JSON.parse(localStorage.getItem(WATCH_LOCATION_HISTORY_KEY) || '[]');
    return Array.isArray(values) ? values.map(value => String(value || '').trim()).filter(Boolean) : [];
  } catch (_) { return []; }
}
function renderSavedCallLocations(show = false) {
  if (!savedCallLocations) return;
  const query = String(callLocationInput?.value || '').trim().toLocaleLowerCase();
  const locations = readSavedCallLocations()
    .filter(value => !query || value.toLocaleLowerCase().includes(query))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  savedCallLocations.replaceChildren(...locations.map(value => {
    const row = document.createElement('div');
    row.className = 'watch-place-option';
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'watch-place-choose';
    choose.textContent = value;
    choose.addEventListener('mousedown', event => event.preventDefault());
    choose.addEventListener('click', () => {
      callLocationInput.value = value;
      savedCallLocations.hidden = true;
      callLocationInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'watch-place-remove';
    remove.textContent = '×';
    remove.title = `Remove ${value} from saved places`;
    remove.setAttribute('aria-label', `Remove ${value} from saved places`);
    remove.addEventListener('mousedown', event => event.preventDefault());
    remove.addEventListener('click', () => {
      const remaining = readSavedCallLocations().filter(item => item.toLocaleLowerCase() !== value.toLocaleLowerCase());
      try { localStorage.setItem(WATCH_LOCATION_HISTORY_KEY, JSON.stringify(remaining)); } catch (_) {}
      renderSavedCallLocations(true);
    });
    row.append(choose, remove);
    return row;
  }));
  savedCallLocations.hidden = !show || locations.length === 0;
}
function rememberCallLocation(value) {
  const location = String(value || '').trim().replace(/\s+/g, ' ');
  if (!location) return;
  const locations = readSavedCallLocations().filter(item => item.toLocaleLowerCase() !== location.toLocaleLowerCase());
  locations.unshift(location);
  try { localStorage.setItem(WATCH_LOCATION_HISTORY_KEY, JSON.stringify(locations.slice(0, 50))); } catch (_) {}
  renderSavedCallLocations();
}
function installWatchSectionToggles() {
  const sections = [
    ['roll-call', 'Roll Call', form.querySelector('textarea[name="roll_call"]')?.closest('label')],
    ['active-status', 'Current Active Status', form.querySelector('.active-presence')],
    ['initial-roll-call', 'Initial Roll Call', form.querySelector('.initial-rollcall')],
    ['unit-sign-in', 'Unit Sign In', form.querySelector('.quick-signin:not(.initial-rollcall)')],
    ['sector-coverage', 'Sector Coverage', form.querySelector('[aria-labelledby="sectorHeading"] .watch-fields')],
    ['notes', 'Notes', form.querySelector('#watchNotes')?.closest('label')],
    ['dnr', 'DNR', form.querySelector('#dnrFields')],
    ['significant-call', 'Significant Call / Add Call', form.querySelector('#significantCallText')?.closest('.watch-field')],
    ['coverage-gaps', 'Coverage Gaps', form.querySelector('textarea[name="coverage_gaps"]')?.closest('label')],
    ['watch-transition', 'Watch Command Transition', form.querySelector('#watchTransitionText')?.closest('.watch-field')],
    ['safety-concerns', 'Safety Concerns', form.querySelector('textarea[name="safety_concerns"]')?.closest('label')]
  ];
  sections.forEach(([key, label, target]) => {
    if (!target) return;
    const storageKey = `lvfr.watch.section-hidden.${key}`;
    let collapsed = false;
    try { collapsed = localStorage.getItem(storageKey) === 'true'; } catch (_) {}
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'watch-section-toggle';
    button.setAttribute('aria-controls', target.id || (target.id = `watch-section-${key}`));
    const update = () => {
      target.hidden = collapsed;
      button.setAttribute('aria-expanded', String(!collapsed));
      button.textContent = `${collapsed ? '＋ Show' : '− Hide'} ${label}`;
    };
    button.addEventListener('click', () => {
      collapsed = !collapsed;
      try { localStorage.setItem(storageKey, String(collapsed)); } catch (_) {}
      update();
    });
    target.before(button);
    update();
  });
}
installWatchSectionToggles();
renderSavedCallLocations();
callLocationInput?.addEventListener('focus', () => renderSavedCallLocations(true));
callLocationInput?.addEventListener('input', () => renderSavedCallLocations(true));
callLocationInput?.addEventListener('blur', () => setTimeout(() => { savedCallLocations.hidden = true; }, 120));
const memberNameCache = new Map();
const memberLookupPromises = new Map();
let watchCommandSaveQueue = Promise.resolve();
const WATCH_MEMBER_DIRECTORY_KEY = 'lvfr.watch.member.directory.v1';
function cacheWatchMemberDirectory(members) {
  memberNameCache.clear();
  for (const member of members || []) {
    const callsign = String(member.callsign || '').trim().toUpperCase();
    const name = String(member.name || '').trim();
    if (callsign && name) memberNameCache.set(callsign, { name, rank: String(member.rank || '').trim() });
  }
  try { sessionStorage.setItem(WATCH_MEMBER_DIRECTORY_KEY, JSON.stringify([...memberNameCache].map(([callsign, member]) => ({ callsign, ...member })))); } catch {}
  if (typeof refreshActivePresence === 'function') refreshActivePresence();
}
try {
  const savedDirectory = JSON.parse(sessionStorage.getItem(WATCH_MEMBER_DIRECTORY_KEY) || 'null');
  const savedRoster = JSON.parse(sessionStorage.getItem('lvfr.roster.snapshot.v1') || 'null');
  const initialDirectory = Array.isArray(savedDirectory) ? savedDirectory : savedRoster;
  if (Array.isArray(initialDirectory)) {
    for (const member of initialDirectory) {
      const callsign = String(member.callsign || '').trim().toUpperCase();
      const name = String(member.name || '').trim();
      if (callsign && name) memberNameCache.set(callsign, { name, rank: String(member.rank || '').trim() });
    }
  }
} catch {}
let suppressBackgroundSaveSuccess = false;
let memberLookupTimer;
let initialMemberLookupTimer;
let loggedInCommander = null;
let activeWatchCommanderCallsign = '';
const sectorFields = {
  Red: 'red_sector',
  Green: 'green_sector',
  Blue: 'blue_sector',
  Specialised: 'specialised_units',
};
const callsignPrefixes = ['COM', 'CHIEF', 'DIV', 'B', 'C', 'E', 'L', 'M', 'A', 'R', 'P', 'S', 'V'];
const logSections = [
  ['Sector Coverage', [
    ['Red Sector', 'red_sector'], ['Green Sector', 'green_sector'],
    ['Blue Sector', 'blue_sector'], ['Specialised units', 'specialised_units'],
    ['Notes', 'notes'],
  ]],
  ['Operational Notes', [
    ['Significant call', 'significant_call'], ['Coverage gaps', 'coverage_gaps'],
    ['Watch Command transition', 'watch_transition'], ['Any safety concerns', 'safety_concerns'],
  ]],
];

function isValidTimeZone(timeZone) {
  try { new Intl.DateTimeFormat('en', { timeZone }).format(); return true; }
  catch (_) { return false; }
}
function selectedTimeZone() {
  return watchTimeZonePicker?.value || 'Africa/Lagos';
}
function timeZoneLabel(timeZone = selectedTimeZone()) {
  return timeZone;
}
function localDateInputValue(timeZone = selectedTimeZone()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function currentWatchTime(timeZone = selectedTimeZone()) {
  return formatWatchTime(new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date()));
}
function formatWatchTime(value) {
  return String(value || '').replace(/^0(?=\d:)/, '');
}
const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let savedTimeZone = '';
try { savedTimeZone = localStorage.getItem('lvfr-watch-time-zone') || ''; } catch (_) {}
const initialTimeZone = isValidTimeZone(savedTimeZone) ? savedTimeZone
  : isValidTimeZone(detectedTimeZone) ? detectedTimeZone : 'Africa/Lagos';
let preferredTimeZone = initialTimeZone;
if (![...watchTimeZonePicker.options].some(option => option.value === initialTimeZone)) {
  const option = document.createElement('option');
  option.value = initialTimeZone;
  option.textContent = `${initialTimeZone} (device time)`;
  watchTimeZonePicker.append(option);
}
watchTimeZonePicker.value = initialTimeZone;
refreshStartTimeLabel();
watchTimeZonePicker.addEventListener('change', () => {
  preferredTimeZone = selectedTimeZone();
  try { localStorage.setItem('lvfr-watch-time-zone', preferredTimeZone); } catch (_) {}
  refreshStartTimeLabel();
  refreshRollCallSummary();
  persistFormDraft();
});
function refreshStartTimeLabel() {
  const label = document.querySelector('#watchStartTimeLabel');
  if (label) label.firstChild.textContent = `Start time (${timeZoneLabel()})`;
}
function newDraftId() {
  const id = crypto.randomUUID();
  sessionStorage.setItem('watch-command-draft-id', id);
  form.elements.draft_id.value = id;
  return id;
}
function persistFormDraft() {
  const values = Object.fromEntries(new FormData(form));
  for (const checkbox of [initialIsTraining]) {
    values[checkbox.name] = checkbox.checked;
  }
  sessionStorage.setItem('watch-command-form-draft', JSON.stringify({
    values,
    draftId: ensureDraftId(),
  }));
}
function ensureDraftId() {
  let id = sessionStorage.getItem('watch-command-draft-id');
  if (!id) id = newDraftId();
  form.elements.draft_id.value = id;
  return id;
}
function setMessage(target, text, kind = '') {
  if (/^Saving\b/i.test(String(text || ''))) return;
  if (kind === 'success' && suppressBackgroundSaveSuccess) {
    suppressBackgroundSaveSuccess = false;
    return;
  }
  target.textContent = text;
  target.className = kind;
}
async function request(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (method === 'POST' && new URL(url, location.href).pathname === '/api/watch-command') {
    const pending = watchCommandSaveQueue.then(async () => {
      const response = await fetch(url, {
        ...options,
        keepalive: true,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        location.assign('/login');
        throw new Error('Your session expired. Sign in again.');
      }
      if (!response.ok) throw new Error(data.detail || 'Save failed.');
      void loadHistory();
    }).catch(error => {
      setMessage(message, `Save failed: ${error.message}. The local watch view may differ from the Sheet. Reload Watch Command to load the saved data.`, 'error');
    });
    watchCommandSaveQueue = pending.then(() => undefined, () => undefined);
    suppressBackgroundSaveSuccess = true;
    setTimeout(() => { suppressBackgroundSaveSuccess = false; }, 0);
    void pending;
    return { background_pending: true };
  }
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (response.status === 401) {
    location.assign('/login');
    throw new Error('Your session expired. Sign in again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    const error = new Error(typeof detail === 'string' ? detail : detail?.message || 'Request failed.');
    error.status = response.status;
    throw error;
  }
  return data;
}
function currentRecord(finalized) {
  return {
    ...Object.fromEntries(new FormData(form)),
    draft_id: ensureDraftId(),
    finalized,
    time_zone: selectedTimeZone(),
  };
}
function addLogField(parent, label, value) {
  const section = document.createElement('section');
  const heading = document.createElement('h4');
  heading.textContent = `• ${label}`;
  const content = document.createElement('p');
  content.textContent = String(value ?? '').trim() || 'N/A';
  if (content.textContent === 'N/A') content.classList.add('watch-na');
  section.append(heading, content);
  parent.append(section);
}
function rollCallCount(value = form.elements.roll_call.value) {
  const callsigns = new Set();
  for (const line of String(value || '').split('\n')) {
    const callsign = line.trim().match(/^([A-Z]+-\d+)\b/i)?.[1];
    if (callsign) callsigns.add(callsign.toUpperCase());
  }
  return callsigns.size;
}
function refreshRollCallSummary() {
  const startTime = form.elements.start_time.value;
  if (rollCallLabel) {
    rollCallLabel.textContent = `Roll Call (${rollCallCount()})${startTime ? ` · ${formatWatchTime(startTime)} ${timeZoneLabel()}` : ''}`;
  }
}
function normalizeAttachedUnit(value) {
  const unit = String(value || '').trim().replace(/\s+/g, ' ');
  if (!unit || unit.length > 24 || /[|()\r\n]/.test(unit)) return '';
  return unit;
}
function addAttachedUnit(unit, rawAttachment) {
  if (!rawAttachment) return unit;
  const attachment = normalizeAttachedUnit(rawAttachment);
  return attachment ? `${unit}(${attachment})` : '';
}
function discordTimestamp(date, time, style, timeZone = selectedTimeZone()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || !/^\d{2}:\d{2}$/.test(String(time || ''))) return '';
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let epoch = target;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(epoch))
      .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    const observed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const difference = target - observed;
    epoch += difference;
    if (difference === 0) break;
  }
  return `<t:${Math.floor(epoch / 1000)}:${style}>`;
}
function formatCoverageForDiscord(value, timeZone = selectedTimeZone()) {
  const copiedAt = currentWatchTime(timeZone);
  return String(value || '').split('\n').map(line => {
    const assignment = parseAssignmentLine(line);
    if (!assignment) return line;
    const members = assignment.members.map(member => {
      const start = formatWatchTime(member.startTime || assignment.startTime);
      const end = formatWatchTime(member.active ? copiedAt : (member.endTime || assignment.endTime || assignment.startTime));
      return `${member.callsign} ${start}-${end}`;
    });
    const unitClosed = assignment.closedWithX && !assignment.active;
    return `${assignment.unit} | ${members.join(' | ')} |${unitClosed ? ' X' : ''}`;
  }).join('\n').trim();
}
function formatCoverageForView(value) {
  // Keep X as the durable signal that this particular unit stint is empty,
  // even when its final member left at the watch end time.
  return String(value || '');
}
function formatDiscordWatchLog(log) {
  const timeZone = isValidTimeZone(log.time_zone) ? log.time_zone : selectedTimeZone();
  const value = key => String(log[key] || "").trim() || "N/A";
  const addField = (lines, label, key, inline = false) => {
    const fieldValue = ['red_sector', 'green_sector', 'blue_sector', 'specialised_units'].includes(key)
      ? (formatCoverageForDiscord(log[key], timeZone) || 'N/A')
      : value(key);
    const cleanLabel = label.trim();
    const bullet = cleanLabel.startsWith("•") ? `**•**${cleanLabel.slice(1)}` : cleanLabel;
    if (fieldValue === "N/A") lines.push(`-# ${bullet} N/A`);
    else if (inline) lines.push(`${bullet} ${fieldValue}`);
    else lines.push(bullet, fieldValue, "");
  };
  const dateStamp = discordTimestamp(log.watch_date, '12:00', 'D', timeZone);
  const startStamp = discordTimestamp(log.watch_date, log.start_time, 't', timeZone) || 'N/A';
  const copiedAt = currentWatchTime(timeZone);
  const copyDate = localDateInputValue(timeZone);
  const endStamp = discordTimestamp(copyDate, copiedAt.padStart(5, '0'), 't', timeZone) || 'N/A';
  const dateLine = dateStamp ? `**•**Watch Date: ${dateStamp}` : '-# **•**Watch Date: N/A';
  const lines = ["**Watch Command**", dateLine];
  if (dateStamp) lines.push('');
  const timeValue = `${startStamp}-${endStamp}`;
  const watchTimeLine = timeValue.includes('N/A')
    ? `-# **•**Start and end time: ${timeValue}`
    : `**•**Start and end time: ${timeValue}`;
  lines.push(watchTimeLine);
  if (!timeValue.includes('N/A')) lines.push('');
  addField(lines, "•Watch Commander: ", "watch_commander", true);
  if (String(log.watch_commander || "").trim()) lines.push("");
  addField(lines, "•Roll Call :", "roll_call");
  lines.push("**Sector Coverage**");
  addField(lines, "•Red Sector :", "red_sector");
  addField(lines, "•Green Sector:", "green_sector");
  addField(lines, "•Blue Sector :", "blue_sector");
  addField(lines, "•Specialised units :", "specialised_units");
  addField(lines, "•Notes:", "notes");
  lines.push("**Operational Notes**");
  addField(lines, "•Significant call:", "significant_call");
  addField(lines, "•Coverage gaps:", "coverage_gaps");
  addField(lines, "•Watch Command transition: ", "watch_transition");
  addField(lines, "•Any safety concerns:", "safety_concerns");
  return lines.join("\n").trimEnd().replace(/\b(\d{1,2}):([0-5]\d)\b/g, (match, hour, minute) =>
    discordTimestamp(log.watch_date, `${hour.padStart(2, '0')}:${minute}`, 't', timeZone) || match
  );
}
async function copyWatchLog(log, button) {
  const text = formatDiscordWatchLog(log);
  try {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(text); }
      catch { copyWithFallback(text); }
    } else {
      copyWithFallback(text);
    }
    const previousText = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = previousText; }, 1800);
  } catch {
    button.textContent = "Copy failed";
    setTimeout(() => { button.textContent = "Copy for Discord"; }, 1800);
  }
}
document.querySelector('#copyCurrentWatch')?.addEventListener('click', event => {
  if (!form.reportValidity()) return;
  copyWatchLog(currentRecord(false), event.currentTarget);
});
function copyWithFallback(text) {
      const fallback = document.createElement("textarea");
      fallback.value = text;
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.append(fallback);
      fallback.select();
      const copied = document.execCommand("copy");
      fallback.remove();
      if (!copied) throw new Error("Clipboard access is unavailable.");
}
function renderLog(log) {
  const article = document.createElement('article');
  article.className = 'watch-log';
  const titleRow = document.createElement('div');
  titleRow.className = 'watch-log-title-row';
  const heading = document.createElement('h3');
  heading.textContent = `Watch Command • ${log.watch_date} • ${log.watch_commander}`;
  if (!log.finalized) {
    const draft = document.createElement('span');
    draft.className = 'watch-log-draft';
    draft.textContent = 'In progress · auto-saved';
    heading.append(draft);
  }
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'watch-copy-button';
  copyButton.textContent = 'Copy for Discord';
  copyButton.addEventListener('click', () => copyWatchLog(log, copyButton));
  const continueButton = document.createElement('button');
  continueButton.type = 'button';
  continueButton.className = 'watch-copy-button';
  continueButton.textContent = 'Edit / Continue';
  continueButton.addEventListener('click', () => continueWatchLog(log));
  const actions = document.createElement('div');
  actions.className = 'watch-log-actions';
  actions.append(continueButton, copyButton);
  titleRow.append(heading, actions);
  const meta = document.createElement('div');
  meta.className = 'watch-log-meta';
  const recordTimeZone = isValidTimeZone(log.time_zone) ? log.time_zone : selectedTimeZone();
  meta.append(document.createTextNode(`Start and end time (${timeZoneLabel(recordTimeZone)}): `));
  for (const [time, separator] of [[formatWatchTime(log.start_time) || 'N/A', '–'], [formatWatchTime(log.end_time) || 'N/A', '']]) {
    const timePart = document.createElement('span');
    timePart.textContent = time;
    if (time === 'N/A') timePart.className = 'watch-na';
    meta.append(timePart);
    if (separator) meta.append(document.createTextNode(separator));
  }
  if (log.created_by) meta.append(document.createTextNode(` · Recorded by ${log.created_by}`));
  const opening = document.createElement('div');
  opening.className = 'watch-log-grid';
  const rollCallDisplay = `(${rollCallCount(log.roll_call)}) ${formatWatchTime(log.start_time) || 'N/A'} ${timeZoneLabel(recordTimeZone)}\n${String(log.roll_call || '').trim() || 'N/A'}`;
  addLogField(opening, 'Roll Call', rollCallDisplay);
  const linkedAccounts = Array.isArray(log.linked_accounts) ? log.linked_accounts : [];
  if (linkedAccounts.length) {
    const linkedAccountDisplay = linkedAccounts.map(account =>
      `${account.callsign}: ${account.account_name} (${account.role})`
    ).join('\n');
    addLogField(opening, 'Linked accounts', linkedAccountDisplay);
  }
  const activeUnit = String(log.active_unit || '').trim();
  const activeEms = String(log.active_ems || '').trim();
  if (log.active_merged) addLogField(opening, 'ACTIVE UNIT', mergedActiveUnitDisplay(activeUnit, activeEms));
  else {
    addLogField(opening, 'ACTIVE UNIT', activeUnit);
    addLogField(opening, 'ACTIVE EMS', activeEms);
  }
  article.append(titleRow, meta, opening);
  for (const [sectionTitle, fields] of logSections) {
    const sectionHeading = document.createElement('h3');
    sectionHeading.textContent = sectionTitle;
    const grid = document.createElement('div');
    grid.className = 'watch-log-grid';
    for (const [label, key] of fields) {
      const value = ['red_sector', 'green_sector', 'blue_sector', 'specialised_units'].includes(key)
        ? formatCoverageForView(log[key])
        : log[key];
      addLogField(grid, label, value);
    }
    article.append(sectionHeading, grid);
  }
  return article;
}
async function continueWatchLog(log) {
  const record = { ...log, finalized: false, end_time: '' };
  try {
    await request('/api/watch-command', { method: 'POST', body: JSON.stringify(record) });
  } catch (error) {
    setMessage(message, `Could not reopen this watch log: ${error.message}`, 'error');
    return;
  }
  form.reset();
  for (const [key, value] of Object.entries(record)) {
    const field = form.elements.namedItem(key);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else if ('value' in field) field.value = value == null ? '' : String(value);
  }
  watchTimeZonePicker.value = isValidTimeZone(record.time_zone) ? record.time_zone : preferredTimeZone;
  form.elements.end_time.value = '';
  sessionStorage.setItem('watch-command-draft-id', String(record.draft_id || ''));
  ensureDraftId();
  refreshStartTimeLabel();
  applyLoggedInCommander();
  refreshRollCallSummary();
  renderUnitRosters();
  refreshOnDutyCallsignChoices();
  refreshInitialUnitOptions();
  updateAvailableChoices();
  persistFormDraft();
  setMessage(message, 'Watch log reopened. Continue editing, then select End Watch & Save when finished.', 'success');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function loadHistory() {
  history.replaceChildren();
  try {
    const logs = await request('/api/watch-command');
    if (!logs.length) {
      const empty = document.createElement('p');
      empty.className = 'watch-empty';
      empty.textContent = 'No Watch Command logs have been saved yet.';
      history.append(empty);
      return;
    }
    for (const log of logs) history.append(renderLog(log));
  } catch (error) {
    const problem = document.createElement('p');
    problem.className = 'watch-empty';
    problem.textContent = `Could not load Watch Command logs: ${error.message}`;
    history.append(problem);
  }
}
function appendText(fieldName, line) {
  const field = form.elements[fieldName];
  const current = field.value.trimEnd();
  field.value = current ? `${current}\n${line}` : line;
}
function parseAssignmentLine(line) {
  const columns = String(line || '').split('|').map(part => part.trim());
  if (columns.length < 2 || !columns[0]) return null;
  const unit = columns[0];
  let aggregateStart = '';
  let aggregateEnd = '';
  let legacyRowClosed = false;
  const memberParts = [];
  for (const column of columns.slice(1)) {
    if (/^X$/i.test(column)) {
      legacyRowClosed = true;
      continue;
    }
    const aggregate = column.match(/^(\d{1,2}:\d{2})(?:[–-]ONGOING|[–-](\d{1,2}:\d{2})(\s+X)?)$/i);
    if (aggregate) {
      aggregateStart = aggregate[1];
      aggregateEnd = aggregate[2] || '';
      legacyRowClosed ||= Boolean(aggregate[3]);
      continue;
    }
    if (column) memberParts.push(...column.split(','));
  }
  const members = memberParts.flatMap(part => {
    const callsign = part.match(/[A-Z]+-\d+/i)?.[0]?.toUpperCase();
    if (!callsign) return [];
    const times = part.match(/(\d{1,2}:\d{2})\s*[–-]\s*(ONGOING|\d{1,2}:\d{2})/i);
    const legacyLeft = /\(10-42\)/i.test(part);
    const closedWithX = /\sX\s*$/i.test(part);
    return [{
      callsign,
      active: !legacyRowClosed && !closedWithX && !legacyLeft && (!times || /^ONGOING$/i.test(times[2])),
      startTime: times?.[1] || (legacyLeft && !legacyRowClosed ? '' : aggregateStart),
      endTime: times && !/^ONGOING$/i.test(times[2]) ? times[2] : (legacyLeft ? aggregateEnd : ''),
      closedWithX,
      watchCommander: /\(WC\)/i.test(part),
    }];
  });
  if (legacyRowClosed && members.length && !members.some(member => member.closedWithX)) {
    members[members.length - 1].closedWithX = true;
  }
  return {
    unit, startTime: aggregateStart || members.find(member => member.startTime)?.startTime || '',
    endTime: aggregateEnd || [...members].reverse().find(member => member.endTime)?.endTime || '',
    members, active: members.some(member => member.active),
    closedWithX: legacyRowClosed || members.some(member => member.closedWithX),
  };
}
function formatAssignment(record) {
  const members = [...record.members.values()];
  const unitClosed = record.closedWithX && !members.some(member => member.active);
  const memberColumns = members.map((member, index) => {
    const commander = member.watchCommander ? '(WC)' : '';
    const timeRange = member.startTime
      ? ` ${formatWatchTime(member.startTime)}–${member.active ? 'ONGOING' : formatWatchTime(member.endTime || record.endTime || record.startTime)}`
      : (member.active ? '' : ' (10-42)');
    return `${member.callsign}${commander}${timeRange}`;
  });
  return `${record.unit} | ${memberColumns.join(' | ')} |${unitClosed ? ' X' : ''}`;
}
function addCallsignToUnit(fieldName, unit, callsign, startTime, watchCommander = isRollCallWatchCommander(callsign)) {
  const field = form.elements[fieldName];
  const lines = field.value.split('\n');
  const matches = [];
  const members = new Map();
  let unitStartTime = '';
  let unitEndTime = '';
  for (let index = 0; index < lines.length; index += 1) {
    const assignment = parseAssignmentLine(lines[index]);
    // Keep completed stints as separate history lines. Reuse only a live
    // instance of this unit; an X marks an empty instance that has ended.
    if (!assignment || assignment.unit.toLowerCase() !== unit.toLowerCase() || !assignment.active) continue;
    matches.push(index);
    for (const member of assignment.members) members.set(member.callsign, member);
    if (!unitStartTime) unitStartTime = assignment.startTime;
    if (assignment.endTime) unitEndTime = assignment.endTime;
  }
  if (!matches.length) {
    const newMembers = new Map([[callsign.toUpperCase(), { callsign: callsign.toUpperCase(), active: true, startTime: formatWatchTime(startTime), watchCommander }]]);
    appendText(fieldName, formatAssignment({ unit, startTime, endTime: '', members: newMembers }));
    return;
  }
  const existingMember = members.get(callsign.toUpperCase());
  members.set(callsign.toUpperCase(), {
    ...existingMember,
    callsign: callsign.toUpperCase(), active: true, startTime: formatWatchTime(startTime), endTime: '',
    watchCommander: Boolean(watchCommander || existingMember?.watchCommander),
  });
  const firstIndex = matches[0];
  const matchingIndices = new Set(matches);
  const updated = [];
  lines.forEach((line, index) => {
    if (index === firstIndex) updated.push(formatAssignment({ unit, startTime: unitStartTime, endTime: unitEndTime, members }));
    else if (!matchingIndices.has(index)) updated.push(line);
  });
  field.value = updated.join('\n');
}
function compactUnitLines(fieldName) {
  const field = form.elements[fieldName];
  const lines = field.value.split('\n');
  const activeGroups = new Map();
  lines.forEach((line, index) => {
    const assignment = parseAssignmentLine(line);
    if (!assignment?.active) return;
    const key = assignment.unit.toLowerCase();
    if (!activeGroups.has(key)) activeGroups.set(key, {
      firstIndex: index,
      record: { unit: assignment.unit, startTime: assignment.startTime, endTime: assignment.endTime, members: new Map(), closedWithX: false },
      indices: [],
    });
    const group = activeGroups.get(key);
    group.indices.push(index);
    if (assignment.endTime) group.record.endTime = assignment.endTime;
    assignment.members.forEach(member => group.record.members.set(member.callsign, member));
  });
  const replacements = new Map();
  const removed = new Set();
  activeGroups.forEach(group => {
    replacements.set(group.firstIndex, formatAssignment(group.record));
    group.indices.slice(1).forEach(index => removed.add(index));
  });
  field.value = lines.map((line, index) => {
    if (removed.has(index)) return null;
    if (replacements.has(index)) return replacements.get(index);
    return line;
  }).filter(line => line !== null).join('\n');
}
function isRollCallWatchCommander(callsign) {
  const target = String(callsign || '').toUpperCase();
  const line = form.elements.roll_call.value.split('\n')
    .find(item => item.trim().toUpperCase().startsWith(`${target} `)) || '';
  return /\sWC(?:\/|\s|$)/i.test(line);
}
function closeOpenAssignments(callsign, endTime) {
  let closedUnit = '';
  const targetCallsign = String(callsign || '').toUpperCase();
  for (const fieldName of Object.values(sectorFields)) {
    const field = form.elements[fieldName];
    field.value = field.value.split('\n').map(line => {
      const assignment = parseAssignmentLine(line);
      if (!assignment || !assignment.members.some(member => member.callsign === targetCallsign && member.active)) return line;
      closedUnit = assignment.unit;
      const members = new Map(assignment.members.map(member => [
        member.callsign,
        member.callsign === targetCallsign ? { ...member, active: false, endTime, closedWithX: false } : member,
      ]));
      return formatAssignment({
        ...assignment,
        endTime,
        members,
        closedWithX: ![...members.values()].some(member => member.active),
      });
    }).join('\n');
  }
  for (const fieldName of Object.values(sectorFields)) compactUnitLines(fieldName);
  return closedUnit;
}
function closeAllOpenAssignments(endTime) {
  for (const fieldName of Object.values(sectorFields)) {
    const field = form.elements[fieldName];
    field.value = field.value.split('\n').map(line => {
      const assignment = parseAssignmentLine(line);
      if (!assignment) return line;
      const hasActiveMembers = assignment.members.some(member => member.active);
      if (!hasActiveMembers) return line;
      const members = new Map(assignment.members.map(member => [
        member.callsign,
        member.active ? { ...member, active: false, endTime, closedWithX: false } : member,
      ]));
      return formatAssignment({
        ...assignment,
        endTime: hasActiveMembers ? endTime : assignment.endTime,
        members,
        closedWithX: true,
      });
    }).join('\n');
    compactUnitLines(fieldName);
  }
}
function activeUnitFor(callsign, sector) {
  const fieldName = sectorFields[sector];
  if (!fieldName) return '';
  for (const line of form.elements[fieldName].value.split('\n')) {
    const assignment = parseAssignmentLine(line);
    if (assignment?.members.some(member => member.callsign === callsign.toUpperCase() && member.active)) return assignment.unit;
  }
  return '';
}
function activeAssignmentsFor(callsign) {
  const assignments = [];
  for (const [sector, fieldName] of Object.entries(sectorFields)) {
    for (const line of form.elements[fieldName].value.split('\n')) {
      const assignment = parseAssignmentLine(line);
      if (assignment?.members.some(member => member.callsign === callsign.toUpperCase() && member.active)) {
        assignments.push({ sector, unit: assignment.unit });
      }
    }
  }
  return assignments;
}
function renderUnitRosters() {
  for (const [sector, fieldName] of Object.entries(sectorFields)) {
    const rosterId = sector === 'Specialised' ? 'specialisedUnitRoster' : `${sector.toLowerCase()}UnitRoster`;
    const roster = document.getElementById(rosterId);
    if (!roster) continue;
    roster.replaceChildren();
    for (const line of form.elements[fieldName].value.split('\n')) {
      const assignment = parseAssignmentLine(line);
      if (!assignment) continue;
      const unit = assignment.unit;
      const activeMembers = assignment.members.filter(member => member.active);
      for (const { callsign } of activeMembers) {
        const item = document.createElement('div');
        item.className = 'unit-roster-item';
        const description = document.createElement('span');
        const memberRecord = assignment.members.find(member => member.callsign === callsign);
        const memberStart = memberRecord?.startTime || assignment.startTime;
        const memberEnd = memberRecord?.active
          ? 'ONGOING'
          : (memberRecord?.endTime || assignment.endTime || assignment.startTime);
        description.textContent = `${unit} · ${callsign} · In ${formatWatchTime(memberStart)} · Out ${formatWatchTime(memberEnd)}`;
        const leaveButton = document.createElement('button');
        leaveButton.type = 'button';
        leaveButton.textContent = '×';
        leaveButton.dataset.callsign = callsign;
        leaveButton.dataset.sector = sector;
        leaveButton.dataset.unit = unit;
        leaveButton.setAttribute('aria-label', `Mark ${callsign} 10-42 and leave ${unit}`);
        item.append(description, leaveButton);
        roster.append(item);
      }
      if (activeMembers.length) {
        const dissolveButton = document.createElement('button');
        dissolveButton.type = 'button';
        dissolveButton.textContent = `Dissolve ${unit}`;
        dissolveButton.dataset.dissolveUnit = unit;
        dissolveButton.dataset.sector = sector;
        roster.append(dissolveButton);
      }
    }
  }
  refreshActivePresence();
  refreshDiveRescueUnitChoices();
}
function refreshActivePresence() {
  const units = new Map();
  const people = new Map();
  for (const [sector, fieldName] of Object.entries(sectorFields)) {
    for (const line of form.elements[fieldName].value.split('\n')) {
      const assignment = parseAssignmentLine(line);
      if (!assignment) continue;
      const activeMembers = assignment.members.filter(member => member.active);
      if (!activeMembers.length) continue;
      const key = `${sector}|${assignment.unit}`;
      if (!units.has(key)) units.set(key, { sector, unit: assignment.unit, callsigns: [] });
      for (const member of activeMembers) {
        const personKey = member.callsign.toUpperCase();
        const rosterMember = memberNameCache.get(personKey);
        units.get(key).callsigns.push(personKey);
        people.set(personKey, {
          callsign: personKey,
          rank: String(rosterMember?.rank || '').toLowerCase(),
          line: `${personKey}${rosterMember?.name ? ` ${rosterMember.name}` : ''} — ${assignment.unit}`
        });
      }
    }
  }
  const unitLines = [...units.values()].map(item => `${item.sector}: ${item.unit}`);
  const rankOrder = ['commissioners', 'chief', 'county command', 'division commander', 'captain', 'lieutenant', 'lead paramedic', 'paramedic', 'aemt', 'emt', 'probationary', 'senior volunteer', 'volunteer', 'probationary volunteer', 'emr', 'emr/volunteer'];
  const personLines = [...people.values()]
    .sort((a, b) => {
      const rankA = rankOrder.indexOf(a.rank), rankB = rankOrder.indexOf(b.rank);
      return (rankA < 0 ? rankOrder.length : rankA) - (rankB < 0 ? rankOrder.length : rankB)
        || a.callsign.localeCompare(b.callsign);
    })
    .map(person => person.line);
  const merged = form.elements.active_merged.value === 'true';
  const mergedLines = [...units.values()].map(item => `${item.unit} : ${item.callsigns.join(' | ')}`);
  form.elements.active_unit.value = merged ? mergedLines.join('\n') : unitLines.join('\n');
  form.elements.active_ems.value = merged ? '' : personLines.join('\n');
  activeUnitSummary.value = form.elements.active_unit.value;
  activeEmsSummary.value = personLines.join('\n');
  activeEmsWrap.hidden = merged;
  activeMergeButton.textContent = merged ? 'SEPARATE' : 'MERGE';
  activeMergeButton.setAttribute('aria-pressed', String(merged));
}
function mergedActiveUnitDisplay(activeUnit, activeEms) {
  if (!String(activeEms || '').trim()) return String(activeUnit || '').trim();
  const callsignsByUnit = new Map();
  for (const line of String(activeEms || '').split('\n')) {
    const match = line.match(/^\s*([A-Z]+-\d+)\b.*?\s+—\s+(.+?)\s*$/i);
    if (!match) continue;
    const callsigns = callsignsByUnit.get(match[2]) || [];
    callsigns.push(match[1].toUpperCase());
    callsignsByUnit.set(match[2], callsigns);
  }
  return String(activeUnit || '').split('\n').map(line => {
    const separator = line.indexOf(':');
    const unit = (separator >= 0 ? line.slice(separator + 1) : line).trim();
    const callsigns = callsignsByUnit.get(unit) || [];
    return callsigns.length ? `${unit} : ${callsigns.join(' | ')}` : unit;
  }).filter(Boolean).join('\n');
}
activeMergeButton?.addEventListener('click', () => {
  form.elements.active_merged.value = form.elements.active_merged.value === 'true' ? 'false' : 'true';
  refreshActivePresence();
  persistFormDraft();
});
async function markAssignment10_42(button) {
  const callsign = button.dataset.callsign || '';
  if (!callsign || !form.reportValidity()) return;
  button.disabled = true;
  let member;
  try {
    member = await lookupMember(callsign);
  } catch (error) {
    setMessage(quickMessage, error.message, 'error');
    button.disabled = false;
    return;
  }

  const changedFields = ['notes', 'roll_call', ...Object.values(sectorFields)];
  const previous = Object.fromEntries(changedFields.map(key => [key, form.elements[key].value]));
  const time = currentWatchTime();
  const unit = closeOpenAssignments(callsign, time);
  if (!unit) {
    renderUnitRosters();
    return;
  }
  const eventLine = `${time} ${callsign} ${member.name} 10-42 Leaving ${unit}`;
  appendText('notes', eventLine);
  persistFormDraft();
  setMessage(quickMessage, `Saving ${callsign} as 10-42…`);
  try {
    const save = () => request('/api/watch-command', {
      method: 'POST', body: JSON.stringify(currentRecord(false)),
    });
    try {
      await save();
    } catch (error) {
      if (!error.message.includes('belongs to another user')) throw error;
      newDraftId();
      await save();
    }
    setMessage(quickMessage, `Saved: ${eventLine}`, 'success');
    renderUnitRosters();
    refreshOnDutyCallsignChoices();
    refreshInitialUnitOptions();
    updateAvailableChoices();
    await loadHistory();
  } catch (error) {
    for (const [key, value] of Object.entries(previous)) form.elements[key].value = value;
    persistFormDraft();
    setMessage(quickMessage, error.message, 'error');
    renderUnitRosters();
    refreshOnDutyCallsignChoices();
    refreshInitialUnitOptions();
    updateAvailableChoices();
  } finally {
    button.disabled = false;
  }
}
async function dissolveUnit(button) {
  const sector = button.dataset.sector;
  const unit = button.dataset.dissolveUnit;
  const fieldName = sectorFields[sector];
  if (!fieldName || !unit) return;
  if (!form.reportValidity()) return;
  const assignment = form.elements[fieldName].value.split('\n')
    .map(parseAssignmentLine)
    .find(item => item?.unit === unit && item.active);
  if (!assignment) return;
  button.disabled = true;
  let members;
  try {
    members = await Promise.all(assignment.members.filter(member => member.active).map(async member => ({
      ...member,
      ...(await lookupMember(member.callsign)),
    })));
  } catch (error) {
    setMessage(quickMessage, error.message, 'error');
    button.disabled = false;
    return;
  }
  const oldNotes = form.elements.notes.value;
  const oldCoverage = Object.fromEntries(Object.values(sectorFields).map(key => [key, form.elements[key].value]));
  const time = currentWatchTime();
  for (const member of members) {
    closeOpenAssignments(member.callsign, time);
    appendText('notes', `${time} ${member.callsign} ${member.name} 10-42 Dissolving ${unit}`);
  }
  persistFormDraft();
  setMessage(quickMessage, `Dissolving ${unit}…`);
  try {
    const save = () => request('/api/watch-command', {
      method: 'POST', body: JSON.stringify(currentRecord(false)),
    });
    try {
      await save();
    } catch (error) {
      if (!error.message.includes('belongs to another user')) throw error;
      newDraftId();
      await save();
    }
    setMessage(quickMessage, `${unit} dissolved. All members were marked 10-42.`, 'success');
    renderUnitRosters();
    refreshOnDutyCallsignChoices();
    refreshInitialUnitOptions();
    updateAvailableChoices();
    await loadHistory();
  } catch (error) {
    form.elements.notes.value = oldNotes;
    for (const [key, value] of Object.entries(oldCoverage)) form.elements[key].value = value;
    persistFormDraft();
    renderUnitRosters();
    setMessage(quickMessage, error.message, 'error');
  } finally {
    button.disabled = false;
  }
}
function refreshOnDutyCallsignChoices() {
  const displayNames = new Map();
  const watchCallsigns = new Map();
  for (const line of form.elements.roll_call.value.split('\n')) {
    const match = line.trim().match(/^([A-Z]+-\d+)\s*(.*)$/i);
    if (match) {
      const callsign = match[1].toUpperCase();
      const cleanedName = match[2].replace(/\s+WC\/(?:Red|Green|Blue|Command|Battalion|Guardian|Nomad|Dive|Engine)-\d+(?:\([^)]*\))?$/i, '')
        .replace(/\s+WC\b/g, '').replace(/\s+\(Training\)/gi, '')
        .replace(/\s+(?:Red|Green|Blue)-\d+(?:\([^)]*\))?$/i, '')
        .replace(/\s+(?:Command|Battalion|Guardian|Nomad|Dive|Engine)-\d+(?:\([^)]*\))?$/i, '').trim();
      displayNames.set(callsign, memberNameCache.get(callsign)?.name || cleanedName);
      watchCallsigns.set(callsign, memberNameCache.get(callsign)?.name || cleanedName);
    }
  }
  for (const [sector, fieldName] of Object.entries(sectorFields)) {
    for (const line of form.elements[fieldName].value.split('\n')) {
      const assignment = parseAssignmentLine(line);
      for (const member of assignment?.members || []) {
        watchCallsigns.set(member.callsign, memberNameCache.get(member.callsign)?.name || '');
        if (member.active) displayNames.set(member.callsign, displayNames.get(member.callsign) || '');
      }
    }
  }
  const previous = onDutyPicker.value;
  onDutyPicker.replaceChildren();
  onDutyCallsignList.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = displayNames.size ? 'Choose a callsign' : 'No members in the watch log yet';
  onDutyPicker.append(placeholder);
  const suggestions = new Set();
  for (const [callsign, member] of memberNameCache.entries()) {
    const suggestion = document.createElement('option');
    suggestion.value = callsign;
    suggestion.label = member.name;
    onDutyCallsignList.append(suggestion);
    suggestions.add(callsign);
  }
  for (const [callsign, name] of [...displayNames.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const option = document.createElement('option');
    option.value = callsign;
    option.textContent = name ? `${callsign} ${name}` : callsign;
    onDutyPicker.append(option);
    if (!suggestions.has(callsign)) {
      const suggestion = document.createElement('option');
      suggestion.value = callsign;
      suggestion.label = name;
      onDutyCallsignList.append(suggestion);
    }
  }
  if ([...onDutyPicker.options].some(option => option.value === previous)) onDutyPicker.value = previous;
  const issuerPicker = document.querySelector('#dnrIssuer');
  const previousIssuer = issuerPicker.value;
  issuerPicker.replaceChildren();
  const issuerPlaceholder = document.createElement('option');
  issuerPlaceholder.value = '';
  issuerPlaceholder.textContent = displayNames.size ? 'Choose an on-duty callsign' : 'No members in the watch log yet';
  issuerPicker.append(issuerPlaceholder);
  for (const [callsign, name] of [...displayNames.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const option = document.createElement('option');
    option.value = callsign;
    option.textContent = name ? `${callsign} ${name}` : callsign;
    issuerPicker.append(option);
  }
  if ([...issuerPicker.options].some(option => option.value === previousIssuer)) issuerPicker.value = previousIssuer;
  const watchCallsignList = document.querySelector('#watchCallsignChoices');
  watchCallsignList.replaceChildren();
  for (const [callsign, name] of [...watchCallsigns.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const suggestion = document.createElement('option');
    suggestion.value = callsign;
    suggestion.label = name ? `${callsign} ${name}` : callsign;
    watchCallsignList.append(suggestion);
  }
}
function renderFormUnitMemberInputs() {
  const count = Number(formUnitCount.value) || 1;
  const previous = [...formUnitMembers.querySelectorAll('input')].map(input => input.value);
  formUnitMembers.replaceChildren();
  for (let index = 0; index < count; index += 1) {
    const label = document.createElement('label');
    label.textContent = `Member ${index + 1} callsign`;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 32;
    input.autocomplete = 'off';
    input.placeholder = 'P-11';
    input.setAttribute('list', 'onDutyCallsignList');
    input.required = false;
    input.value = previous[index] || '';
    input.addEventListener('input', () => {
      input.value = addCallsignHyphen(input.value);
    });
    label.append(input);
    formUnitMembers.append(label);
  }
}
function activeUnitsIn(sector) {
  const fieldName = sectorFields[sector];
  if (!fieldName) return [];
  return form.elements[fieldName].value.split('\n').flatMap(line => {
    const assignment = parseAssignmentLine(line);
    return assignment?.active ? [assignment.unit] : [];
  });
}
function refreshInitialUnitOptions() {
  const sector = document.querySelector('#initialSector').value;
  const prefix = sector === 'Specialised'
    ? document.querySelector('#initialSpecial').value
    : sector;
  initialUnitOptions.replaceChildren();
  for (const unit of [...new Set(activeUnitsIn(sector))]) {
    const match = unit.match(new RegExp(`^${prefix}-(\\d+)(?:\\([^)]*\\))?$`, 'i'));
    if (!match) continue;
    const option = document.createElement('option');
    option.value = match[1];
    initialUnitOptions.append(option);
  }
}
function formatInitialUnit(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 4);
}
function normalizeInitialUnit(value) {
  const sector = document.querySelector('#initialSector').value;
  const number = formatInitialUnit(value);
  if (!number || Number(number) < 1) return '';
  const prefix = sector === 'Specialised'
    ? document.querySelector('#initialSpecial').value
    : sector;
  return `${prefix}-${number}`;
}
async function addInitialRollCallMember() {
  if (!form.reportValidity()) return;
  const callsign = initialCallsignInput.value.trim().toUpperCase();
  if (!callsign) {
    setMessage(initialRollcallMessage, 'Enter the member callsign.', 'error');
    initialCallsignInput.focus();
    return;
  }
  const sector = document.querySelector('#initialSector').value;
  const isTraining = initialIsTraining.checked;
  const baseUnit = normalizeInitialUnit(initialUnitInput.value);
  const attachmentText = baseUnit ? initialAttachedUnit.value.trim() : '';
  if (attachmentText && !normalizeAttachedUnit(attachmentText)) {
    setMessage(initialRollcallMessage, 'Enter any attached unit name (up to 24 characters).', 'error');
    initialAttachedUnit.focus();
    return;
  }
  const unit = baseUnit ? addAttachedUnit(baseUnit, attachmentText) : '';
  if (attachmentText && !unit) {
    setMessage(initialRollcallMessage, 'Choose a parent unit before adding an attached unit.', 'error');
    initialUnitInput.focus();
    return;
  }
  if (!unit && !isTraining) {
    setMessage(initialRollcallMessage, 'Enter the unit number only, for example 1.', 'error');
    initialUnitInput.focus();
    return;
  }

  const button = document.querySelector('#addInitialRollCall');
  button.disabled = true;
  setMessage(initialRollcallMessage, 'Looking up the member…');
  let member;
  try {
    member = await lookupMember(callsign);
  } catch (error) {
    setMessage(initialRollcallMessage, error.message, 'error');
    button.disabled = false;
    return;
  }

  const assignments = activeAssignmentsFor(callsign);
  if (unit && assignments.length && (assignments.length !== 1 || assignments[0].sector !== sector || assignments[0].unit !== unit)) {
    setMessage(initialRollcallMessage, `${callsign} is already active in ${assignments[0].unit}. Use the unit switch controls instead.`, 'error');
    button.disabled = false;
    return;
  }
  const changedFields = ['notes', 'roll_call', ...Object.values(sectorFields)];
  const previous = Object.fromEntries(changedFields.map(key => [key, form.elements[key].value]));
  const fieldName = sectorFields[sector];
  const alreadyAssigned = unit && assignments.some(item => item.sector === sector && item.unit === unit);
  if (unit && !alreadyAssigned) {
    const startTime = formatWatchTime(form.elements.start_time.value || currentWatchTime());
    addCallsignToUnit(fieldName, unit, callsign, startTime, isLoggedInWatchCommander(callsign));
  }
  const notesBeforeRollCallChange = form.elements.notes.value;
  upsertRollCall(callsign, member.name, unit, {
    watchCommander: isLoggedInWatchCommander(callsign),
    training: initialIsTraining.checked,
  });
  // Initial Roll Call records pre-existing presence, never a sign-in event.
  form.elements.notes.value = notesBeforeRollCallChange;
  persistFormDraft();
  setMessage(initialRollcallMessage, 'Saving initial Roll Call…');
  try {
    const save = () => request('/api/watch-command', {
      method: 'POST', body: JSON.stringify(currentRecord(false)),
    });
    try {
      await save();
    } catch (error) {
      if (!error.message.includes('belongs to another user')) throw error;
      newDraftId();
      await save();
    }
    setMessage(initialRollcallMessage, `${callsign} ${member.name} added to Roll Call${unit ? ` and ${unit} in ${sector} coverage` : ' without a unit'}. Saving in the background.`);
    initialCallsignInput.value = '';
    initialCallsignInput.dispatchEvent(new Event('input', { bubbles: true }));
    initialUnitInput.value = '';
    initialAttachedUnit.value = '';
    initialIsTraining.checked = false;
    document.querySelector('#initialUnitLabel').textContent = 'Unit number';
    initialMemberLookup.textContent = 'Enter a callsign to look up the member name.';
    persistFormDraft();
    renderUnitRosters();
    refreshOnDutyCallsignChoices();
    refreshInitialUnitOptions();
    updateAvailableChoices();
  } catch (error) {
    for (const [key, value] of Object.entries(previous)) form.elements[key].value = value;
    persistFormDraft();
    setMessage(initialRollcallMessage, error.message, 'error');
    renderUnitRosters();
    refreshOnDutyCallsignChoices();
    refreshInitialUnitOptions();
    updateAvailableChoices();
  } finally {
    button.disabled = false;
  }
}
function updateAvailableChoices(member = null) {
  const callsign = callsignInput.value.trim().toUpperCase();
  const selectedMember = member || memberNameCache.get(callsign);
  const rank = String(selectedMember?.rank || '').trim().toLowerCase();
  const isProbie = ['probationary', 'probie', 'probationary volunteer', 'probie volunteer'].includes(rank);
  const assignments = callsign ? activeAssignmentsFor(callsign) : [];
  const sectorSelect = document.querySelector('#activitySector');
  for (const option of sectorSelect.options) {
    if (!option.value) continue;
    const activeUnits = activeUnitsIn(option.value);
    option.hidden = isProbie && activeUnits.length === 0;
  }
  if (isProbie && sectorSelect.value && activeUnitsIn(sectorSelect.value).length === 0) {
    sectorSelect.value = '';
  }

  const statusSelect = document.querySelector('#activityStatus');
  const leavingOption = [...statusSelect.options].find(option => option.value === '10-42 Leaving');
  if (leavingOption) leavingOption.hidden = assignments.length === 0;
  if (!assignments.length && statusSelect.value === '10-42 Leaving') {
    statusSelect.value = '10-41 forming';
    quickButton.textContent = activityTraining.checked ? 'Sign in for Training' : 'Sign in';
  }

  const specialSelect = document.querySelector('#specialisedUnitName');
  for (const option of specialSelect.options) {
    const hasActiveUnit = activeUnitsIn('Specialised').some(unit =>
      unit.toLowerCase().startsWith(`${option.value.toLowerCase()}-`));
    option.hidden = isProbie && !hasActiveUnit;
  }
  if (isProbie && specialSelect.selectedOptions[0]?.hidden) {
    const firstAvailable = [...specialSelect.options].find(option => !option.hidden);
    specialSelect.value = firstAvailable?.value || '';
  }
  updateTargetUnitChoices(selectedMember);
}
function updateTargetUnitChoices(member = null) {
  const sector = document.querySelector('#activitySector').value;
  const leaving = document.querySelector('#activityStatus').value === '10-42 Leaving';
  targetUnitWrap.hidden = leaving || !sector;
  document.querySelector('#activityAttachedWrap').hidden = leaving || sector !== 'Specialised' || targetUnitSelect.value !== '__new__';
  document.querySelector('#specialisedUnitWrap').hidden = sector !== 'Specialised';
  if (targetUnitWrap.hidden) return;

  const callsign = callsignInput.value.trim().toUpperCase();
  const selectedMember = member || memberNameCache.get(callsign);
  const rank = String(selectedMember?.rank || '').trim().toLowerCase();
  const isProbie = ['probationary', 'probie', 'probationary volunteer', 'probie volunteer'].includes(rank);
  const unitType = sector === 'Specialised'
    ? document.querySelector('#specialisedUnitName').value.trim().toLowerCase()
    : '';
  const units = [...new Set(activeUnitsIn(sector).filter(unit =>
    !unitType || unit.toLowerCase().startsWith(`${unitType}-`)))];
  const previousChoice = targetUnitSelect.value;
  targetUnitSelect.replaceChildren();

  if (!isProbie) {
    const createOption = document.createElement('option');
    createOption.value = '__new__';
    createOption.textContent = 'Form a new unit';
    targetUnitSelect.append(createOption);
  }
  for (const unit of units) {
    const option = document.createElement('option');
    option.value = unit;
    option.textContent = `Join ${unit}`;
    targetUnitSelect.append(option);
  }
  if (!targetUnitSelect.options.length) {
    const unavailable = document.createElement('option');
    unavailable.value = '';
    unavailable.textContent = 'No active unit available';
    unavailable.disabled = true;
    unavailable.selected = true;
    targetUnitSelect.append(unavailable);
    return;
  }

  const currentUnit = callsign ? activeUnitFor(callsign, sector) : '';
  if (previousChoice && [...targetUnitSelect.options].some(option => option.value === previousChoice)) {
    targetUnitSelect.value = previousChoice;
  } else if (currentUnit && units.includes(currentUnit)) {
    targetUnitSelect.value = currentUnit;
  } else if (isProbie) {
    targetUnitSelect.value = units[0] || '';
  } else {
    targetUnitSelect.value = '__new__';
  }
  if (targetUnitSelect.value !== '__new__') activityAttachedUnit.value = '';
  document.querySelector('#activityAttachedWrap').hidden = leaving || sector !== 'Specialised' || targetUnitSelect.value !== '__new__';
}
function addCallsignHyphen(value) {
  const normalized = String(value || '').toUpperCase().replace(/\s+/g, '');
  if (normalized.includes('-')) return normalized;
  return callsignPrefixes.includes(normalized) ? `${normalized}-` : normalized;
}
function nextSectorUnit(sector) {
  const fieldName = sectorFields[sector];
  const activeNumbers = new Set();
  for (const line of form.elements[fieldName].value.split('\n')) {
    const assignment = parseAssignmentLine(line);
    const match = assignment?.unit.match(new RegExp(`^${sector}-(\\d+)$`, 'i'));
    if (assignment?.active && match) activeNumbers.add(Number(match[1]));
  }
  let number = 1;
  while (activeNumbers.has(number)) number += 1;
  return `${sector}-${number}`;
}
function nextSpecialisedUnit(unitType) {
  const activeNumbers = new Set();
  for (const line of form.elements.specialised_units.value.split('\n')) {
    const assignment = parseAssignmentLine(line);
    const match = assignment?.unit.match(new RegExp(`^${unitType}-(\\d+)(?:\\([^)]*\\))?$`, 'i'));
    if (assignment?.active && match) activeNumbers.add(Number(match[1]));
  }
  let number = 1;
  while (activeNumbers.has(number)) number += 1;
  return `${unitType}-${number}`;
}
async function recordActivity() {
  const callsign = callsignInput.value.trim().toUpperCase();
  const sector = document.querySelector('#activitySector').value;
  const status = document.querySelector('#activityStatus').value;
  if (!callsign) {
    setMessage(quickMessage, 'Enter the member callsign first.', 'error');
    document.querySelector('#activityCallsign').focus();
    return;
  }
  if (!form.reportValidity()) return;
  quickButton.disabled = true;
  setMessage(quickMessage, 'Looking up the member on the roster…');
  let member;
  try {
    member = await lookupMember(callsign);
  } catch (error) {
    setMessage(quickMessage, error.message, 'error');
    quickButton.disabled = false;
    return;
  }
  const specialName = document.querySelector('#specialisedUnitName').value.trim();
  const isTraining = activityTraining.checked;
  const attachmentText = isTraining && !sector ? '' : activityAttachedUnit.value.trim();
  const attachingToNewUnit = sector === 'Specialised' && targetUnitSelect.value === '__new__';
  if (isTraining && status === '10-42 Leaving') {
    setMessage(quickMessage, 'A training sign-in cannot be marked as 10-42. Uncheck Training first.', 'error');
    quickButton.disabled = false;
    return;
  }
  if (sector === 'Specialised' && status !== '10-42 Leaving' && !specialName) {
    setMessage(quickMessage, 'Choose a specialised unit.', 'error');
    document.querySelector('#specialisedUnitName').focus();
    quickButton.disabled = false;
    return;
  }
  if (attachmentText && !normalizeAttachedUnit(attachmentText)) {
    setMessage(quickMessage, 'Enter any attached unit name (up to 24 characters).', 'error');
    activityAttachedUnit.focus();
    quickButton.disabled = false;
    return;
  }
  if (attachmentText && !attachingToNewUnit) {
    setMessage(quickMessage, 'An attached unit can only be added while forming a new specialised unit.', 'error');
    activityAttachedUnit.focus();
    quickButton.disabled = false;
    return;
  }

  const changedFields = ['notes', 'roll_call', ...Object.values(sectorFields)];
  const previous = Object.fromEntries(changedFields.map(key => [key, form.elements[key].value]));
  const time = currentWatchTime();
  let unit = '';
  let joinedExistingUnit = false;
  const previousAssignment = activeAssignmentsFor(callsign)[0] || null;
  const rankKey = String(member.rank || '').trim().toLowerCase();
  const isProbie = ['probationary', 'probie', 'probationary volunteer', 'probie volunteer'].includes(rankKey);
  if (status === '10-42 Leaving') {
    unit = closeOpenAssignments(callsign, time);
    if (!unit) {
      for (const [key, value] of Object.entries(previous)) form.elements[key].value = value;
      setMessage(quickMessage, `${callsign} cannot be marked 10-42 because they are not assigned to an active unit.`, 'error');
      quickButton.disabled = false;
      return;
    }
  } else if (isTraining && !sector) {
    if (previousAssignment) {
      closeOpenAssignments(callsign, time);
      appendText('notes', `${time} ${callsign} ${member.name} 10-42 Leaving ${previousAssignment.unit} for Training`);
    }
  } else if (isProbie) {
    if (!sector) {
      setMessage(quickMessage, 'Choose the sector or specialised unit the Probie is joining.', 'error');
      quickButton.disabled = false;
      return;
    }
    const specialName = document.querySelector('#specialisedUnitName').value.trim();
    const targetChoice = targetUnitSelect.value;
    unit = targetChoice && targetChoice !== '__new__' ? targetChoice : '';
    if (!unit) {
      const target = sector === 'Specialised' ? `${specialName} specialised` : `${sector} Sector`;
      setMessage(quickMessage, `No active ${target} unit exists to join. Sign in a member to form the unit first.`, 'error');
      quickButton.disabled = false;
      return;
    }
    joinedExistingUnit = true;
    if (activeUnitFor(callsign, sector) !== unit) {
      closeOpenAssignments(callsign, time);
      addCallsignToUnit(sectorFields[sector], unit, callsign, time);
    }
  } else if (sector) {
    const existingUnit = activeUnitFor(callsign, sector);
    const targetChoice = targetUnitSelect.value;
    unit = targetChoice === '__new__'
      ? (sector === 'Specialised'
        ? addAttachedUnit(nextSpecialisedUnit(specialName), attachmentText)
        : nextSectorUnit(sector))
      : targetChoice;
    if (!unit) {
      setMessage(quickMessage, 'Choose an available unit or form a new one.', 'error');
      quickButton.disabled = false;
      return;
    }
    joinedExistingUnit = targetChoice !== '__new__';
    if (existingUnit !== unit) {
      closeOpenAssignments(callsign, time);
      addCallsignToUnit(sectorFields[sector], unit, callsign, time);
    }
  }
  const eventLine = isTraining
    ? `${time} ${callsign} ${member.name} 10-41 Training${unit ? ` ${unit}` : ''}`
    : status === '10-42 Leaving'
    ? `${time} ${callsign} ${status}${unit ? ` ${unit}` : ''}`
    : previousAssignment && unit && previousAssignment.unit !== unit
      ? `${time} ${callsign} ${member.name} Switching from ${previousAssignment.unit} to ${joinedExistingUnit ? `Existing Unit ${unit}` : unit}`
      : isProbie
        ? `${time} ${callsign} ${member.name} 10-41 Joining ${unit}`
        : `${time} ${callsign} ${member.name} ${status}${unit ? ` ${unit}` : ''}`;
  appendText('notes', eventLine);

  persistFormDraft();
  setMessage(quickMessage, 'Saving activity…');
  try {
    const saveActivity = () => request('/api/watch-command', {
      method: 'POST', body: JSON.stringify(currentRecord(false)),
    });
    try {
      await saveActivity();
    } catch (error) {
      if (!error.message.includes('belongs to another user')) throw error;
      newDraftId();
      await saveActivity();
    }
    setMessage(quickMessage, `Recorded: ${eventLine}. Saving in the background.`);
    callsignInput.value = '';
    callsignInput.dispatchEvent(new Event('input', { bubbles: true }));
    activityAttachedUnit.value = '';
    renderUnitRosters();
    refreshOnDutyCallsignChoices();
    refreshInitialUnitOptions();
    updateAvailableChoices();
  } catch (error) {
    for (const [key, value] of Object.entries(previous)) form.elements[key].value = value;
    persistFormDraft();
    renderUnitRosters();
    refreshOnDutyCallsignChoices();
    refreshInitialUnitOptions();
    updateAvailableChoices();
    setMessage(quickMessage, error.message, 'error');
  } finally {
    quickButton.disabled = false;
  }
}

async function formUnitWithMembers() {
  if (!form.reportValidity()) return;
  const sector = document.querySelector('#formUnitSector').value;
  const specialName = document.querySelector('#formUnitSpecial').value.trim();
  const enteredCallsigns = [...formUnitMembers.querySelectorAll('input')]
    .map(input => input.value.trim().toUpperCase());
  if (enteredCallsigns.some(callsign => !callsign)) {
    setMessage(formUnitMessage, 'Enter a callsign for every selected member.', 'error');
    return;
  }
  const callsigns = enteredCallsigns;
  if (!callsigns.length) {
    setMessage(formUnitMessage, 'Enter at least one callsign.', 'error');
    return;
  }
  if (new Set(callsigns).size !== callsigns.length) {
    setMessage(formUnitMessage, 'Each member must have a different callsign.', 'error');
    return;
  }

  formUnitSubmit.disabled = true;
  setMessage(formUnitMessage, 'Looking up members…');
  let members;
  try {
    members = await Promise.all(callsigns.map(async callsign => ({
      callsign,
      ...(await lookupMember(callsign)),
    })));
  } catch (error) {
    setMessage(formUnitMessage, error.message, 'error');
    formUnitSubmit.disabled = false;
    return;
  }

  const changedFields = ['notes', 'roll_call', ...Object.values(sectorFields)];
  const previous = Object.fromEntries(changedFields.map(key => [key, form.elements[key].value]));
  const time = currentWatchTime();
  const unit = sector === 'Specialised' ? nextSpecialisedUnit(specialName) : nextSectorUnit(sector);
  const probieRanks = ['probationary', 'probie', 'probationary volunteer', 'probie volunteer'];
  const hasUnitLeader = members.some(member => !probieRanks.includes(member.rank.trim().toLowerCase()));
  if (!hasUnitLeader) {
    setMessage(formUnitMessage, 'At least one member must be able to form the unit. Probies can join an existing unit.', 'error');
    formUnitSubmit.disabled = false;
    return;
  }
  const formingLeader = members.find(member => !probieRanks.includes(member.rank.trim().toLowerCase())).callsign;

  const fieldName = sectorFields[sector];
  for (const member of members) {
    const previousAssignment = activeAssignmentsFor(member.callsign)[0] || null;
    const currentUnit = activeUnitFor(member.callsign, sector);
    if (currentUnit !== unit) {
      closeOpenAssignments(member.callsign, time);
      addCallsignToUnit(fieldName, unit, member.callsign, time);
    }
    const event = previousAssignment && previousAssignment.unit !== unit
      ? `Switching from ${previousAssignment.unit} to ${unit}`
      : member.callsign === formingLeader
        ? `10-41 Forming Unit ${unit}`
        : `10-41 Joining ${unit}`;
    appendText('notes', `${time} ${member.callsign} ${member.name} ${event}`);
  }

  persistFormDraft();
  setMessage(formUnitMessage, `Saving ${unit}…`);
  try {
    const save = () => request('/api/watch-command', {
      method: 'POST', body: JSON.stringify(currentRecord(false)),
    });
    try {
      await save();
    } catch (error) {
      if (!error.message.includes('belongs to another user')) throw error;
      newDraftId();
      await save();
    }
    setMessage(formUnitMessage, `${unit} formed with ${members.length} member(s).`, 'success');
    renderUnitRosters();
    refreshOnDutyCallsignChoices();
    refreshInitialUnitOptions();
    updateAvailableChoices();
    await loadHistory();
  } catch (error) {
    for (const [key, value] of Object.entries(previous)) form.elements[key].value = value;
    persistFormDraft();
    setMessage(formUnitMessage, error.message, 'error');
    renderUnitRosters();
    refreshOnDutyCallsignChoices();
    updateAvailableChoices();
  } finally {
    formUnitSubmit.disabled = false;
  }
}

function upsertRollCall(callsign, memberName, unit, { watchCommander = false, training = false } = {}) {
  const field = form.elements.roll_call;
  const lines = field.value.split('\n');
  const index = lines.findIndex(line => line.trim().toUpperCase().split(/\s+/, 1)[0] === callsign);
  const keepWatchCommander = watchCommander || isRollCallWatchCommander(callsign);
  const tags = `${training ? ' (Training)' : ''}`;
  const placement = unit ? ` ${keepWatchCommander ? `WC/${unit}` : unit}` : (keepWatchCommander ? ' WC' : '');
  const entry = `${callsign} ${memberName}${tags}${placement}`;
  if (index < 0) {
    appendText('roll_call', entry);
  } else if (lines[index].trim().toUpperCase() === callsign) {
    lines[index] = entry;
    field.value = lines.join('\n');
  } else if (unit && !lines[index].includes(unit)) {
    lines[index] = entry;
    field.value = lines.join('\n');
  } else {
    lines[index] = entry;
    field.value = lines.join('\n');
  }
  refreshRollCallSummary();
}
function isLoggedInWatchCommander(callsign) {
  return Boolean(activeWatchCommanderCallsign && activeWatchCommanderCallsign === String(callsign || '').toUpperCase());
}
function applyLoggedInCommander() {
  if (!loggedInCommander) return;
  const commanderField = form.elements.watch_commander;
  if (form.elements.watch_transition.value.trim()) {
    activeWatchCommanderCallsign = commanderField.value.trim().match(/^([A-Z]+-\d+)/i)?.[1]?.toUpperCase() || activeWatchCommanderCallsign;
    return;
  }
  if (loggedInCommander.callsign) {
    activeWatchCommanderCallsign = loggedInCommander.callsign;
    commanderField.value = `${loggedInCommander.callsign} ${loggedInCommander.name}`.trim();
    markRollCallWatchCommander(loggedInCommander.callsign, loggedInCommander.name, true);
    if (!initialCallsignInput.value.trim()) initialCallsignInput.value = loggedInCommander.callsign;
  } else if (!commanderField.value.trim()) {
    commanderField.value = loggedInCommander.name;
  }
  persistFormDraft();
}
function markRollCallWatchCommander(callsign, memberName, clearPrevious = false) {
  const field = form.elements.roll_call;
  const lines = field.value.split('\n');
  let targetIndex = lines.findIndex(line => line.trim().toUpperCase().split(/\s+/, 1)[0] === callsign);
  const updated = lines.map((line, index) => {
    if (!clearPrevious && index !== targetIndex) return line;
    const clean = line
      .replace(/\s+WC\/(?=(?:Red|Green|Blue|Command|Battalion|Guardian|Nomad|Dive|Engine)-\d+)/gi, ' ')
      .replace(/\s+WC\b/gi, '').trimEnd();
    if (index !== targetIndex) return clean;
    const unit = clean.match(/\s(?:Red|Green|Blue|Command|Battalion|Guardian|Nomad|Dive|Engine)-\d+(?:\([^)]*\))?/i);
    return unit
      ? `${clean.slice(0, unit.index).trimEnd()} WC/${unit[0].trim()}`
      : `${clean} WC`;
  }).filter(line => line.trim());
  if (targetIndex < 0) updated.push(`${callsign} ${memberName} WC`);
  field.value = updated.join('\n');
  refreshRollCallSummary();
}
async function transferWatchCommand(input = null, trigger = null) {
  const callsign = String(input?.value || onDutyPicker.value || '').trim().toUpperCase();
  if (!callsign) {
    setMessage(input ? document.querySelector('#watchMessage') : quickMessage, 'Enter or choose the new Watch Commander callsign first.', 'error');
    return;
  }
  const button = trigger || document.querySelector('#setWatchCommander');
  button.disabled = true;
  let oldValues = null;
  try {
    const member = await lookupMember(callsign);
    oldValues = { transition: form.elements.watch_transition.value };
    const transition = `${currentWatchTime()} ${callsign} ${member.name}`;
    appendText('watch_transition', transition);
    persistFormDraft();
    const save = () => request('/api/watch-command', {
      method: 'POST', body: JSON.stringify(currentRecord(false)),
    });
    try {
      await save();
    } catch (error) {
      if (!error.message.includes('belongs to another user')) throw error;
      newDraftId();
      await save();
    }
    setMessage(input ? message : quickMessage, `Incoming Watch Commander added to transition: ${callsign} ${member.name}.`, 'success');
    if (input) input.value = '';
    await loadHistory();
  } catch (error) {
    if (oldValues) {
      form.elements.watch_transition.value = oldValues.transition;
      persistFormDraft();
    }
    setMessage(input ? message : quickMessage, error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function lookupMember(callsign) {
  callsign = String(callsign || '').trim().toUpperCase();
  if (memberNameCache.has(callsign)) return memberNameCache.get(callsign);
  if (memberLookupPromises.has(callsign)) return memberLookupPromises.get(callsign);
  const pending = request(`/api/watch-command/member/${encodeURIComponent(callsign)}`).then(member => {
    const name = String(member.name || '').trim();
    if (!name) throw new Error(`${callsign} has no member name on the roster.`);
    const result = { name, rank: String(member.rank || '').trim() };
    memberNameCache.set(callsign, result);
    return result;
  });
  memberLookupPromises.set(callsign, pending);
  try {
    return await pending;
  } finally {
    if (memberLookupPromises.get(callsign) === pending) memberLookupPromises.delete(callsign);
  }
}

let memberDirectoryPromise = null;
function loadMemberDirectory() {
  if (memberDirectoryPromise) return memberDirectoryPromise;
  if (memberNameCache.size) {
    refreshOnDutyCallsignChoices();
    memberDirectoryPromise = Promise.resolve();
    return memberDirectoryPromise;
  }
  memberDirectoryPromise = request('/api/watch-command/members').then(members => {
    cacheWatchMemberDirectory(members);
    refreshOnDutyCallsignChoices();
  }).catch(error => {
    memberDirectoryPromise = null;
    console.warn('Could not preload the Watch Command member directory:', error);
  });
  return memberDirectoryPromise;
}

callsignInput.addEventListener('input', () => {
  clearTimeout(memberLookupTimer);
  const formattedCallsign = addCallsignHyphen(callsignInput.value);
  if (formattedCallsign !== callsignInput.value.toUpperCase().replace(/\s+/g, '')) {
    callsignInput.value = formattedCallsign;
  }
  const callsign = callsignInput.value.trim().toUpperCase();
  updateAvailableChoices();
  if (!callsign) {
    memberLookup.textContent = 'Enter a callsign to look up the member name.';
    return;
  }
  if (!/^[A-Z]+-\d+$/.test(callsign)) {
    memberLookup.textContent = 'Enter a complete callsign to look up the member name.';
    return;
  }
  const cachedMember = memberNameCache.get(callsign);
  if (cachedMember) {
    memberLookup.textContent = `${callsign} ${cachedMember.name}`;
    updateAvailableChoices(cachedMember);
    return;
  }
  memberLookup.textContent = 'Looking up member…';
  memberLookupTimer = setTimeout(async () => {
    try {
      const member = await lookupMember(callsign);
      if (callsignInput.value.trim().toUpperCase() === callsign) {
        callsignInput.value = callsign;
        memberLookup.textContent = `${callsign} ${member.name}`;
        updateAvailableChoices(member);
      }
    } catch (error) {
      if (callsignInput.value.trim().toUpperCase() === callsign) {
        memberLookup.textContent = error.status === 404
          ? `${callsign} was not found on the roster.`
          : error.message;
      }
    }
  }, 0);
});

let restoredDraft = false;
try {
  const savedDraft = JSON.parse(sessionStorage.getItem('watch-command-form-draft') || 'null');
  if (savedDraft?.draftId && savedDraft.values) {
    for (const [key, value] of Object.entries(savedDraft.values)) {
      if (!form.elements[key]) continue;
      if (form.elements[key].type === 'checkbox') {
        form.elements[key].checked = Boolean(value);
        continue;
      }
      if (key === 'activityStatus' && value === '10-8 in service') {
        form.elements[key].value = '10-41 forming';
      } else if (key === 'activityStatus' && ['10-42', '10-42 leaving'].includes(value)) {
        form.elements[key].value = '10-42 Leaving';
      } else {
        form.elements[key].value = value;
      }
    }
    sessionStorage.setItem('watch-command-draft-id', savedDraft.draftId);
    ensureDraftId();
    restoredDraft = true;
  }
} catch (_) {
  sessionStorage.removeItem('watch-command-form-draft');
}
if (!restoredDraft) {
  form.elements.watch_date.value = localDateInputValue();
  newDraftId();
}
for (const fieldName of Object.values(sectorFields)) compactUnitLines(fieldName);
renderUnitRosters();
document.querySelector('#specialisedUnitWrap').hidden = document.querySelector('#activitySector').value !== 'Specialised';
quickButton.textContent = document.querySelector('#activityStatus').value === '10-42 Leaving' ? 'Sign out' : 'Sign in';
form.addEventListener('input', persistFormDraft);
form.addEventListener('change', persistFormDraft);
for (const fieldName of Object.values(sectorFields)) {
  form.elements[fieldName].addEventListener('input', refreshActivePresence);
  form.elements[fieldName].addEventListener('change', refreshActivePresence);
}
document.querySelector('#activitySector').addEventListener('change', event => {
  if (event.target.value !== 'Specialised') activityAttachedUnit.value = '';
  document.querySelector('#specialisedUnitWrap').hidden = event.target.value !== 'Specialised';
  updateAvailableChoices();
});
document.querySelector('#specialisedUnitName').addEventListener('change', () => {
  updateAvailableChoices();
});
document.querySelector('#activityStatus').addEventListener('change', event => {
  quickButton.textContent = event.target.value === '10-42 Leaving' ? 'Sign out' : (activityTraining.checked ? 'Sign in for Training' : 'Sign in');
  updateTargetUnitChoices();
});
activityTraining.addEventListener('change', () => {
  if (activityTraining.checked) {
    if (document.querySelector('#activityStatus').value === '10-42 Leaving') {
      document.querySelector('#activityStatus').value = '10-41 forming';
    }
    quickButton.textContent = 'Sign in for Training';
  } else {
    quickButton.textContent = 'Sign in';
  }
  updateAvailableChoices();
});
targetUnitSelect.addEventListener('change', updateTargetUnitChoices);
quickButton.addEventListener('click', recordActivity);
document.querySelector('#chooseOnDutyCallsign').addEventListener('click', () => {
  refreshOnDutyCallsignChoices();
  onDutyPicker.hidden = !onDutyPicker.hidden;
  if (!onDutyPicker.hidden) onDutyPicker.focus();
});
const transitionCallsignInput = document.querySelector('#transitionCallsign');
transitionCallsignInput.addEventListener('input', () => {
  const normalized = addCallsignHyphen(transitionCallsignInput.value);
  if (normalized !== transitionCallsignInput.value.toUpperCase().replace(/\s+/g, '')) transitionCallsignInput.value = normalized;
});
document.querySelector('#transferWatchCommand').addEventListener('click', () => transferWatchCommand(
  transitionCallsignInput,
  document.querySelector('#transferWatchCommand'),
));
onDutyPicker.addEventListener('change', () => {
  if (!onDutyPicker.value) return;
  callsignInput.value = onDutyPicker.value;
  onDutyPicker.hidden = true;
  callsignInput.dispatchEvent(new Event('input', { bubbles: true }));
});
for (let count = 1; count <= 8; count += 1) {
  const option = document.createElement('option');
  option.value = String(count);
  option.textContent = String(count);
  formUnitCount.append(option);
}
formUnitCount.value = '2';
renderFormUnitMemberInputs();
formUnitCount.addEventListener('change', renderFormUnitMemberInputs);
document.querySelector('#toggleFormUnit').addEventListener('click', event => {
  formUnitPanel.hidden = !formUnitPanel.hidden;
  event.currentTarget.textContent = formUnitPanel.hidden ? 'Forming a unit with' : 'Close unit formation';
});
document.querySelector('#formUnitSector').addEventListener('change', event => {
  document.querySelector('#formUnitSpecialWrap').hidden = event.target.value !== 'Specialised';
});
formUnitSubmit.addEventListener('click', formUnitWithMembers);
for (const fieldName of Object.values(sectorFields)) {
  form.elements[fieldName].addEventListener('input', () => {
    updateAvailableChoices();
    refreshOnDutyCallsignChoices();
    renderUnitRosters();
    refreshInitialUnitOptions();
  });
}
for (const sector of Object.keys(sectorFields)) {
  const rosterId = sector === 'Specialised' ? 'specialisedUnitRoster' : `${sector.toLowerCase()}UnitRoster`;
  document.getElementById(rosterId).addEventListener('click', event => {
    const dissolveButton = event.target.closest('button[data-dissolve-unit]');
    if (dissolveButton) {
      dissolveUnit(dissolveButton);
      return;
    }
    const button = event.target.closest('button[data-callsign]');
    if (button) markAssignment10_42(button);
  });
}
form.elements.roll_call.addEventListener('input', () => {
  refreshOnDutyCallsignChoices();
  refreshRollCallSummary();
});
form.elements.start_time.addEventListener('input', refreshRollCallSummary);
document.querySelector('#formUnitSpecialWrap').hidden = document.querySelector('#formUnitSector').value !== 'Specialised';
initialCallsignInput.addEventListener('input', () => {
  clearTimeout(initialMemberLookupTimer);
  initialCallsignInput.value = addCallsignHyphen(initialCallsignInput.value);
  const callsign = initialCallsignInput.value.trim().toUpperCase();
  if (!callsign) {
    initialMemberLookup.textContent = 'Enter a callsign to look up the member name.';
    return;
  }
  if (!/^[A-Z]+-\d+$/.test(callsign)) {
    initialMemberLookup.textContent = 'Enter a complete callsign to look up the member name.';
    return;
  }
  const cachedMember = memberNameCache.get(callsign);
  if (cachedMember) {
    initialMemberLookup.textContent = `${callsign} ${cachedMember.name}`;
    return;
  }
  initialMemberLookup.textContent = 'Looking up member…';
  initialMemberLookupTimer = setTimeout(async () => {
    try {
      const member = await lookupMember(callsign);
      if (initialCallsignInput.value.trim().toUpperCase() === callsign) {
        initialMemberLookup.textContent = `${callsign} ${member.name}`;
      }
    } catch (error) {
      if (initialCallsignInput.value.trim().toUpperCase() === callsign) {
        initialMemberLookup.textContent = error.status === 404
          ? `${callsign} was not found on the roster.`
          : error.message;
      }
    }
  }, 0);
});
initialIsTraining.addEventListener('change', () => {
  document.querySelector('#initialUnitLabel').textContent = initialIsTraining.checked
    ? 'Unit number (optional for Training)'
    : 'Unit number';
  persistFormDraft();
});
initialUnitInput.addEventListener('input', () => {
  initialUnitInput.value = formatInitialUnit(initialUnitInput.value);
});
document.querySelector('#initialSector').addEventListener('change', () => {
  initialUnitInput.value = '';
  if (document.querySelector('#initialSector').value !== 'Specialised') initialAttachedUnit.value = '';
  document.querySelector('#initialSpecialWrap').hidden = document.querySelector('#initialSector').value !== 'Specialised';
  document.querySelector('#initialAttachedWrap').hidden = document.querySelector('#initialSector').value !== 'Specialised';
  refreshInitialUnitOptions();
});
document.querySelector('#initialSpecial').addEventListener('change', () => {
  initialUnitInput.value = '';
  refreshInitialUnitOptions();
});
document.querySelector('#addInitialRollCall').addEventListener('click', addInitialRollCallMember);
document.querySelector('#initialSpecialWrap').hidden = document.querySelector('#initialSector').value !== 'Specialised';
document.querySelector('#initialAttachedWrap').hidden = document.querySelector('#initialSector').value !== 'Specialised';
document.querySelector('#initialUnitLabel').textContent = initialIsTraining.checked
  ? 'Unit number (optional for Training)'
  : 'Unit number';
const callTypeSelect = document.querySelector('#callType');
const dnrTypeSelect = document.querySelector('#dnrType');
function refreshDnrFields() {
  const mascas = callTypeSelect.value === 'MASCAS';
  const diveRescue = callTypeSelect.value === 'Dive Rescue';
  const fireCall = callTypeSelect.value === 'Fire dealt with by Engine-1';
  document.querySelector('#divePerformedByWrap').hidden = !diveRescue;
  document.querySelector('#diveSuccessCountWrap').hidden = !diveRescue;
  document.querySelector('#diveFailureCountWrap').hidden = !diveRescue;
  document.querySelector('#callDetailsWrap').hidden = diveRescue;
  const dnrType = dnrTypeSelect.value;
  document.querySelector('#callDetailsLabel').textContent = mascas ? 'MASCAS number' : fireCall ? 'Fire details' : 'Call / details';
  const detailsInput = document.querySelector('#callDetails');
  detailsInput.type = mascas ? 'number' : 'text';
  detailsInput.min = mascas ? '1' : '';
  detailsInput.step = mascas ? '1' : '';
  detailsInput.placeholder = mascas ? '5' : fireCall ? 'Enter fire details' : 'Incident details';
  refreshDiveRescueUnitChoices();
  document.querySelector('#dnrPartialReason').hidden = dnrType !== 'Partial';
  document.querySelector('#dnrReasonLabel').hidden = dnrType === 'Partial';
  const subjectLabel = document.querySelector('#dnrSubjectLabel');
  subjectLabel.firstChild.textContent = dnrType === 'Localized' ? 'Place' : 'Name';
  document.querySelector('#dnrSubject').placeholder = dnrType === 'Localized' ? 'Place' : "Person's name";
}
function refreshDiveRescueUnitChoices() {
  const select = document.querySelector('#divePerformedBy');
  if (!select) return;
  const previous = select.value;
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose an active unit';
  select.append(placeholder);
  const units = [...new Set(Object.keys(sectorFields).flatMap(activeUnitsIn))]
    .filter(unit => !/(guardian|hazmat)/i.test(unit))
    .sort((a, b) => a.localeCompare(b));
  for (const unit of units) {
    const option = document.createElement('option');
    option.value = unit;
    option.textContent = unit;
    select.append(option);
  }
  if (units.includes(previous)) select.value = previous;
}
callTypeSelect.addEventListener('change', refreshDnrFields);
dnrTypeSelect.addEventListener('change', refreshDnrFields);
refreshDnrFields();
for (const [choicesId, fieldName] of [['coverageGapChoices', 'coverage_gaps'], ['safetyConcernChoices', 'safety_concerns']]) {
  const choices = document.querySelector(`#${choicesId}`);
  const field = form.elements[fieldName];
  const boxes = [...choices.querySelectorAll('input[type="checkbox"]')];
  const knownChoices = new Set(boxes.map(box => box.value));
  const syncChecksFromText = () => {
    const values = field.value.split(',').map(value => value.trim().toLowerCase());
    for (const box of boxes) box.checked = values.includes(box.value.toLowerCase());
  };
  const syncTextFromChecks = () => {
    const customValues = field.value.split(',').map(value => value.trim())
      .filter(value => value && ![...knownChoices].some(known => known.toLowerCase() === value.toLowerCase()));
    const selected = boxes.filter(box => box.checked).map(box => box.value);
    field.value = [...selected, ...customValues].join(', ');
    persistFormDraft();
  };
  choices.addEventListener('change', syncTextFromChecks);
  field.addEventListener('input', syncChecksFromText);
  syncChecksFromText();
}
function addCall(isDnr = false) {
  const time = currentWatchTime();
  const type = isDnr ? 'DNR' : document.querySelector('#callType').value;
  const details = document.querySelector('#callDetails').value.trim();
  const location = document.querySelector('#callLocation').value.trim();
  const callMessage = document.querySelector(isDnr ? '#dnrMessage' : '#callMessage');
  const diveUnit = document.querySelector('#divePerformedBy').value;
  const diveSuccessCount = Math.max(0, Number.parseInt(document.querySelector('#diveSuccessCount').value, 10) || 0);
  const diveFailureCount = Math.max(0, Number.parseInt(document.querySelector('#diveFailureCount').value, 10) || 0);
  const dnr = type === 'DNR';
  const dnrType = dnrTypeSelect.value;
  const dnrSubject = document.querySelector('#dnrSubject').value.trim();
  const dnrReason = dnrType === 'Partial' ? 'AFK/Starving' : document.querySelector('#dnrReason').value.trim();
  const dnrIssuer = document.querySelector('#dnrIssuer').value;
  const dnrDuration = document.querySelector('#dnrDuration').value;
  const dnrDurationUnit = document.querySelector('#dnrDurationUnit').value;
  if (dnr ? (!dnrSubject || !dnrReason || !dnrIssuer || (dnrDuration && Number(dnrDuration) < 1)) : (type === 'Dive Rescue' ? (!diveUnit || !Number.isInteger(diveSuccessCount) || !Number.isInteger(diveFailureCount)) : (type !== 'Fire dealt with by Engine-1' && !details || (type === 'MASCAS' && (!Number.isInteger(Number(details)) || Number(details) < 1))))) {
    setMessage(callMessage, 'Enter the call details first.', 'error');
    (dnr ? document.querySelector(!dnrSubject ? '#dnrSubject' : !dnrReason ? '#dnrReason' : !dnrIssuer ? '#dnrIssuer' : '#dnrDuration') : type === 'Dive Rescue' ? document.querySelector('#divePerformedBy') : document.querySelector('#callDetails')).focus();
    return;
  }
  if (!isDnr) rememberCallLocation(location);
  const description = dnr
    ? `DNR ${dnrType} ${dnrType === 'Localized' ? 'Place' : 'Name'}: ${dnrSubject} · Reason: ${dnrReason} · Issued by: ${dnrIssuer}${dnrDuration ? ` · Lasts for: ${dnrDuration} ${dnrDurationUnit}` : ''}`
    : type === 'MASCAS'
    ? `MASCAS X${details}${location ? ` ${location}` : ''}`
    : type === 'Dive Rescue'
    ? `Dive Rescue performed by ${diveUnit}${diveSuccessCount ? ` · Successful: ${diveSuccessCount}` : ''}${diveFailureCount ? ` · Failed: ${diveFailureCount}` : ''}`
    : type === 'Fire dealt with by Engine-1'
    ? `${type}${details ? `: ${details}` : ''}${location ? ` ${location}` : ''}`
    : `${type}: ${details}${location ? ` ${location}` : ''}`;
  const line = `${time} ${description}`;
  appendText(dnr ? 'notes' : 'significant_call', line);
  document.querySelector('#callDetails').value = '';
  document.querySelector('#callLocation').value = '';
  document.querySelector('#diveSuccessCount').value = '0';
  document.querySelector('#diveFailureCount').value = '0';
  if (dnr) {
    document.querySelector('#dnrSubject').value = '';
    document.querySelector('#dnrReason').value = '';
    document.querySelector('#dnrIssuer').value = '';
    document.querySelector('#dnrDuration').value = '';
  }
  setMessage(callMessage, `${type === 'DNR' ? 'Added to Notes' : 'Added'}: ${line}`, 'success');
  persistFormDraft();
}
document.querySelector('#addSignificantCall').addEventListener('click', () => addCall());
document.querySelector('#addDnr').addEventListener('click', () => addCall(true));
refreshInitialUnitOptions();
refreshOnDutyCallsignChoices();
renderUnitRosters();
refreshRollCallSummary();
updateAvailableChoices();
persistFormDraft();
form.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !(event.target instanceof HTMLTextAreaElement)) event.preventDefault();
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  const endTime = currentWatchTime();
  form.elements.end_time.value = endTime;
  closeAllOpenAssignments(endTime);
  renderUnitRosters();
  updateAvailableChoices();
  persistFormDraft();
  saveButton.disabled = true;
  quickButton.disabled = true;
  setMessage(message, 'Saving watch log…');
  try {
    const submittedRecord = currentRecord(true);
    const saveWatch = () => request('/api/watch-command', {
      method: 'POST', body: JSON.stringify(submittedRecord),
    });
    try {
      await saveWatch();
    } catch (error) {
      if (!error.message.includes('belongs to another user')) throw error;
      submittedRecord.draft_id = newDraftId();
      await saveWatch();
    }
    setMessage(message, 'Watch log submitted. Saving in the background.');
    const continueButton = document.createElement('button');
    continueButton.type = 'button';
    continueButton.className = 'watch-copy-button';
    continueButton.textContent = 'Edit / Continue';
    continueButton.addEventListener('click', () => continueWatchLog(submittedRecord));
    message.append(' ', continueButton);
    form.reset();
    watchTimeZonePicker.value = preferredTimeZone;
    refreshStartTimeLabel();
    sessionStorage.removeItem('watch-command-draft-id');
    sessionStorage.removeItem('watch-command-form-draft');
    newDraftId();
    form.elements.watch_date.value = localDateInputValue();
    applyLoggedInCommander();
    refreshRollCallSummary();
    document.querySelector('#specialisedUnitWrap').hidden = true;
    activityTraining.checked = false;
    activityAttachedUnit.value = '';
    document.querySelector('#activityAttachedWrap').hidden = true;
    document.querySelector('#initialSpecialWrap').hidden = true;
    formUnitPanel.hidden = true;
    document.querySelector('#toggleFormUnit').textContent = 'Forming a unit with';
    formUnitCount.value = '2';
    renderFormUnitMemberInputs();
    onDutyPicker.hidden = true;
    quickButton.textContent = 'Sign in';
    setMessage(quickMessage, '');
    initialMemberLookup.textContent = 'Enter a callsign to look up the member name.';
    persistFormDraft();
    refreshOnDutyCallsignChoices();
    renderUnitRosters();
    refreshInitialUnitOptions();
    updateAvailableChoices();
  } catch (error) {
    setMessage(message, error.message, 'error');
  } finally {
    saveButton.disabled = false;
    quickButton.disabled = false;
  }
});
document.querySelector('#clearWatchCommand').addEventListener('click', () => {
  if (!window.confirm('Clear the current unsaved Watch Command form? Saved watch logs will not be deleted.')) return;
  form.reset();
  watchTimeZonePicker.value = preferredTimeZone;
  refreshStartTimeLabel();
  sessionStorage.removeItem('watch-command-draft-id');
  sessionStorage.removeItem('watch-command-form-draft');
  newDraftId();
  form.elements.watch_date.value = localDateInputValue();
  form.elements.start_time.value = currentWatchTime();
  applyLoggedInCommander();
  initialCallsignInput.value = '';
  initialCallsignInput.dispatchEvent(new Event('input', { bubbles: true }));
  initialMemberLookup.textContent = 'Enter a callsign to look up the member name.';
  refreshRollCallSummary();
  refreshActivePresence();
  document.querySelector('#specialisedUnitWrap').hidden = true;
  activityTraining.checked = false;
  activityAttachedUnit.value = '';
  document.querySelector('#activityAttachedWrap').hidden = true;
  document.querySelector('#initialSpecialWrap').hidden = true;
  formUnitPanel.hidden = true;
  document.querySelector('#toggleFormUnit').textContent = 'Forming a unit with';
  formUnitCount.value = '2';
  renderFormUnitMemberInputs();
  onDutyPicker.hidden = true;
  quickButton.textContent = 'Sign in';
  setMessage(message, '');
  setMessage(quickMessage, '');
  setMessage(initialRollcallMessage, '');
  persistFormDraft();
  refreshOnDutyCallsignChoices();
  renderUnitRosters();
  refreshInitialUnitOptions();
  updateAvailableChoices();
});
document.querySelector('#watchLogout').addEventListener('click', () => {
  sessionStorage.removeItem('watch-command-draft-id');
  sessionStorage.removeItem('watch-command-form-draft');
  window.lvfrLogout?.();
});

request('/api/watch-command/current-user')
  .then(user => {
    loggedInCommander = {
      callsign: String(user.callsign || '').trim().toUpperCase(),
      name: String(user.name || '').trim(),
    };
    applyLoggedInCommander();
  })
  .catch(error => setMessage(quickMessage, `Could not load account name: ${error.message}`, 'error'));

loadMemberDirectory();
loadHistory();
