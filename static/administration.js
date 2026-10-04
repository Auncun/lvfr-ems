const messageEl = document.querySelector('#adminMessage');
const accountRows = document.querySelector('#accountRows');
const auditRows = document.querySelector('#auditRows');
const countEl = document.querySelector('#accountCount');
let overview = { approved: [], pending: [], deactivated: [], audit: [] };
let selectedStatus = 'all';
let currentUser = null;
let notificationItems = [];
let notificationLoadPromise = null;
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
function accountActions(account) {
  const id = esc(account.account_id);
  if (account.account_id === currentUser?.account_id) return '';
  if (account.status === 'pending') return `
    <button type="button" data-action="allow" data-id="${id}">Approve</button>
    <button type="button" class="danger" data-action="deny" data-id="${id}">Deny</button>`;
  if (account.status === 'deactivated') return `
    <button type="button" data-action="reactivate" data-id="${id}">Reactivate</button>
    ${account.is_admin ? `<button type="button" data-action="demote" data-id="${id}">Remove Commander</button>` : ''}`;
  const adminButton = account.is_admin
    ? `<button type="button" data-action="demote" data-id="${id}">Remove Commander</button>`
    : `<button type="button" data-action="promote" data-id="${id}">Make Commander</button>`;
  const memberButton = account.role === 'member'
    ? `<button type="button" data-action="leader" data-id="${id}">Make Supervisor</button>`
    : `<button type="button" data-action="member" data-id="${id}">Make Member</button>`;
  const deactivateButton = account.is_admin
    ? '<button type="button" disabled title="Remove Commander access first">Deactivate</button>'
    : `<button type="button" class="danger" data-action="deactivate" data-id="${id}">Deactivate</button>`;
  const deleteButton = account.is_admin
    ? '<button type="button" disabled title="Remove Commander access first">Delete</button>'
    : `<button type="button" class="danger" data-action="delete" data-id="${id}">Delete</button>`;
  return `${account.is_admin ? '' : memberButton}${adminButton}${deactivateButton}${deleteButton}`;
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
      <td data-label="Role">${account.is_admin ? 'Commander' : account.role === 'member' ? 'Member' : account.status === 'pending' ? '—' : 'Supervisor'}</td>
      <td data-label="Presence"><span class="presence-badge ${account.online ? 'online' : 'offline'}">${account.online ? 'Online' : 'Offline'}</span></td>
      <td data-label="Created">${esc(account.requested_at || '—')}</td><td data-label="Actions"><div class="admin-actions">${accountActions(account)}</div></td></tr>`).join('');
}
function renderAudit() {
  const rows = overview.audit || [];
  auditRows.innerHTML = rows.length ? rows.map(entry => `
    <tr><td data-label="Date">${esc(entry.created_at || '—')}</td><td data-label="Account">${esc(entry.name || 'N/A')}${entry.callsign ? ` (${esc(entry.callsign)})` : ''}</td>
      <td data-label="Action">${esc(String(entry.action || '—').replace(/\bAdmin\b/g, 'Commander'))}</td><td data-label="By">${esc(String(entry.actor_name || '—').replace(/\bWeb Admin\b/g, 'Web Commander'))}</td></tr>`).join('')
    : '<tr><td colspan="4">No account history yet.</td></tr>';
}
async function loadAccounts(silent = false) {
  const cachedUser = window.lvfrCachedUser?.();
  const cacheKey = `lvfr.admin.accounts.${cachedUser?.account_id || cachedUser?.id || 'current'}.v1`;
  let hadCached = false;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (cached?.overview) {
      overview = cached.overview;
      currentUser = cached.user || cachedUser;
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
  const accountLabel = account.display_name || account.name;
  const confirmations = {
    deny: `Deny the account request for ${accountLabel}?`,
    deactivate: `Deactivate ${accountLabel}'s account?`,
    delete: `Permanently delete ${accountLabel}'s account? This cannot be undone.`,
    demote: `Remove Commander access from ${accountLabel}?`,
    member: `Limit ${accountLabel} to Watch Command access?`,
  };
  if (confirmations[action] && !window.confirm(confirmations[action])) return;
  const paths = {
    allow: `/api/leaders/${encodeURIComponent(id)}/allow`,
    deny: `/api/leaders/${encodeURIComponent(id)}/deny`,
    promote: `/api/leaders/${encodeURIComponent(id)}/admin`,
    demote: `/api/leaders/${encodeURIComponent(id)}/demote`,
    member: `/api/leaders/${encodeURIComponent(id)}/member`,
    leader: `/api/leaders/${encodeURIComponent(id)}/leader`,
    deactivate: `/api/leaders/${encodeURIComponent(id)}/deactivate`,
    reactivate: `/api/leaders/${encodeURIComponent(id)}/reactivate`,
    delete: `/api/leaders/${encodeURIComponent(id)}`,
  };
  const method = action === 'delete' ? 'DELETE' : 'POST';
  applyOptimisticAccountAction(account, action);
  const success = { allow: 'Account approved.', deny: 'Account request denied.', promote: 'Commander access granted.', demote: 'Commander access removed.', member: 'Account set to Member.', leader: 'Account set to Supervisor.', deactivate: 'Account deactivated.', reactivate: 'Account reactivated.', delete: 'Account deleted.' };
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
  else if (action === 'promote') { account.role = 'admin'; account.is_admin = true; }
  else if (action === 'demote') { account.role = 'leader'; account.is_admin = false; }
  else if (action === 'member') account.role = 'member';
  else if (action === 'leader') account.role = 'leader';
  else if (action === 'deactivate') account.status = 'deactivated';
  else if (action === 'reactivate') account.status = 'approved';
  (overview[account.status] || (overview[account.status] = [])).unshift(account);
  renderAccounts();
}

