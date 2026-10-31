const messageEl = document.querySelector('#adminMessage');
const accountRows = document.querySelector('#accountRows');
const auditRows = document.querySelector('#auditRows');
const countEl = document.querySelector('#accountCount');
let overview = { approved: [], pending: [], deactivated: [], audit: [] };
const accountStatusKey = 'lvfr.accounts.status';
const accountStatuses = ['all', 'pending', 'approved', 'deactivated'];
let selectedStatus = (() => { try { const saved = sessionStorage.getItem(accountStatusKey); return accountStatuses.includes(saved) ? saved : 'all'; } catch { return 'all'; } })();
function setSelectedStatus(status) {
  selectedStatus = accountStatuses.includes(status) ? status : 'all';
  try { sessionStorage.setItem(accountStatusKey, selectedStatus); } catch {}
}
let currentUser = null;
let rolePermissionsLoaded = false;
let rolePermissionsLoadPromise = null;
const cachedNotificationUser = window.lvfrCachedUser?.();
const notificationCacheKey = `lvfr.portal.notifications.v2:${cachedNotificationUser?.account_id || cachedNotificationUser?.id || 'current'}`;

try { Object.keys(localStorage).filter(key => key.startsWith('lvfr.portal.notifications.v1:')).forEach(key => localStorage.removeItem(key)); } catch {}

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
// Position of a role for the page (RANK 1 is the top). Unknown roles are left to the server to decide.
function roleOrderForPage(role) {
  return permissionRoleOrder.find(item => item.role === String(role || '').toLowerCase())?.sort_order;
}
function canEditRole(role) {
  if (currentUser?.role === 'admin') return true;
  const mine = roleOrderForPage(currentUser?.role), theirs = roleOrderForPage(role);
  if (mine == null || theirs == null) return true;
  return theirs > mine;
}
function canClearAccountAudit() {
  return currentUser?.role === 'admin' || currentUser?.permissions?.logs_delete_d1 === true;
}
function canManageRanks(permission) { return currentUser?.role === 'admin' || currentUser?.permissions?.role_manage === true || currentUser?.permissions?.operation_command_access === true || currentUser?.permissions?.[permission] === true; }
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
  if (!(await lvfrConfirm({ title: "Clear Notifications", message: "Clear all notifications for everyone? They will be deleted from the website and the Google Sheet.", confirmText: "Clear all", danger: true }))) return;
  const button = document.querySelector("#clearAllNotifications");
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
// Delegated, so the button works even if it is shown after the page loads.
document.addEventListener('click', event => {
  if (event.target.closest('#clearAllNotifications')) clearAllNotificationsHandler(event);
});
function configureOperationAccess() {
  const allowed = canAccessPermissionPanel(), accountManager = canManageCommandAccounts();
  document.querySelector('#openFullCleaning')?.toggleAttribute('hidden', currentUser?.role !== 'admin');
  document.querySelector('#clearAllNotifications')?.toggleAttribute('hidden', !canClearAllNotifications());
  document.querySelector('[data-command-section="accounts"]')?.toggleAttribute('hidden', !accountManager);
  document.querySelector('[data-command-section="history"]')?.toggleAttribute('hidden', !accountManager);
  document.querySelector('[data-command-section="discord"]')?.toggleAttribute('hidden', !canUseDiscord());
  applyDiscordPermissions();
  document.querySelector('[data-command-section="permissions"]')?.toggleAttribute('hidden', !allowed);
  document.querySelector('.permission-member-picker')?.toggleAttribute('hidden', !canManageRoleProfiles());
  document.querySelector('#clearAccountAuditBtn')?.toggleAttribute('hidden', !canClearAccountAudit());
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
  const resetButton = `<button type="button" data-action="reset-password" data-id="${id}">Reset password</button>`;
  return `${memberButton}${roleButton}${permissionButton}${resetButton}${deactivateButton}${deleteButton}`;
}
// Shows how many accounts are in each status tab.
function updateStatusCounts() {
  const accounts = allAccounts() || [];
  const counts = { all: accounts.length, pending: 0, approved: 0, deactivated: 0 };
  accounts.forEach(account => { if (counts[account.status] !== undefined) counts[account.status]++; });
  document.querySelectorAll('[data-status-count]').forEach(el => { el.textContent = `(${counts[el.dataset.statusCount] ?? 0})`; });
}
function renderAccounts() {
  updateStatusCounts();
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
      <td data-label="Created">${esc(window.lvfrDateOnly(account.requested_at) || '—')}</td><td data-label="Actions"><div class="admin-actions">${accountActions(account)}</div></td></tr>`).join('');
}
function renderAudit() {
  const query = String(document.querySelector('#auditSearch')?.value || '').trim().toLocaleLowerCase();
  const rows = (overview.audit || []).filter(entry => !query || [entry.created_at, entry.name, entry.callsign, entry.action, entry.actor_name]
    .join(' ').toLocaleLowerCase().includes(query));
  auditRows.innerHTML = rows.length ? rows.map(entry => `
    <tr><td data-label="Date">${esc(window.lvfrDateOnly ? window.lvfrDateOnly(entry.created_at) || '—' : entry.created_at || '—')}</td><td data-label="Account">${esc(entry.name || 'N/A')}${entry.callsign ? ` (${esc(entry.callsign)})` : ''}</td>
      <td data-label="Action">${esc(String(entry.action || '—').replace(/\bAdmin\b/g, 'Operation'))}</td><td data-label="By">${esc(String(entry.actor_name || '—').replace(/\bWeb Admin\b/g, 'Web Operation'))}</td></tr>`).join('')
    : `<tr><td colspan="4">${query ? 'No matching history.' : 'No account history yet.'}</td></tr>`;
}
document.querySelector('#auditSearch')?.addEventListener('input', renderAudit);
document.querySelector('#clearAccountAuditBtn')?.addEventListener('click', async event => {
  if (!canClearAccountAudit()) return;
  const button = event.currentTarget;
  if (!currentUser?.is_admin) return;
  if (!(await lvfrConfirm({ title: "Clear Account Audit", message: "The audit is cleared from D1 and the website. Google Sheets will remain unchanged.", confirmText: "Clear", danger: true }))) return;
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
async function runCleaning(scope) {
  if (!currentUser?.is_admin) return;
  const full = scope === 'full';
  const items = cleanAllLogs.checked ? ['all'] : [...fullCleaningDialog.querySelectorAll('[data-clean-log]:checked')].map(input => input.dataset.cleanLog);
  const status = document.querySelector('#fullCleaningStatus');
  if (!items.length) { status.textContent = 'Select at least one log or choose All.'; status.className = 'admin-status error'; return; }
  const description = cleanAllLogs.checked ? 'all logs and notifications' : `${items.length} selected item(s)`;
  const where = full ? 'D1 and Google Sheets' : 'D1 only';
  if (!(await lvfrConfirm({ title: full ? 'Full Cleaning' : 'Cleaning', subject: description, message: `This is removed from ${where} and cannot be undone.`, confirmText: 'Delete', danger: true }))) return;
  const buttons = [...fullCleaningDialog.querySelectorAll('.full-cleaning-footer button')];
  buttons.forEach(button => { button.disabled = true; });
  status.textContent = 'Cleaning selected data...'; status.className = 'admin-status';
  try {
    await api('/api/logs/clean', { method: 'POST', body: JSON.stringify({ items, scope: full ? 'full' : 'd1' }) });
    const accountId = currentUser.account_id || currentUser.id || 'current';
    const knownLogs = ['promotion','callsign','termination','training','training_time','loi','exam','note','activity','instructor','do_not_promote','do_not_terminate'];
    try { knownLogs.forEach(kind => sessionStorage.removeItem(`lvfr.log.${accountId}.${kind}.v1`)); } catch {}
    if (items.includes('account_audit') || items.includes('all')) { overview.audit = []; renderAudit(); void loadAccounts(true); }
    if (items.includes('notifications') || items.includes('all')) {
      try { localStorage.setItem(notificationCacheKey, '[]'); } catch {}
      void window.lvfrNotifications?.load();
      window.lvfrNotifications?.render();
    }
    status.textContent = full
      ? 'Selected logs and notifications were removed from D1 and Google Sheets.'
      : 'Selected logs and notifications were removed from D1. Google Sheets was not changed.';
    status.className = 'admin-status success';
    window.setTimeout(() => fullCleaningDialog.close(), 1000);
  } catch (error) {
    status.textContent = `Cleanup failed: ${error.message}`;
    status.className = 'admin-status error';
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}
document.querySelector('#confirmFullCleaning')?.addEventListener('click', () => runCleaning('full'));
document.querySelector('#confirmCleaningD1')?.addEventListener('click', () => runCleaning('d1'));
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
async function resetAccountPassword(button, account) {
  const label = account.display_name || account.name;
  const confirmed = await lvfrConfirm({ title: 'Reset password', subject: label, rows: [['Action', 'Reset password']], message: `Create a temporary password for ${label}? Their current password stops working and every device they are signed in on is signed out.`, confirmText: 'Reset', danger: true });
  if (!confirmed) return;
  button.disabled = true;
  try {
    const result = await api(`/api/leaders/${encodeURIComponent(account.account_id)}/reset-password`, { method: 'POST' });
    setMessage(`Password reset for ${label}.`, 'success');
    // The password is shown once. It is not stored anywhere readable, so copy it before closing this box.
    window.prompt(`Temporary password for ${label}. Send it to them privately; it is not shown again.`, result.temporary_password);
  } catch (error) {
    setMessage(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}
async function performAction(button) {
  const { action, id } = button.dataset;
  const account = allAccounts().find(row => row.account_id === id);
  if (!account) return;
  if (action === 'permissions') return openIndividualPermissions(account);
  if (action === 'reset-password') return resetAccountPassword(button, account);
  const accountLabel = account.display_name || account.name;
  const confirmations = {
    deny: `Deny the account request for ${accountLabel}?`,
    deactivate: `Deactivate ${accountLabel}'s account?`,
    delete: `Permanently delete ${accountLabel}'s account? This cannot be undone.`,
    demote: account.role === 'admin' ? `Change ${accountLabel} from Operation to Commander?` : `Change ${accountLabel} from Commander to Leader?`,
    member: `Limit ${accountLabel} to Watch Command access?`,
  };
  if (confirmations[action] && !(await lvfrConfirm({ title: "Account Change", subject: accountLabel, rows: [["Action", action]], message: confirmations[action], confirmText: "Confirm", danger: ["delete", "deactivate", "demote"].includes(action) }))) return;
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
  {
    "name": "EMS Operations",
    "items": [
      [
        "notifications_clear_all",
        "Clear notifications (everyone)",
        "Delete all notifications for everyone from D1 and Google Sheets. Button appears in Operation Command."
      ],
      [
        "notif_termination",
        "Termination notifications",
        "Receive termination notifications and view the Termination log."
      ],
      [
        "notif_inactive",
        "Due to Activity notifications",
        "Receive notifications when members are Can Be Terminated for activity, and view the Due to Activity list."
      ],
      [
        "notif_overdue",
        "Training Overdue notifications",
        "Receive notifications when EMT members are overdue for Basic or Advanced FORT, and view the Training Overdue list."
      ],
      [
        "notif_promotion",
        "Promotion notifications",
        "Receive promotion notifications and view the Promotion log."
      ],
      [
        "notif_eligible",
        "Eligible notifications",
        "Receive eligible-for-promotion notifications and view the Eligible list."
      ],
      [
        "notif_callsign",
        "Callsign notifications",
        "Receive callsign notifications and view the Callsign log."
      ],
      [
        "notif_training",
        "Training notifications",
        "Receive training notifications and view the Training log."
      ],
      [
        "notif_training_time",
        "Training Hours notifications",
        "Receive Training Hours notifications and view the Training Time log."
      ],
      [
        "notif_loi",
        "LOI notifications",
        "Receive LOI notifications and view the LOI log."
      ],
      [
        "notif_exam",
        "Exam notifications",
        "Receive exam notifications and view the Exam log."
      ],
      [
        "notif_note",
        "Note notifications",
        "Receive note notifications and view the Notes log."
      ],
      [
        "notif_activity",
        "Activity notifications",
        "Receive activity notifications and view the Activity log."
      ],
      [
        "notif_instructor",
        "Instructor notifications",
        "Receive instructor notifications and view the Instructor log."
      ],
      [
        "notif_do_not_promote",
        "Do Not Promote notifications",
        "Receive Do Not Promote notifications and view the Do Not Promote log."
      ],
      [
        "notif_do_not_terminate",
        "Do Not Terminate notifications",
        "Receive Do Not Terminate notifications and view the Do Not Terminate log."
      ],
      [
        "portal_access",
        "EMS Operations",
        "Open the EMS Operations application."
      ],
      [
        "members_view",
        "Members list",
        "View the roster and member list."
      ],
      [
        "eligible_view",
        "Eligible list",
        "View promotion eligibility."
      ],
      [
        "promotion_access",
        "Access Promotion",
        "Open the Promotion page and view eligible members."
      ],
      [
        "profile_view",
        "Member profiles",
        "Open member View / Manage details."
      ],
      [
        "inactive_view",
        "Termination list",
        "View the Termination list: members due to activity and EMTs overdue for training."
      ],
      {
        "key": "logs_view",
        "label": "Members Log (all)",
        "description": "Allow every log tab.",
        "children": [
          [
            "promotion_log_view",
            "Promotion log",
            "View promotion and rank-change history."
          ],
          [
            "callsign_log_view",
            "Callsign log",
            "View callsign-change history."
          ],
          [
            "termination_log_view",
            "Termination log",
            "View termination history."
          ],
          [
            "training_log_view",
            "Training log",
            "View FORT and HERT training history."
          ],
          [
            "training_hours_log_view",
            "Training Hours log",
            "View Training Hours changes."
          ],
          [
            "loi_log_view",
            "LOI log",
            "View LOI history."
          ],
          [
            "exam_log_view",
            "Exam log",
            "View exam history."
          ],
          [
            "note_log_view",
            "Note log",
            "View member-note history."
          ],
          [
            "activity_log_view",
            "Activity log",
            "View activity-status history."
          ],
          [
            "instructor_log_view",
            "Instructor log",
            "View instructor-assignment history."
          ],
          [
            "do_not_promote_log_view",
            "Do Not Promote log",
            "View when members were added to or removed from the Do Not Promote list, and by whom."
          ],
          [
            "do_not_terminate_log_view",
            "Do Not Terminate log",
            "View when members were added to or removed from the Do Not Terminate list, and by whom."
          ]
        ]
      },
      [
        "statistics_view",
        "Statistics",
        "View roster statistics."
      ],
      [
        "logs_delete_d1",
        "Delete logs from D1",
        "Delete the selected log from the website database."
      ],
      [
        "logs_clean_full",
        "Full Cleaning",
        "Delete selected logs and notifications from D1 and Google Sheets."
      ],
      {
        "key": "training_view",
        "label": "Training lists (all)",
        "description": "Allow every HERT and FORT training sublist.",
        "children": [
          [
            "hert_certified_view",
            "HERT Certified",
            "View HERT certification records."
          ],
          [
            "hert_instructor_view",
            "HERT Instructor",
            "View HERT instructor records."
          ],
          [
            "hert_loi_view",
            "HERT LOI",
            "View the HERT LOI list."
          ],
          [
            "fort_training_view",
            "FORT Training",
            "View Basic and Advanced FORT records."
          ],
          [
            "fort_instructor_view",
            "FORT Instructor",
            "View FORT instructor records."
          ],
          [
            "fort_loi_view",
            "FORT LOI",
            "View the FORT LOI list."
          ]
        ]
      },
      [
        "training_hours_view",
        "Training Hours: view",
        "View Training Hours records."
      ],
      [
        "do_not_promote_view",
        "Do Not Promote/Terminate: view",
        "View the Do Not Promote and Do Not Terminate lists."
      ],
      [
        "training_fort_manage",
        "Manage FORT training",
        "Change Basic and Advanced FORT status; FORT Instructor status is also required."
      ],
      [
        "training_hert_manage",
        "Manage HERT training",
        "Change HERT status; HERT Instructor status is also required."
      ],
      [
        "training_hours_manage",
        "Manage Training Hours",
        "Add, remove, and change Training Hours records."
      ],
      [
        "loi_manage",
        "Manage LOI lists",
        "Add LOI candidates and record Passed or Failed results."
      ],
      [
        "instructor_manage",
        "Instructor assignments",
        "Assign or remove FORT and HERT Instructor status."
      ],
      [
        "notes_manage",
        "Member notes",
        "Add, edit, or remove member notes."
      ],
      [
        "activity_manage",
        "Activity status",
        "Change member activity status."
      ],
      [
        "exam_manage",
        "Supervisor exam",
        "Add or remove exam status."
      ],
      [
        "rank_date_manage",
        "Rank date",
        "Change a member rank date."
      ],
      [
        "promotion_manage",
        "Promotion",
        "Promote members using available rules."
      ],
      [
        "rank_manage",
        "Rank tools",
        "Force promote, demote, or change rank."
      ],
      [
        "callsign_manage",
        "Callsign changes",
        "Change a member callsign."
      ],
      [
        "termination_manage",
        "Termination",
        "Remove a member from the roster."
      ],
      [
        "do_not_promote_manage",
        "Do Not Promote/Terminate: edit",
        "Add or remove members from the Do Not Promote and Do Not Terminate lists."
      ]
    ]
  },
  {
    "name": "Watch Command",
    "items": [
      [
        "watch_command_view",
        "Watch Command: view",
        "Open Watch Command logs and activity."
      ],
      [
        "watch_command_edit",
        "Watch Command: edit",
        "Create and update Watch Command records."
      ],
      [
        "watch_command_roster",
        "Watch Command: roster lookup",
        "Search member names and callsigns."
      ]
    ]
  },
  {
    "name": "Academy",
    "items": [
      [
        "academy_view",
        "Academy: view",
        "Open the Academy and view recruits and graduates."
      ],
      [
        "academy_manage",
        "Academy: manage",
        "Recruit members, record trainings, patrol, Exit Exams and graduations."
      ],
      [
        "academy_terminate",
        "Academy: terminate",
        "Terminate a recruit whose training is overdue (21 days without the Exit Exam), with the Discord choice."
      ],
      [
        "academy_resign",
        "Academy: resign",
        "Remove a recruit who resigned, with the Discord choice."
      ]
    ]
  },
  {
    "name": "Operation Command",
    "items": [
      [
        "operation_command_access",
        "Edit rank permission",
        "Edit rank permissions, add, rename, delete and reorder ranks, and edit personal permissions. Does not grant account management."
      ]
    ]
  },
  {
    "name": "Discord",
    "items": [
      [
        "discord_view",
        "Discord: view",
        "View Linked members, the Discord status, and the Discord action log."
      ],
      [
        "discord_manage",
        "Discord: manage links",
        "Change a Discord ID or nickname, delink a member, and use the Discord buttons in the member Manage window."
      ],
      [
        "discord_sync_manage",
        "Discord: sync and retry",
        "Run Sync Discord Members and retry failed Discord updates."
      ],
      [
        "discord_log_clear",
        "Discord: clear log",
        "Delete the Discord action log."
      ],
      [
        "discord_settings_manage",
        "Discord: settings",
        "Change the Discord server ID and the Discord role IDs of the ranks on the website."
      ],
      [
        "discord_kick",
        "Discord: kick",
        "Kick a member from the Discord server. Without this permission the Kick option is disabled in Discord choices."
      ]
    ]
  },
  {
    "name": "Sync",
    "items": [
      [
        "sync_view",
        "Sync status",
        "View roster synchronization status."
      ],
      [
        "sync_manage",
        "Sync now",
        "Synchronize with the source sheet."
      ],
      [
        "full_sync_manage",
        "Full roster sync",
        "Run a full roster synchronization from the source sheet."
      ]
    ]
  }
];let rolePermissionProfiles = {};
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
// Rank limits are shown only when the viewer holds one of their permissions.
const scopeBaseKeys = {
    promote: ['promotion_manage', 'rank_manage'], demote: ['rank_manage'], terminate: ['termination_manage'],
    view: ['members_view', 'eligible_view', 'inactive_view', 'promotion_access'],
};
// A notification type is listed only when one of its base permissions is on, as with rank limits.
const notificationBaseKeys = {
    notif_termination: ['termination_manage'], notif_inactive: ['inactive_view'], notif_overdue: ['inactive_view'], notif_promotion: ['promotion_manage', 'rank_manage'],
    notif_eligible: ['eligible_view', 'promotion_access'], notif_callsign: ['callsign_manage'], notif_training: ['training_hert_manage', 'training_fort_manage'],
    notif_training_time: ['training_hours_manage'], notif_loi: ['loi_manage'], notif_exam: ['exam_manage'], notif_note: ['notes_manage'],
    notif_activity: ['activity_manage'], notif_instructor: ['instructor_manage'], notif_do_not_promote: ['do_not_promote_manage'], notif_do_not_terminate: ['do_not_promote_manage'],
};
function notificationEntryAllowed(entry, profile) {
    const key = Array.isArray(entry) ? entry[0] : entry.key;
    const bases = notificationBaseKeys[key];
    if (!bases) return true;
    return bases.some(base => profile?.[base] === true);
}

