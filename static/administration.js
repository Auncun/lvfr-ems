const messageEl = document.querySelector('#adminMessage');
const accountRows = document.querySelector('#accountRows');
const auditRows = document.querySelector('#auditRows');
const countEl = document.querySelector('#accountCount');
let overview = { approved: [], pending: [], deactivated: [], audit: [] };
let selectedStatus = 'all';
let currentUser = null;
let notificationItems = [];

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
    ? `<button type="button" data-action="leader" data-id="${id}">Make Leader</button>`
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
    && `${account.display_name || account.username} ${account.username} ${account.callsign}`.toLowerCase().includes(query));
  countEl.textContent = `${rows.length} account${rows.length === 1 ? '' : 's'}`;
  if (!rows.length) {
    accountRows.innerHTML = '<tr><td colspan="6">No accounts match this filter.</td></tr>';
    return;
  }
  accountRows.innerHTML = rows.map(account => `
    <tr><td><strong>${esc(account.display_name || account.username)}</strong>${account.approved_by ? `<br><small class="muted">Approved by ${esc(account.approved_by)}</small>` : ''}</td>
      <td>${esc(account.callsign || '—')}</td><td>${esc(account.status)}</td>
      <td>${account.is_admin ? 'Commander' : account.role === 'member' ? 'Member' : account.status === 'pending' ? '—' : 'Leader'}</td>
      <td>${esc(account.requested_at || '—')}</td><td><div class="admin-actions">${accountActions(account)}</div></td></tr>`).join('');
}
function renderAudit() {
  const rows = overview.audit || [];
  auditRows.innerHTML = rows.length ? rows.map(entry => `
    <tr><td>${esc(entry.created_at || '—')}</td><td>${esc(entry.name || 'N/A')}${entry.callsign ? ` (${esc(entry.callsign)})` : ''}</td>
      <td>${esc(String(entry.action || '—').replace(/\bAdmin\b/g, 'Commander'))}</td><td>${esc(String(entry.actor_name || '—').replace(/\bWeb Admin\b/g, 'Web Commander'))}</td></tr>`).join('')
    : '<tr><td colspan="4">No account history yet.</td></tr>';
}
async function loadAccounts() {
  setMessage('Loading accounts…');
  try {
    const [data, user] = await Promise.all([api('/api/leaders'), api('/auth/me')]);
    overview = data;
    currentUser = user;
    renderAccounts();
    renderAudit();
    setMessage('Account list is up to date.', 'success');
  } catch (error) {
    setMessage(error.message, 'error');
    accountRows.innerHTML = '<tr><td colspan="6">Could not load accounts.</td></tr>';
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
  try {
    const result = await api('/api/notifications');
    notificationItems = Array.isArray(result.items) ? result.items : [];
    renderNotifications(Number(result.unread_count || 0));
  } catch (error) {
    document.querySelector('#notificationList').innerHTML = `<div class="empty">${esc(error.message)}</div>`;
  }
}
async function markNotificationsRead(ids = []) {
  try {
    await api('/api/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) });
    const selected = new Set(ids.map(Number));
    notificationItems = notificationItems.map(item => !ids.length || selected.has(Number(item.id)) ? { ...item, is_read: 1 } : item);
    renderNotifications();
  } catch (error) {
    setMessage(error.message, 'error');
  }
}
async function performAction(button) {
  const { action, id } = button.dataset;
  const account = allAccounts().find(row => row.account_id === id);
  if (!account) return;
  const accountLabel = account.display_name || account.username;
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
  button.disabled = true;
  try {
    const result = await api(paths[action], { method });
    setMessage(result.status === 'saving' || result.status === 'queued'
      ? 'Change queued for saving.' : 'Account updated.', 'success');
    await loadAccounts();
  } catch (error) {
    setMessage(error.message, 'error');
    button.disabled = false;
  }
}
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
  fetch('/auth/logout', { method: 'POST' }).finally(() => location.assign('/login'));
});
loadAccounts();
loadNotifications();
window.setInterval(loadNotifications, 60000);
