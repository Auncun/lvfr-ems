/**
 * LVFR EMS Google Apps Script API.
 * Deploy as a web app that executes as the spreadsheet owner. Requests must
 * use a short-lived session token in the JSON body; passwords are salted and hashed.
 * Spreadsheet IDs and role records stay in Script Properties / the private
 * Accounts sheet and are never sent to the public PWA bundle.
 * Roster mutations write directly to Sheets; the PWA applies the immediate
 * optimistic display while this request completes. No delayed job queue runs.
 */

const LVFR = Object.freeze({
  apiVersion: '2026-09-30-member-name-auth-2',
  rosterTab: 'Ranks🎖️',
  accountsTab: 'Accounts',
  watchTab: 'Watch Command Logs',
  ranks: [
    'Commissioners', 'Chief', 'County Command', 'Division Commander',
    'Captain', 'Lieutenant', 'Lead Paramedic', 'Paramedic', 'AEMT', 'EMT',
    'Probationary', 'Senior Volunteer', 'Volunteer',
    'Probationary Volunteer', 'EMR', 'EMR/Volunteer'
  ],
  ignoredCallsigns: new Set(['B-01'])
});

function doGet(e) {
  return output_({ ok: true, service: 'LVFR EMS Apps Script API', version: LVFR.apiVersion, postOnly: true });
}

function doPost(e) {
  try {
    const input = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const route = String(input.route || '');
    const params = input.params || {};
    if (route === '/api/health' && String(input.method || 'GET') === 'GET') {
      return output_({ ok: true, data: { ok: true, backend: 'Google Apps Script', version: LVFR.apiVersion } });
    }
    if (route === '/auth/signup' && String(input.method || 'GET') === 'POST') {
      return output_({ ok: true, data: signupWithPassword_(input.data || {}) });
    }
    if (route === '/auth/login' && String(input.method || 'GET') === 'POST') return output_({ ok: true, data: loginWithPassword_(input.data || {}) });
    if (route === '/auth/logout' && String(input.method || 'GET') === 'POST') { logoutSession_(input.sessionToken); return output_({ ok: true, data: { ok: true } }); }
    const method = String(input.method || 'GET');
    const user = requireUser_(input.sessionToken);
    const data = dispatch_(route, method, params, input.data || {}, user);
    if (method === 'POST' && [
      '/api/activity', '/api/note', '/api/date', '/api/training', '/api/exam',
      '/api/promote', '/api/force-promote', '/api/demote', '/api/change-rank',
      '/api/change-callsign', '/api/terminate'
    ].includes(route)) invalidateRosterCache_();
    if (method === 'POST' && /^\/api\/member\/[^/]+\/instructor$/.test(route)) invalidateRosterCache_();
    return output_({ ok: true, data });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return output_({
      ok: false,
      error: error && error.message ? error.message : 'Request failed'
    });
  }
}

function dispatch_(route, method, params, data, user) {
  if (route === '/auth/logout') return { ok: true };
  if (route === '/auth/me') return publicUser_(user);
  if (route === '/api/health') return { ok: true, backend: 'Google Apps Script' };
  if (route === '/api/config') return {
    ranks: LVFR.ranks,
    trainings: ['Basic Firefighting', 'Advanced Firefighting', 'Hert'],
    activities: ['Active', 'Semi Active', 'Inactive', 'Can Be Terminated'],
    exams: ['Supervisor Exam']
  };
  if (route === '/api/members') {
    requireLeader_(user);
    return listMembers_(String(params.search || ''));
  }
  if (route === '/api/eligible' && method === 'GET') { requireLeader_(user); return eligibleMembers_(); }
  if (route === '/api/inactive' && method === 'GET') { requireAdmin_(user); return inactiveMembers_(); }
  if (route === '/api/sync-status' && method === 'GET') { requireLeader_(user); return syncStatus_(); }
  if (route === '/api/sync' && method === 'POST') {
    requireLeader_(user);
    invalidateRosterCache_();
    return { ok: true, message: 'Google Sheet synchronized', result: { members: listMembers_('').length } };
  }
  if (route === '/api/sync/auto' && method === 'POST') { requireCommand_(user); return { ok: true, auto_enabled: Boolean(data.enabled), interval_seconds: 15 }; }
  if (route === '/api/notifications' && method === 'GET') { requireApproved_(user); return { items: [], unread_count: 0 }; }
  if (route === '/api/notifications/read' && method === 'POST') { requireApproved_(user); return { ok: true }; }
  if (route === '/api/leaders' && method === 'GET') { requireAdmin_(user); return leaderOverview_(); }
  if (route === '/api/leaders/audit' && method === 'GET') { requireAdmin_(user); return accountAudit_(); }
  const accountAction = route.match(/^\/api\/leaders\/([^/]+)\/(allow|deny|admin|demote|member|leader|deactivate|reactivate)$/);
  if (accountAction && method === 'POST') { requireAdmin_(user); return updateAccount_(decodeURIComponent(accountAction[1]), accountAction[2], user); }
  const accountDelete = route.match(/^\/api\/leaders\/([^/]+)$/);
  if (accountDelete && method === 'DELETE') { requireAdmin_(user); return updateAccount_(decodeURIComponent(accountDelete[1]), 'delete', user); }
  if (route === '/api/instructors' && method === 'GET') { requireAdmin_(user); return instructorDirectory_(); }
  if (route === '/api/members-log' && method === 'GET') { requireLeader_(user); return memberLogs_(String(params.log_type || 'promotion')); }
  if (route === '/api/promotions' && method === 'GET') { requireLeader_(user); return memberLogs_('promotion'); }
  if (route === '/api/training-log' && method === 'GET') { requireLeader_(user); return memberLogs_('training'); }
  if (route === '/api/exam-log' && method === 'GET') { requireLeader_(user); return memberLogs_('exam'); }
  if (route === '/api/termination-log' && method === 'GET') { requireAdmin_(user); return memberLogs_('termination'); }
  if (route === '/api/activity' && method === 'POST') { requireAdmin_(user); return setActivity_(data, user); }
  if (route === '/api/note' && method === 'POST') { requireLeader_(user); return editNote_(data, user); }
  if (route === '/api/date' && method === 'POST') { requireAdmin_(user); return changeRankDate_(data, user); }
  if (route === '/api/training' && method === 'POST') { requireTrainingPermission_(data.training, user); return changeTraining_(data, user); }
  if (route === '/api/exam' && method === 'POST') { requireCommand_(user); return changeExam_(data, user); }
  if (route === '/api/promote' && method === 'POST') { requireLeader_(user); return promoteMember_(data, user); }
  if (route === '/api/force-promote' && method === 'POST') { requireAdmin_(user); return changeMemberRank_(data, user, 'FORCE'); }
  if (route === '/api/demote' && method === 'POST') { requireAdmin_(user); return changeMemberRank_(data, user, 'DEMOTION'); }
  if (route === '/api/change-rank' && method === 'POST') { requireAdmin_(user); return changeMemberRank_(data, user, 'CHANGE_RANK'); }
  if (route === '/api/change-callsign' && method === 'POST') { requireLeader_(user); return changeMemberCallsign_(data, user); }
  if (route === '/api/terminate' && method === 'POST') { requireAdmin_(user); return terminateMember_(data, user); }
  const instructorRoute = route.match(/^\/api\/member\/([^/]+)\/instructor$/);
  if (instructorRoute && method === 'POST') {
    requireAdmin_(user); return changeInstructor_(decodeURIComponent(instructorRoute[1]).toUpperCase(), data, user);
  }
  if (route.startsWith('/api/member/')) {
    requireLeader_(user);
    return memberProfile_(decodeURIComponent(route.slice('/api/member/'.length)), user);
  }
  if (route === '/api/watch-command/current-user' && method === 'GET') {
    requireApproved_(user);
    const member = rosterMember_(user.callsign);
    return { callsign: user.callsign, name: member ? member.name : user.name };
  }
  if (route.startsWith('/api/watch-command/member/') && method === 'GET') {
    requireApproved_(user);
    const callsign = decodeURIComponent(route.slice('/api/watch-command/member/'.length)).trim().toUpperCase();
    const member = rosterMember_(callsign);
    if (!member) throw new Error('Callsign was not found on the synced roster.');
    return member;
  }
  if (route === '/api/watch-command' && method === 'GET') {
    requireApproved_(user);
    return listWatchLogs_();
  }
  if (route === '/api/watch-command' && method === 'POST') {
    requireApproved_(user);
    return saveWatchLog_(data, user);
  }
  throw new Error('This API operation has not yet been migrated to Apps Script: ' + route);
}