// Rank limits shown only for the actions this role is allowed to perform. Unchecked ranks are not allowed.
function scopeEditor(role) {
    const profile = rolePermissionProfiles[role] || {};
    const scopes = rolePermissionScopes[role] || {};
    const sections = [
        { scope: 'promote', title: 'Promote', allowed: profile.promotion_manage || profile.rank_manage, fields: [['from', 'Members of rank'], ['to', 'Can promote to rank']] },
        { scope: 'demote', title: 'Demote', allowed: profile.rank_manage, fields: [['from', 'Members of rank'], ['to', 'Can demote to rank']] },
        { scope: 'terminate', title: 'Terminate', allowed: profile.termination_manage, fields: [['from', 'Can terminate members of rank']] },
        { scope: 'view', title: 'Viewing members', allowed: profile.members_view || profile.eligible_view || profile.inactive_view || profile.promotion_access, fields: [['from', 'Can see members of rank (lists and notifications)']] },
    ].filter(section => section.allowed && scopeBaseKeys[section.scope].some(key => editablePermissionKeys.includes(key)));
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
// Readable view of one change: which permissions were turned on or off, and how rank limits moved.
function permissionLabelMap() {
    const map = {};
    const addEntry = entry => {
        if (Array.isArray(entry)) map[entry[0]] = entry[1];
        else {
            if (entry.key) map[entry.key] = entry.label;
            (entry.children || []).forEach(child => { map[child[0]] = child[1]; });
        }
    };
    permissionGroups.forEach(group => group.items.forEach(addEntry));
    return map;
}
function rankListText(list) {
    if (list === undefined || list === null) return 'All ranks';
    return list.length ? list.join(', ') : 'No rank';
}
function permissionChangeDetails(before, after) {
    const labels = permissionLabelMap();
    const b = before?.permissions || {}, a = after?.permissions || {};
    const permissionRows = Object.keys(a)
        .filter(key => Boolean(b[key]) !== Boolean(a[key]))
        .map(key => `<tr><td>${esc(labels[key] || key)}</td><td><span class="change-badge ${a[key] ? 'is-on' : 'is-off'}">${a[key] ? 'Turned on' : 'Turned off'}</span></td></tr>`);
    const scopeNames = { promote: 'Promote', demote: 'Demote', terminate: 'Terminate', view: 'Members visible' };
    const bs = before?.scopes || {}, as = after?.scopes || {};
    const scopeRows = [];
    Object.keys({ ...bs, ...as }).forEach(scope => {
        ['from', 'to'].forEach(field => {
            const was = (bs[scope] || {})[field], now = (as[scope] || {})[field];
            if (JSON.stringify(was ?? null) === JSON.stringify(now ?? null)) return;
            scopeRows.push(`<tr><td>${esc(scopeNames[scope] || scope)} · ${field === 'from' ? 'current rank' : 'target rank'}</td><td>${esc(rankListText(was))} → <strong>${esc(rankListText(now))}</strong></td></tr>`);
        });
    });
    if (!permissionRows.length && !scopeRows.length) return '<p class="muted">No changes were recorded for this entry.</p>';
    return `<table class="permission-change-table"><thead><tr><th>Setting</th><th>Change</th></tr></thead><tbody>${[...permissionRows, ...scopeRows].join('')}</tbody></table>`;
}
let permissionHistoryCanDelete = false;
// Taken from the server, which applies the same check as the delete route.
function canDeletePermissionLog() {
    return permissionHistoryCanDelete;
}
function permissionLogRowsHtml(query) {
    const q = query.trim().toLocaleLowerCase();
    const canDelete = canDeletePermissionLog();
    const rows = permissionHistoryItems.filter(item => !q || [roleTitle(item.role), item.changed_by, item.changed_at, changedPermissionLabels(item.before, item.after)]
        .join(' ').toLocaleLowerCase().includes(q));
    if (!rows.length) return `<tr><td colspan="5">${q ? 'No matching changes.' : 'No changes yet.'}</td></tr>`;
    return rows.map(item => `
        <tr>
            <td>${esc(window.lvfrDateOnly(item.changed_at) || '')}</td>
            <td><strong>${esc(roleTitle(item.role))}</strong></td>
            <td>${esc(item.changed_by || 'Unknown')}</td>
            <td>${esc(changedPermissionLabels(item.before, item.after))}</td>
            <td class="log-actions">
                <button type="button" data-view-history="${item.id}">View</button>
                <button type="button" class="role-undo" data-restore-history="${item.id}">Restore previous</button>
                ${canDelete ? `<button type="button" class="danger" data-delete-history="${item.id}">Delete</button>` : ''}
            </td>
        </tr>
        <tr class="log-detail" data-detail-for="${item.id}" hidden><td colspan="5">${permissionChangeDetails(item.before, item.after)}</td></tr>`).join('');
}
function renderPermissionLogRows() {
    const body = document.querySelector('#permissionLogRows');
    if (body) body.innerHTML = permissionLogRowsHtml(document.querySelector('#permissionLogSearch')?.value || '');
}
async function renderPermissionHistory(force = false) {
    const panel = document.querySelector('#rolePermissionsPanel');
    if (!panel) return;
    let box = document.querySelector('#permissionHistory');
    if (!box) { box = document.createElement('section'); box.id = 'permissionHistory'; box.className = 'permission-history'; (document.querySelector('#permissionLogPanel') || panel).appendChild(box); }
    if (!force && Date.now() - permissionHistoryLoadedAt < 3000 && box.innerHTML) return;
    permissionHistoryLoadedAt = Date.now();
    const previousQuery = document.querySelector('#permissionLogSearch')?.value || '';
    try {
        const result = await api('/api/role-permissions/history');
        permissionHistoryItems = result.items || [];
        permissionHistoryCanDelete = result.can_delete === true;
        box.innerHTML = `
            <div class="toolbar"><input id="permissionLogSearch" type="text" autocomplete="off" placeholder="Search role, person, date, or change"><button type="button" class="search-clear" id="permissionLogClear">Clear</button></div>
            <div class="history-log-head"><span class="muted">${permissionHistoryItems.length} entr${permissionHistoryItems.length === 1 ? 'y' : 'ies'}</span>${canDeletePermissionLog() && permissionHistoryItems.length ? '<button type="button" class="danger" data-clear-history>Delete logs from D1</button>' : ''}</div>
            <div class="table-wrap"><table><thead><tr><th>Date</th><th>Role</th><th>Changed By</th><th>Changes</th><th>Actions</th></tr></thead><tbody id="permissionLogRows"></tbody></table></div>`;
        const search = box.querySelector('#permissionLogSearch');
        if (search) search.value = previousQuery;
        renderPermissionLogRows();
    } catch (error) {
        box.innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    }
}
document.addEventListener('input', event => { if (event.target.id === 'permissionLogSearch') renderPermissionLogRows(); });
document.addEventListener('click', event => {
    if (event.target.closest('#permissionLogClear')) {
        const search = document.querySelector('#permissionLogSearch');
        if (search) search.value = '';
        renderPermissionLogRows();
        return;
    }
    const view = event.target.closest('[data-view-history]');
    if (view) {
        const detail = document.querySelector(`[data-detail-for="${view.dataset.viewHistory}"]`);
        if (detail) detail.hidden = !detail.hidden;
    }
});
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

// Sub-tabs: Rank / Personal Permission, and Account Audit / Permission log.
document.addEventListener('click', event => {
    const permissionTab = event.target.closest('[data-permission-subtab]');
    if (permissionTab) {
        const key = permissionTab.dataset.permissionSubtab;
        document.querySelectorAll('[data-permission-subpanel]').forEach(panel => { panel.hidden = panel.dataset.permissionSubpanel !== key; });
        document.querySelectorAll('[data-permission-subtab]').forEach(button => button.classList.toggle('active', button === permissionTab));
        return;
    }
    const historyTab = event.target.closest('[data-history-tab]');
    if (historyTab) {
        const key = historyTab.dataset.historyTab;
        document.querySelectorAll('[data-history-subpanel]').forEach(panel => { panel.hidden = panel.dataset.historySubpanel !== key; });
        document.querySelectorAll('[data-history-tab]').forEach(button => button.classList.toggle('active', button === historyTab));
        if (key === 'permission') renderPermissionHistory(true);
    }
});

// Refresh the change history whenever the History section is opened.
document.querySelectorAll('[data-command-section="history"]').forEach(button => button.addEventListener('click', () => renderPermissionHistory(true)));
window.addEventListener('hashchange', () => { if (location.hash === '#auditHeading') renderPermissionHistory(true); });

// Delete one entry, or the whole permission log, from D1.
document.addEventListener('click', async event => {
    const single = event.target.closest('[data-delete-history]');
    const all = event.target.closest('[data-clear-history]');
    if (!single && !all) return;
    const message = single ? 'Delete this log entry from D1?' : 'Delete logs from D1? This cannot be undone.';
    if (!(await lvfrConfirm({ title: "Delete History", message, confirmText: "Delete", danger: true }))) return;
    try {
        await api(single ? `/api/role-permissions/history/${single.dataset.deleteHistory}` : '/api/role-permissions/history', { method: 'DELETE' });
        void renderPermissionHistory(true);
    } catch (error) {
        console.error('Delete logs from D1 failed:', error);
        document.querySelector('#permissionHistory')?.insertAdjacentHTML('afterbegin', `<p class="log-error">Could not delete: ${esc(error.message)}</p>`);
    }
});

// Account preview: choose an approved account to see what it can do, including its own overrides.
function renderAccountPreview() {
    const host = document.querySelector('[data-permission-subpanel="personal"]');
    if (!host || document.querySelector('#accountPreview')) return;
    const box = document.createElement('section');
    box.id = 'accountPreview';
    box.className = 'permission-history';
    box.innerHTML = `<details class="role-preview"><summary>Preview an account: what can this person do?</summary><label class="role-preview-rank">Account <select id="accountPreviewSelect"><option value="">Choose an account</option></select></label><div id="accountPreviewResult"><p class="muted">Choose an account to see its permissions.</p></div></details>`;
    host.append(box);
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
    const totals = {};
    document.querySelectorAll(`[data-scope-role="${role}"]`).forEach(input => {
        const id = `${input.dataset.scope}|${input.dataset.scopeField}`;
        totals[id] = (totals[id] || 0) + 1;
        const scope = scopes[input.dataset.scope] || (scopes[input.dataset.scope] = {});
        const field = scope[input.dataset.scopeField] || (scope[input.dataset.scopeField] = []);
        if (input.checked) field.push(input.value);
    });
    // Every rank ticked means no limit. Saving the full list would block ranks added later.
    for (const [scopeName, fields] of Object.entries(scopes)) {
        for (const field of Object.keys(fields)) {
            if (fields[field].length === (totals[`${scopeName}|${field}`] || 0)) delete fields[field];
        }
        if (!Object.keys(fields).length) delete scopes[scopeName];
    }
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
  const query = (document.querySelector('#permissionSearch')?.value || '').trim().toLocaleLowerCase();
  const roles = Object.keys(rolePermissionProfiles).filter(role => role !== 'admin' && role !== String(currentUser?.role || '').toLowerCase()).sort((a,b) => {
    const ai=permissionRoleOrder.findIndex(item=>item.role===a), bi=permissionRoleOrder.findIndex(item=>item.role===b);
    return (ai<0?999:ai)-(bi<0?999:bi) || a.localeCompare(b);
  });
  if (!roles.includes(selectedPermissionRole)) selectedPermissionRole = roles[0] || '';
  document.querySelector('#permissionRoleNav').innerHTML = roles.map(role => `<button type="button" data-select-permission-role="${esc(role)}" aria-current="${role===selectedPermissionRole}">${esc(roleTitle(role))} · ${permissionRoleOrder.findIndex(item=>item.role===role)+1}</button>`).join('');
  panel.innerHTML = roles.filter(role => role === selectedPermissionRole).map(role => {
    const roleLabel = roleTitle(role);
    const groups = permissionGroups.map(group => {
      const items = group.items.filter(entry => notificationEntryAllowed(entry, rolePermissionProfiles[role]) && permissionEntryMatches(entry,query,group.name) && (Array.isArray(entry)?editablePermissionKeys.includes(entry[0]):editablePermissionKeys.includes(entry.key)||entry.children.some(item=>editablePermissionKeys.includes(item[0]))));
      if (!items.length) return '';
      return `<details class="permission-group" data-role-tab="${roleTabFor(group.name)}" data-permission-group="${esc(group.name)}" ${query||openPermissionGroups.has(group.name)?'open':''}><summary>${esc(group.name)}</summary>${items.map(entry=>renderPermissionEntry(entry,rolePermissionProfiles[role],query,group.name)).join('')}</details>`;
    }).join('');
    const enabled = Object.values(rolePermissionProfiles[role] || {}).filter(Boolean).length;
    const orderIndex=permissionRoleOrder.findIndex(item=>item.role===role);
    const actorRank=currentUser?.role==='admin'?1:(permissionRoleOrder.findIndex(item=>item.role===String(currentUser?.role||''))+1||2);
    const belowActor=orderIndex+1>actorRank;
    const rankTools=`<div class="admin-actions"><label>Rank name <input type="text" maxlength="32" data-rank-name="${esc(role)}" value="${esc(roleLabel)}" ${!canManageRanks('rank_rename')||!belowActor?'disabled':''}></label><button type="button" data-rename-rank="${esc(role)}" ${!canManageRanks('rank_rename')||!belowActor?'disabled':''}>Save name</button><button type="button" data-rank-move="up" data-rank-role="${esc(role)}" ${!canManageRanks('rank_reorder')||!belowActor||orderIndex<=1?'disabled':''}>Move up</button><button type="button" data-rank-move="down" data-rank-role="${esc(role)}" ${!canManageRanks('rank_reorder')||!belowActor||orderIndex<1||orderIndex>=permissionRoleOrder.length-1?'disabled':''}>Move down</button>${!['member','leader','commander'].includes(role)?`<button type="button" class="danger" data-delete-role="${esc(role)}" ${!canManageRanks('rank_delete')||!belowActor?'disabled':''}>Delete rank</button>`:''}</div>`;
    return `<article class="role-permission-card" data-permission-role="${role}"${canEditRole(role)?'':' inert'}><header><div><span class="role-kicker">RANK ${orderIndex+1} · ROLE PROFILE</span><h3>${roleLabel}</h3></div><span class="permission-count">${enabled} enabled</span></header>${canEditRole(role)?'':'<p class="muted role-readonly">Read only: this role has your rank or higher.</p>'}${rankTools}${canManageRoleProfiles()?roleTabBar(role):''}<div class="role-tabbed" data-role-tabs="${esc(role)}" data-active-tab="${roleActiveTab[role]||'pages'}"><div class="role-permission-groups">${canManageRoleProfiles()?(groups || '<p class="muted">No permissions match your search.</p>'):'<p class="muted">Rank actions are available according to your individual rank permissions. Editing permission profiles requires Operation Command access.</p>'}</div>${canManageRoleProfiles()?scopeEditor(role):''}${canManageRoleProfiles()?previewEditor(role):''}</div>${canManageRoleProfiles()?roleWarningsHtml(role):''}${canManageRoleProfiles()?`<button type="button" class="role-undo" data-undo-permissions="${esc(role)}">Undo unsaved changes</button>`:''}${canManageRoleProfiles()?`<button type="button" class="primary" data-save-permissions="${role}">Save ${roleLabel} permissions</button>`:''}</article>`;
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
document.querySelector('#permissionSearch')?.addEventListener('input', renderRolePermissions);
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
    if(!(await lvfrConfirm({ title: "Delete Rank", subject: roleTitle(role), message: "It must have no assigned accounts.", confirmText: "Delete", danger: true }))) return;
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
document.querySelector('#permissionMemberSearch')?.addEventListener('input', async event => {
  const results = document.querySelector('#permissionMemberResults'), query = event.target.value.trim().toLowerCase();
  if (!query) { results.hidden = true; results.replaceChildren(); return; }
  if (!allAccounts().length) {
    results.innerHTML = '<span class="muted">Loading members...</span>';
    results.hidden = false;
    try { await loadAccounts(); } catch {}
  }
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
  const effectiveProfile = Object.fromEntries(Object.keys(defaults).map(key => [key, Object.hasOwn(overrides, key) ? overrides[key] : defaults[key]]));
  // Same list as the Rank Permission cards: same groups, sub-lists and labels.
  panel.innerHTML = permissionGroups.map(group => {
    const body = group.items
      .filter(entry => notificationEntryAllowed(entry, effectiveProfile))
      .map(entry => renderPermissionEntry(entry, effectiveProfile, '', group.name))
      .join('');
    return body ? `<details class="permission-group" data-permission-group="${esc(group.name)}" open><summary>${esc(group.name)}</summary>${body}</details>` : '';
  }).join('').replace(/data-permission-key=/g, 'data-individual-permission=');
}
async function openIndividualPermissions(account) {
  // Switch to Access Permissions → Personal Permission immediately, before any check or loading.
  showCommandSection('permissions', true);
  document.querySelector('[data-permission-subtab="personal"]')?.click();
  const dialog = document.querySelector('#individualPermissionsDialog');
  const status = document.querySelector('#individualPermissionsStatus');
  if (!canManageRoleProfiles()) {
    setMessage('Operation Command access is required to customize personal permissions.', 'error');
    return;
  }
  individualPermissionTarget = account;
  document.querySelector('#individualPermissionsTitle').textContent = `Permissions: ${account.display_name || account.name}`;
  dialog.hidden = false;
  dialog.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!canEditRole(account.role)) {
    individualPermissionState = null;
    status.textContent = 'You cannot change permissions of an account with your rank or higher.';
    return;
  }
  if (account.role === 'admin') {
    individualPermissionState = null;
    status.textContent = 'Admin accounts keep full access and cannot be customized.';
    return;
  }
  status.textContent = 'Loading permissions...';
  try {
    individualPermissionState = await api(`/api/leaders/${encodeURIComponent(account.account_id)}/permissions`);
    individualPermissionMode = Object.keys(individualPermissionState.overrides || {}).length ? 'customize' : 'role';
    renderIndividualPermissions();
    status.textContent = `Role: ${roleTitle(individualPermissionState.role)}. Press "Customize permissions" to change this person's permissions.`;
  } catch (error) {
    individualPermissionState = null;
    status.textContent = `Could not load permissions: ${error.message}`;
  }
}
document.querySelector('#individualPermissionsList')?.addEventListener('change', event => {
  // A group's master checkbox sets every permission inside it.
  const master = event.target.closest('[data-permission-parent]');
  if (master && individualPermissionState) {
    master.closest('details')?.querySelectorAll('[data-individual-permission]').forEach(child => {
      if (child.checked !== master.checked) { child.checked = master.checked; child.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    return;
  }
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
  if (!individualPermissionTarget || !(await lvfrConfirm({ title: "Restore Permissions", message: "Restore this account to its role permissions. Its account role will stay the same.", confirmText: "Restore" }))) {
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
document.querySelector('#individualPermissionsCustomize')?.addEventListener('click', async () => {
  const status = document.querySelector('#individualPermissionsStatus');
  if (!individualPermissionState && individualPermissionTarget) {
    try {
      individualPermissionState = await api(`/api/leaders/${encodeURIComponent(individualPermissionTarget.account_id)}/permissions`);
    } catch (error) {
      status.textContent = `Could not load permissions: ${error.message}`;
      return;
    }
  }
  if (!individualPermissionState) {
    status.textContent = 'Choose a member first.';
    return;
  }
  individualPermissionMode = 'customize';
  try {
    renderIndividualPermissions();
  } catch (error) {
    status.textContent = `Could not show the permissions: ${error.message}`;
  }
});
document.querySelector('#individualPermissionsClose')?.addEventListener('click', () => { document.querySelector('#individualPermissionsDialog').hidden = true; });
document.querySelector('#individualPermissionsReset')?.addEventListener('click', async event => {
  if (!individualPermissionTarget || !(await lvfrConfirm({ title: "Restore Permissions", message: "Restore this account to its role permissions. Its account role will stay the same.", confirmText: "Restore" }))) return;
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
  // Start from the current overrides so keys that are not shown in this list (hidden notification switches, for example) are kept.
  const overrides = {...(individualPermissionState.overrides || {})};
  document.querySelectorAll('[data-individual-permission]').forEach(input => {
    const key=input.dataset.individualPermission;
    if(input.checked!==Boolean(individualPermissionState.defaults[key])) overrides[key]=input.checked;
    else delete overrides[key];
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
  setSelectedStatus(button.dataset.status);
  document.querySelectorAll('.admin-tabs button').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
  renderAccounts();
}));
document.querySelectorAll('.admin-tabs button').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.status === selectedStatus)));
document.querySelector('#accountSearch').addEventListener('input', renderAccounts);
document.querySelector('#refreshAccounts').addEventListener('click', loadAccounts);
window.setInterval(() => { if (!document.hidden) void loadAccounts(true); }, 30000);
// Admin page: a request notification opens the Pending accounts list here; others open EMS Operations.
window.lvfrOpenNotification = async id => {
  const item = window.lvfrNotifications?.find(id);
  if (!item) return;
  await window.lvfrNotifications.markRead([id]);
  if (item.kind === 'request') {
    setSelectedStatus('pending');
    document.querySelectorAll('.admin-tabs button').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.status === 'pending')));
    renderAccounts();
    document.querySelector('#accountsHeading')?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (item.callsign) {
    const target = new URL('/', location.origin);
    target.searchParams.set('notification_id', String(item.id));
    location.assign(target.toString());
  }
};
document.querySelector('#logoutButton').addEventListener('click', () => {
  window.lvfrLogout?.();
});

const commandSections = {
  accounts: document.querySelector('#commandAccountsSection'),
  permissions: document.querySelector('#commandPermissionsSection'),
  history: document.querySelector('#commandHistorySection'),
  discord: document.querySelector('#commandDiscordSection'),
  links: document.querySelector('#commandLinksSection'),
  log: document.querySelector('#commandLogSection'),
  mirror: document.querySelector('#commandMirrorSection'),
};
function showCommandSection(name, updateHash = false) {
  if (!canManageCommandAccounts() && !canAccessPermissionPanel() && !canUseDiscord()) return;
  if (name === 'permissions' && !canAccessPermissionPanel()) {
    if (!canManageCommandAccounts()) return;
    name = 'accounts';
  }
  if (name !== 'permissions' && !canManageCommandAccounts() && !(['discord', 'links', 'log'].includes(name) && canUseDiscord())) name = 'permissions';
  if (!commandSections[name]) return;
  Object.entries(commandSections).forEach(([key, section]) => { section.hidden = key !== name; });
  document.querySelectorAll('[data-command-section]').forEach(button => {
    const active = button.dataset.commandSection === name || (button.dataset.commandSection === 'discord' && ['links', 'log'].includes(name));
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (updateHash) {
    const anchors = { accounts: 'accountsHeading', permissions: 'permissionsHeading', history: 'auditHeading', discord: 'discordSyncHeading', links: 'linkedMembersHeading', log: 'discordLogHeading', mirror: 'mirrorQueueHeading' };
    history.replaceState(null, '', `#${anchors[name]}`);
  }
  // replaceState does not fire hashchange, so load the list here and tell the sidebar which item is current.
  if (name === 'links' || name === 'log') document.querySelector('#refreshLinkedMembers')?.click();
  if (name === 'mirror') void loadMirrorQueue();
  window.dispatchEvent(new Event('lvfr:view-changed'));
}
document.querySelectorAll('[data-command-section]').forEach(button => button.addEventListener('click', () => showCommandSection(button.dataset.commandSection, true)));
function selectCommandSectionFromHash() {
  const sections = { '#permissionsHeading': 'permissions', '#auditHeading': 'history', '#accountsHeading': 'accounts', '#discordSyncHeading': 'discord', '#discordHeading': 'discord', '#linkedMembersHeading': 'links', '#discordLogHeading': 'log', '#mirrorQueueHeading': 'mirror' };
  const section = sections[location.hash];
  if (section) showCommandSection(section);
}
window.addEventListener('hashchange', selectCommandSectionFromHash);
selectCommandSectionFromHash();
loadAccounts();
// Discord permissions on this page, and the disabled-reason display used by every Discord button here.
function canUseDiscord() { return currentUser?.role === 'admin' || currentUser?.permissions?.discord_view === true; }
function canManageDiscord() { return currentUser?.role === 'admin' || currentUser?.permissions?.discord_manage === true; }
function canSyncDiscord() { return currentUser?.role === 'admin' || currentUser?.permissions?.discord_sync_manage === true; }
function canClearDiscordLog() { return currentUser?.role === 'admin' || currentUser?.permissions?.discord_log_clear === true; }
function applyDiscordPermissions() {
  const set = (selector, allowed, reason) => {
    const button = document.querySelector(selector);
    if (!button) return;
    button.disabled = !allowed;
    button.dataset.disabledReason = allowed ? '' : reason;
  };
  set('#syncDiscordMembers', canSyncDiscord(), 'Your role does not have Discord sync permission.');
  set('#retryDiscordUpdates', canSyncDiscord(), 'Your role does not have Discord sync permission.');
  set('#clearDiscordLog', canClearDiscordLog(), 'Your role does not have permission to clear the Discord log.');
  syncDisabledReasons();
}
function syncDisabledReasons(root = document) {
  root.querySelectorAll?.('button[data-disabled-reason]').forEach(button => {
    // Buttons in an action row sit in their own cell, so the reason stays under its button and the row keeps its side-by-side layout.
    if (button.parentElement?.matches?.('.training-actions, .activity-actions, .instructor-admin-buttons, .actions') && !button.parentElement.classList.contains('action-cell')) {
      const cell = document.createElement('span');
      cell.className = 'action-cell';
      button.before(cell);
      cell.append(button);
    }
    const wanted = button.disabled ? button.dataset.disabledReason : '';
    const next = button.nextElementSibling;
    const hint = next && next.classList.contains('disabled-reason') ? next : null;
    if (!wanted) { hint?.remove(); return; }
    if (!hint) {
      const created = document.createElement('small');
      created.className = 'disabled-reason';
      created.textContent = wanted;
      button.after(created);
    } else if (hint.textContent !== wanted) {
      hint.textContent = wanted;
    }
  });
}
const disabledReasonObserver = new MutationObserver(() => syncDisabledReasons());
disabledReasonObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'data-disabled-reason'] });

// Linked members (Discord ID or nickname edits, delink) and the Discord action log.
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const note = (text, kind = '') => { const el = document.querySelector('#discordSyncStatus'); if (el) { el.textContent = text; el.className = 'admin-status' + (kind ? ' ' + kind : ''); } };
  const when = value => (value ? new Date(value).toLocaleString() : '');

  // Linked members loaded from the server, and a redraw that applies the search box.
  let linkedRows = [];
  function drawLinks() {
    const query = String(document.querySelector('#linkedMembersSearch')?.value || '').trim().toLocaleLowerCase();
    const rows = linkedRows.filter(link => !query || [link.callsign, link.roster_name, link.member_name, link.discord_user_id, link.discord_nickname]
      .some(value => String(value || '').toLocaleLowerCase().includes(query)));
    const manage = canManageDiscord();
    document.querySelector('#linkedMemberRows').innerHTML = rows.length
      ? rows.map(link => {
          const linked = link.discord_state === 'linked';
          return `<tr>
          <td><b>${esc(link.callsign)}</b></td>
          <td>${esc(link.roster_name || link.member_name || '—')}</td>
          <td>${linked ? '<span class="badge active-status">Linked</span>' : '<span class="badge terminate-status">Not linked</span>'}</td>
          <td>${esc(link.discord_user_id || '—')}</td>
          <td>${esc(link.discord_nickname || '—')}</td>
          <td>${esc(link.status || '—')}${link.last_error ? `<br><small class="muted">${esc(link.last_error)}</small>` : ''}</td>
          <td>${Number(link.on_roster) ? 'On roster' : '<span class="muted">Not on roster</span>'}</td>
          <td class="admin-actions">
            <button type="button" data-link-edit="${esc(link.callsign)}" data-linked="${linked ? '1' : '0'}" data-discord-id="${esc(link.discord_user_id || '')}" data-nickname="${esc(link.discord_nickname || '')}" ${manage ? '' : 'disabled'} data-disabled-reason="Your role does not have Discord manage permission.">${linked ? 'Edit' : 'Link'}</button>
            <button type="button" class="danger" data-link-delink="${esc(link.callsign)}" ${manage && linked ? '' : 'disabled'} data-disabled-reason="${linked ? 'Your role does not have Discord manage permission.' : 'Not linked, so there is nothing to delink.'}">Delink</button>
          </td></tr>`;
        }).join('')
      : (linkedRows.length
          ? '<tr><td colspan="8" class="muted">No linked members match your search.</td></tr>'
          : '<tr><td colspan="8" class="muted">No linked members yet.</td></tr>');
    syncDisabledReasons();
  }

  async function loadLinks() {
    const data = await api('/api/discord/links');
    // Only members who are linked to Discord are listed.
    linkedRows = (data.links || []).filter(link => link.discord_state === 'linked');
    drawLinks();
  }
  document.querySelector('#linkedMembersSearch')?.addEventListener('input', drawLinks);

  async function loadLog() {
    const data = await api('/api/discord/log');
    const rows = data.log || [];
    document.querySelector('#discordLogRows').innerHTML = rows.length
      ? rows.map(item => `<tr><td>${esc(when(item.created_at))}</td><td>${esc(item.actor_name)}</td><td>${esc(item.action)}</td><td>${esc(item.callsign)}${item.member_name ? ' · ' + esc(item.member_name) : ''}</td><td>${esc(item.outcome)}</td><td>${esc(item.detail)}</td></tr>`).join('')
      : '<tr><td colspan="6" class="muted">No Discord actions recorded yet.</td></tr>';
  }

  async function refreshAll() { await Promise.all([loadLinks(), loadLog()]); }

  document.querySelector('#linkedMemberRows')?.addEventListener('click', async event => {
    const edit = event.target.closest('[data-link-edit]');
    const delink = event.target.closest('[data-link-delink]');
    if (!edit && !delink) return;
    if ((edit || delink).disabled) return;
    try {
      if (edit) {
        const callsign = edit.dataset.linkEdit;
        const choice = await lvfrEditLink({ callsign, discordId: edit.dataset.discordId || '', nickname: edit.dataset.nickname || '' });
        if (!choice) return;
        if (choice.what === 'id') {
          await api('/api/discord/links/edit', { method: 'POST', body: JSON.stringify({ callsign, discord_user_id: choice.value }) });
          note(`Discord User ID saved for ${callsign}.`, 'success');
        } else {
          await api(`/api/discord/member/${encodeURIComponent(callsign)}/nickname`, { method: 'POST', body: JSON.stringify({ nickname: choice.value }) });
          note(`Nickname saved for ${callsign}.`, 'success');
        }
      } else {
        const callsign = delink.dataset.linkDelink;
        if (!(await lvfrConfirm({ title: "Delink Discord", subject: callsign, message: "Delink this member from Discord. Discord itself will not be changed.", confirmText: "Delink", danger: true }))) return;
        await api('/api/discord/links/delink', { method: 'POST', body: JSON.stringify({ callsign }) });
        note(`${callsign} delinked. Discord was not changed.`, 'success');
      }
      await refreshAll();
    } catch (error) {
      note(error.message || 'The request failed.', 'error');
    }
  });

  document.querySelector('#clearDiscordLog')?.addEventListener('click', async () => {
    if (!canClearDiscordLog()) return;
    if (!(await lvfrConfirm({ title: "Clear Discord Log", message: "Clear the whole Discord action log? This cannot be undone.", confirmText: "Clear", danger: true }))) return;
    try {
      await api('/api/discord/log', { method: 'DELETE' });
      note('Discord action log cleared.', 'success');
      await loadLog();
    } catch (error) {
      note(error.message || 'Could not clear the log.', 'error');
    }
  });

  document.querySelector('#refreshLinkedMembers')?.addEventListener('click', () => refreshAll().catch(error => note(error.message, 'error')));
  document.querySelector('[data-command-section="discord"]')?.addEventListener('click', () => refreshAll().catch(() => {}));
})();

// Discord page wiring: the Sync / Retry / Refresh buttons and the sync report.
const discordStatus = document.querySelector('#discordSyncStatus');
const discordReport = document.querySelector('#discordSyncReport');
const discordReportText = document.querySelector('#discordSyncReportText');
const reportLabels = {
  roster_members: 'Roster members', processed: 'Discord members scanned', linked_count: 'Linked in this run',
  total_linked: 'Total linked', left_count: 'Left the server', unmatched_roster_count: 'Roster members not found on Discord',
  unmatched_discord_count: 'Discord members with no callsign', malformed_count: 'Malformed entries',
  duplicate_count: 'Duplicates', conflict_count: 'Conflicts', error: 'Error',
  unmatched_roster: 'Roster members not found on Discord', unmatched_discord: 'Discord members with no callsign',
  malformed: 'Malformed entries', duplicates: 'Duplicates', conflicts: 'Conflicts',
};
const hiddenReportKeys = ['ok', 'message', 'ops_role_check', 'ops_role_message'];
const humanizeKey = key => key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
function reportItemText(item) {
  if (item === null || typeof item !== 'object') return String(item ?? '');
  const parts = item.callsign ? [String(item.callsign)] : [];
  Object.entries(item).forEach(([key, value]) => {
    if (key === 'callsign' || value === null || value === undefined || value === '') return;
    if (Array.isArray(value)) parts.push(value.join(', '));
    else if (key === 'count') parts.push(`${value} accounts`);
    else parts.push(String(value));
  });
  return parts.join(' — ');
}
function showDiscordReport(value) {
  if (!discordReport || !discordReportText) return;
  discordReport.hidden = false;
  discordReportText.replaceChildren();
  if (typeof value === 'string') { discordReportText.textContent = value; return; }
  const rows = document.createElement('dl');
  const lists = [];
  Object.entries(value || {}).filter(([key]) => !hiddenReportKeys.includes(key)).forEach(([key, raw]) => {
    const label = reportLabels[key] || humanizeKey(key);
    if (Array.isArray(raw)) { if (raw.length) lists.push([label, raw]); return; }
    if (raw !== null && typeof raw === 'object') { lists.push([label, [raw]]); return; }
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = typeof raw === 'boolean' ? (raw ? 'Yes' : 'No') : String(raw ?? '');
    rows.append(dt, dd);
  });
  discordReportText.append(rows);
  lists.forEach(([label, items]) => {
    const heading = document.createElement('h4'); heading.textContent = label;
    const ul = document.createElement('ul');
    items.forEach(item => { const li = document.createElement('li'); li.textContent = reportItemText(item) || '—'; ul.append(li); });
    discordReportText.append(heading, ul);
  });
}
const roleMapEsc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
async function loadDiscordRoleMap() {
  const card = document.querySelector('#discordRoleMapCard');
  if (!card) return;
  card.hidden = !canUseDiscord();
  if (card.hidden) return;
  const body = document.querySelector('#discordRoleMapRows');
  const save = document.querySelector('#saveDiscordRoleMap');
  save.disabled = !canEditDiscordSettings();
  document.querySelector('#saveDiscordGuildId').disabled = !canEditDiscordSettings();
  document.querySelector('#discordGuildIdInput').disabled = !canEditDiscordSettings();
  try {
    const data = await api('/api/discord/role-map');
    document.querySelector('#discordGuildIdInput').value = data.guild_id || '';
    document.querySelector('#discordOpsRoleInput').value = data.ops_role_id || '';
    document.querySelector('#discordOpsRoleInput').disabled = !canEditDiscordSettings();
    body.innerHTML = data.ranks.map(row => `<tr><td>${roleMapEsc(row.rank)}</td><td><input type="text" inputmode="numeric" autocomplete="off" data-rank="${roleMapEsc(row.rank)}" value="${roleMapEsc(row.role_id)}" placeholder="17 to 20 digits" ${canEditDiscordSettings() ? '' : 'disabled'} aria-label="Discord role ID for ${roleMapEsc(row.rank)}"></td></tr>`).join('');
  } catch (error) {
    body.innerHTML = `<tr><td colspan="2">${roleMapEsc(error.message)}</td></tr>`;
  }
}
async function saveDiscordRoleMap() {
  const status = document.querySelector('#discordRoleMapStatus');
  const ranks = {};
  document.querySelectorAll('#discordRoleMapRows input[data-rank]').forEach(input => { ranks[input.dataset.rank] = input.value.trim(); });
  try {
    await api('/api/discord/role-map', { method: 'POST', body: JSON.stringify({ ranks, ops_role_id: document.querySelector('#discordOpsRoleInput').value.trim() }) });
    status.textContent = 'Discord role IDs saved.';
  } catch (error) {
    status.textContent = error.message;
  }
}
document.querySelector('#saveDiscordRoleMap')?.addEventListener('click', saveDiscordRoleMap);
function canEditDiscordSettings() { return currentUser?.role === 'admin' || currentUser?.permissions?.discord_settings_manage === true; }
async function saveDiscordGuildId() {
  const status = document.querySelector('#discordRoleMapStatus');
  try {
    const result = await api('/api/discord/settings', { method: 'POST', body: JSON.stringify({ guild_id: document.querySelector('#discordGuildIdInput').value.trim() }) });
    status.textContent = result.guild_id ? 'Discord server ID saved.' : 'Discord server ID cleared; the DISCORD_GUILD_ID secret is used.';
  } catch (error) { status.textContent = error.message; }
}
document.querySelector('#saveDiscordGuildId')?.addEventListener('click', saveDiscordGuildId);
async function refreshDiscordStatus() {
  loadDiscordRoleMap().catch(() => {});
  if (!discordStatus) return;
  discordStatus.className = 'admin-status';
  discordStatus.textContent = 'Loading Discord synchronization status…';
  try {
    const status = await api('/api/discord/status');
    discordStatus.className = 'admin-status success';
    discordStatus.textContent = `Linked: ${status.linked} · Failed: ${status.failed} · Pending: ${status.pending} · Total mappings: ${status.total}`;
  } catch (error) {
    discordStatus.className = 'admin-status error';
    discordStatus.textContent = error.message;
  }
}
document.querySelector('#syncDiscordMembers')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  if (!(await lvfrConfirm({ title: "Sync Discord Members", message: "Refresh the roster from Google Sheets and link Discord members by exact callsign? This initial sync will not change Discord nicknames or roles.", confirmText: "Sync" }))) return;
  button.disabled = true;
  if (discordStatus) { discordStatus.className = 'admin-status'; discordStatus.textContent = 'Refreshing the roster and scanning Discord members…'; }
  if (discordReport) discordReport.hidden = true;
  try {
    const result = await api('/api/discord/sync', { method: 'POST', body: '{}' });
    showDiscordReport(result);
    if (discordStatus) { discordStatus.className = 'admin-status success'; discordStatus.textContent = [result.message, result.ops_role_message].filter(Boolean).join(' ') || 'Initial Discord linking completed.'; }
    await refreshDiscordStatus();
  } catch (error) {
    if (discordStatus) { discordStatus.className = 'admin-status error'; discordStatus.textContent = error.message; }
    showDiscordReport({ error: error.message });
  } finally { button.disabled = false; }
});
document.querySelector('#retryDiscordUpdates')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  if (discordStatus) { discordStatus.className = 'admin-status'; discordStatus.textContent = 'Queueing failed Discord updates…'; }
  try {
    const result = await api('/api/discord/retry', { method: 'POST', body: '{}' });
    if (discordStatus) { discordStatus.className = 'admin-status success'; discordStatus.textContent = result.message || 'Retry request accepted.'; }
    showDiscordReport(result);
    window.setTimeout(() => { void refreshDiscordStatus(); }, 1500);
  } catch (error) {
    if (discordStatus) { discordStatus.className = 'admin-status error'; discordStatus.textContent = error.message; }
  } finally { button.disabled = false; }
});
document.querySelector('#refreshDiscordStatus')?.addEventListener('click', () => void refreshDiscordStatus());

