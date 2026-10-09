const messageEl = document.querySelector('#adminMessage');
const accountRows = document.querySelector('#accountRows');
const auditRows = document.querySelector('#auditRows');
const countEl = document.querySelector('#accountCount');
let overview = { approved: [], pending: [], deactivated: [], audit: [] };
let selectedStatus = 'all';
let currentUser = null;
let notificationItems = [];
let notificationLoadPromise = null;
let rolePermissionsLoaded = false;
let rolePermissionsLoadPromise = null;
const cachedNotificationUser = window.lvfrCachedUser?.();
const notificationCacheKey = `lvfr.portal.notifications.v1:${cachedNotificationUser?.account_id || cachedNotificationUser?.id || 'current'}`;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}
function setMessage(text, kind = '') {
  messageEl.textContent = text;
  messageEl.className = `admin-status ${kind}`.trim();
}
function canManageRoleProfiles() {
  return ['admin', 'commander'].includes(String(currentUser?.role || '').toLowerCase())
    || currentUser?.permissions?.operation_command_access === true;
}
function canManageRanks(permission) { return currentUser?.role === 'admin' || currentUser?.permissions?.role_manage === true || currentUser?.permissions?.[permission] === true; }
function canAccessPermissionPanel() { return canManageRoleProfiles() || ['rank_add','rank_rename','rank_delete','rank_reorder'].some(canManageRanks); }
function canManageCommandAccounts() {
  return ['admin', 'commander'].includes(String(currentUser?.role || '').toLowerCase());
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    location.assign('/login');
    throw new Error('Your session expired. Sign in again.');
  }
  if (!response.ok) throw new Error(data.detail || 'The request failed.');
  return data;
}
function allAccounts() {
  return [
    ...(overview.pending || []).map(account => ({ ...account, status: 'pending' })),
    ...(overview.approved || []).map(account => ({ ...account, status: 'approved' })),
    ...(overview.deactivated || []).map(account => ({ ...account, status: 'deactivated' })),
  ];
}
const canClearAllNotifications = () => currentUser?.role === 'admin' || currentUser?.permissions?.notifications_clear_all === true;
const clearAllNotificationsHandler = async event => {
  if (!window.confirm('Clear notifications for everyone? They will be deleted from D1 and Google Sheets.')) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const response = await fetch('/api/notifications/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || result.error || 'Could not clear notifications.');
    window.alert('All notifications were cleared.');
  } catch (error) {
    window.alert(error.message);
  } finally {
    button.disabled = false;
  }
};
['#clearAllNotifications'].forEach(selector => document.querySelector(selector)?.addEventListener('click', clearAllNotificationsHandler));
function configureOperationAccess() {
  const allowed = canAccessPermissionPanel(), accountManager = canManageCommandAccounts();
  document.querySelector('#openFullCleaning')?.toggleAttribute('hidden', currentUser?.role !== 'admin');
  document.querySelector('#clearAllNotifications')?.toggleAttribute('hidden', !canClearAllNotifications());
  document.querySelector('[data-command-section="accounts"]')?.toggleAttribute('hidden', !accountManager);
  document.querySelector('[data-command-section="history"]')?.toggleAttribute('hidden', !accountManager);
  document.querySelector('[data-command-section="permissions"]')?.toggleAttribute('hidden', !allowed);
  document.querySelector('.permission-member-picker')?.toggleAttribute('hidden', currentUser?.role !== 'admin');
  document.querySelector('.custom-role-tools')?.toggleAttribute('hidden', !canManageRanks('rank_add'));
  if (!accountManager) {
    commandSections.accounts.hidden = true;
    commandSections.history.hidden = true;
    commandSections.permissions.hidden = !allowed;
    if (allowed) showCommandSection('permissions');
  }
  if (allowed && !rolePermissionsLoaded && !rolePermissionsLoadPromise) {
    rolePermissionsLoadPromise = loadRolePermissions().finally(() => { rolePermissionsLoadPromise = null; });
  }
  if (!allowed && commandSections.permissions?.hidden === false && accountManager) showCommandSection('accounts');
  // The section named in the URL (from the sidebar) is applied now that permissions are known.
  selectCommandSectionFromHash();
}
function accountActions(account) {
  const id = esc(account.account_id);
  const operation = currentUser?.role === 'admin';
  if (account.account_id === currentUser?.account_id) return '';
  if (account.status === 'pending') return `
    <button type="button" data-action="allow" data-id="${id}">Approve</button>
    <button type="button" class="danger" data-action="deny" data-id="${id}">Deny</button>`;
  if (account.status === 'deactivated') return `
    ${(!account.is_elevated || operation) ? `<button type="button" data-action="reactivate" data-id="${id}">Reactivate</button>` : ''}
    ${operation && account.is_elevated ? `<button type="button" data-action="demote" data-id="${id}">${account.role === 'admin' ? `Make ${esc(roleTitle('commander'))}` : `Demote to ${esc(roleTitle('leader'))}`}</button>` : ''}
    ${operation && account.role !== 'admin' ? `<button type="button" data-action="permissions" data-id="${id}">Permissions</button>` : ''}`;
  if (account.is_elevated && !operation) return '';
  const memberButton = account.role === 'member'
    ? `<button type="button" data-action="leader" data-id="${id}">Make ${esc(roleTitle('leader'))}</button>`
    : account.role === 'leader' ? `<button type="button" data-action="member" data-id="${id}">Make ${esc(roleTitle('member'))}</button>` : '';
  const roleButton = operation
    ? account.role === 'admin'
      ? `<button type="button" data-action="demote" data-id="${id}">Make ${esc(roleTitle('commander'))}</button>`
      : account.role === 'commander'
      ? `<button type="button" data-action="promote" data-id="${id}">Make Operation</button><button type="button" data-action="demote" data-id="${id}">Demote to ${esc(roleTitle('leader'))}</button>`
      : `<button type="button" data-action="commander" data-id="${id}">Make ${esc(roleTitle('commander'))}</button><button type="button" data-action="promote" data-id="${id}">Make Operation</button>`
    : '';
  const permissionButton = operation ? `<button type="button" data-action="permissions" data-id="${id}">Permissions</button>` : '';
  const elevated = account.is_elevated;
  const deactivateButton = elevated
    ? '<button type="button" disabled title="Remove elevated role first">Deactivate</button>'
    : `<button type="button" class="danger" data-action="deactivate" data-id="${id}">Deactivate</button>`;
  const deleteButton = elevated
    ? '<button type="button" disabled title="Remove elevated role first">Delete</button>'
    : `<button type="button" class="danger" data-action="delete" data-id="${id}">Delete</button>`;
  return `${memberButton}${roleButton}${permissionButton}${deactivateButton}${deleteButton}`;
}
function renderAccounts() {
  const query = document.querySelector('#accountSearch').value.trim().toLowerCase();
  const rows = allAccounts().filter(account =>
    (selectedStatus === 'all' || account.status === selectedStatus)
    && `${account.display_name || account.name} ${account.callsign}`.toLowerCase().includes(query));
  countEl.textContent = `${rows.length} account${rows.length === 1 ? '' : 's'}`;
  const onlineCount = document.querySelector('#onlineAccountCount');
  if (onlineCount) onlineCount.textContent = `Online now: ${Number(overview.online_count || 0)}`;
  if (!rows.length) {
    accountRows.innerHTML = '<tr><td colspan="7">No accounts match this filter.</td></tr>';
    return;
  }
  accountRows.innerHTML = rows.map(account => `
    <tr><td data-label="Account"><strong>${esc(account.display_name || account.name)}</strong>${account.approved_by ? `<br><small class="muted">Approved by ${esc(account.approved_by)}</small>` : ''}</td>
      <td data-label="Callsign">${esc(account.callsign || '—')}</td><td data-label="Status">${esc(account.status)}</td>
      <td data-label="Role">${account.status === 'pending' ? '—' : esc(roleTitle(account.role))}</td>
      <td data-label="Presence"><span class="presence-badge ${account.online ? 'online' : 'offline'}">${account.online ? 'Online' : 'Offline'}</span></td>
      <td data-label="Created">${esc(account.requested_at || '—')}</td><td data-label="Actions"><div class="admin-actions">${accountActions(account)}</div></td></tr>`).join('');
}
function renderAudit() {
  const query = String(document.querySelector('#auditSearch')?.value || '').trim().toLocaleLowerCase();
  const rows = (overview.audit || []).filter(entry => !query || [entry.created_at, entry.name, entry.callsign, entry.action, entry.actor_name]
    .join(' ').toLocaleLowerCase().includes(query));
  auditRows.innerHTML = rows.length ? rows.map(entry => `
    <tr><td data-label="Date">${esc(entry.created_at || '—')}</td><td data-label="Account">${esc(entry.name || 'N/A')}${entry.callsign ? ` (${esc(entry.callsign)})` : ''}</td>
      <td data-label="Action">${esc(String(entry.action || '—').replace(/\bAdmin\b/g, 'Operation'))}</td><td data-label="By">${esc(String(entry.actor_name || '—').replace(/\bWeb Admin\b/g, 'Web Operation'))}</td></tr>`).join('')
    : `<tr><td colspan="4">${query ? 'No matching history.' : 'No account history yet.'}</td></tr>`;
}
document.querySelector('#auditSearch')?.addEventListener('input', renderAudit);
document.querySelector('#clearAccountAuditBtn')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  if (!currentUser?.is_admin) return;
  if (!window.confirm("Clear the account audit from D1 and the website? Google Sheets will remain unchanged.")) return;
  button.disabled = true;
  try {
    await api('/api/leaders/audit/clear', { method: 'POST' });
    overview.audit = [];
    renderAudit();
    void loadAccounts(true);
    setMessage('D1 account audit cleared. Google Sheets was not changed.', 'success');
  } catch (error) {
    setMessage(`Could not clear D1 account audit: ${error.message}`, 'error');
  } finally { button.disabled = false; }
});
const fullCleaningDialog = document.querySelector('#fullCleaningDialog');
const cleanAllLogs = document.querySelector('#cleanAllLogs');
fullCleaningDialog?.addEventListener('click', event => {
  if (event.target === fullCleaningDialog) fullCleaningDialog.close();
});
document.querySelector('#openFullCleaning')?.addEventListener('click', () => {
  if (currentUser?.role !== 'admin') return;
  cleanAllLogs.checked = false;
  cleanAllLogs.indeterminate = false;
  fullCleaningDialog.querySelectorAll('[data-clean-log]').forEach(input => { input.checked = false; });
  const status = document.querySelector('#fullCleaningStatus');
  status.textContent = ''; status.className = 'admin-status';
  fullCleaningDialog.showModal();
});
cleanAllLogs?.addEventListener('change', () => {
  cleanAllLogs.indeterminate = false;
  fullCleaningDialog.querySelectorAll('[data-clean-log]').forEach(input => { input.checked = cleanAllLogs.checked; });
});
fullCleaningDialog?.querySelectorAll('[data-clean-log]').forEach(input => input.addEventListener('change', () => {
  const options = [...fullCleaningDialog.querySelectorAll('[data-clean-log]')];
  cleanAllLogs.checked = options.every(option => option.checked);
  cleanAllLogs.indeterminate = options.some(option => option.checked) && !cleanAllLogs.checked;
}));
document.querySelector('#cancelFullCleaning')?.addEventListener('click', () => fullCleaningDialog.close());
document.querySelector('#confirmFullCleaning')?.addEventListener('click', async event => {
  if (!currentUser?.is_admin) return;
  const items = cleanAllLogs.checked ? ['all'] : [...fullCleaningDialog.querySelectorAll('[data-clean-log]:checked')].map(input => input.dataset.cleanLog);
  const status = document.querySelector('#fullCleaningStatus');
  if (!items.length) { status.textContent = 'Select at least one log or choose All.'; status.className = 'admin-status error'; return; }
  const description = cleanAllLogs.checked ? 'all logs and notifications' : `${items.length} selected item(s)`;
  if (!window.confirm(`Permanently delete ${description} from D1 and Google Sheets?`)) return;
  const button = event.currentTarget;
  button.disabled = true; status.textContent = 'Cleaning selected data...'; status.className = 'admin-status';
  try {
    await api('/api/logs/clean', { method: 'POST', body: JSON.stringify({ items }) });
    const accountId = currentUser.account_id || currentUser.id || 'current';
    const knownLogs = ['promotion','callsign','termination','training','training_time','loi','exam','note','activity','instructor'];
    try { knownLogs.forEach(kind => sessionStorage.removeItem(`lvfr.log.${accountId}.${kind}.v1`)); } catch {}
    if (items.includes('account_audit') || items.includes('all')) { overview.audit = []; renderAudit(); void loadAccounts(true); }
    if (items.includes('notifications') || items.includes('all')) {
      notificationItems = [];
      try { localStorage.setItem(notificationCacheKey, '[]'); } catch {}
      renderNotifications(0);
    }
    status.textContent = 'Selected logs and notifications were removed from D1 and Google Sheets.';
    status.className = 'admin-status success';
    window.setTimeout(() => fullCleaningDialog.close(), 1000);
  } catch (error) {
    status.textContent = `Cleanup failed: ${error.message}`;
    status.className = 'admin-status error';
  } finally { button.disabled = false; }
});
async function loadAccounts(silent = false) {
  const cachedUser = window.lvfrCachedUser?.();
  currentUser = currentUser || cachedUser;
  configureOperationAccess();
  if (currentUser && !canManageCommandAccounts() && canAccessPermissionPanel()) {
    setMessage('Operation Command access is limited to Access Permissions.');
    return;
  }
  if (currentUser && !canAccessPermissionPanel()) { location.replace('/portal'); return; }
  const cacheKey = `lvfr.admin.accounts.${cachedUser?.account_id || cachedUser?.id || 'current'}.v1`;
  let hadCached = false;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (cached?.overview) {
      overview = cached.overview;
      currentUser = cached.user || cachedUser;
      configureOperationAccess();
      renderAccounts();
      renderAudit();
      hadCached = true;
    }
  } catch {}
  if (!hadCached && !silent) setMessage('Loading accounts...');
  try {
    const [data, user] = await Promise.all([api('/api/leaders'), Promise.resolve(cachedUser || null)]);
    overview = data;
    currentUser = user;
    configureOperationAccess();
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ overview, user, savedAt: Date.now() })); } catch {}
    renderAccounts();
    renderAudit();
    if (!silent) setMessage('Account list is up to date.', 'success');
  } catch (error) {
    if (!silent) setMessage(error.message, 'error');
    accountRows.innerHTML = '<tr><td colspan="7">Could not load accounts.</td></tr>';
  }
}
function renderNotifications(unreadCount = null) {
  const badge = document.querySelector('#notificationBadge');
  const list = document.querySelector('#notificationList');
  const unread = unreadCount ?? notificationItems.filter(item => !Number(item.is_read)).length;
  badge.textContent = unread > 99 ? '99+' : String(unread);
  badge.hidden = unread === 0;
  list.innerHTML = notificationItems.length ? notificationItems.map(item => `
    <button type="button" class="notification-item ${Number(item.is_read) ? '' : 'unread'}" data-notification-id="${Number(item.id)}">
      <strong>${esc(item.title)}</strong><p>${esc(item.message)}</p><small>${esc(item.created_at || '')}</small>
    </button>`).join('') : '<div class="empty">No notifications.</div>';
}
async function loadNotifications() {
  if (notificationLoadPromise) return notificationLoadPromise;
  notificationLoadPromise = (async () => {
    try {
      const result = await api('/api/notifications');
      notificationItems = Array.isArray(result.items) ? result.items : [];
      try { localStorage.setItem(notificationCacheKey, JSON.stringify(notificationItems)); } catch {}
      renderNotifications(Number(result.unread_count || 0));
    } catch (error) {
      if (!notificationItems.length) document.querySelector('#notificationList').innerHTML = `<div class="empty">${esc(error.message)}</div>`;
    } finally { notificationLoadPromise = null; }
  })();
  return notificationLoadPromise;
}
async function markNotificationsRead(ids = []) {
  const selected = new Set(ids.map(Number));
  notificationItems = notificationItems.map(item => !selected.size || selected.has(Number(item.id)) ? { ...item, is_read: 1 } : item);
  try { localStorage.setItem(notificationCacheKey, JSON.stringify(notificationItems)); } catch {}
  renderNotifications();
  void api('/api/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }).catch(error => {
    if (String(error?.message || error) === 'BACKGROUND_SAVE_PENDING') return;
    setMessage(`Save failed: ${error.message}. Notification state may differ from Google Sheets. Reload notifications to refresh it.`, 'error');
  });
}
async function performAction(button) {
  const { action, id } = button.dataset;
  const account = allAccounts().find(row => row.account_id === id);
  if (!account) return;
  if (action === 'permissions') return openIndividualPermissions(account);
  const accountLabel = account.display_name || account.name;
  const confirmations = {
    deny: `Deny the account request for ${accountLabel}?`,
    deactivate: `Deactivate ${accountLabel}'s account?`,
    delete: `Permanently delete ${accountLabel}'s account? This cannot be undone.`,
    demote: account.role === 'admin' ? `Change ${accountLabel} from Operation to Commander?` : `Change ${accountLabel} from Commander to Leader?`,
    member: `Limit ${accountLabel} to Watch Command access?`,
  };
  if (confirmations[action] && !window.confirm(confirmations[action])) return;
  const paths = {
    allow: `/api/leaders/${encodeURIComponent(id)}/allow`,
    deny: `/api/leaders/${encodeURIComponent(id)}/deny`,
    promote: `/api/leaders/${encodeURIComponent(id)}/admin`,
    commander: `/api/leaders/${encodeURIComponent(id)}/commander`,
    demote: `/api/leaders/${encodeURIComponent(id)}/demote`,
    member: `/api/leaders/${encodeURIComponent(id)}/member`,
    leader: `/api/leaders/${encodeURIComponent(id)}/leader`,
    deactivate: `/api/leaders/${encodeURIComponent(id)}/deactivate`,
    reactivate: `/api/leaders/${encodeURIComponent(id)}/reactivate`,
    delete: `/api/leaders/${encodeURIComponent(id)}`,
  };
  const method = action === 'delete' ? 'DELETE' : 'POST';
  applyOptimisticAccountAction(account, action);
  const success = { allow: 'Account approved.', deny: 'Account request denied.', promote: 'Operation access granted.', commander: 'Commander role granted.', demote: account.role === 'admin' ? 'Account changed to Commander.' : 'Account changed to Leader.', member: 'Account set to Member.', leader: 'Account set to Leader.', deactivate: 'Account deactivated.', reactivate: 'Account reactivated.', delete: 'Account deleted.' };
  setMessage(success[action] || 'Account updated.', 'success');
  button.disabled = true;
  void api(paths[action], { method }).catch(error => {
    setMessage(`Save failed: ${error.message}. The account view may differ from Google Sheets. Use Refresh Accounts to reload the correct data.`, 'error');
  });
}