function requireUser_(sessionToken) {
  if (!sessionToken) throw new Error('Sign in with your name and password.');
  const cache = CacheService.getScriptCache();
  const key = sessionCacheKey_(sessionToken);
  const accountId = cache.get(key);
  if (!accountId) throw new Error('Your session expired. Sign in again.');
  const account = findAccountById_(accountId);
  if (!account) { cache.remove(key); throw new Error('Account not found.'); }
  return applyCurrentRosterIdentity_(account);
}

function loginWithPassword_(data) {
  const name = normalizeMemberName_(data.name), password = String(data.password || '');
  const cache = CacheService.getScriptCache();
  const throttleKey = 'login-attempts:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, name)).replace(/=+$/, '');
  const attempts = Number(cache.get(throttleKey) || 0);
  if (attempts >= 8) throw new Error('Too many sign-in attempts. Wait 10 minutes and try again.');
  const account = findAccountByName_(name);
  if (!account || !account.passwordSalt || !account.passwordHash || !constantTimeEquals_(passwordHash_(password, account.passwordSalt), account.passwordHash)) {
    cache.put(throttleKey, String(attempts + 1), 600);
    throw new Error('Incorrect name or password.');
  }
  cache.remove(throttleKey);
  if (['denied', 'removed', 'deactivated'].includes(account.status)) throw new Error('This account is inactive. Contact a Commander.');
  applyCurrentRosterIdentity_(account);
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put(sessionCacheKey_(token), account.accountId, 21600);
  return { token: token, user: publicUser_(account) };
}

function signupWithPassword_(data) {
  const requestedName = String(data.name || '').trim().replace(/\s+/g, ' '), password = String(data.password || '');
  const memberName = normalizeMemberName_(requestedName);
  const member = findRosterMemberByName_(memberName);
  if (!member) throw new Error('Name was not found on the LVFR roster. Enter your name as it appears on the roster.');
  const name = member.name, callsign = member.callsign;
  if (name.length < 2 || name.length > 48) throw new Error('Name must be between 2 and 48 characters.');
  if (!/^[A-Za-z0-9]{4,20}$/.test(password)) throw new Error('Password must be 4–20 letters or numbers.');
  const salt = Utilities.getUuid().replace(/-/g, '');
  const hash = passwordHash_(password, salt);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const { sheet, rows } = accountRows_();
    if (!sheet) throw new Error('The Accounts sheet is not configured. Contact a Commander.');
    const existing = rows.filter(row => normalizeMemberName_(row[1]) === memberName && !['removed', 'denied'].includes(String(row[5] || '').toLowerCase()));
    if (existing.length) throw new Error('An account is already linked to this member name. Contact a Commander.');
    const id = Utilities.getUuid(), now = new Date().toISOString();
    sheet.appendRow([id, name, callsign, '', '', 'pending', 'member', now, '', '', '', '', '', '', '', salt, hash]);
    SpreadsheetApp.flush();
    try { recordAccountAudit_(id, name, callsign, 'Account Requested', name); }
    catch (auditError) { console.error('Account was saved but audit logging failed: ' + auditError); }
    return { ok: true, status: 'pending', request_id: id, callsign: callsign };
  } finally { lock.releaseLock(); }
}

function normalizeMemberName_(value) { return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
function sessionCacheKey_(token) { return 'session:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token))).replace(/=+$/, ''); }
function passwordHash_(password, salt) {
  let value = String(salt) + ':' + String(password);
  for (let i = 0; i < 30000; i++) value = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value));
  return value;
}
function constantTimeEquals_(a, b) {
  a = String(a); b = String(b); let diff = a.length ^ b.length;
  for (let i = 0, n = Math.max(a.length, b.length); i < n; i++) diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ (b.charCodeAt(i % (b.length || 1)) || 0);
  return diff === 0;
}
function logoutSession_(token) { if (token) CacheService.getScriptCache().remove(sessionCacheKey_(token)); }
function findAccountById_(id) {
  const cache = CacheService.getScriptCache(), key = accountCacheKey_(id), cached = cache.get(key);
  if (cached) { try { return JSON.parse(cached); } catch (ignored) {} }
  const row = accountRows_().rows.find(item => String(item[0] || '') === String(id));
  if (!row) return null;
  const account = accountObject_(row);
  try { cache.put(key, JSON.stringify(account), 30); } catch (ignored) {}
  return account;
}
function findAccountByName_(name) {
  const rows = accountRows_().rows.filter(row => normalizeMemberName_(row[1]) === name && !['removed', 'denied'].includes(String(row[5] || '').toLowerCase()));
  if (rows.length > 1) throw new Error('More than one account matches this name. Contact a Commander.');
  if (!rows.length) return null;
  const row = rows[0];
  return { accountId: String(row[0] || ''), name: String(row[1] || ''), callsign: String(row[2] || ''), status: String(row[5] || '').toLowerCase(), role: String(row[6] || 'member').toLowerCase(), passwordSalt: String(row[15] || ''), passwordHash: String(row[16] || '') };
}
function accountCacheKey_(id) {
  return 'account-id:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(id))).replace(/=+$/, '');
}
function rosterMembersByName_() {
  const membersByName = new Map();
  listMembers_('').forEach(member => {
    const key = normalizeMemberName_(member.name);
    membersByName.set(key, membersByName.has(key) ? null : member);
  });
  return membersByName;
}
function findRosterMemberByName_(name) {
  const members = rosterMembersByName_();
  if (!members.has(name)) return null;
  if (!members.get(name)) throw new Error('More than one roster member has this name. Contact a Commander.');
  return members.get(name);
}
function applyCurrentRosterIdentity_(account) {
  const member = findRosterMemberByName_(normalizeMemberName_(account.name));
  if (!member) throw new Error('Your name was not found on the current LVFR roster. Contact a Commander.');
  account.name = member.name;
  account.callsign = member.callsign;
  return account;
}

function publicUser_(user) {
  return {
    account_id: user.accountId || user.account_id,
    id: user.accountId || user.account_id,
    name: user.name,
    callsign: user.callsign,
    role: user.role,
    status: user.status,
    is_admin: user.role === 'admin' || user.role === 'commander',
    is_command: isCommand_(user)
  };
}

function requireApproved_(user) {
  if (user.status !== 'approved' || !user.accountId) throw new Error('This LVFR account is not active. Contact a Commander.');
}

function requireLeader_(user) {
  requireApproved_(user);
  if (!['leader', 'admin', 'commander'].includes(String(user.role || '').toLowerCase())) {
    throw new Error('This LVFR account is not authorized for EMS Operations.');
  }
}

function requireAdmin_(user) {
  requireApproved_(user);
  if (!isAdmin_(user)) throw new Error('Only Commanders can perform this action.');
}

function requireCommand_(user) {
  requireApproved_(user);
  if (!isCommand_(user)) {
    throw new Error('Command rank is required for this action.');
  }
}

function requireTrainingPermission_(training, user) {
  requireApproved_(user);
  const required = String(training || '').toLowerCase() === 'hert' ? 'HERT' : 'FORT';
  if (isAdmin_(user) || instructorTypes_(user).includes(required)) return;
  throw new Error(required + ' Instructor status is required for this training.');
}

function instructorTypes_(user) {
  const member = rosterMember_(user.callsign);
  if (!member) return [];
  const records = instructorDirectory_();
  const item = records.find(row => row.name.trim().toLowerCase() === member.name.trim().toLowerCase());
  return item ? item.type.toUpperCase().split('/').map(value => value.trim()) : [];
}