// Sidebar links for the new Discord pages: load their data when opened, and run a Discord button clicked from another page.
(() => {
  const openSection = () => {
    if (location.hash === '#linkedMembersHeading') document.querySelector('#refreshLinkedMembers')?.click();
    if (location.hash === '#discordLogHeading') document.querySelector('#refreshLinkedMembers')?.click();
  };
  window.addEventListener('hashchange', openSection);
  const pending = sessionStorage.getItem('lvfr.sidebar.pending-click');
  if (pending) {
    sessionStorage.removeItem('lvfr.sidebar.pending-click');
    setTimeout(() => document.querySelector(pending)?.click(), 600);
  }
})();

// Discord sub-navigation shown inside the Discord tab: Sync, Linked members, Discord action log.
(() => {
  const views = [['discord', 'Sync'], ['links', 'Linked members'], ['log', 'Discord action log']];
  const nav = `<nav class="role-tab-bar discord-subtabs" aria-label="Discord sections">${views.map(([key, label]) =>
    `<button type="button" class="role-tab" data-discord-view="${key}">${label}</button>`).join('')}</nav>`;
  ['#commandDiscordSection', '#commandLinksSection', '#commandLogSection'].forEach(selector => {
    const section = document.querySelector(selector);
    section?.querySelector('.admin-header')?.insertAdjacentHTML('beforebegin', nav);
  });
  const markActive = view => document.querySelectorAll('[data-discord-view]').forEach(button =>
    button.classList.toggle('active', button.dataset.discordView === view));
  document.querySelectorAll('[data-discord-view]').forEach(button => button.addEventListener('click', () => {
    showCommandSection(button.dataset.discordView, true);
    markActive(button.dataset.discordView);
  }));
  window.addEventListener('hashchange', () => {
    const view = { '#discordSyncHeading': 'discord', '#linkedMembersHeading': 'links', '#discordLogHeading': 'log' }[location.hash];
    if (view) markActive(view);
  });
  const visibleView = () => {
    if (!document.querySelector('#commandLinksSection')?.hidden) return 'links';
    if (!document.querySelector('#commandLogSection')?.hidden) return 'log';
    return 'discord';
  };
  window.addEventListener('lvfr:view-changed', () => markActive(visibleView()));
  markActive(visibleView());
})();

