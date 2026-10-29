function showAvailableApps(user) {
  if (!user) return;
  const canOpenOperationCommand = Boolean(user.is_admin) || ['admin', 'commander'].includes(String(user.role || '').toLowerCase()) || user.permissions?.operation_command_access === true;
  document.querySelector('#administrationCard')?.toggleAttribute('hidden', !canOpenOperationCommand);
  const role = String(user.role || '').trim().toLowerCase();
  const approved = String(user.status || '').toLowerCase() === 'approved';
  document.querySelector('#emsCard')?.toggleAttribute('hidden', !approved || !(role === 'admin' || user.permissions?.portal_access === true));
  document.querySelector('#watchCommandCard')?.toggleAttribute('hidden', !approved || !(role === 'admin' || user.permissions?.watch_command_view === true));
  // Everyone sees the sync status; only users with permission see the action buttons.
  const canSync = Boolean(user.is_command);
  ['#syncBtn', '#fullSyncBtn', '#logSyncBtn'].forEach(id => { const el = document.querySelector(id); if (el) el.hidden = !canSync; });
  const syncDiscordBtn = document.querySelector('#syncDiscordBtn');
  if (syncDiscordBtn) syncDiscordBtn.hidden = !(canSync || user.permissions?.discord_sync_manage === true);
}

document.querySelector('[data-action="logout"]')?.addEventListener('click', () => window.lvfrLogout?.());
const cachedPortalUser = window.lvfrCachedUser?.();

const notificationList = document.querySelector('#portalNotificationList');
const notificationsButton = document.querySelector('#portalNotificationsButton');
const notificationPanel = document.querySelector('#portalNotificationPanel');
const markAllReadButton = document.querySelector('#portalMarkAllRead');
const clearMyNotificationsButton = document.querySelector('#portalClearMine');
const notificationStorageKey = `lvfr.portal.notifications.v2:${cachedPortalUser?.account_id || cachedPortalUser?.id || 'user'}`;

try { Object.keys(localStorage).filter(key => key.startsWith('lvfr.portal.notifications.v1:')).forEach(key => localStorage.removeItem(key)); } catch {}
function renderPortalNotifications(items = []) {
  if (!notificationList) return;
  const unread = items.filter(item => !Number(item.is_read)).length;
  const badge = document.querySelector('#portalNotificationBadge');
  if (badge) {
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.hidden = unread === 0;
  }
  notificationList.innerHTML = items.length ? items.slice(0, 8).map(item => `
    <button type="button" class="portal-notification ${Number(item.is_read) ? '' : 'unread'}" data-notification-id="${Number(item.id)}">
      <strong>${escapePortalText(item.title || 'Notification')}</strong>
      <span>${escapePortalText(item.message || '')}</span>
      <small>${escapePortalText(window.lvfrDateOnly ? window.lvfrDateOnly(item.created_at) : String(item.created_at || '').split('T')[0])}</small>
    </button>`).join('') : '<p>No notifications.</p>';
  notificationList.querySelectorAll('[data-notification-id]').forEach(button => {
    button.addEventListener('click', async () => {
      const item = (cachedNotifications || items).find(row => Number(row.id) === Number(button.dataset.notificationId));
      if (!item) return;
      await markPortalNotificationsRead([item.id]);
      if (item.kind === 'request' && cachedPortalUser?.is_admin) {
        location.assign('/administration');
        return;
      }
      const target = new URL('/', location.origin);
      if (item.callsign) target.searchParams.set('notification_id', String(item.id));
      location.assign(target.toString());
    });
  });
}
function escapePortalText(value) {
  const element = document.createElement('span');
  element.textContent = String(value);
  return element.innerHTML;
}