function applyOptimisticAccountAction(source, action) {
  const account = { ...source };
  for (const key of ['pending', 'approved', 'deactivated']) {
    overview[key] = (overview[key] || []).filter(row => String(row.account_id) !== String(account.account_id));
  }
  if (action === 'allow') { account.status = 'approved'; account.role = 'member'; account.is_admin = false; }
  else if (action === 'deny' || action === 'delete') return renderAccounts();
  else if (action === 'promote') { account.role = 'admin'; account.is_admin = true; account.is_elevated = true; }
  else if (action === 'commander') { account.role = 'commander'; account.is_admin = false; account.is_commander = true; account.is_elevated = true; }
  else if (action === 'demote') { account.role = account.role === 'admin' ? 'commander' : 'leader'; account.is_admin = false; account.is_commander = account.role === 'commander'; account.is_elevated = account.role === 'commander'; }
  else if (action === 'member') account.role = 'member';
  else if (action === 'leader') account.role = 'leader';
  else if (action === 'deactivate') account.status = 'deactivated';
  else if (action === 'reactivate') account.status = 'approved';
  (overview[account.status] || (overview[account.status] = [])).unshift(account);
  renderAccounts();
}

const permissionGroups = [
  { name: 'Notifications', items: [
    ['notifications_clear_all', 'Clear notifications (everyone)', 'Delete all notifications for everyone from D1 and Google Sheets. Button appears in Operation Command.'],
    ['termination_log_view', 'Termination notifications', 'Receive termination notifications and view the Termination log.'],
    ['inactive_view', 'Can be terminated notifications', 'Receive can-be-terminated notifications and view the Can Be Terminated list.'],
    ['promotion_log_view', 'Promotion notifications', 'Receive promotion notifications and view the Promotion log.'],
    ['eligible_view', 'Eligible notifications', 'Receive eligible-for-promotion notifications and view the Eligible list.'],
    ['callsign_log_view', 'Callsign notifications', 'Receive callsign notifications and view the Callsign log.'],
    ['training_log_view', 'Training notifications', 'Receive training notifications and view the Training log.'],
    ['training_hours_log_view', 'Training Hours notifications', 'Receive Training Hours notifications and view the Training Time log.'],
    ['loi_log_view', 'LOI notifications', 'Receive LOI notifications and view the LOI log.'],
    ['exam_log_view', 'Exam notifications', 'Receive exam notifications and view the Exam log.'],
    ['note_log_view', 'Note notifications', 'Receive note notifications and view the Notes log.'],
    ['activity_log_view', 'Activity notifications', 'Receive activity notifications and view the Activity log.'],
    ['instructor_log_view', 'Instructor notifications', 'Receive instructor notifications and view the Instructor log.'],
    ['do_not_promote_log_view', 'Do Not Promote notifications', 'Receive Do Not Promote notifications and view the Do Not Promote log.'],
  ] },
  { name: 'Application access', items: [
    ['portal_access', 'EMS Operations', 'Open the EMS Operations application.'],
    ['operation_command_access', 'Operation Command access', 'Open Access Permissions to manage role permission profiles. Does not grant account management.'],
    ['rank_add', 'Add ranks', 'Create additional rank profiles.'],
    ['rank_rename', 'Rename ranks', 'Change the names of ranks below your own.'],
    ['rank_delete', 'Delete ranks', 'Delete custom ranks below your own when no accounts use them.'],
    ['rank_reorder', 'Reorder ranks', 'Change the order of ranks below your own.'],
    ['watch_command_view', 'Watch Command: view', 'Open Watch Command logs and activity.'],
    ['watch_command_edit', 'Watch Command: edit', 'Create and update Watch Command records.'],
    ['watch_command_roster', 'Watch Command: roster lookup', 'Search member names and callsigns.'],
  ] },
  { name: 'Lists and records', items: [
    ['members_view', 'Members list', 'View the roster and member list.'], ['eligible_view', 'Eligible list', 'View promotion eligibility.'], ['promotion_access', 'Access Promotion', 'Open the Promotion page and view eligible members.'],
    ['profile_view', 'Member profiles', 'Open member View / Manage details.'], ['inactive_view', 'Can Be Terminated list', 'View members marked for termination.'],
    { key:'logs_view', label:'Members Log (all)', description:'Allow every log tab.', children:[
      ['promotion_log_view','Promotion log','View promotion and rank-change history.'],['callsign_log_view','Callsign log','View callsign-change history.'],['termination_log_view','Termination log','View termination history.'],['training_log_view','Training log','View FORT and HERT training history.'],['training_hours_log_view','Training Hours log','View Training Hours changes.'],['loi_log_view','LOI log','View LOI history.'],['exam_log_view','Exam log','View exam history.'],['note_log_view','Note log','View member-note history.'],['activity_log_view','Activity log','View activity-status history.'],['instructor_log_view','Instructor log','View instructor-assignment history.'],
      ['do_not_promote_log_view','Do Not Promote log','View when members were added to or removed from the Do Not Promote list, and by whom.']
    ]}, ['statistics_view', 'Statistics', 'View roster statistics.'],
    ['logs_delete_d1', 'Delete logs from D1', 'Delete the selected log from the website database.'], ['logs_clean_full', 'Full Cleaning', 'Delete selected logs and notifications from D1 and Google Sheets.'],
    { key:'training_view', label:'Training lists (all)', description:'Allow every HERT and FORT training sublist.', children:[
      ['hert_certified_view','HERT Certified','View HERT certification records.'],['hert_instructor_view','HERT Instructor','View HERT instructor records.'],['hert_loi_view','HERT LOI','View the HERT LOI list.'],['fort_training_view','FORT Training','View Basic and Advanced FORT records.'],['fort_instructor_view','FORT Instructor','View FORT instructor records.'],['fort_loi_view','FORT LOI','View the FORT LOI list.']
    ]}, ['training_hours_view', 'Training Hours: view', 'View Training Hours records.'],
    ['do_not_promote_view', 'Do not Promote: view', 'View the Do not Promote list.'], ['sync_view', 'Sync status', 'View roster synchronization status.'],
  ] },
  { name: 'Training and member changes', items: [
    ['training_fort_manage', 'Manage FORT training', 'Change Basic and Advanced FORT status; FORT Instructor status is also required.'],
    ['training_hert_manage', 'Manage HERT training', 'Change HERT status; HERT Instructor status is also required.'],
    ['training_hours_manage', 'Manage Training Hours', 'Add, remove, and change Training Hours records.'], ['loi_manage', 'Manage LOI lists', 'Add LOI candidates and record Passed or Failed results.'],
    ['instructor_manage', 'Instructor assignments', 'Assign or remove FORT and HERT Instructor status.'],
    ['notes_manage', 'Member notes', 'Add, edit, or remove member notes.'], ['activity_manage', 'Activity status', 'Change member activity status.'],
    ['exam_manage', 'Supervisor exam', 'Add or remove exam status.'], ['rank_date_manage', 'Rank date', 'Change a member rank date.'],
    ['promotion_manage', 'Promotion', 'Promote members using available rules.'], ['rank_manage', 'Rank tools', 'Force promote, demote, or change rank.'],
    ['callsign_manage', 'Callsign changes', 'Change a member callsign.'], ['termination_manage', 'Termination', 'Remove a member from the roster.'],
    ['do_not_promote_manage', 'Do not Promote: edit', 'Add or remove members from that list.'], ['sync_manage', 'Sync now', 'Synchronize with the source sheet.'],
    ['full_sync_manage', 'Full roster sync', 'Run a full roster synchronization from the source sheet.'],
  ] },
];
let rolePermissionProfiles = {};
let rolePermissionScopes = {};
let rolePermissionRanks = [];
const roleActiveTab = {};
// Last saved state of each role, used by "Undo unsaved changes".
const savedRoleSnapshot = {};
function snapshotRoleProfiles() {
    for (const role of Object.keys(rolePermissionProfiles)) {
        savedRoleSnapshot[role] = {
            profile: JSON.parse(JSON.stringify(rolePermissionProfiles[role] || {})),
            scopes: JSON.parse(JSON.stringify(rolePermissionScopes[role] || {})),
        };
    }
}
let permissionRoleOrder = [];
let permissionEditorCapabilities = {};
let editablePermissionKeys = [];
let selectedPermissionRole = 'member';
function roleTitle(role) { const saved=permissionRoleOrder.find(item=>item.role===role)?.display_name; return saved || ({admin:'Operation',member:'Member',leader:'Leader',commander:'Commander'})[role] || role.replace(/[_-]+/g,' ').replace(/\b\w/g, ch => ch.toUpperCase()); }
function permissionEntryMatches(entry, query, groupName) {
  if (!query) return true;
  if (Array.isArray(entry)) return `${entry[1]} ${entry[2]} ${groupName}`.toLocaleLowerCase().includes(query);
  return `${entry.label} ${entry.description} ${groupName} ${entry.children.map(item=>item.slice(1).join(' ')).join(' ')}`.toLocaleLowerCase().includes(query);
}
function renderPermissionEntry(entry, profile, query, groupName) {
  if (Array.isArray(entry)) {
    const [key,label,description]=entry;
    if (!editablePermissionKeys.includes(key) || !permissionEntryMatches(entry,query,groupName)) return '';
    return `<label class="permission-item"><input type="checkbox" data-permission-key="${key}" ${profile?.[key]?'checked':''} ${currentUser?.role!=='admin'&&permissionEditorCapabilities[key]!==true&&!profile?.[key]?'disabled':''}><span><strong>${esc(label)}</strong><small>${esc(description)}</small></span></label>`;
  }
  const children=entry.children.filter(item=>editablePermissionKeys.includes(item[0])&&permissionEntryMatches(item,query,groupName));
  const showParent=children.length>0&&permissionEntryMatches(entry,query,groupName);
  if (!children.length&&!showParent) return '';
  const all=entry.children.filter(item=>editablePermissionKeys.includes(item[0]));
  const checked=all.length>0&&all.every(item=>profile?.[item[0]]===true);
  const partiallyChecked=all.some(item=>profile?.[item[0]]===true)&&!checked;
  const parent=showParent?`<label class="permission-item permission-master"><input type="checkbox" data-permission-parent="${entry.key}" data-indeterminate="${partiallyChecked?'true':'false'}" ${checked?'checked':''} ${currentUser?.role!=='admin'&&all.some(item=>permissionEditorCapabilities[item[0]]!==true&&!profile?.[item[0]])?'disabled':''}><span><strong>${esc(entry.label)}</strong><small>${esc(entry.description)}</small></span></label>`:'';
  const sublist=children.map(item=>renderPermissionEntry(item,profile,query,groupName)).join('');
  return `<details class="permission-sublist" data-permission-sublist="${entry.key}" ${query||openPermissionSubLists.has(entry.key)?'open':''}><summary>${esc(entry.label)} <span>${all.filter(item=>profile?.[item[0]]===true).length}/${all.length}</span></summary>${parent}${sublist}</details>`;
}
let openPermissionGroups = new Set();
let openPermissionSubLists = new Set();
// Rank limits shown only for the actions this role is allowed to perform. Unchecked ranks are not allowed.
function scopeEditor(role) {
    const profile = rolePermissionProfiles[role] || {};
    const scopes = rolePermissionScopes[role] || {};
    const sections = [
        { scope: 'promote', title: 'Promote', allowed: profile.promotion_manage || profile.rank_manage, fields: [['from', 'Members of rank'], ['to', 'Can promote to rank']] },
        { scope: 'demote', title: 'Demote', allowed: profile.rank_manage, fields: [['from', 'Members of rank'], ['to', 'Can demote to rank']] },
        { scope: 'terminate', title: 'Terminate', allowed: profile.termination_manage, fields: [['from', 'Can terminate members of rank']] },
        { scope: 'view', title: 'Viewing members', allowed: profile.members_view || profile.eligible_view || profile.inactive_view || profile.promotion_access, fields: [['from', 'Can see members of rank (lists and notifications)']] },
    ].filter(section => section.allowed);
    if (!sections.length || !rolePermissionRanks.length) return '';
    const box = (section, [field, label]) => {
        const selected = scopes[section.scope]?.[field];
        return `<fieldset class="scope-box"><legend>${esc(label)}</legend><div class="scope-ranks">${rolePermissionRanks.map(rank => `<label><input type="checkbox" data-scope-role="${esc(role)}" data-scope="${section.scope}" data-scope-field="${field}" value="${esc(rank)}" ${!selected || selected.includes(rank) ? 'checked' : ''}><span>${esc(rank)}</span></label>`).join('')}</div></fieldset>`;
    };
    return `<details class="rank-limits" data-role-tab="limits" open><summary>Rank limits</summary>${sections.map(section => `<div class="rank-limit-section"><strong>${esc(section.title)}</strong>${section.fields.map(field => box(section, field)).join('')}</div>`).join('')}</details>`;
}
// Undo: restore the last saved state of this role and redraw the cards.
document.addEventListener('click', event => {
    const button = event.target.closest('[data-undo-permissions]');
    if (!button) return;
    const role = button.dataset.undoPermissions;
    const snapshot = savedRoleSnapshot[role];
    if (!snapshot) return;
    rolePermissionProfiles[role] = JSON.parse(JSON.stringify(snapshot.profile));
    rolePermissionScopes[role] = JSON.parse(JSON.stringify(snapshot.scopes));
    renderRolePermissions();
    const status = document.querySelector('#permissionStatus');
    if (status) { status.textContent = 'Unsaved changes were undone.'; status.className = 'permission-status'; }
});

