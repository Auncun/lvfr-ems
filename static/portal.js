function showAvailableApps(user) {
  if (!user) return;
  const isCommander = Boolean(user.is_admin) || ['admin', 'commander'].includes(String(user.role || '').toLowerCase());
  if (isCommander) document.querySelector('#administrationCard')?.removeAttribute('hidden');
  if (user.status === 'approved' && user.role !== 'member') document.querySelector('#emsCard')?.removeAttribute('hidden');
}

document.querySelector('[data-action="logout"]')?.addEventListener('click', () => window.lvfrLogout?.());
showAvailableApps(window.lvfrCachedUser?.());

fetch('/auth/me')
  .then(response => response.ok ? response.json() : null)
  .then(user => {
    window.lvfrCacheUser?.(user);
    document.querySelector('#administrationCard')?.toggleAttribute('hidden', !user || !(Boolean(user.is_admin) || ['admin', 'commander'].includes(String(user.role || '').toLowerCase())));
    document.querySelector('#emsCard')?.toggleAttribute('hidden', !user || user.status !== 'approved' || user.role === 'member');
  })
  .catch(() => {});
