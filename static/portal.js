document.querySelector('[data-action="logout"]')?.addEventListener('click', () => {
  fetch('/auth/logout', { method: 'POST' }).finally(() => location.assign('/login'));
});

fetch('/auth/me')
  .then(response => response.ok ? response.json() : null)
  .then(user => {
    const isCommander = Boolean(user?.is_admin) || ['admin', 'commander'].includes(String(user?.role || '').toLowerCase());
    if (isCommander) document.querySelector('#administrationCard')?.removeAttribute('hidden');
    if (user?.status === 'approved' && user?.role !== 'member') document.querySelector('#emsCard')?.removeAttribute('hidden');
  })
  .catch(() => {});