// Google Sheets sync queue (manual). Rows are changes D1 saved but the Sheet missed.
const mirrorRows = document.querySelector('#mirrorQueueRows');
const mirrorStatus = document.querySelector('#mirrorQueueStatus');
function mirrorStatusMessage(text, kind = '') { if (mirrorStatus) { mirrorStatus.className = 'admin-status' + (kind ? ' ' + kind : ''); mirrorStatus.textContent = text; } }
async function loadMirrorQueue() {
  if (!mirrorRows) return;
  mirrorStatusMessage('Loading the Sheets sync queue…');
  try {
    const data = await api('/internal/mirror-queue');
    const items = data.items || [];
    mirrorRows.innerHTML = items.length ? items.map(item => `<tr>
      <td>${esc(new Date(Number(item.created_at) * 1000).toLocaleString())}</td>
      <td>${esc(item.label || item.route)}</td>
      <td>${esc(item.attempts)}</td>
      <td>${esc(item.last_error)}</td>
      <td><code>${esc(item.preview)}</code></td>
      <td><button type="button" data-mirror-retry="${esc(item.id)}">Retry</button> <button type="button" class="danger" data-mirror-discard="${esc(item.id)}">Discard</button></td>
    </tr>`).join('') : '<tr><td colspan="6">Nothing is waiting. Google Sheets has every saved change.</td></tr>';
    mirrorStatusMessage(items.length ? `${items.length} change${items.length === 1 ? '' : 's'} waiting for Google Sheets.` : 'Google Sheets is up to date.', items.length ? 'error' : 'success');
  } catch (error) { mirrorStatusMessage(error.message, 'error'); }
}
async function mirrorAction(path, body, success) {
  mirrorStatusMessage('Working…');
  try { const result = await api(path, { method: 'POST', body: JSON.stringify(body) }); await loadMirrorQueue(); if (success) mirrorStatusMessage(success(result), result.failed ? 'error' : 'success'); }
  catch (error) { mirrorStatusMessage(error.message, 'error'); }
}
document.querySelector('#mirrorRefresh')?.addEventListener('click', () => void loadMirrorQueue());
document.querySelector('#mirrorRetryAll')?.addEventListener('click', () => void mirrorAction('/internal/mirror-queue/retry', {}, result => `Retried ${result.processed}: ${result.done} sent, ${result.failed} failed.`));
document.querySelector('#mirrorDiscardAll')?.addEventListener('click', () => { if (confirm('Discard every waiting change? Google Sheets will not receive them.')) void mirrorAction('/internal/mirror-queue/discard', { all: true }, result => `Discarded ${result.removed}.`); });
mirrorRows?.addEventListener('click', event => {
  const retry = event.target.closest('[data-mirror-retry]'), discard = event.target.closest('[data-mirror-discard]');
  if (retry) void mirrorAction('/internal/mirror-queue/retry', { id: Number(retry.dataset.mirrorRetry) }, result => result.failed ? 'The retry failed again.' : 'Sent to Google Sheets.');
  if (discard && confirm('Discard this change? Google Sheets will not receive it.')) void mirrorAction('/internal/mirror-queue/discard', { id: Number(discard.dataset.mirrorDiscard) }, () => 'Discarded.');
});