const permissionGroups = [
  { name: 'Application access', items: [
    ['portal_access', 'EMS Operations', 'Open the EMS Operations application.'],
    ['watch_command_view', 'Watch Command: view', 'Open Watch Command logs and activity.'],
    ['watch_command_edit', 'Watch Command: edit', 'Create and update Watch Command records.'],
    ['watch_command_roster', 'Watch Command: roster lookup', 'Search member names and callsigns.'],
  ] },
  { name: 'Lists and records', items: [
    ['members_view', 'Members list', 'View the roster and member list.'], ['eligible_view', 'Eligible list', 'View promotion eligibility.'],
    ['profile_view', 'Member profiles', 'Open member View / Manage details.'], ['inactive_view', 'Can Be Terminated list', 'View members marked for termination.'],
    ['logs_view', 'Members Log', 'View member operation logs.'], ['statistics_view', 'Statistics', 'View roster statistics.'],
    ['training_view', 'Training lists', 'Open FORT, HERT, and instructor directories.'], ['training_hours_view', 'Training Hours: view', 'View Training Hours records.'],
    ['do_not_promote_view', 'Do not Promote: view', 'View the Do not Promote list.'], ['sync_view', 'Sync status', 'View roster synchronization status.'],
  ] },
  { name: 'Training and member changes', items: [
    ['training_fort_manage', 'Manage FORT training', 'Change Basic and Advanced FORT status; FORT Instructor status is also required.'],
    ['training_hert_manage', 'Manage HERT training', 'Change HERT status; HERT Instructor status is also required.'],
    ['training_hours_manage', 'Manage Training Hours', 'Add, remove, and change Training Hours records.'],
    ['instructor_manage', 'Instructor assignments', 'Assign or remove FORT and HERT Instructor status.'],
    ['notes_manage', 'Member notes', 'Add, edit, or remove member notes.'], ['activity_manage', 'Activity status', 'Change member activity status.'],
    ['exam_manage', 'Supervisor exam', 'Add or remove exam status.'], ['rank_date_manage', 'Rank date', 'Change a member rank date.'],
    ['promotion_manage', 'Promotion', 'Promote members using available rules.'], ['rank_manage', 'Rank tools', 'Force promote, demote, or change rank.'],
    ['callsign_manage', 'Callsign changes', 'Change a member callsign.'], ['termination_manage', 'Termination', 'Remove a member from the roster.'],
    ['do_not_promote_manage', 'Do not Promote: edit', 'Add or remove members from that list.'], ['sync_manage', 'Sync now', 'Synchronize with the source sheet.'],
  ] },
];
let rolePermissionProfiles = {};
function renderRolePermissions() {
  const panel = document.querySelector('#rolePermissionsPanel');
  if (!panel) return;
  const query = document.querySelector('#permissionSearch').value.trim().toLocaleLowerCase();
  panel.innerHTML = ['member', 'leader'].map(role => {
    const roleLabel = role === 'member' ? 'Member' : 'Leader';
    const groups = permissionGroups.map(group => {
      const items = group.items.filter(([, label, description]) => !query || `${label} ${description} ${group.name}`.toLocaleLowerCase().includes(query));
      if (!items.length) return '';
      return `<section class="permission-group"><h4>${esc(group.name)}</h4>${items.map(([key, label, description]) => `
        <label class="permission-item"><input type="checkbox" data-permission-key="${key}" ${rolePermissionProfiles[role]?.[key] ? 'checked' : ''}><span><strong>${esc(label)}</strong><small>${esc(description)}</small></span></label>`).join('')}</section>`;
    }).join('');
    const enabled = Object.values(rolePermissionProfiles[role] || {}).filter(Boolean).length;
    return `<article class="role-permission-card" data-permission-role="${role}"><header><div><span class="role-kicker">ROLE PROFILE</span><h3>${roleLabel}</h3></div><span class="permission-count">${enabled} enabled</span></header><div class="role-permission-groups">${groups || '<p class="muted">No permissions match your search.</p>'}</div><button type="button" class="primary" data-save-permissions="${role}">Save ${roleLabel} permissions</button></article>`;
  }).join('');
}
async function loadRolePermissions() {
  const status = document.querySelector('#permissionStatus');
  try {
    const result = await api('/api/role-permissions');
    rolePermissionProfiles = result.profiles || {};
    renderRolePermissions();
    status.textContent = 'Role settings loaded. Changes apply to every account with that role.';
    status.className = 'permission-status';
  } catch (error) {
    status.textContent = `Could not load role permissions: ${error.message}`;
    status.className = 'permission-status error';
  }
}
document.querySelector('#permissionSearch').addEventListener('input', renderRolePermissions);
document.querySelector('#rolePermissionsPanel').addEventListener('change', event => {
  const input = event.target.closest('[data-permission-key]');
  if (!input) return;
  const role = input.closest('[data-permission-role]').dataset.permissionRole;
  rolePermissionProfiles[role][input.dataset.permissionKey] = input.checked;
  const count = input.closest('[data-permission-role]').querySelector('.permission-count');
  count.textContent = `${Object.values(rolePermissionProfiles[role]).filter(Boolean).length} enabled`;
});
document.querySelector('#rolePermissionsPanel').addEventListener('click', async event => {
  const button = event.target.closest('[data-save-permissions]');
  if (!button) return;
  const role = button.dataset.savePermissions, status = document.querySelector('#permissionStatus');
  button.disabled = true; status.textContent = 'Saving permissions...'; status.className = 'permission-status';
  try {
    const result = await api('/api/role-permissions', { method: 'POST', body: JSON.stringify({ role, permissions: rolePermissionProfiles[role] }) });
    rolePermissionProfiles[role] = result.permissions || rolePermissionProfiles[role];
    renderRolePermissions();
    status.textContent = `${role === 'member' ? 'Member' : 'Leader'} permissions saved.`;
    status.className = 'permission-status success';
  } catch (error) {
    status.textContent = `Save failed: ${error.message}`; status.className = 'permission-status error';
  } finally { button.disabled = false; }
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
loadAccounts();
void loadRolePermissions();
try {
  const cached = JSON.parse(localStorage.getItem(notificationCacheKey) || 'null');
  if (Array.isArray(cached)) { notificationItems = cached; renderNotifications(); }
} catch {}
loadNotifications();
window.setInterval(() => { if (!document.hidden) void loadNotifications(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void loadNotifications(); });