async function markPortalNotificationsRead(ids = []) {
  const current = cachedNotifications || [];
  const selected = new Set(ids.map(Number));
  const next = current.map(item => !ids.length || selected.has(Number(item.id)) ? { ...item, is_read: 1 } : item);
  try {
    const response = await fetch('/api/notifications/read', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!response.ok) throw new Error('Could not save notification read status');
    cachedNotifications = next;
    try { localStorage.setItem(notificationStorageKey, JSON.stringify(next)); } catch {}
    renderPortalNotifications(next);
  } catch {}
}
notificationsButton?.addEventListener('click', () => {
  const opening = Boolean(notificationPanel?.hidden);
  if (notificationPanel) notificationPanel.hidden = !opening;
  notificationsButton.setAttribute('aria-expanded', String(opening));
  if (opening && cachedNotifications?.some(item => !Number(item.is_read))) {
    void markPortalNotificationsRead();
  }
});
markAllReadButton?.addEventListener('click', () => { void markPortalNotificationsRead(); });
// Clears only this account's view of notifications. Other people keep theirs.
clearMyNotificationsButton?.addEventListener('click', async () => {
  clearMyNotificationsButton.disabled = true;
  try {
    const response = await fetch('/api/notifications/clear-mine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || result.error || 'Could not clear your notifications.');
    cachedNotifications = [];
    try { localStorage.setItem(notificationStorageKey, '[]'); } catch {}
    renderPortalNotifications([]);
  } catch (error) {
    window.alert(error.message);
  } finally {
    clearMyNotificationsButton.disabled = false;
  }
});
document.addEventListener('click', event => {
  if (event.target.closest('.notification-control')) return;
  if (notificationPanel) notificationPanel.hidden = true;
  notificationsButton?.setAttribute('aria-expanded', 'false');
});

let cachedNotifications = null;
try {
  const stored = JSON.parse(localStorage.getItem(notificationStorageKey) || 'null');
  if (Array.isArray(stored)) cachedNotifications = stored;
} catch {}
if (cachedNotifications) renderPortalNotifications(cachedNotifications);
window.addEventListener('storage', event => {
  if (event.key !== notificationStorageKey || !event.newValue) return;
  try {
    const updated = JSON.parse(event.newValue);
    if (Array.isArray(updated)) {
      cachedNotifications = updated;
      renderPortalNotifications(updated);
    }
  } catch {}
});

function loadPortalNotifications() {
  return fetch('/api/notifications')
  .then(response => response.ok ? response.json() : Promise.reject(new Error('Unable to load notifications')))
  .then(result => {
    cachedNotifications = Array.isArray(result.items) ? result.items : [];
    try { localStorage.setItem(notificationStorageKey, JSON.stringify(cachedNotifications)); } catch {}
    renderPortalNotifications(cachedNotifications);
    if (!notificationPanel?.hidden && cachedNotifications.some(item => !Number(item.is_read))) {
      void markPortalNotificationsRead();
    }
  })
  .catch(() => {
    if (notificationList && !cachedNotifications) notificationList.innerHTML = '<p>Could not load notifications. Try again.</p>';
  });
}

// Fetch immediately so the badge and hidden list are ready before the user opens them.
void loadPortalNotifications();
setInterval(() => {
  if (!document.hidden) void loadPortalNotifications();
}, 15000);

fetch('/auth/me')
  .then(response => response.ok ? response.json() : null)
  .then(user => {
    if (!user) return;
    window.lvfrCacheUser?.(user);
    showAvailableApps(user);
    void refreshSyncStatus();
  })
  .catch(() => {});

// Sync control in the top bar, the same as EMS Operations.
const syncPanel = document.querySelector('#commandSyncPanel');
const syncToggle = document.querySelector('#syncToggleButton');
const syncNowBtn = document.querySelector('#syncBtn');
const fullSyncBtn = document.querySelector('#fullSyncBtn');
const logSyncBtn = document.querySelector('#logSyncBtn');
const SYNC_GREEN = '#56d364';
const SYNC_AMBER = '#d29922';
const SYNC_RED = '#f85149';

function setSyncText(id, text, color, title) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  if (title) el.title = title;
  if (color) el.style.color = color;
}