// Change history of role permissions, with "Restore previous" for each change.
let permissionHistoryItems = [];
let permissionHistoryLoadedAt = 0;
function changedPermissionLabels(before, after) {
    const names = [];
    const b = before?.permissions || {}, a = after?.permissions || {};
    Object.keys(a).forEach(key => { if (Boolean(b[key]) !== Boolean(a[key])) names.push(`${key} ${a[key] ? 'on' : 'off'}`); });
    if (JSON.stringify(before?.scopes || {}) !== JSON.stringify(after?.scopes || {})) names.push('rank limits changed');
    if (!names.length) return 'No permission changes';
    return names.slice(0, 6).join(', ') + (names.length > 6 ? '…' : '');
}
async function renderPermissionHistory(force = false) {
    const panel = document.querySelector('#rolePermissionsPanel');
    if (!panel) return;
    let box = document.querySelector('#permissionHistory');
    if (!box) { box = document.createElement('section'); box.id = 'permissionHistory'; box.className = 'permission-history'; panel.after(box); }
    if (!force && Date.now() - permissionHistoryLoadedAt < 3000 && box.innerHTML) return;
    permissionHistoryLoadedAt = Date.now();
    try {
        const result = await api('/api/role-permissions/history');
        permissionHistoryItems = result.items || [];
        box.innerHTML = `<details class="rank-limits"><summary>Change history (${permissionHistoryItems.length})</summary>${permissionHistoryItems.length ? `<ul class="role-preview-list">${permissionHistoryItems.map(item => `<li class="is-allowed"><strong>${esc(roleTitle(item.role))}</strong> · ${esc(item.changed_by || 'Unknown')} · ${esc(item.changed_at || '')}<br><span class="muted">${esc(changedPermissionLabels(item.before, item.after))}</span> <button type="button" class="role-undo" data-restore-history="${item.id}">Restore previous</button></li>`).join('')}</ul>` : '<p class="muted">No changes yet.</p>'}</details>`;
    } catch (error) {
        box.innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    }
}
document.addEventListener('click', async event => {
    const button = event.target.closest('[data-restore-history]');
    if (!button) return;
    const item = permissionHistoryItems.find(row => String(row.id) === button.dataset.restoreHistory);
    if (!item) return;
    button.disabled = true;
    try {
        await api('/api/role-permissions', { method: 'POST', body: JSON.stringify({ role: item.role, permissions: item.before.permissions, scopes: item.before.scopes }) });
        await loadRolePermissions();
        const status = document.querySelector('#permissionStatus');
        if (status) { status.textContent = `${roleTitle(item.role)} was restored to its previous settings.`; status.className = 'permission-status success'; }
        void renderPermissionHistory(true);
    } catch (error) {
        setMessage(`Could not restore: ${error.message}`, 'error');
    } finally {
        button.disabled = false;
    }
});