function instructorDirectory_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'instructor-directory:v1';
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (ignored) {}
  }
  const spreadsheet = SpreadsheetApp.openById(requiredProperty_('LVFR_ROSTER_SPREADSHEET_ID'));
  const byName = new Map();
  const addSheet = (title, nameColumn, statusColumn, dateColumn, type) => {
    const sheet = spreadsheet.getSheetByName(title);
    if (!sheet || sheet.getLastRow() < 2) return;
    const last = Math.min(sheet.getLastRow(), 1000);
    const start = Math.min(nameColumn, dateColumn || nameColumn);
    const end = Math.max(nameColumn, statusColumn, dateColumn || nameColumn);
    const values = sheet.getRange(2, start, last - 1, end - start + 1).getDisplayValues();
    const colors = sheet.getRange(2, start, last - 1, end - start + 1).getBackgrounds();
    values.forEach((row, index) => {
      const name = String(row[nameColumn - start] || '').trim();
      const color = colors[index][statusColumn - start];
      if (!name || !isGreen_(color)) return;
      const date = dateColumn ? String(row[dateColumn - start] || '') : '';
      const key = name.toLowerCase();
      const old = byName.get(key);
      byName.set(key, { name, type: old && old.type !== type ? 'HERT / FORT' : type, date: date || (old && old.date) || '' });
    });
  };
  addSheet('HERT Certified', 2, 6, null, 'HERT');
  addSheet('FIREFIGHTER CERT', 1, 2, 4, 'FORT');
  const result = Array.from(byName.values());
  try { cache.put(cacheKey, JSON.stringify(result), 60); } catch (ignored) {}
  return result;
}

function isGreen_(color) {
  const match = String(color || '').match(/^#([0-9a-f]{6})$/i);
  if (!match) return false;
  const value = parseInt(match[1], 16);
  const red = (value >> 16) & 255, green = (value >> 8) & 255, blue = value & 255;
  return green >= 190 && red <= 51 && blue <= 51;
}

function rosterSheet_() {
  const spreadsheet = SpreadsheetApp.openById(requiredProperty_('LVFR_ROSTER_SPREADSHEET_ID'));
  return spreadsheet.getSheetByName(LVFR.rosterTab) || spreadsheet.getSheetByName('Ranks🎖️');
}

function listMembers_(search) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'roster:members:v2';
  let records;
  const cached = readRosterCache_(cache, cacheKey);
  if (cached) records = cached;
  else {
    records = readRosterMembers_();
    writeRosterCache_(cache, cacheKey, records);
  }
  const query = String(search || '').trim().toLowerCase();
  if (!query) return records;
  return records.filter(item => [item.callsign, item.name, item.rank]
    .some(value => String(value).toLowerCase().includes(query)));
}

function invalidateRosterCache_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'roster:members:v2';
  cache.remove('leader-overview:v1');
  cache.remove('leader-overview:v2');
  const index = cache.get(cacheKey);
  cache.remove(cacheKey);
  if (!index) return;
  try {
    const count = Number(JSON.parse(index).chunks || 0);
    if (count > 0 && count <= 32) {
      cache.removeAll(Array.from({ length: count }, (_, part) => cacheKey + ':' + part));
    }
  } catch (ignored) {}
}

// Apps Script CacheService rejects entries near 100 KB. Split large rosters
// so the shared roster snapshot remains usable instead of rereading Sheets on
// every API request. Store the index last so partial writes are never served.
function readRosterCache_(cache, cacheKey) {
  const index = cache.get(cacheKey);
  if (!index) return null;
  try {
    const count = Number(JSON.parse(index).chunks || 0);
    if (!count || count > 32) return null;
    const parts = cache.getAll(Array.from({ length: count }, (_, part) => cacheKey + ':' + part));
    let serialized = '';
    for (let part = 0; part < count; part++) {
      const value = parts[cacheKey + ':' + part];
      if (typeof value !== 'string') return null;
      serialized += value;
    }
    return JSON.parse(serialized);
  } catch (ignored) {
    return null;
  }
}

function writeRosterCache_(cache, cacheKey, records) {
  const serialized = JSON.stringify(records);
  const chunkSize = 20000;
  const count = Math.ceil(serialized.length / chunkSize);
  if (count > 32) return;
  try {
    for (let part = 0; part < count; part++) {
      cache.put(cacheKey + ':' + part, serialized.slice(part * chunkSize, (part + 1) * chunkSize), 60);
    }
    cache.put(cacheKey, JSON.stringify({ chunks: count }), 60);
  } catch (ignored) {
    cache.remove(cacheKey);
  }
}

function readRosterMembers_() {
  const sheet = rosterSheet_();
  if (!sheet) throw new Error('Roster sheet was not found.');
  const count = Math.max(0, sheet.getLastRow() - 1);
  if (!count) return [];
  const values = sheet.getRange(2, 1, count, 13).getDisplayValues();
  const colors = sheet.getRange(2, 1, count, 13).getBackgrounds();
  const hertByName = hertDirectory_();
  const instructorsByName = new Map(instructorDirectory_().map(item => [item.name.toLowerCase(), item]));
  const rankByCallsign = Object.create(null);
  let rank = 'Probationary';
  const records = [];
  values.forEach((row, index) => {
    const callsign = String(row[1] || '').trim().toUpperCase();
    const name = String(row[2] || '').trim();
    if (callsign && !name && LVFR.ranks.some(value => value.toLowerCase() === callsign.toLowerCase())) {
      rank = callsign;
      return;
    }
    if (!callsign && name && LVFR.ranks.some(value => value.toLowerCase() === name.toLowerCase())) {
      rank = name;
      return;
    }
    if (!callsign || !name || LVFR.ignoredCallsigns.has(callsign)) return;
    const item = {
      callsign,
      name,
      rank: rankByCallsign[callsign] || rankFromCallsign_(callsign) || rank,
      date: row[3] || '',
      rank_assigned_date: row[3] || '',
      days_in_rank: daysSince_(row[3]),
      discord_id: String(row[0] || ''),
      notes: String(row[10] || ''),
      row: index + 2,
      has_basic_firefighting: hasColor_(colors[index][6]),
      has_advanced_firefighting: hasColor_(colors[index][7]),
      has_supervisor_exam: hasColor_(colors[index][5]),
      has_hert: Boolean(hertByName.get(name.toLowerCase())),
      activity: activityFromColor_(colors[index][8]),
      instructor_type: (instructorsByName.get(name.toLowerCase()) || {}).type || ''
    };
    records.push(item);
  });
  return records.sort((a, b) => LVFR.ranks.indexOf(a.rank) - LVFR.ranks.indexOf(b.rank) || a.callsign.localeCompare(b.callsign));
}

function memberProfile_(callsign, user) {
  const member = rosterMemberFull_(callsign);
  if (!member) throw new Error('Member not found.');
  const eligibility = eligibility_(member);
  return Object.assign(member, {
    trainings: [
      ...(member.has_basic_firefighting ? ['basic_firefighting'] : []),
      ...(member.has_advanced_firefighting ? ['advanced_firefighting'] : [])
    ],
    exams: member.has_supervisor_exam ? ['supervisor_exam'] : [],
    hert: member.has_hert,
    eligible: eligibility.eligible,
    eligibility_reason: eligibility.reason,
    next_rank: eligibility.next_rank,
    instructor_type: isCommand_(user) ? member.instructor_type : '',
    instructor_date: ''
  });
}

function rosterMemberFull_(callsign) {
  return listMembers_(callsign).find(row => row.callsign.toUpperCase() === callsign.trim().toUpperCase()) || null;
}

