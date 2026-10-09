function showAvailableApps(user) {
  if (!user) return;
  const canOpenOperationCommand = Boolean(user.is_admin) || ['admin', 'commander'].includes(String(user.role || '').toLowerCase()) || user.permissions?.operation_command_access === true;
  document.querySelector('#administrationCard')?.toggleAttribute('hidden', !canOpenOperationCommand);
  const role = String(user.role || '').trim().toLowerCase();
  const approved = String(user.status || '').toLowerCase() === 'approved';
  document.querySelector('#emsCard')?.toggleAttribute('hidden', !approved || !(role === 'admin' || user.permissions?.portal_access === true));
  document.querySelector('#watchCommandCard')?.toggleAttribute('hidden', !approved || !(role === 'admin' || user.permissions?.watch_command_view === true));
  const canSync = Boolean(user.is_command || isCommander);
  document.querySelector('#portalSyncButton')?.toggleAttribute('hidden', !canSync);
  document.querySelector('#portalSyncStatus')?.toggleAttribute('hidden', !canSync);
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
      <small>${escapePortalText(item.created_at || '')}</small>
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
    void loadPortalSyncStatus();
  })
  .catch(() => {});

const portalSyncButton = document.querySelector('#portalSyncButton');
const portalSyncStatus = document.querySelector('#portalSyncStatus');
function showPortalSyncTime(value) {
  if (!portalSyncStatus) return;
  portalSyncStatus.textContent = value ? `Last sync: ${value}` : 'Roster has not been synced yet.';
}
async function loadPortalSyncStatus() {
  if (!portalSyncButton || portalSyncButton.hidden) return;
  try {
    const response = await fetch('/api/sync-status');
    const result = await response.json();
    if (response.ok) showPortalSyncTime(result.synced_at || result.sync_last_success);
  } catch {}
}
portalSyncButton?.addEventListener('click', async () => {
  portalSyncButton.disabled = true;
  portalSyncButton.textContent = 'Syncing…';
  if (portalSyncStatus) portalSyncStatus.textContent = 'Updating roster…';
  try {
    const response = await fetch('/api/sync', { method: 'POST' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || result.error || 'Roster sync failed.');
    showPortalSyncTime(result.synced_at || new Date().toISOString());
    portalSyncButton.textContent = 'Sync complete';
    setTimeout(() => { portalSyncButton.textContent = 'Sync roster'; }, 1800);
  } catch (error) {
    if (portalSyncStatus) portalSyncStatus.textContent = error.message;
    portalSyncButton.textContent = 'Sync roster';
  } finally {
    portalSyncButton.disabled = false;
  }
});
void loadPortalSyncStatus();