// Account preview: choose an approved account to see what it can do, including its own overrides.
function renderAccountPreview() {
    const panel = document.querySelector('#rolePermissionsPanel');
    if (!panel || document.querySelector('#accountPreview')) return;
    const box = document.createElement('section');
    box.id = 'accountPreview';
    box.className = 'permission-history';
    box.innerHTML = `<details class="role-preview"><summary>Preview an account: what can this person do?</summary><label class="role-preview-rank">Account <select id="accountPreviewSelect"><option value="">Choose an account</option></select></label><div id="accountPreviewResult"><p class="muted">Choose an account to see its permissions.</p></div></details>`;
    panel.before(box);
    const select = box.querySelector('#accountPreviewSelect');
    const accounts = (allAccounts() || []).filter(account => account.status === 'approved' && account.account_id);
    select.insertAdjacentHTML('beforeend', accounts.map(account => `<option value="${esc(account.account_id)}">${esc(account.name || '')}${account.callsign ? ` (${esc(account.callsign)})` : ''}</option>`).join(''));
}
document.addEventListener('change', async event => {
    if (event.target.id !== 'accountPreviewSelect') return;
    const out = document.querySelector('#accountPreviewResult');
    if (!out) return;
    if (!event.target.value) { out.innerHTML = '<p class="muted">Choose an account to see its permissions.</p>'; return; }
    try {
        const result = await api(`/api/account-preview?account_id=${encodeURIComponent(event.target.value)}`);
        out.innerHTML = `<p class="muted">${esc(result.name || '')}${result.callsign ? ' · ' + esc(result.callsign) : ''} · ${esc(roleTitle(result.role))}</p><ul class="role-preview-list">${result.actions.map(item => `<li class="${item.allowed ? 'is-allowed' : 'is-denied'}"><strong>${esc(item.label)}:</strong> ${item.allowed ? 'Allowed' : 'Not allowed'} <span class="muted">${esc(item.reason)}</span></li>`).join('')}</ul>`;
    } catch (error) {
        out.innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    }
});