function activityFromColor_(color) {
  const match = String(color || '').match(/^#([0-9a-f]{6})$/i);
  if (!match) return 'Active';
  const value = parseInt(match[1], 16);
  const r = ((value >> 16) & 255) / 255, g = ((value >> 8) & 255) / 255, b = (value & 255) / 255;
  if (r > .90 && g > .90 && b > .90) return 'Active';
  if (r >= .90 && g <= .10 && b <= .10) return 'Can Be Terminated';
  if (r > .80 && g > .65 && b < .35) return 'Semi Active';
  if (r > .80 && g >= .30 && g < .65 && b < .25) return 'Inactive';
  return 'Active';
}

function hertCertified_(name) {
  return Boolean(hertDirectory_().get(String(name || '').trim().toLowerCase()));
}

function hertDirectory_() {
  const map = new Map();
  const sheet = SpreadsheetApp.openById(requiredProperty_('LVFR_ROSTER_SPREADSHEET_ID')).getSheetByName('HERT Certified');
  if (!sheet || sheet.getLastRow() < 2) return map;
  const count = sheet.getLastRow() - 1;
  const rows = sheet.getRange(2, 2, count, 3).getDisplayValues();
  const colors = sheet.getRange(2, 2, count, 3).getBackgrounds();
  rows.forEach((row, index) => {
    const name = String(row[0] || '').trim();
    if (name && hasColor_(colors[index][2])) map.set(name.toLowerCase(), true);
  });
  return map;
}

function isCommand_(user) {
  if (isAdmin_(user)) return true;
  const prefix = String(user.callsign || '').trim().toUpperCase().match(/^[A-Z]+(?=-\d+\b)/);
  return ['E', 'C', 'DIV', 'B', 'CHIEF', 'COM'].includes(prefix ? prefix[0] : '');
}

function eligibility_(member) {
  const requirements = {
    'EMR': { rank: 'EMT', days: 7, trainings: [], exams: [] },
    'Probationary': { rank: 'EMT', days: 7, trainings: [], exams: [] },
    'EMT': { rank: 'AEMT', days: 14, trainings: ['basic_firefighting'], exams: [] },
    'AEMT': { rank: 'Paramedic', days: 21, trainings: ['basic_firefighting', 'advanced_firefighting'], exams: ['supervisor_exam'] },
    'Advanced EMT': { rank: 'Paramedic', days: 21, trainings: ['basic_firefighting', 'advanced_firefighting'], exams: ['supervisor_exam'] },
    'EMR/Volunteer': { rank: 'Volunteer', days: 7, trainings: [], exams: [] },
    'Probationary Volunteer': { rank: 'Volunteer', days: 7, trainings: [], exams: [] },
    'Volunteer': { rank: 'Senior Volunteer', days: 14, trainings: [], exams: [] }
  };
  const rule = requirements[member.rank];
  if (!rule || ['Probationary', 'Probationary Volunteer'].includes(member.rank)) return { eligible: false, reason: 'No automatic promotion available', next_rank: '' };
  const missing = [];
  if (Number(member.days_in_rank || 0) < rule.days) missing.push((rule.days - Number(member.days_in_rank || 0)) + ' more day(s)');
  if (rule.trainings.includes('basic_firefighting') && !member.has_basic_firefighting) missing.push('basic_firefighting');
  if (rule.trainings.includes('advanced_firefighting') && !member.has_advanced_firefighting) missing.push('advanced_firefighting');
  if (rule.exams.includes('supervisor_exam') && !member.has_supervisor_exam) missing.push('supervisor_exam');
  return { eligible: missing.length === 0, reason: missing.length ? missing.join(', ') : 'Eligible for Promotion', next_rank: rule.rank };
}

function eligibleMembers_() {
  return listMembers_('').filter(member => {
    if (['Probationary', 'Probie', 'Probationary Volunteer', 'Probie Volunteer'].includes(member.rank)) return false;
    const eligibility = eligibility_(member);
    if (!eligibility.eligible) return false;
    member.eligible = true;
    member.next_rank = eligibility.next_rank;
    member.eligibility_reason = eligibility.reason;
    return true;
  });
}

function inactiveMembers_() {
  return listMembers_('').filter(member => member.activity === 'Can Be Terminated')
    .map(({ callsign, name }) => ({ callsign, name }));
}

function syncStatus_() {
  return {
    synced_at: new Date().toISOString(), members: listMembers_('').length,
    sync_running: false, sync_last_source: 'automatic', sync_last_success: new Date().toISOString(),
    sync_error: null, auto_sync_enabled: true, auto_sync_interval_seconds: 15,
    google_write: { running: false, pending: 0, last_error: null, last_success: new Date().toISOString() },
    archive: { enabled: true, status: 'idle', pending: 0, last_error: null, last_success: new Date().toISOString() }
  };
}

const APP_LOG_TAB = 'PWA Activity Log';
const APP_LOG_HEADERS = ['id', 'kind', 'log_date', 'callsign', 'member_name', 'action', 'details', 'changed_by', 'old_rank', 'new_rank', 'old_callsign', 'new_callsign'];

function appLogSheet_(spreadsheet) {
  spreadsheet = spreadsheet || SpreadsheetApp.openById(requiredProperty_('LVFR_PRIVATE_SPREADSHEET_ID'));
  let sheet = spreadsheet.getSheetByName(APP_LOG_TAB);
  if (!sheet) sheet = spreadsheet.insertSheet(APP_LOG_TAB);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, APP_LOG_HEADERS.length).setValues([APP_LOG_HEADERS]);
  return sheet;
}

function appendAppLog_(record) {
  const sheet = appLogSheet_();
  const row = APP_LOG_HEADERS.map(key => record[key] == null ? '' : record[key]);
  row[0] = Math.max(0, sheet.getLastRow() - 1) + 1;
  row[2] = row[2] || new Date().toISOString();
  sheet.appendRow(row);
  invalidateMemberLogsCache_();
}

function memberLogs_(kind) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'member-logs:v1:' + String(kind || '').toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (ignored) {}
  }
  const result = readMemberLogs_(kind);
  const serialized = JSON.stringify(result);
  if (serialized.length < 90000) {
    try { cache.put(cacheKey, serialized, 45); } catch (ignored) {}
  }
  return result;
}

function invalidateMemberLogsCache_() {
  CacheService.getScriptCache().removeAll([
    'member-logs:v1:promotion', 'member-logs:v1:callsign', 'member-logs:v1:training',
    'member-logs:v1:exam', 'member-logs:v1:note', 'member-logs:v1:activity',
    'member-logs:v1:instructor', 'member-logs:v1:termination'
  ]);
}

function readMemberLogs_(kind) {
  // Reuse one spreadsheet handle for both logs. A cold log request should not
  // open the same private spreadsheet twice.
  const spreadsheet = SpreadsheetApp.openById(requiredProperty_('LVFR_PRIVATE_SPREADSHEET_ID'));
  const sheet = appLogSheet_(spreadsheet);
  const lastRow = sheet.getLastRow();
  const rowCount = Math.min(Math.max(0, lastRow - 1), 2000);
  const rows = rowCount ? sheet.getRange(lastRow - rowCount + 1, 1, rowCount, APP_LOG_HEADERS.length).getDisplayValues() : [];
  const aliases = { promotion: ['promotion'], callsign: ['callsign'], training: ['training'], exam: ['exam'], note: ['note'], activity: ['activity'], instructor: ['instructor'], termination: ['termination'] };
  const allowed = aliases[kind] || [];
  const current = rows.filter(row => allowed.includes(String(row[1]).toLowerCase())).map(row => {
    const record = Object.fromEntries(APP_LOG_HEADERS.map((key, index) => [key, row[index]]));
    if (kind === 'training') record.training_name = record.details;
    if (kind === 'exam') record.exam_name = record.details;
    if (kind === 'note') record.note = record.details;
    if (kind === 'activity') {
      const parts = String(record.details || '').split(' -> ');
      record.old_status = parts[0] || '';
      record.new_status = parts[1] || '';
      record.changed_at = record.log_date;
    }
    if (kind === 'instructor') {
      record.instructor_type = record.details;
      record.log_date = record.log_date;
    }
    if (kind === 'termination') record.termination_date = record.log_date;
    if (kind === 'promotion' || kind === 'callsign') {
      record.promoted_by = record.changed_by;
      record.promo_date = record.log_date;
    }
    return record;
  });
  const archive = spreadsheet.getSheetByName('Logs');
  if (!archive || archive.getLastRow() < 2) return current.slice(-200).reverse();
  const archiveLastRow = archive.getLastRow();
  const archiveColumns = Math.min(11, archive.getLastColumn());
  const historical = [];
  // Read backward in batches. Most log types find their latest 200 entries
  // near the end of the archive, avoiding a 5,000-row scan on every cold load.
  // Continue farther back when a type is rare so older history remains visible.
  const batchSize = 500;
  for (let endRow = archiveLastRow; endRow >= 2 && historical.length < 200; endRow -= batchSize) {
    const startRow = Math.max(2, endRow - batchSize + 1);
    const oldRows = archive.getRange(startRow, 1, endRow - startRow + 1, archiveColumns).getDisplayValues();
    for (let i = oldRows.length - 1; i >= 0; i--) {
      const row = oldRows[i];
      const event = String(row[1] || ''), lower = event.toLowerCase();
      const category = lower.includes('terminat') ? 'termination'
      : lower.includes('training') || lower.includes('hert') ? 'training'
      : lower.includes('exam') ? 'exam'
      : lower.includes('note') ? 'note'
      : lower.includes('activity') ? 'activity'
      : lower.includes('instructor') ? 'instructor'
      : lower.includes('callsign') || lower.includes('promot') || lower.includes('demot') || lower.includes('rank') ? (lower.includes('callsign') ? 'callsign' : 'promotion')
      : '';
      if (category !== kind) continue;
      historical.push({
      id: 'archive-' + row[0], log_date: row[0], created_at: row[0], event,
      member_name: row[2], callsign: row[3], old_callsign: row[4], new_callsign: row[5],
      old_rank: row[6], new_rank: row[7], details: row[8], promoted_by: row[9], changed_by: row[9],
      actor_callsign: row[10], promo_date: row[0], termination_date: row[0],
      training_name: row[8], exam_name: row[8], note: row[8], action: event
      });
      if (historical.length >= 200) break;
    }
  }
  return [...historical, ...current].sort((a, b) => String(b.log_date || '').localeCompare(String(a.log_date || ''))).slice(0, 200);
}

