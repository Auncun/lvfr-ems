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
    button.addEventListener('click', () => {
      const item = items.find(row => Number(row.id) === Number(button.dataset.notificationId));
      if (!item) return;
      fetch('/api/notifications/read', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [item.id] }) }).catch(() => {});
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
let cachedNotifications = null;
let notificationLoadPromise = null;
let notificationLoadedAt = 0;
try {
  const stored = JSON.parse(localStorage.getItem(notificationStorageKey) || 'null');
  if (Array.isArray(stored)) cachedNotifications = stored;
} catch {}
if (cachedNotifications) renderPortalNotifications(cachedNotifications);
function loadPortalNotifications() {
  if (notificationLoadPromise) return notificationLoadPromise;
  if (cachedNotifications) renderPortalNotifications(cachedNotifications);
  else if (notificationList) notificationList.innerHTML = '<p>Loading notifications…</p>';
  notificationLoadPromise = fetch('/api/notifications')
    .then(response => response.ok ? response.json() : Promise.reject(new Error('Unable to load notifications')))
    .then(result => {
      cachedNotifications = Array.isArray(result.items) ? result.items : [];
      notificationLoadedAt = Date.now();
      try { localStorage.setItem(notificationStorageKey, JSON.stringify(cachedNotifications)); } catch {}
      renderPortalNotifications(cachedNotifications);
    })
    .catch(() => {
      if (notificationList && !cachedNotifications) notificationList.innerHTML = '<p>Could not load notifications. Try again.</p>';
    })
    .finally(() => { notificationLoadPromise = null; });
  return notificationLoadPromise;
}
notificationsButton?.addEventListener('click', () => {
  const opening = notificationPanel?.hidden;
  if (notificationPanel) notificationPanel.hidden = !opening;
  notificationsButton.setAttribute('aria-expanded', String(Boolean(opening)));
  if (opening && Date.now() - notificationLoadedAt > 15000) void loadPortalNotifications();
});
// Fetch as soon as Portal opens; the panel itself stays hidden until requested.
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