// Tabs on each role card. Each section is tagged with the tab it belongs to.
const roleTabs = [['pages', 'Pages and lists'], ['actions', 'Actions'], ['notifications', 'Notifications'], ['limits', 'Rank limits'], ['preview', 'Preview']];
function roleTabFor(groupName) {
    if (groupName === 'Training and member changes') return 'actions';
    if (groupName === 'Notifications') return 'notifications';
    return 'pages';
}
function roleTabBar(role) {
    const active = roleActiveTab[role] || 'pages';
    return `<nav class="role-tab-bar" aria-label="Role sections">${roleTabs.map(([key, label]) => `<button type="button" class="role-tab ${active === key ? 'active' : ''}" data-role-tab-button="${key}" data-role="${esc(role)}">${esc(label)}</button>`).join('')}</nav>`;
}
document.addEventListener('click', event => {
    const button = event.target.closest('[data-role-tab-button]');
    if (!button) return;
    const role = button.dataset.role;
    roleActiveTab[role] = button.dataset.roleTabButton;
    const card = document.querySelector(`[data-role-tabs="${role}"]`);
    if (card) card.dataset.activeTab = roleActiveTab[role];
    button.parentElement?.querySelectorAll('[data-role-tab-button]').forEach(item => item.classList.toggle('active', item === button));
});

// Warnings for settings that will not work as intended. They never block saving.
function roleWarnings(role) {
    const p = rolePermissionProfiles[role] || {};
    const s = scopesFromDom(role);
    const out = [];
    const promote = p.promotion_manage || p.rank_manage;
    const viewable = p.members_view || p.eligible_view || p.inactive_view || p.promotion_access;
    if (promote && !(p.eligible_view || p.promotion_access)) out.push('Can promote, but cannot see the Eligible list.');
    if (p.rank_manage && !p.members_view) out.push('Can demote, but cannot see the Members list.');
    if (p.termination_manage && !(p.members_view || p.inactive_view)) out.push('Can terminate, but cannot see member lists.');
    if (promote && Array.isArray(s.promote?.from) && !s.promote.from.length) out.push('Promote is enabled, but no rank is allowed.');
    if (p.rank_manage && Array.isArray(s.demote?.from) && !s.demote.from.length) out.push('Demote is enabled, but no rank is allowed.');
    if (p.termination_manage && Array.isArray(s.terminate?.from) && !s.terminate.from.length) out.push('Terminate is enabled, but no rank is allowed.');
    if (viewable && Array.isArray(s.view?.from) && !s.view.from.length) out.push('No rank is allowed to view members, so the lists will be hidden.');
    if (p.loi_manage || p.training_hours_manage) out.push('LOI and Training Hours need the member to be an instructor (HERT or FORT).');
    return out;
}
function roleWarningsHtml(role) {
    const items = roleWarnings(role);
    return `<ul class="role-warnings" data-warnings-role="${esc(role)}">${items.map(text => `<li>${esc(text)}</li>`).join('')}</ul>`;
}
document.addEventListener('change', event => {
    const card = event.target.closest('[data-permission-role]');
    const scope = event.target.closest('[data-scope-role]');
    const role = card?.dataset.permissionRole || scope?.dataset.scopeRole;
    if (!role) return;
    // Wait so the permission change is saved to the in-memory profile first.
    setTimeout(() => document.querySelector(`[data-warnings-role="${role}"]`)?.replaceWith(Object.assign(document.createElement('div'), { innerHTML: roleWarningsHtml(role) }).firstElementChild), 0);
});

// Preview block on each role card: choose a rank and see what the role can do with members of that rank.
function previewEditor(role) {
    const options = rolePermissionRanks.map(rank => `<option value="${esc(rank)}">${esc(rank)}</option>`).join('');
    return `<details class="role-preview" data-role-tab="preview"><summary>Preview: what can this role do?</summary><label class="role-preview-rank">Member rank <select data-preview-rank="${esc(role)}"><option value="">Choose a rank</option>${options}</select></label><div data-preview-result="${esc(role)}"><p class="muted">Choose a rank to see what this role can do.</p></div></details>`;
}
document.addEventListener('change', async event => {
    const select = event.target.closest('[data-preview-rank]');
    if (!select) return;
    const role = select.dataset.previewRank;
    const out = document.querySelector(`[data-preview-result="${role}"]`);
    if (!out) return;
    if (!select.value) { out.innerHTML = '<p class="muted">Choose a rank to see what this role can do.</p>'; return; }
    try {
        const result = await api(`/api/role-preview?role=${encodeURIComponent(role)}&rank=${encodeURIComponent(select.value)}`);
        out.innerHTML = `<ul class="role-preview-list">${result.actions.map(item => `<li class="${item.allowed ? 'is-allowed' : 'is-denied'}"><strong>${esc(item.label)}:</strong> ${item.allowed ? 'Allowed' : 'Not allowed'} <span class="muted">${esc(item.reason)}</span></li>`).join('')}</ul>`;
    } catch (error) {
        out.innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    }
});

function scopesFromDom(role) {
    const scopes = {};
    document.querySelectorAll(`[data-scope-role="${role}"]`).forEach(input => {
        const scope = scopes[input.dataset.scope] || (scopes[input.dataset.scope] = {});
        const field = scope[input.dataset.scopeField] || (scope[input.dataset.scopeField] = []);
        if (input.checked) field.push(input.value);
    });
    return scopes;
}