function memberByCallsign_(callsign) {
  const cs = String(callsign || '').trim().toUpperCase();
  const member = rosterMemberFull_(cs);
  if (!member || LVFR.ignoredCallsigns.has(cs)) throw new Error('Member not found.');
  return member;
}

function setActivity_(data, user) {
  const member = memberByCallsign_(data.callsign);
  const activity = String(data.activity || '').trim();
  const colors = { 'Active': '#ffffff', 'Semi Active': '#ffff33', 'Inactive': '#ff8000', 'Can Be Terminated': '#ff0000' };
  if (!colors[activity]) throw new Error('Invalid activity status.');
  if (member.activity === activity) return { ok: false, changed: false, status: 'already_current', message: 'Already ' + activity };
  rosterSheet_().getRange(member.row, 9).setBackground(colors[activity]);
  appendAppLog_({ kind: 'activity', callsign: member.callsign, member_name: member.name, action: 'Activity Changed', details: member.activity + ' -> ' + activity, changed_by: actorName_(user) });
  return { ok: true, changed: true, status: 'changed', message: 'Activity changed to ' + activity };
}

function editNote_(data, user) {
  const member = memberByCallsign_(data.callsign);
  const action = String(data.action || '').trim();
  const entered = String(data.note || '').trim();
  let next = member.notes || '';
  if (action === 'Add') {
    if (next) throw new Error('This member already has a note. Choose Edit or Delete.');
    if (!entered) throw new Error('Enter a note before adding it.');
    next = entered;
  } else if (action === 'Edit') {
    if (!next) throw new Error('This member has no note to edit. Choose Add.');
    if (!entered) throw new Error('A note cannot be empty. Choose Delete to remove it.');
    next = entered;
  } else if (action === 'Delete') {
    if (!next) throw new Error('This member has no note to delete.');
    next = '';
  } else throw new Error('Invalid note action.');
  rosterSheet_().getRange(member.row, 11).setValue(next);
  appendAppLog_({ kind: 'note', callsign: member.callsign, member_name: member.name, action: action.toUpperCase(), details: next || 'Deleted', changed_by: actorName_(user) });
  return { ok: true, note: next };
}

function changeRankDate_(data, user) {
  const member = memberByCallsign_(data.callsign);
  const raw = String(data.date_str || '').trim();
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) throw new Error('Enter a date in MM/DD/YYYY format.');
  const date = new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
  if (date.getFullYear() !== Number(match[3]) || date.getMonth() !== Number(match[1]) - 1 || date.getDate() !== Number(match[2])) throw new Error('Enter a valid date.');
  rosterSheet_().getRange(member.row, 4).setValue(date);
  appendAppLog_({ kind: 'date', callsign: member.callsign, member_name: member.name, action: 'Rank Date Changed', details: raw, changed_by: actorName_(user) });
  return { ok: true };
}

function nextEmptyCallsign_(rank) {
  const prefixes = {
    'Commissioners': 'COM', 'Chief': 'CHIEF', 'County Command': 'B', 'Division Commander': 'DIV',
    'Captain': 'C', 'Lieutenant': 'E', 'Lead Paramedic': 'L', 'Paramedic': 'M',
    'AEMT': 'A', 'Advanced EMT': 'A', 'EMT': 'R', 'Probationary': 'P', 'EMR': 'P',
    'Senior Volunteer': 'S', 'Volunteer': 'V', 'Probationary Volunteer': 'V', 'EMR/Volunteer': 'P'
  };
  const prefix = prefixes[rank];
  if (!prefix) throw new Error('Unknown rank: ' + rank);
  const sheet = rosterSheet_(), count = Math.max(0, sheet.getLastRow() - 1);
  const rows = count ? sheet.getRange(2, 2, count, 2).getDisplayValues() : [];
  const candidates = rows.map((row, i) => ({ callsign: String(row[0] || '').trim().toUpperCase(), name: String(row[1] || '').trim(), row: i + 2 }))
    .filter(item => item.callsign.startsWith(prefix + '-') && !item.name && rankFromCallsign_(item.callsign) === (rank === 'Advanced EMT' ? 'AEMT' : rank))
    .map(item => ({ ...item, number: Number(item.callsign.slice(prefix.length + 1)) }))
    .filter(item => Number.isFinite(item.number))
    .sort((a, b) => a.number - b.number);
  if (!candidates.length) throw new Error('No existing empty callsign available for rank ' + rank);
  return candidates[0];
}

function rankLevel_(rank) {
  const levels = {
    'Probationary Volunteer': 1, 'Probie Volunteer': 1, 'Probationary': 1, 'Probie': 1, 'EMR': 1,
    'Volunteer': 2, 'Senior Volunteer': 3, 'EMT': 4, 'AEMT': 5, 'Advanced EMT': 5,
    'Paramedic': 6, 'Lead Paramedic': 7, 'Lieutenant': 8, 'Captain': 9,
    'Division Commander': 10, 'County Command': 11, 'Chief': 12, 'Commissioners': 13, 'EMR/Volunteer': 1
  };
  return levels[String(rank || '').trim()];
}

function promoteMember_(data, user) {
  const old = memberByCallsign_(data.callsign);
  if (!isAdmin_(user) && old.rank.toLowerCase() !== 'emt') throw new Error('Leaders may only promote EMT members to AEMT.');
  const eligibility = eligibility_(old);
  if (!eligibility.eligible) throw new Error(eligibility.reason);
  if (!isAdmin_(user) && eligibility.next_rank.toLowerCase() !== 'aemt') throw new Error('Leaders may only promote EMT members to AEMT.');
  const target = nextEmptyCallsign_(eligibility.next_rank);
  moveMember_(old, target, eligibility.next_rank, user, 'NORMAL');
  return { ok: true, new_callsign: target.callsign, new_rank: eligibility.next_rank };
}

function changeMemberRank_(data, user, operation) {
  const old = memberByCallsign_(data.callsign);
  const rank = String(data.new_rank || '').trim();
  if (!rank || !LVFR.ranks.includes(rank)) throw new Error('Choose a valid rank.');
  const oldLevel = rankLevel_(old.rank), newLevel = rankLevel_(rank);
  if (operation === 'FORCE' && !(newLevel > oldLevel)) throw new Error('You can only promote to a higher rank.');
  if (operation === 'DEMOTION' && !(newLevel < oldLevel)) throw new Error('You can only demote to a lower rank.');
  if (operation === 'CHANGE_RANK' && ![
    'AEMT|Senior Volunteer', 'EMT|Volunteer', 'Senior Volunteer|AEMT', 'Volunteer|EMT'
  ].includes(old.rank + '|' + rank)) throw new Error('Rank transition is not allowed.');
  const target = nextEmptyCallsign_(rank);
  moveMember_(old, target, rank, user, operation);
  return { ok: true, new_callsign: target.callsign, new_rank: rank };
}

