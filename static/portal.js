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
try {
  const cachedNotifications = JSON.parse(localStorage.getItem(notificationStorageKey) || 'null');
  if (Array.isArray(cachedNotifications)) renderPortalNotifications(cachedNotifications);
} catch {}
fetch('/api/notifications')
  .then(response => response.ok ? response.json() : Promise.reject(new Error('Unable to load notifications')))
  .then(result => {
    const items = Array.isArray(result.items) ? result.items : [];
    try { localStorage.setItem(notificationStorageKey, JSON.stringify(items)); } catch {}
    renderPortalNotifications(items);
  })
  .catch(() => {
    if (notificationList && !notificationList.querySelector('.portal-notification')) notificationList.innerHTML = '<p>Notifications will appear here when available.</p>';
  });

if (!cachedPortalUser) fetch('/auth/me')
  .then(response => response.ok ? response.json() : null)
  .then(user => {
    window.lvfrCacheUser?.(user);
    document.querySelector('#administrationCard')?.toggleAttribute('hidden', !user || !(Boolean(user.is_admin) || ['admin', 'commander'].includes(String(user.role || '').toLowerCase())));
    document.querySelector('#emsCard')?.toggleAttribute('hidden', !user || user.status !== 'approved' || user.role === 'member');
  })
  .catch(() => {});