function renderRolePermissions() {
  const panel = document.querySelector('#rolePermissionsPanel');
  if (!panel) return;
  populateRoleStartOptions();
  void renderPermissionHistory();
  renderAccountPreview();
  openPermissionGroups = new Set([...panel.querySelectorAll('details.permission-group[open]')].map(item=>item.dataset.permissionGroup).filter(Boolean));
  openPermissionSubLists = new Set([...panel.querySelectorAll('details.permission-sublist[open]')].map(item=>item.dataset.permissionSublist).filter(Boolean));
  const query = document.querySelector('#permissionSearch').value.trim().toLocaleLowerCase();
  const roles = Object.keys(rolePermissionProfiles).filter(role => role !== 'admin' && role !== String(currentUser?.role || '').toLowerCase()).sort((a,b) => {
    const ai=permissionRoleOrder.findIndex(item=>item.role===a), bi=permissionRoleOrder.findIndex(item=>item.role===b);
    return (ai<0?999:ai)-(bi<0?999:bi) || a.localeCompare(b);
  });
  if (!roles.includes(selectedPermissionRole)) selectedPermissionRole = roles[0] || '';
  document.querySelector('#permissionRoleNav').innerHTML = roles.map(role => `<button type="button" data-select-permission-role="${esc(role)}" aria-current="${role===selectedPermissionRole}">${esc(roleTitle(role))} · ${permissionRoleOrder.findIndex(item=>item.role===role)+1}</button>`).join('');
  panel.innerHTML = roles.filter(role => role === selectedPermissionRole).map(role => {
    const roleLabel = roleTitle(role);
    const groups = permissionGroups.map(group => {
      const items = group.items.filter(entry => permissionEntryMatches(entry,query,group.name) && (Array.isArray(entry)?editablePermissionKeys.includes(entry[0]):editablePermissionKeys.includes(entry.key)||entry.children.some(item=>editablePermissionKeys.includes(item[0]))));
      if (!items.length) return '';
      return `<details class="permission-group" data-role-tab="${roleTabFor(group.name)}" data-permission-group="${esc(group.name)}" ${query||openPermissionGroups.has(group.name)?'open':''}><summary>${esc(group.name)}</summary>${items.map(entry=>renderPermissionEntry(entry,rolePermissionProfiles[role],query,group.name)).join('')}</details>`;
    }).join('');
    const enabled = Object.values(rolePermissionProfiles[role] || {}).filter(Boolean).length;
    const orderIndex=permissionRoleOrder.findIndex(item=>item.role===role);
    const actorRank=currentUser?.role==='admin'?1:(permissionRoleOrder.findIndex(item=>item.role===String(currentUser?.role||''))+1||2);
    const belowActor=orderIndex+1>actorRank;
    const rankTools=`<div class="admin-actions"><label>Rank name <input type="text" maxlength="32" data-rank-name="${esc(role)}" value="${esc(roleLabel)}" ${!canManageRanks('rank_rename')||!belowActor?'disabled':''}></label><button type="button" data-rename-rank="${esc(role)}" ${!canManageRanks('rank_rename')||!belowActor?'disabled':''}>Save name</button><button type="button" data-rank-move="up" data-rank-role="${esc(role)}" ${!canManageRanks('rank_reorder')||!belowActor||orderIndex<=1?'disabled':''}>Move up</button><button type="button" data-rank-move="down" data-rank-role="${esc(role)}" ${!canManageRanks('rank_reorder')||!belowActor||orderIndex<1||orderIndex>=permissionRoleOrder.length-1?'disabled':''}>Move down</button>${!['member','leader','commander'].includes(role)?`<button type="button" class="danger" data-delete-role="${esc(role)}" ${!canManageRanks('rank_delete')||!belowActor?'disabled':''}>Delete rank</button>`:''}</div>`;
    return `<article class="role-permission-card" data-permission-role="${role}"><header><div><span class="role-kicker">RANK ${orderIndex+1} · ROLE PROFILE</span><h3>${roleLabel}</h3></div><span class="permission-count">${enabled} enabled</span></header>${rankTools}${canManageRoleProfiles()?roleTabBar(role):''}<div class="role-tabbed" data-role-tabs="${esc(role)}" data-active-tab="${roleActiveTab[role]||'pages'}"><div class="role-permission-groups">${canManageRoleProfiles()?(groups || '<p class="muted">No permissions match your search.</p>'):'<p class="muted">Rank actions are available according to your individual rank permissions. Editing permission profiles requires Operation Command access.</p>'}</div>${canManageRoleProfiles()?scopeEditor(role):''}${canManageRoleProfiles()?previewEditor(role):''}</div>${canManageRoleProfiles()?roleWarningsHtml(role):''}${canManageRoleProfiles()?`<button type="button" class="role-undo" data-undo-permissions="${esc(role)}">Undo unsaved changes</button>`:''}${canManageRoleProfiles()?`<button type="button" class="primary" data-save-permissions="${role}">Save ${roleLabel} permissions</button>`:''}</article>`;
  }).join('');
  panel.querySelectorAll('[data-indeterminate="true"]').forEach(input => { input.indeterminate = true; });
}
async function loadRolePermissions() {
  const status = document.querySelector('#permissionStatus');
  try {
    const result = await api('/api/role-permissions');
    rolePermissionProfiles = result.profiles || {};
    rolePermissionScopes = result.scopes || {};
    rolePermissionRanks = result.ranks || [];
    snapshotRoleProfiles();
    permissionRoleOrder = result.order || [];
    permissionEditorCapabilities = result.actor_permissions || {};
    editablePermissionKeys = Array.isArray(result.keys) ? result.keys : Object.keys(permissionEditorCapabilities).filter(key => permissionEditorCapabilities[key] === true);
    renderRolePermissions();
    rolePermissionsLoaded = true;
    status.textContent = 'Role settings loaded. Changes apply to every account with that role.';
    status.className = 'permission-status';
  } catch (error) {
    status.textContent = `Could not load role permissions: ${error.message}`;
    status.className = 'permission-status error';
  }
}
document.querySelector('#permissionSearch').addEventListener('input', renderRolePermissions);
document.querySelector('#permissionRoleNav')?.addEventListener('click', event => {
  const button = event.target.closest('[data-select-permission-role]');
  if (!button) return;
  selectedPermissionRole = button.dataset.selectPermissionRole;
  renderRolePermissions();
});
document.querySelector('#rolePermissionsPanel').addEventListener('change', event => {
  const master = event.target.closest('[data-permission-parent]');
  if (master) {
    const role=master.closest('[data-permission-role]').dataset.permissionRole;
    const entry=permissionGroups.flatMap(group=>group.items).find(item=>!Array.isArray(item)&&item.key===master.dataset.permissionParent);
    if (!entry) return;
    for(const [key] of entry.children) if(editablePermissionKeys.includes(key)&&(currentUser?.role==='admin'||permissionEditorCapabilities[key]===true)) rolePermissionProfiles[role][key]=master.checked;
    rolePermissionProfiles[role][entry.key]=entry.children.every(([key])=>rolePermissionProfiles[role][key]===true);
    renderRolePermissions();
    return;
  }
  const input = event.target.closest('[data-permission-key]');
  if (!input) return;
  const role = input.closest('[data-permission-role]').dataset.permissionRole;
  if (input.checked && currentUser?.role !== 'admin' && permissionEditorCapabilities[input.dataset.permissionKey] !== true && !rolePermissionProfiles[role]?.[input.dataset.permissionKey]) {
    input.checked = false;
    return;
  }
  rolePermissionProfiles[role][input.dataset.permissionKey] = input.checked;
  const parentEntry=permissionGroups.flatMap(group=>group.items).find(item=>!Array.isArray(item)&&item.children.some(child=>child[0]===input.dataset.permissionKey));
  if(parentEntry) rolePermissionProfiles[role][parentEntry.key]=parentEntry.children.every(([key])=>rolePermissionProfiles[role][key]===true);
  if (currentUser?.role !== 'admin' && permissionEditorCapabilities[input.dataset.permissionKey] !== true && !input.checked) input.disabled = true;
  const count = input.closest('[data-permission-role]').querySelector('.permission-count');
  count.textContent = `${Object.values(rolePermissionProfiles[role]).filter(Boolean).length} enabled`;
  if(parentEntry) renderRolePermissions();
});
document.querySelector('#rolePermissionsPanel').addEventListener('click', async event => {
  const move=event.target.closest('[data-rank-move]');
  if(move){
    move.disabled=true;
    try{const result=await api('/api/role-permissions/order',{method:'POST',body:JSON.stringify({role:move.dataset.rankRole,direction:move.dataset.rankMove})});permissionRoleOrder=result.order||permissionRoleOrder;renderRolePermissions();}
    catch(error){document.querySelector('#permissionStatus').textContent=`Could not reorder rank: ${error.message}`;document.querySelector('#permissionStatus').className='permission-status error';}
    return;
  }
  const rename=event.target.closest('[data-rename-rank]');
  if(rename){
    const role=rename.dataset.renameRank,input=document.querySelector(`[data-rank-name="${CSS.escape(role)}"]`),name=input?.value.trim();
    if(!name)return;
    rename.disabled=true;
    try{const result=await api('/api/role-permissions/name',{method:'POST',body:JSON.stringify({role,display_name:name})});const item=permissionRoleOrder.find(entry=>entry.role===role);if(item)item.display_name=result.display_name;renderRolePermissions();document.querySelector('#permissionStatus').textContent=`Rank renamed to ${name}.`;document.querySelector('#permissionStatus').className='permission-status success';}
    catch(error){document.querySelector('#permissionStatus').textContent=`Could not rename rank: ${error.message}`;document.querySelector('#permissionStatus').className='permission-status error';rename.disabled=false;}
    return;
  }
  const remove=event.target.closest('[data-delete-role]');
  if(remove){
    const role=remove.dataset.deleteRole;
    if(!window.confirm(`Delete the ${roleTitle(role)} rank? It must have no assigned accounts.`)) return;
    remove.disabled=true;
    try{await api(`/api/role-permissions/${encodeURIComponent(role)}`,{method:'DELETE'});delete rolePermissionProfiles[role];permissionRoleOrder=permissionRoleOrder.filter(item=>item.role!==role);selectedPermissionRole='';renderRolePermissions();document.querySelector('#permissionStatus').textContent=`${roleTitle(role)} deleted.`;document.querySelector('#permissionStatus').className='permission-status success';}
    catch(error){document.querySelector('#permissionStatus').textContent=`Could not delete rank: ${error.message}`;document.querySelector('#permissionStatus').className='permission-status error';remove.disabled=false;}
    return;
  }
  const button = event.target.closest('[data-save-permissions]');
  if (!button) return;
  const role = button.dataset.savePermissions, status = document.querySelector('#permissionStatus');
  button.disabled = true; status.textContent = 'Saving permissions...'; status.className = 'permission-status';
  try {
    const result = await api('/api/role-permissions', { method: 'POST', body: JSON.stringify({ role, permissions: rolePermissionProfiles[role], scopes: scopesFromDom(role) }) });
    const persisted = await api('/api/role-permissions');
    const savedProfile = persisted.profiles?.[role];
    if (!savedProfile || Object.keys(rolePermissionProfiles[role]).some(key => Boolean(savedProfile[key]) !== Boolean(result.permissions?.[key]))) {
      throw new Error('The saved permissions could not be verified. Reload and try again.');
    }
    rolePermissionProfiles = persisted.profiles || rolePermissionProfiles;
    rolePermissionScopes = persisted.scopes || rolePermissionScopes;
    rolePermissionRanks = persisted.ranks || rolePermissionRanks;
    snapshotRoleProfiles();
    permissionRoleOrder = persisted.order || permissionRoleOrder;
    permissionEditorCapabilities = persisted.actor_permissions || permissionEditorCapabilities;
    editablePermissionKeys = Array.isArray(persisted.keys) ? persisted.keys : editablePermissionKeys;
    renderRolePermissions();
    status.textContent = `${role === 'member' ? 'Member' : role === 'leader' ? 'Leader' : 'Commander'} permissions saved.`;
    status.className = 'permission-status success';
  } catch (error) {
    status.textContent = `Save failed: ${error.message}`; status.className = 'permission-status error';
  } finally { button.disabled = false; }
});
// Starting points for a new role. Each template only lists permissions; the admin reviews them before saving.
const roleTemplates = {
    promotion_emt: { label: 'Promotions: EMT to AEMT', permissions: ['promotion_manage', 'eligible_view', 'members_view', 'profile_view'], scopes: { promote: { from: ['EMT'], to: ['AEMT'] }, view: { from: ['EMT', 'AEMT'] } } },
    fort_training: { label: 'FORT training and LOI', permissions: ['training_fort_manage', 'fort_training_view', 'fort_instructor_view', 'fort_loi_view', 'loi_manage', 'training_hours_view', 'training_hours_manage'] },
    hert_training: { label: 'HERT training and LOI', permissions: ['training_hert_manage', 'hert_certified_view', 'hert_instructor_view', 'hert_loi_view', 'loi_manage', 'training_hours_view', 'training_hours_manage'] },
    read_only: { label: 'Read only: members and statistics', permissions: ['members_view', 'profile_view', 'statistics_view', 'eligible_view'] },
};
function populateRoleStartOptions() {
    const select = document.querySelector('#newPermissionRoleFrom');
    if (!select) return;
    const roles = Object.keys(rolePermissionProfiles).filter(role => role !== 'admin');
    select.innerHTML = `<option value="">Empty (no permissions)</option>`
        + `<optgroup label="Copy from a role">${roles.map(role => `<option value="role:${esc(role)}">${esc(roleTitle(role))}</option>`).join('')}</optgroup>`
        + `<optgroup label="Templates">${Object.entries(roleTemplates).map(([key, t]) => `<option value="template:${key}">${esc(t.label)}</option>`).join('')}</optgroup>`;
}
// Builds the permissions and limits for a new role from the chosen starting point.
function startingProfileFor(choice) {
    const empty = Object.fromEntries(editablePermissionKeys.map(key => [key, false]));
    if (choice.startsWith('role:')) {
        const from = choice.slice(5);
        return { permissions: { ...empty, ...Object.fromEntries(editablePermissionKeys.map(key => [key, rolePermissionProfiles[from]?.[key] === true])) }, scopes: JSON.parse(JSON.stringify(rolePermissionScopes[from] || {})) };
    }
    if (choice.startsWith('template:')) {
        const template = roleTemplates[choice.slice(9)];
        if (!template) return { permissions: empty, scopes: {} };
        return { permissions: { ...empty, ...Object.fromEntries(template.permissions.filter(key => editablePermissionKeys.includes(key)).map(key => [key, true])) }, scopes: JSON.parse(JSON.stringify(template.scopes || {})) };
    }
    return { permissions: empty, scopes: {} };
}
document.querySelector('#createPermissionRole')?.addEventListener('click', async () => {
  const input = document.querySelector('#newPermissionRole'), role = input.value.trim().toLowerCase().replace(/\s+/g,'_');
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(role)) return setMessage('Use 2–32 letters, numbers, underscores, or hyphens for the role name.', 'error');
  if (rolePermissionProfiles[role]) return setMessage('That role already exists.', 'error');
  const start = startingProfileFor(document.querySelector('#newPermissionRoleFrom')?.value || '');
  const empty = start.permissions;
  try {
    await api('/api/role-permissions', {method:'POST',body:JSON.stringify({role,permissions:empty,scopes:start.scopes})});
    rolePermissionProfiles[role] = empty;
    rolePermissionScopes[role] = start.scopes;
    snapshotRoleProfiles();
    permissionRoleOrder.push({role,sort_order:Math.max(4,...permissionRoleOrder.map(item=>Number(item.sort_order)||0))+1});
    permissionRoleOrder.sort((a,b)=>a.sort_order-b.sort_order||a.role.localeCompare(b.role));
    selectedPermissionRole = role;
    input.value = '';
    renderRolePermissions();
    document.querySelector('#permissionStatus').textContent = `${roleTitle(role)} created. Set its permissions and save.`;
    document.querySelector('#permissionStatus').className = 'permission-status success';
  } catch (error) { setMessage(`Could not create role: ${error.message}`, 'error'); }
});
document.querySelector('#permissionMemberSearch')?.addEventListener('input', event => {
  const results = document.querySelector('#permissionMemberResults'), query = event.target.value.trim().toLowerCase();
  if (!query) { results.hidden = true; results.replaceChildren(); return; }
  const matches = allAccounts().filter(account => `${account.display_name||account.name} ${account.callsign}`.toLowerCase().includes(query)).slice(0,8);
  results.innerHTML = matches.map(account => `<button type="button" data-permission-member="${esc(account.account_id)}">${esc(account.display_name||account.name)} · ${esc(account.callsign||'')}</button>`).join('') || '<span class="muted">No members found.</span>';
  results.hidden = false;
});
document.querySelector('#permissionMemberResults')?.addEventListener('click', event => {
  const button = event.target.closest('[data-permission-member]');
  if (!button) return;
  const account = allAccounts().find(item => item.account_id === button.dataset.permissionMember);
  if (account) openIndividualPermissions(account);
});