async function refreshSyncStatus() {
  try {
    const health = await fetch('/api/health');
    setSyncText('syncScriptStatus', health.ok ? 'Google Apps Script: online' : 'Google Apps Script: offline', health.ok ? SYNC_GREEN : SYNC_RED);
  } catch {
    setSyncText('syncScriptStatus', 'Google Apps Script: offline', SYNC_RED);
  }
  try {
    const response = await fetch('/api/sync-status');
    const s = await response.json();
    if (response.ok) {
      setSyncText('syncStatus',
        s.synced_at ? `Roster: ${s.members} · ${window.lvfrDateOnly(s.synced_at)}` : `Roster: ${s.members} · Initial sync pending`,
        s.synced_at ? SYNC_GREEN : SYNC_AMBER,
        s.synced_at ? `Roster snapshot: ${window.lvfrDateOnly(s.synced_at)} | ${s.members} members` : `Roster ready: ${s.members} members | waiting for initial sync`);
      setSyncText('syncActivityStatus', 'Site: live · Sheet: trigger sync', SYNC_AMBER, 'Site edits update D1 immediately; Sheet edits sync through the spreadsheet trigger');
      if (syncNowBtn && !syncNowBtn.dataset.syncing) syncNowBtn.disabled = Boolean(s.sync_running);
    }
  } catch {}
  setSyncText('googleWriteStatus', 'Sheets: background sync', SYNC_GREEN, 'Edits save to D1 immediately; Google Sheets updates in the background');
  setSyncText('archiveStatus', 'Audit: private Sheet', SYNC_GREEN, 'Audit history is stored in the private Google Sheet');
}

async function runSyncAction(button, busyText, idleText, url, confirmText) {
  if (!button) return;
  if (confirmText && !(await window.lvfrConfirm({ title: 'Sync', message: confirmText, confirmText: 'Run' }))) return;
  button.dataset.syncing = 'true';
  button.disabled = true;
  button.textContent = busyText;
  try {
    const response = await fetch(url, { method: 'POST' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || result.error || 'Sync failed.');
    setSyncText('syncActivityStatus', result.message || 'Sync complete', SYNC_GREEN);
  } catch (error) {
    setSyncText('syncActivityStatus', error.message, SYNC_RED);
  } finally {
    delete button.dataset.syncing;
    button.disabled = false;
    button.textContent = idleText;
    await refreshSyncStatus();
  }
}

syncToggle?.addEventListener('click', event => {
  event.stopPropagation();
  const opening = syncPanel.hidden;
  syncPanel.hidden = !opening;
  syncToggle.setAttribute('aria-expanded', String(opening));
});
document.addEventListener('click', event => {
  if (event.target.closest('.sync-control')) return;
  if (syncPanel) syncPanel.hidden = true;
  syncToggle?.setAttribute('aria-expanded', 'false');
});
syncNowBtn?.addEventListener('click', () => runSyncAction(syncNowBtn, 'Syncing…', 'Sync now', '/api/sync'));
fullSyncBtn?.addEventListener('click', () => runSyncAction(fullSyncBtn, 'Full Syncing…', 'Full Sync', '/api/full-sync',
  'Full Sync will replace the D1 roster and Callsign slots from the current Google Sheet. Continue?'));
document.querySelector('#syncDiscordBtn')?.addEventListener('click', () => runSyncAction(document.querySelector('#syncDiscordBtn'), 'Syncing Discord…', 'Sync Discord', '/api/discord/sync', 'Refresh the roster and link Discord members by exact callsign? This will not change Discord nicknames or roles.'));
logSyncBtn?.addEventListener('click', () => runSyncAction(logSyncBtn, 'Syncing logs…', 'Log sync', '/api/logs-sync',
  'Log sync copies logs from the Google Sheet into D1. Continue?'));
void refreshSyncStatus();
