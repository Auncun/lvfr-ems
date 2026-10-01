function showAvailableApps(user) {
  if (!user) return;
  const isCommander = Boolean(user.is_admin) || ['admin', 'commander'].includes(String(user.role || '').toLowerCase());
  if (isCommander) document.querySelector('#administrationCard')?.removeAttribute('hidden');
  if (user.status === 'approved' && user.role !== 'member') document.querySelector('#emsCard')?.removeAttribute('hidden');
}

document.querySelector('[data-action="logout"]')?.addEventListener('click', () => window.lvfrLogout?.());
const cachedPortalUser = window.lvfrCachedUser?.();
showAvailableApps(cachedPortalUser);

const notificationList = document.querySelector('#portalNotificationList');
const notificationsButton = document.querySelector('#portalNotificationsButton');
const notificationPanel = document.querySelector('#portalNotificationPanel');
const notificationStorageKey = `lvfr.portal.notifications.v1:${cachedPortalUser?.account_id || cachedPortalUser?.id || 'user'}`;
function renderPortalNotifications(items = []) {
  if (!notificationList) return;
  const unread = items.filter(item => !Number(item.is_read)).length;
  const badge = document.querySelector('#portalNotificationBadge');
  if (badge) badge.textContent = unread ? `(${unread} new)` : '';
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
      try { sessionStorage.setItem('lvfr.portal.pending-notification', String(item.id)); } catch {}
      location.assign('/');
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

if (!cachedPortalUser) fetch('/auth/me')
  .then(response => response.ok ? response.json() : null)
  .then(user => {
    window.lvfrCacheUser?.(user);
    document.querySelector('#administrationCard')?.toggleAttribute('hidden', !user || !(Boolean(user.is_admin) || ['admin', 'commander'].includes(String(user.role || '').toLowerCase())));
    document.querySelector('#emsCard')?.toggleAttribute('hidden', !user || user.status !== 'approved' || user.role === 'member');
  })
  .catch(() => {});