function changeMemberCallsign_(data, user) {
  const old = memberByCallsign_(data.callsign);
  const next = String(data.new_callsign || '').trim().toUpperCase();
  if (!next || next === old.callsign || LVFR.ignoredCallsigns.has(next)) throw new Error('Enter a different valid Callsign.');
  const rank = rankFromCallsign_(next);
  if (!isAdmin_(user) && (data.force || rank !== old.rank)) throw new Error('Leaders may only change a Callsign while keeping the member’s current rank.');
  if (isAdmin_(user) && rank && rank !== old.rank && !data.force) throw new Error('The Callsign belongs to a different rank. Confirm a rank change first.');
  const target = emptyRowForCallsign_(next);
  moveMember_(old, target, isAdmin_(user) && rank ? rank : old.rank, user, 'CALLSIGN_CHANGE');
  return { ok: true, new_callsign: target.callsign, new_rank: isAdmin_(user) && rank ? rank : old.rank };
}

function emptyRowForCallsign_(callsign) {
  const sheet = rosterSheet_(), count = Math.max(0, sheet.getLastRow() - 1);
  const rows = count ? sheet.getRange(2, 2, count, 2).getDisplayValues() : [];
  const index = rows.findIndex(row => String(row[0] || '').trim().toUpperCase() === callsign && !String(row[1] || '').trim());
  if (index < 0) {
    if (rows.some(row => String(row[0] || '').trim().toUpperCase() === callsign && String(row[1] || '').trim())) throw new Error('That Callsign is already assigned.');
    throw new Error('That Callsign is not an existing empty roster slot.');
  }
  return { callsign, row: index + 2 };
}

function moveMember_(member, target, newRank, user, operation) {
  if (member.row === target.row) throw new Error('Old and new Callsign point to the same roster row.');
  const sheet = rosterSheet_();
  const sourceValues = sheet.getRange(member.row, 2, 1, 12).getDisplayValues()[0];
  const oldRank = member.rank, oldCallsign = member.callsign;
  sheet.getRange(member.row, 6, 1, 4).copyTo(sheet.getRange(target.row, 6, 1, 4), { formatOnly: true });
  const seniorRank = rankLevel_(newRank) <= rankLevel_('Lead Paramedic');
  const destination = [...sourceValues.slice(0, 8)];
  destination[0] = target.callsign;
  destination[1] = member.name;
  destination[2] = seniorRank ? '' : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy');
  destination[3] = seniorRank ? '' : '=TODAY()-D' + target.row;
  sheet.getRange(target.row, 2, 1, 8).setValues([destination]);
  sheet.getRange(target.row, 11, 1, 3).setValues([[...sourceValues.slice(9, 12)]]);
  sheet.getRange(member.row, 3, 1, 7).clearContent().setBackground('#ffffff');
  sheet.getRange(member.row, 11, 1, 3).clearContent().setBackground('#ffffff');
  sheet.getRange(member.row, 2).setValue(oldCallsign);
  const event = operation === 'DEMOTION' ? 'Demoted' : operation === 'CALLSIGN_CHANGE' ? 'Callsign Changed' : operation === 'CHANGE_RANK' ? 'Rank Changed' : 'Promoted';
  const timestamp = new Date().toISOString();
  appendArchiveLog_({ timestamp, event, member: member.name, callsign: target.callsign, old_callsign: oldCallsign, new_callsign: target.callsign, old_rank: oldRank, new_rank: newRank, details: '', actor: actorName_(user), actor_callsign: user.callsign });
  appendAppLog_({ kind: operation === 'CALLSIGN_CHANGE' ? 'callsign' : 'promotion', log_date: timestamp, callsign: target.callsign, member_name: member.name, action: event, details: operation, changed_by: actorName_(user), old_rank: oldRank, new_rank: newRank, old_callsign: oldCallsign, new_callsign: target.callsign });
}

function appendArchiveLog_(entry) {
  const spreadsheet = SpreadsheetApp.openById(requiredProperty_('LVFR_PRIVATE_SPREADSHEET_ID'));
  let sheet = spreadsheet.getSheetByName('Logs');
  const headers = ['Timestamp', 'Event', 'Member', 'Callsign', 'Old Callsign', 'New Callsign', 'Old Rank', 'New Rank', 'Details', 'Performed By', 'Actor Callsign'];
  if (!sheet) sheet = spreadsheet.insertSheet('Logs');
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.appendRow([entry.timestamp, entry.event, entry.member, entry.callsign, entry.old_callsign, entry.new_callsign, entry.old_rank, entry.new_rank, entry.details, entry.actor, entry.actor_callsign]);
}

function terminateMember_(data, user) {
  const member = memberByCallsign_(data.callsign), sheet = rosterSheet_();
  sheet.getRange(member.row, 3, 1, 7).clearContent().setBackground('#ffffff');
  sheet.getRange(member.row, 4).setValue(new Date());
  sheet.getRange(member.row, 11, 1, 3).clearContent().setBackground('#ffffff');
  const timestamp = new Date().toISOString(), reason = String(data.note || '');
  appendArchiveLog_({ timestamp, event: 'Terminated', member: member.name, callsign: member.callsign, old_callsign: '', new_callsign: '', old_rank: member.rank, new_rank: '', details: reason, actor: actorName_(user), actor_callsign: user.callsign });
  appendAppLog_({ kind: 'termination', log_date: timestamp, callsign: member.callsign, member_name: member.name, action: 'Terminated', details: reason, changed_by: actorName_(user), old_rank: member.rank });
  return { ok: true };
}

function changeTraining_(data, user) {
  const member = memberByCallsign_(data.callsign);
  const training = String(data.training || '').trim();
  const remove = Boolean(data.remove);
  if (training === 'Hert') {
    const sheet = SpreadsheetApp.openById(requiredProperty_('LVFR_ROSTER_SPREADSHEET_ID')).getSheetByName('HERT Certified');
    if (!sheet) throw new Error('HERT Certified sheet was not found.');
    const last = Math.max(sheet.getLastRow(), 2);
    const values = sheet.getRange(2, 2, last - 1, 1).getDisplayValues();
    let index = values.findIndex(row => row[0].trim().toLowerCase() === member.name.toLowerCase());
    if (index < 0 && !remove) {
      index = values.findIndex(row => !row[0].trim());
      if (index < 0) throw new Error('No empty HERT row available.');
      sheet.getRange(index + 2, 2).setValue(member.name);
    }
    if (index < 0) return { ok: false, changed: false, status: 'already_removed', message: 'Training already removed' };
    const cell = sheet.getRange(index + 2, 4);
    const already = hasColor_(cell.getBackground());
    if (already === !remove) return { ok: false, changed: false, status: remove ? 'already_removed' : 'already_certified', message: remove ? 'Training already removed' : 'Already certified' };
    cell.setBackground(remove ? '#ffffff' : '#00ff00');
  } else {
    const columns = { 'Basic Firefighting': [7, '#9900ff'], 'Advanced Firefighting': [8, '#990000'] };
    if (!columns[training]) throw new Error('Unknown training: ' + training);
    const [column, color] = columns[training];
    const cell = rosterSheet_().getRange(member.row, column);
    const already = hasColor_(cell.getBackground());
    if (already === !remove) return { ok: false, changed: false, status: remove ? 'already_removed' : 'already_completed', message: remove ? 'Training already removed' : 'Already certified' };
    cell.setBackground(remove ? '#ffffff' : color);
  }
  appendAppLog_({ kind: 'training', callsign: member.callsign, member_name: member.name, training_name: training, action: remove ? 'REMOVED' : 'ADDED', details: training, changed_by: actorName_(user) });
  return { ok: true, changed: true, result: [true, remove ? 'removed' : 'added'], status: remove ? 'removed' : 'added', message: remove ? 'Training removed' : 'Training added' };
}