let individualPermissionTarget = null;
let individualPermissionState = null;
let individualPermissionMode = 'role';
function individualRoleLabel(role) { return roleTitle(role); }
function renderIndividualPermissions() {
  const panel = document.querySelector('#individualPermissionsList');
  if (!panel || !individualPermissionState) return;
  const { defaults, overrides } = individualPermissionState;
  const mode = document.querySelector('#individualPermissionMode');
  const customize = document.querySelector('#individualPermissionsCustomize');
  const restore = document.querySelector('#individualPermissionsReset');
  const save = document.querySelector('#individualPermissionsSave');
  mode.querySelector('[value="role"]').textContent = `Role default (${individualRoleLabel(individualPermissionState.role)})`;
  mode.value = individualPermissionMode;
  const editing = individualPermissionMode === 'customize';
  panel.hidden = !editing;
  customize.hidden = editing;
  restore.hidden = !editing;
  save.hidden = !editing;
  if (!editing) { panel.replaceChildren(); return; }
  panel.innerHTML = permissionGroups.map(group => `<details class="permission-group" open><summary>${esc(group.name)}</summary>${group.items.map(entry => (Array.isArray(entry)?[entry]:entry.children).map(([key,label,description]) => {
    const checked = Object.hasOwn(overrides,key) ? overrides[key] : Boolean(defaults[key]);
    return `<label class="permission-item"><input type="checkbox" data-individual-permission="${key}" ${checked?'checked':''}><span><strong>${esc(label)}</strong><small>${esc(description)}</small></span></label>`;
  }).join('')).join('')}</details>`).join('');
}
async function openIndividualPermissions(account) {
  if (currentUser?.role !== 'admin') return;
  individualPermissionTarget = account;
  const dialog = document.querySelector('#individualPermissionsDialog');
  document.querySelector('#individualPermissionsTitle').textContent = `Permissions: ${account.display_name || account.name}`;
  document.querySelector('#individualPermissionsStatus').textContent = 'Loading permissions...';
  dialog.hidden = false;
  dialog.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    individualPermissionState = await api(`/api/leaders/${encodeURIComponent(account.account_id)}/permissions`);
    individualPermissionMode = Object.keys(individualPermissionState.overrides || {}).length ? 'customize' : 'role';
    renderIndividualPermissions();
    document.querySelector('#individualPermissionsStatus').textContent = `Role defaults: ${individualRoleLabel(individualPermissionState.role)}. Customize starts with these permissions; Restore to Role removes the personal changes without changing the account role.`;
  } catch (error) {
    document.querySelector('#individualPermissionsStatus').textContent = `Could not load permissions: ${error.message}`;
  }
}
document.querySelector('#individualPermissionsList')?.addEventListener('change', event => {
  const input = event.target.closest('[data-individual-permission]');
  if (!input || !individualPermissionState) return;
  const key = input.dataset.individualPermission;
  if (input.checked === Boolean(individualPermissionState.defaults[key])) delete individualPermissionState.overrides[key];
  else individualPermissionState.overrides[key] = input.checked;
});
document.querySelector('#individualPermissionMode')?.addEventListener('change', async event => {
  if (!individualPermissionState) return;
  if (event.currentTarget.value === 'customize') {
    individualPermissionMode = 'customize';
    renderIndividualPermissions();
    document.querySelector('#individualPermissionsStatus').textContent = `Customize ${individualRoleLabel(individualPermissionState.role)} permissions. The list starts with the role defaults.`;
    return;
  }
  if (individualPermissionMode !== 'customize') {
    individualPermissionMode = 'role';
    renderIndividualPermissions();
    return;
  }
  if (!individualPermissionTarget || !window.confirm('Restore this account to its role permissions? Its account role will stay the same.')) {
    event.currentTarget.value = 'customize';
    return;
  }
  const selector = event.currentTarget;
  selector.disabled = true;
  try {
    individualPermissionState = await api(`/api/leaders/${encodeURIComponent(individualPermissionTarget.account_id)}/permissions`, {method:'POST',body:JSON.stringify({reset:true})});
    individualPermissionMode = 'role';
    renderIndividualPermissions();
    document.querySelector('#individualPermissionsStatus').textContent = `Restored ${individualRoleLabel(individualPermissionState.role)} permissions. The account role was not changed.`;
  } catch(error) {
    selector.value = 'customize';
    document.querySelector('#individualPermissionsStatus').textContent = `Restore failed: ${error.message}`;
  } finally { selector.disabled = false; }
});
document.querySelector('#individualPermissionsCustomize')?.addEventListener('click', () => {
  individualPermissionMode = 'customize';
  renderIndividualPermissions();
});
document.querySelector('#individualPermissionsClose')?.addEventListener('click', () => { document.querySelector('#individualPermissionsDialog').hidden = true; });
document.querySelector('#individualPermissionsReset')?.addEventListener('click', async event => {
  if (!individualPermissionTarget || !window.confirm('Restore this account to its role permissions? Its account role will stay the same.')) return;
  const button = event.currentTarget; button.disabled = true;
  try {
    individualPermissionState = await api(`/api/leaders/${encodeURIComponent(individualPermissionTarget.account_id)}/permissions`, {method:'POST',body:JSON.stringify({reset:true})});
    individualPermissionMode = 'role';
    renderIndividualPermissions();
    document.querySelector('#individualPermissionsStatus').textContent = `Restored ${individualRoleLabel(individualPermissionState.role)} permissions. The account role was not changed.`;
  } catch(error) { document.querySelector('#individualPermissionsStatus').textContent = `Reset failed: ${error.message}`; }
  finally { button.disabled = false; }
});
document.querySelector('#individualPermissionsSave')?.addEventListener('click', async event => {
  if (!individualPermissionTarget || !individualPermissionState) return;
  const overrides = {};
  document.querySelectorAll('[data-individual-permission]').forEach(input => {
    const key=input.dataset.individualPermission;
    if(input.checked!==Boolean(individualPermissionState.defaults[key])) overrides[key]=input.checked;
  });
  const button=event.currentTarget; button.disabled=true;
  try {
    individualPermissionState=await api(`/api/leaders/${encodeURIComponent(individualPermissionTarget.account_id)}/permissions`,{method:'POST',body:JSON.stringify({overrides})});
    renderIndividualPermissions();
    document.querySelector('#individualPermissionsStatus').textContent='Individual permissions saved.';
  } catch(error) { document.querySelector('#individualPermissionsStatus').textContent=`Save failed: ${error.message}`; }
  finally { button.disabled=false; }
});

