(() => {
  const accountName = document.querySelector('#accountName');
  const accountButton = document.querySelector('#accountMenuButton');
  const accountMenu = document.querySelector('#accountMenu');
  const applyUser = user => {
    if (accountName && user?.name) accountName.textContent = user.name;
  };
  applyUser(window.lvfrCachedUser?.());
  if (accountName && !accountName.textContent) {
    fetch('/auth/me').then(response => response.ok ? response.json() : null).then(user => {
      if (user) { window.lvfrCacheUser?.(user); applyUser(user); }
    }).catch(() => {});
  }
  accountButton?.addEventListener('click', () => {
    if (!accountMenu) return;
    accountMenu.hidden = !accountMenu.hidden;
    accountButton.setAttribute('aria-expanded', String(!accountMenu.hidden));
  });

  const onlineButton = document.querySelector('#topOnlineCount');
  const onlinePanel = document.querySelector('#onlineUsersPanel');
  const onlineList = document.querySelector('#onlineUsersList');
  function renderOnline(people = []) {
    if (!onlineList) return;
    onlineList.replaceChildren();
    if (!people.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No one online.';
      onlineList.append(empty);
      return;
    }
    for (const person of people) {
      const row = document.createElement('div');
      row.className = 'online-user';
      const name = document.createElement('strong');
      name.textContent = person.name || 'Member';
      row.append(name);
      if (person.callsign) {
        const callsign = document.createElement('span');
        callsign.textContent = person.callsign;
        row.append(callsign);
      }
      onlineList.append(row);
    }
  }
  async function refreshOnline() {
    try {
      const response = await fetch('/api/presence/summary');
      if (!response.ok) return;
      const data = await response.json();
      if (onlineButton) {
        onlineButton.textContent = `Online: ${Number(data.online_count || 0)}`;
        onlineButton.title = `Online now: ${Number(data.online_count || 0)}`;
      }
      renderOnline(Array.isArray(data.online) ? data.online : []);
    } catch {}
  }
  onlineButton?.addEventListener('click', async () => {
    if (!onlinePanel) return;
    onlinePanel.hidden = !onlinePanel.hidden;
    onlineButton.setAttribute('aria-expanded', String(!onlinePanel.hidden));
    if (!onlinePanel.hidden) await refreshOnline();
  });
  if (onlineButton) {
    void refreshOnline();
    window.setInterval(() => { if (!document.hidden) void refreshOnline(); }, 30000);
  }

  document.addEventListener('click', event => {
    if (accountMenu && !event.target.closest('.account-control')) {
      accountMenu.hidden = true;
      accountButton?.setAttribute('aria-expanded', 'false');
    }
    if (onlinePanel && !event.target.closest('.online-control')) {
      onlinePanel.hidden = true;
      onlineButton?.setAttribute('aria-expanded', 'false');
    }
  });

  const notificationButton = document.querySelector('#watchNotificationButton');
  const notificationPanel = document.querySelector('#watchNotificationPanel');
  const clearNotificationsButton = document.querySelector('#watchClearNotifications');
  const notificationList = document.querySelector('#watchNotificationList');
  const notificationBadge = document.querySelector('#watchNotificationBadge');
  let notifications = [];
  const markAllReadButton = document.querySelector('#watchMarkAllRead');
  function renderNotifications() {
    if (!notificationList) return;
    const unread = notifications.filter(item => !Number(item.is_read)).length;
    if (notificationBadge) {
      notificationBadge.textContent = unread > 99 ? '99+' : String(unread);
      notificationBadge.hidden = unread === 0;
    }
    notificationList.replaceChildren();
    if (!notifications.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No notifications.';
      notificationList.append(empty);
      return;
    }
    for (const item of notifications) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `notification-item ${Number(item.is_read) ? '' : 'unread'}`;
      const title = document.createElement('strong');
      title.textContent = item.title || 'Notification';
      const message = document.createElement('p');
      message.textContent = item.message || '';
      const date = document.createElement('small');
      date.textContent = item.created_at || '';
      button.append(title, message, date);
      button.addEventListener('click', async () => {
        await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [Number(item.id)] }) }).catch(() => {});
        if (item.kind === 'request') location.assign('/administration');
        else if (item.callsign) {
          const target = new URL('/', location.origin);
          target.searchParams.set('notification_id', String(item.id));
          location.assign(target.toString());
        } else location.assign('/');
      });
      notificationList.append(button);
    }
  }
  async function loadNotifications() {
    try {
      const response = await fetch('/api/notifications');
      if (!response.ok) return;
      const result = await response.json();
      notifications = Array.isArray(result.items) ? result.items : [];
      renderNotifications();
    } catch {}
  }
  notificationButton?.addEventListener('click', async () => {
    if (!notificationPanel) return;
    notificationPanel.hidden = !notificationPanel.hidden;
    notificationButton.setAttribute('aria-expanded', String(!notificationPanel.hidden));
    if (!notificationPanel.hidden) await loadNotifications();
  });
  markAllReadButton?.addEventListener('click', async () => {
    markAllReadButton.disabled = true;
    try {
      const response = await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [] }) });
      if (!response.ok) throw new Error('Could not mark notifications as read.');
      notifications = notifications.map(item => ({ ...item, is_read: 1 }));
      renderNotifications();
    } catch (error) {
      window.alert(error.message);
    } finally {
      markAllReadButton.disabled = false;
    }
  });
  // Clears only this account's view of notifications. Other people keep theirs.
  clearNotificationsButton?.addEventListener('click', async () => {
    clearNotificationsButton.disabled = true;
    try {
      const response = await fetch('/api/notifications/clear-mine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || result.error || 'Could not clear your notifications.');
      notifications = [];
      renderNotifications();
    } catch (error) {
      window.alert(error.message);
    } finally {
      clearNotificationsButton.disabled = false;
    }
  });
  if (notificationButton) {
    void loadNotifications();
    window.setInterval(() => { if (!document.hidden) void loadNotifications(); }, 60000);
    document.addEventListener('click', event => {
      if (event.target.closest('.notification-control')) return;
      if (notificationPanel) notificationPanel.hidden = true;
      notificationButton.setAttribute('aria-expanded', 'false');
    });
  }
})();