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
function configureOperationAccess() {
  const allowed = ['admin', 'commander'].includes(currentUser?.role);
  document.querySelector('[data-command-section="permissions"]')?.toggleAttribute('hidden', !allowed);
  if (allowed && !rolePermissionsLoaded && !rolePermissionsLoadPromise) {
    rolePermissionsLoadPromise = loadRolePermissions().finally(() => { rolePermissionsLoadPromise = null; });
  }
  if (!allowed && commandSections.permissions?.hidden === false) showCommandSection('accounts');
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
    ${operation && account.is_elevated ? `<button type="button" data-action="demote" data-id="${id}">${account.role === 'admin' ? 'Make Commander' : 'Demote to Leader'}</button>` : ''}
    ${operation && account.role !== 'admin' ? `<button type="button" data-action="permissions" data-id="${id}">Permissions</button>` : ''}`;
  if (account.is_elevated && !operation) return '';
  const memberButton = account.role === 'member'
    ? `<button type="button" data-action="leader" data-id="${id}">Make Leader</button>`
    : account.role === 'leader' ? `<button type="button" data-action="member" data-id="${id}">Make Member</button>` : '';
  const roleButton = operation
    ? account.role === 'admin'
      ? `<button type="button" data-action="demote" data-id="${id}">Make Commander</button>`
      : account.role === 'commander'
      ? `<button type="button" data-action="promote" data-id="${id}">Make Operation</button><button type="button" data-action="demote" data-id="${id}">Demote to Leader</button>`
      : `<button type="button" data-action="commander" data-id="${id}">Make Commander</button><button type="button" data-action="promote" data-id="${id}">Make Operation</button>`
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
      <td data-label="Role">${account.status === 'pending' ? '—' : account.role === 'admin' ? 'Operation' : account.role === 'commander' ? 'Commander' : account.role === 'leader' ? 'Leader' : 'Member'}</td>
      <td data-label="Presence"><span class="presence-badge ${account.online ? 'online' : 'offline'}">${account.online ? 'Online' : 'Offline'}</span></td>
      <td data-label="Created">${esc(account.requested_at || '—')}</td><td data-label="Actions"><div class="admin-actions">${accountActions(account)}</div></td></tr>`).join('');
}
function renderAudit() {
  const rows = overview.audit || [];
  auditRows.innerHTML = rows.length ? rows.map(entry => `
    <tr><td data-label="Date">${esc(entry.created_at || '—')}</td><td data-label="Account">${esc(entry.name || 'N/A')}${entry.callsign ? ` (${esc(entry.callsign)})` : ''}</td>
      <td data-label="Action">${esc(String(entry.action || '—').replace(/\bAdmin\b/g, 'Operation'))}</td><td data-label="By">${esc(String(entry.actor_name || '—').replace(/\bWeb Admin\b/g, 'Web Operation'))}</td></tr>`).join('')
    : '<tr><td colspan="4">No account history yet.</td></tr>';
}
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
async function loadAccounts(silent = false) {
  const cachedUser = window.lvfrCachedUser?.();
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
  { name: 'Application access', items: [
    ['portal_access', 'EMS Operations', 'Open the EMS Operations application.'],
    ['watch_command_view', 'Watch Command: view', 'Open Watch Command logs and activity.'],
    ['watch_command_edit', 'Watch Command: edit', 'Create and update Watch Command records.'],
    ['watch_command_roster', 'Watch Command: roster lookup', 'Search member names and callsigns.'],
  ] },
  { name: 'Lists and records', items: [
    ['members_view', 'Members list', 'View the roster and member list.'], ['eligible_view', 'Eligible list', 'View promotion eligibility.'], ['promotion_access', 'Access Promotion', 'Open the Promotion page and view eligible members.'],
    ['profile_view', 'Member profiles', 'Open member View / Manage details.'], ['inactive_view', 'Can Be Terminated list', 'View members marked for termination.'],
    ['logs_view', 'Members Log', 'View member operation logs.'], ['statistics_view', 'Statistics', 'View roster statistics.'],
    ['training_view', 'Training lists', 'Open FORT, HERT, and instructor directories.'], ['training_hours_view', 'Training Hours: view', 'View Training Hours records.'],
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
let permissionEditorCapabilities = {};
let selectedPermissionRole = 'member';
function roleTitle(role) { return ({member:'Member',leader:'Leader',commander:'Commander'})[role] || role.replace(/[_-]+/g,' ').replace(/\b\w/g, ch => ch.toUpperCase()); }
function renderRolePermissions() {
  const panel = document.querySelector('#rolePermissionsPanel');
  if (!panel) return;
  const query = document.querySelector('#permissionSearch').value.trim().toLocaleLowerCase();
  const roleOrder = {member:0,leader:1,commander:2};
  const roles = Object.keys(rolePermissionProfiles).filter(role => role !== 'admin').sort((a,b) => (roleOrder[a] ?? 3) - (roleOrder[b] ?? 3) || a.localeCompare(b));
  if (!roles.includes(selectedPermissionRole)) selectedPermissionRole = roles[0] || '';
  document.querySelector('#permissionRoleNav').innerHTML = roles.map(role => `<button type="button" data-select-permission-role="${esc(role)}" aria-current="${role===selectedPermissionRole}">${esc(roleTitle(role))}</button>`).join('');
  panel.innerHTML = roles.filter(role => role === selectedPermissionRole).map(role => {
    const roleLabel = roleTitle(role);
    const groups = permissionGroups.map(group => {
      const items = group.items.filter(([, label, description]) => !query || `${label} ${description} ${group.name}`.toLocaleLowerCase().includes(query));
      if (!items.length) return '';
      return `<section class="permission-group"><h4>${esc(group.name)}</h4>${items.map(([key, label, description]) => `
        <label class="permission-item"><input type="checkbox" data-permission-key="${key}" ${rolePermissionProfiles[role]?.[key] ? 'checked' : ''} ${currentUser?.role !== 'admin' && permissionEditorCapabilities[key] !== true && !rolePermissionProfiles[role]?.[key] ? 'disabled' : ''}><span><strong>${esc(label)}</strong><small>${esc(description)}</small></span></label>`).join('')}</section>`;
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
    permissionEditorCapabilities = result.actor_permissions || {};
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
  const input = event.target.closest('[data-permission-key]');
  if (!input) return;
  const role = input.closest('[data-permission-role]').dataset.permissionRole;
  if (input.checked && currentUser?.role !== 'admin' && permissionEditorCapabilities[input.dataset.permissionKey] !== true && !rolePermissionProfiles[role]?.[input.dataset.permissionKey]) {
    input.checked = false;
    return;
  }
  rolePermissionProfiles[role][input.dataset.permissionKey] = input.checked;
  if (currentUser?.role !== 'admin' && permissionEditorCapabilities[input.dataset.permissionKey] !== true && !input.checked) input.disabled = true;
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
    const persisted = await api('/api/role-permissions');
    const savedProfile = persisted.profiles?.[role];
    if (!savedProfile || Object.keys(rolePermissionProfiles[role]).some(key => Boolean(savedProfile[key]) !== Boolean(result.permissions?.[key]))) {
      throw new Error('The saved permissions could not be verified. Reload and try again.');
    }
    rolePermissionProfiles = persisted.profiles || rolePermissionProfiles;
    permissionEditorCapabilities = persisted.actor_permissions || permissionEditorCapabilities;
    renderRolePermissions();
    status.textContent = `${role === 'member' ? 'Member' : role === 'leader' ? 'Leader' : 'Commander'} permissions saved.`;
    status.className = 'permission-status success';
  } catch (error) {
    status.textContent = `Save failed: ${error.message}`; status.className = 'permission-status error';
  } finally { button.disabled = false; }
});
document.querySelector('#createPermissionRole')?.addEventListener('click', async () => {
  const input = document.querySelector('#newPermissionRole'), role = input.value.trim().toLowerCase().replace(/\s+/g,'_');
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(role)) return setMessage('Use 2–32 letters, numbers, underscores, or hyphens for the role name.', 'error');
  if (rolePermissionProfiles[role]) return setMessage('That role already exists.', 'error');
  const empty = Object.fromEntries(permissionGroups.flatMap(group => group.items.map(([key]) => [key,false])));
  try {
    await api('/api/role-permissions', {method:'POST',body:JSON.stringify({role,permissions:empty})});
    rolePermissionProfiles[role] = empty;
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
function individualRoleLabel(role) { return role === 'leader' ? 'Leader' : role === 'commander' ? 'Commander' : role === 'admin' ? 'Operation' : 'Member'; }
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
  panel.innerHTML = permissionGroups.map(group => `<section class="permission-group"><h4>${esc(group.name)}</h4>${group.items.map(([key,label,description]) => {
    const checked = Object.hasOwn(overrides,key) ? overrides[key] : Boolean(defaults[key]);
    return `<label class="permission-item"><input type="checkbox" data-individual-permission="${key}" ${checked?'checked':''}><span><strong>${esc(label)}</strong><small>${esc(description)}</small></span></label>`;
  }).join('')}</section>`).join('');
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

const commandSections = {
  accounts: document.querySelector('#commandAccountsSection'),
  permissions: document.querySelector('#commandPermissionsSection'),
  history: document.querySelector('#commandHistorySection'),
};
function showCommandSection(name, updateHash = false) {
  if (name === 'permissions' && !['admin', 'commander'].includes(currentUser?.role)) name = 'accounts';
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