function changeExam_(data, user) {
  const member = memberByCallsign_(data.callsign);
  const cell = rosterSheet_().getRange(member.row, 6);
  const remove = Boolean(data.remove), exists = hasColor_(cell.getBackground());
  if (remove === !exists) return { ok: false, changed: false, status: remove ? 'already_removed' : 'already_passed', message: remove ? 'Exam already removed' : 'Already passed the exam' };
  cell.setBackground(remove ? '#ffffff' : '#00ffff');
  appendAppLog_({ kind: 'exam', callsign: member.callsign, member_name: member.name, exam_name: 'Supervisor Exam', action: remove ? 'REMOVED' : 'ADDED', details: 'Supervisor Exam', changed_by: actorName_(user) });
  return { ok: true, changed: true, result: [true, remove ? 'removed' : 'added'], status: remove ? 'removed' : 'added', message: remove ? 'Exam removed' : 'Exam added' };
}

function changeInstructor_(callsign, data, user) {
  const member = memberByCallsign_(callsign);
  const type = String(data.instructor_type || '').trim().toUpperCase();
  const assigned = Boolean(data.assigned);
  if (!['HERT', 'FORT'].includes(type)) throw new Error('Choose HERT or FORT.');
  const spreadsheet = SpreadsheetApp.openById(requiredProperty_('LVFR_ROSTER_SPREADSHEET_ID'));
  const title = type === 'HERT' ? 'HERT Certified' : 'FIREFIGHTER CERT';
  const nameColumn = type === 'HERT' ? 2 : 1;
  const statusColumn = type === 'HERT' ? 6 : 2;
  const sheet = spreadsheet.getSheetByName(title);
  if (!sheet) throw new Error(title + ' sheet was not found.');
  const last = Math.max(sheet.getLastRow(), 2);
  const names = sheet.getRange(2, nameColumn, last - 1, 1).getDisplayValues();
  let index = names.findIndex(row => row[0].trim().toLowerCase() === member.name.toLowerCase());
  if (index < 0 && assigned) {
    index = names.findIndex(row => !row[0].trim());
    if (index < 0) { index = names.length; sheet.insertRowAfter(last); }
    sheet.getRange(index + 2, nameColumn).setValue(member.name);
  }
  if (index < 0) return { ok: true, changed: false, assigned, instructor_type: type, status: 'unchanged' };
  const cell = sheet.getRange(index + 2, statusColumn);
  const current = isGreen_(cell.getBackground());
  if (current !== assigned) {
    cell.setBackground(assigned ? '#00ff00' : '#ffffff');
    CacheService.getScriptCache().remove('instructor-directory:v1');
    if (type === 'FORT') sheet.getRange(index + 2, 4).setValue(assigned ? new Date() : '');
    appendAppLog_({ kind: 'instructor', callsign: member.callsign, member_name: member.name, action: type + (assigned ? ' Instructor Assigned' : ' Instructor Removed'), details: type, changed_by: actorName_(user) });
  }
  return { ok: true, changed: current !== assigned, assigned, instructor_type: type, status: current !== assigned ? 'queued' : 'unchanged' };
}

function actorName_(user) { return user.name || user.accountId || 'LVFR user'; }

function accountRows_() {
  const sheet = SpreadsheetApp.openById(requiredProperty_('LVFR_PRIVATE_SPREADSHEET_ID')).getSheetByName(LVFR.accountsTab);
  if (!sheet || sheet.getLastRow() < 2) return { sheet, rows: [] };
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(17, sheet.getLastColumn())).getDisplayValues();
  return { sheet, rows };
}

function accountObject_(row, membersByName) {
  const isAdmin = ['admin', 'commander'].includes(String(row[6] || '').toLowerCase());
  const name = String(row[1] || '');
  const currentMember = membersByName && membersByName.get(normalizeMemberName_(name));
  return {
    accountId: String(row[0] || ''),
    account_id: String(row[0] || ''), name, display_name: name,
    callsign: currentMember ? currentMember.callsign : String(row[2] || ''), status: String(row[5] || '').toLowerCase(),
    role: String(row[6] || 'leader').toLowerCase(), is_admin: isAdmin,
    created_at: String(row[7] || ''), requested_at: String(row[7] || ''), linked_at: String(row[7] || ''),
    activated_at: String(row[8] || ''), approved_at: String(row[8] || ''), approved_by: String(row[9] || ''),
    admin_changed_at: String(row[10] || ''), admin_changed_by: String(row[11] || '')
  };
}

function leaderOverview_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'leader-overview:v2';
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (ignored) {}
  }
  const membersByName = rosterMembersByName_();
  const accounts = accountRows_().rows.map(row => accountObject_(row, membersByName));
  const result = {
    approved: accounts.filter(row => row.status === 'approved'),
    pending: accounts.filter(row => row.status === 'pending'),
    deactivated: accounts.filter(row => row.status === 'deactivated'),
    audit: accountAudit_()
  };
  try { cache.put(cacheKey, JSON.stringify(result), 30); } catch (ignored) {}
  return result;
}

function accountAudit_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'account-audit:v1';
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (ignored) {}
  }
  const sheet = SpreadsheetApp.openById(requiredProperty_('LVFR_PRIVATE_SPREADSHEET_ID')).getSheetByName('Account Audit');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const lastRow = sheet.getLastRow();
  const count = Math.min(lastRow - 1, 200);
  const result = sheet.getRange(lastRow - count + 1, 1, count, 6).getDisplayValues().reverse().map(row => ({
    created_at: row[0], account_id: row[1], name: row[2], callsign: row[3], action: row[4], actor_name: row[5], by: row[5]
  }));
  try { cache.put(cacheKey, JSON.stringify(result), 45); } catch (ignored) {}
  return result;
}

function updateAccount_(accountId, action, actor) {
  if (String(actor.accountId) === String(accountId) && ['demote', 'member', 'deactivate', 'delete'].includes(action)) throw new Error('You cannot remove or restrict your own account.');
  const { sheet, rows } = accountRows_();
  const index = rows.findIndex(row => String(row[0]) === String(accountId));
  if (index < 0) throw new Error('Account not found.');
  const rowNumber = index + 2, row = rows[index];
  let status = String(row[5] || '').toLowerCase(), role = String(row[6] || 'leader').toLowerCase();
  const now = new Date().toISOString(), actorName = actorName_(actor), name = row[1] || '', callsign = row[2] || '';
  switch (action) {
    case 'allow':
      if (status !== 'pending') throw new Error('Account is not pending.');
      status = 'approved'; role = 'member';
      sheet.getRange(rowNumber, 6, 1, 5).setValues([[status, role, row[7], now, actorName]]);
      break;
    case 'deny':
      if (status !== 'pending') throw new Error('Account is not pending.');
      sheet.getRange(rowNumber, 6).setValue('denied'); status = 'denied';
      break;
    case 'admin':
      if (status !== 'approved') throw new Error('Activate the account first.');
      sheet.getRange(rowNumber, 7).setValue('admin'); role = 'admin';
      sheet.getRange(rowNumber, 11, 1, 2).setValues([[now, actorName]]);
      break;
    case 'demote':
      if (role !== 'admin' && role !== 'commander') throw new Error('Account is not a Commander.');
      sheet.getRange(rowNumber, 7).setValue('leader'); role = 'leader';
      sheet.getRange(rowNumber, 11, 1, 2).setValues([[now, actorName]]);
      break;
    case 'member':
      if (status !== 'approved') throw new Error('Activate the account first.');
      if (isAdmin_({ role })) throw new Error('Remove Commander access before changing this role.');
      sheet.getRange(rowNumber, 7).setValue('member'); role = 'member';
      sheet.getRange(rowNumber, 11, 1, 2).setValues([[now, actorName]]);
      break;
    case 'leader':
      if (status !== 'approved' || role !== 'member') throw new Error('Only an approved Member can become a Leader.');
      sheet.getRange(rowNumber, 7).setValue('leader'); role = 'leader';
      sheet.getRange(rowNumber, 11, 1, 2).setValues([[now, actorName]]);
      break;
    case 'deactivate':
      if (status !== 'approved' || isAdmin_({ role })) throw new Error('Remove Commander access first; only active accounts can be deactivated.');
      sheet.getRange(rowNumber, 6).setValue('deactivated'); status = 'deactivated';
      sheet.getRange(rowNumber, 11, 1, 2).setValues([[now, actorName]]);
      break;
    case 'reactivate':
      if (status !== 'deactivated') throw new Error('Account is not deactivated.');
      sheet.getRange(rowNumber, 6).setValue('approved'); status = 'approved';
      sheet.getRange(rowNumber, 9, 1, 3).setValues([[now, actorName, now]]);
      break;
    case 'delete':
      if (isAdmin_({ role })) throw new Error('Remove Commander access before deleting the account.');
      sheet.getRange(rowNumber, 6).setValue('removed'); status = 'removed';
      break;
    default: throw new Error('Unknown account action.');
  }
  recordAccountAudit_(accountId, name, callsign, action, actorName);
  CacheService.getScriptCache().remove(accountCacheKey_(accountId));
  return { ok: true, status: 'saving' };
}