document.querySelector('#accountRows').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (button) performAction(button);
});
document.querySelectorAll('.admin-tabs button').forEach(button => button.addEventListener('click', () => {
  selectedStatus = button.dataset.status;
  document.querySelectorAll('.admin-tabs button').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
  renderAccounts();
}));
document.querySelector('#accountSearch').addEventListener('input', renderAccounts);
document.querySelector('#refreshAccounts').addEventListener('click', loadAccounts);
window.setInterval(() => { if (!document.hidden) void loadAccounts(true); }, 30000);
const notificationButton = document.querySelector('#notificationButton');
notificationButton.addEventListener('click', async () => {
  const panel = document.querySelector('#notificationPanel');
  panel.hidden = !panel.hidden;
  notificationButton.setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) await loadNotifications();
});
document.querySelector('#markNotificationsRead').addEventListener('click', () => markNotificationsRead());
// Clears only this account's view of notifications. Other people keep theirs.
document.querySelector('#clearMyNotifications').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api('/api/notifications/clear-mine', { method: 'POST', body: '{}' });
    notificationItems = [];
    try { localStorage.setItem(notificationCacheKey, '[]'); } catch {}
    renderNotifications();
  } catch (error) {
    setMessage(`Could not clear notifications: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
  }
});
document.querySelector('#notificationList').addEventListener('click', async event => {
  const button = event.target.closest('[data-notification-id]');
  if (!button) return;
  const item = notificationItems.find(entry => Number(entry.id) === Number(button.dataset.notificationId));
  if (!item) return;
  await markNotificationsRead([item.id]);
  if (item.kind === 'request') {
    selectedStatus = 'pending';
    document.querySelectorAll('.admin-tabs button').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.status === 'pending')));
    renderAccounts();
    document.querySelector('#accountsHeading').scrollIntoView({ behavior: 'smooth' });
  } else if (item.callsign) {
    const target = new URL('/', location.origin);
    target.searchParams.set('notification_id', String(item.id));
    location.assign(target.toString());
    return;
  }
  document.querySelector('#notificationPanel').hidden = true;
  notificationButton.setAttribute('aria-expanded', 'false');
});
document.addEventListener('click', event => {
  if (event.target.closest('.notification-control')) return;
  document.querySelector('#notificationPanel').hidden = true;
  notificationButton.setAttribute('aria-expanded', 'false');
});
document.querySelector('#logoutButton').addEventListener('click', () => {
  window.lvfrLogout?.();
});

const commandSections = {
  accounts: document.querySelector('#commandAccountsSection'),
  permissions: document.querySelector('#commandPermissionsSection'),
  history: document.querySelector('#commandHistorySection'),
};
function showCommandSection(name, updateHash = false) {
  if (!canManageCommandAccounts() && !canAccessPermissionPanel()) return;
  if (name === 'permissions' && !canAccessPermissionPanel()) {
    if (!canManageCommandAccounts()) return;
    name = 'accounts';
  }
  if (name !== 'permissions' && !canManageCommandAccounts()) name = 'permissions';
  if (!commandSections[name]) return;
  Object.entries(commandSections).forEach(([key, section]) => { section.hidden = key !== name; });
  document.querySelectorAll('[data-command-section]').forEach(button => {
    const active = button.dataset.commandSection === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (updateHash) {
    const anchors = { accounts: 'accountsHeading', permissions: 'permissionsHeading', history: 'auditHeading' };
    history.replaceState(null, '', `#${anchors[name]}`);
  }
}
document.querySelectorAll('[data-command-section]').forEach(button => button.addEventListener('click', () => showCommandSection(button.dataset.commandSection, true)));
function selectCommandSectionFromHash() {
  const sections = { '#permissionsHeading': 'permissions', '#auditHeading': 'history', '#accountsHeading': 'accounts' };
  const section = sections[location.hash];
  if (section) showCommandSection(section);
}
window.addEventListener('hashchange', selectCommandSectionFromHash);
selectCommandSectionFromHash();
loadAccounts();
try {
  const cached = JSON.parse(localStorage.getItem(notificationCacheKey) || 'null');
  if (Array.isArray(cached)) { notificationItems = cached; renderNotifications(); }
} catch {}
loadNotifications();
window.setInterval(() => { if (!document.hidden) void loadNotifications(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void loadNotifications(); });