function recordAccountAudit_(accountId, name, callsign, action, actorName) {
  const spreadsheet = SpreadsheetApp.openById(requiredProperty_('LVFR_PRIVATE_SPREADSHEET_ID'));
  let sheet = spreadsheet.getSheetByName('Account Audit');
  if (!sheet) sheet = spreadsheet.insertSheet('Account Audit');
  if (sheet.getLastRow() === 0) sheet.appendRow(['Timestamp', 'Account ID', 'Name', 'Callsign', 'Action', 'By']);
  sheet.appendRow([new Date().toISOString(), accountId, name, callsign, action, actorName]);
  CacheService.getScriptCache().removeAll(['leader-overview:v2', 'account-audit:v1']);
}

function rosterMember_(callsign) {
  const normalized = String(callsign || '').trim().toUpperCase();
  if (!normalized) return null;
  const rows = listMembers_(normalized);
  const member = rows.find(item => item.callsign === normalized);
  return member ? { callsign: member.callsign, name: member.name, rank: member.rank } : null;
}

const WATCH_FIELDS = [
  'watch_date', 'watch_commander', 'roll_call', 'start_time', 'end_time',
  'red_sector', 'green_sector', 'blue_sector', 'specialised_units', 'notes',
  'significant_call', 'coverage_gaps', 'watch_transition', 'safety_concerns'
];
const WATCH_HEADERS = ['id', 'draft_id', 'finalized', 'created_at', ...WATCH_FIELDS, 'created_by'];

function watchSheet_() {
  const spreadsheet = SpreadsheetApp.openById(requiredProperty_('LVFR_PRIVATE_SPREADSHEET_ID'));
  let sheet = spreadsheet.getSheetByName(LVFR.watchTab);
  if (!sheet) sheet = spreadsheet.insertSheet(LVFR.watchTab);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, WATCH_HEADERS.length).setValues([WATCH_HEADERS]);
  return sheet;
}

function listWatchLogs_() {
  const sheet = watchSheet_();
  if (sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, WATCH_HEADERS.length).getValues();
  const accounts = accountsForRollCall_();
  return rows.slice(-100).reverse().map(values => {
    const record = Object.fromEntries(WATCH_HEADERS.map((key, index) => [key, values[index]]));
    record.id = Number(record.id);
    record.finalized = Boolean(record.finalized);
    record.linked_accounts = linkedWatchAccounts_(record.roll_call, accounts);
    return record;
  });
}

function saveWatchLog_(input, user) {
  const record = {};
  WATCH_FIELDS.forEach(key => { record[key] = String(input[key] || '').trim(); });
  record.draft_id = String(input.draft_id || '').trim();
  record.finalized = Boolean(input.finalized);
  if (!record.watch_date || !/^\d{4}-\d{2}-\d{2}$/.test(record.watch_date) || isNaN(Date.parse(record.watch_date))) throw new Error('Select a valid watch date.');
  if (!record.watch_commander || record.watch_commander.length > 120) throw new Error('Enter a Watch Commander (120 characters or fewer).');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(record.start_time)) throw new Error('Enter a start time in 24-hour HH:MM format.');
  if (record.finalized && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(record.end_time)) throw new Error('Enter an end time in 24-hour HH:MM format.');
  if (record.end_time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(record.end_time)) throw new Error('End time must use 24-hour HH:MM format.');
  Object.keys(record).forEach(key => { if (typeof record[key] === 'string' && record[key].length > 5000) throw new Error('Each field must be 5,000 characters or fewer.'); });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = watchSheet_();
    let targetRow = 0;
    if (record.draft_id && sheet.getLastRow() >= 2) {
      const drafts = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getDisplayValues().flat();
      const index = drafts.indexOf(record.draft_id);
      if (index >= 0) targetRow = index + 2;
    }
    const now = new Date().toISOString();
    let id;
    let createdAt = now;
    if (targetRow) {
      const existing = sheet.getRange(targetRow, 1, 1, WATCH_HEADERS.length).getValues()[0];
      id = existing[0];
      createdAt = existing[3] || now;
      if (String(existing[WATCH_HEADERS.length - 1] || '') !== user.accountId && !isAdmin_(user)) throw new Error('This watch log belongs to another user.');
    } else {
      id = Math.max(0, sheet.getLastRow() - 1) + 1;
      targetRow = sheet.getLastRow() + 1;
    }
    const row = [id, record.draft_id, record.finalized, createdAt, ...WATCH_FIELDS.map(key => record[key]), user.accountId];
    sheet.getRange(targetRow, 1, 1, WATCH_HEADERS.length).setValues([row]);
    return Object.fromEntries(WATCH_HEADERS.map((key, index) => [key, row[index]]));
  } finally {
    lock.releaseLock();
  }
}

function accountsForRollCall_() {
  const sheet = SpreadsheetApp.openById(requiredProperty_('LVFR_PRIVATE_SPREADSHEET_ID')).getSheetByName(LVFR.accountsTab);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const membersByName = rosterMembersByName_();
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(17, sheet.getLastColumn())).getDisplayValues().map(row => {
    const member = membersByName.get(normalizeMemberName_(row[1]));
    return {
      accountId: String(row[0] || ''), name: String(row[1] || ''),
      callsign: member ? member.callsign : String(row[2] || '').trim().toUpperCase(),
      status: String(row[5] || '').toLowerCase(), role: String(row[6] || 'leader').toLowerCase()
    };
  });
}

function linkedWatchAccounts_(rollCall, accounts) {
  const matches = String(rollCall || '').matchAll(/\b([A-Z]+-\d+)\b/gi);
  const seen = new Set();
  const byCallsign = new Map(accounts.filter(row => row.status !== 'removed' && row.status !== 'denied').map(row => [row.callsign, row]));
  const result = [];
  for (const match of matches) {
    const callsign = match[1].toUpperCase();
    if (seen.has(callsign)) continue;
    seen.add(callsign);
    const account = byCallsign.get(callsign);
    if (!account) continue;
    result.push({ callsign, account_name: account.name, role: account.role === 'member' ? 'Member' : (isAdmin_(account) ? 'Commander' : 'Leader') });
  }
  return result;
}

function isAdmin_(user) { return ['admin', 'commander'].includes(String(user.role || '').toLowerCase()); }

function hasColor_(background) {
  const color = String(background || '').toLowerCase();
  return !['#ffffff', '#fff', '#000000', '#000'].includes(color);
}

function rankFromCallsign_(callsign) {
  const prefix = callsign.match(/^[A-Z]+/);
  if (!prefix) return '';
  if (prefix[0] === 'V') {
    const number = Number(String(callsign).split('-', 2)[1]);
    const probationary = [1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 21, 22, 23, 24, 25, 26, 27, 28, 29, 36, 37, 38, 39, 40];
    return probationary.includes(number) ? 'Probationary Volunteer' : 'Volunteer';
  }
  const map = { COM: 'Commissioners', CHIEF: 'Chief', B: 'County Command', DIV: 'Division Commander', C: 'Captain', E: 'Lieutenant', L: 'Lead Paramedic', M: 'Paramedic', A: 'AEMT', R: 'EMT', P: 'Probationary', S: 'Senior Volunteer', V: 'Volunteer' };
  return map[prefix[0]] || '';
}

function daysSince_(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function requiredProperty_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error('Apps Script setting is missing: ' + key);
  return value;
}

function output_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
