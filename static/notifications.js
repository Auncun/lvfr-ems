// Shared notification bell for every page. Same panel, filter, settings and behaviour everywhere.
// On the EMS Operations page, a notification opens in place (window.lvfrOpenNotification).
// On other pages it opens EMS Operations with notification_id in the address.
(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const LABELS = { inactive: "Due to Activity", overdue: "Training Overdue", termination: "Termination", promotion: "Promotion", eligible: "Can be promoted", callsign: "Callsign", training: "Training", training_time: "Training Hours", loi: "LOI", exam: "Exam", note: "Note", activity: "Activity", instructor: "Instructor", do_not_promote: "Do Not Promote", request: "New account request" };
  const state = { items: [], loadPromise: null, hydrated: false, prefs: null, prefsAt: 0, selected: new Set() };

  const accountId = () => String(window.lvfrCachedUser?.()?.account_id || window.lvfrCachedUser?.()?.id || '');
  const cacheKey = () => `lvfr.portal.notifications.v2:${accountId()}`;
  const notify = message => (typeof window.toast === 'function' ? window.toast(message) : console.warn(message));
  const panel = () => $('notificationPanel');
  const bellButton = () => $('notificationButton');

  async function request(path, options = {}) {
    const headers = options.body ? { 'Content-Type': 'application/json' } : {};
    const token = window.lvfrSessionToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(path, { method: options.method || 'GET', headers, body: options.body, keepalive: !!options.keepalive });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || result.error || 'Request failed.');
    return result;
  }

  function saveCache() {
    try { if (accountId()) localStorage.setItem(cacheKey(), JSON.stringify(state.items)); } catch {}
  }

  function closePanel() {
    const p = panel();
    if (p) p.hidden = true;
    bellButton()?.setAttribute('aria-expanded', 'false');
  }

  // Only notification types switched on in Notification Settings are listed or shown.
  async function enabledKinds() {
    if (state.prefs && Date.now() - state.prefsAt < 60000) return state.prefs;
    try {
      const result = await request('/api/account/notification-preferences');
      state.prefs = new Map(result.options.filter(option => option.allowed && option.enabled).map(option => [option.kind, option.label]));
      state.prefsAt = Date.now();
      document.dispatchEvent(new Event('notification-prefs-loaded'));
    } catch { state.prefs = null; }
    return state.prefs;
  }

  async function fillFilter() {
    const box = $('notificationFilter');
    if (!box) return;
    const enabled = await enabledKinds();
    const kinds = enabled ? [...enabled.keys()] : [];
    const labelOf = kind => (enabled && enabled.get(kind)) || LABELS[kind] || kind;
    state.selected = new Set([...state.selected].filter(value => value === 'unread' || kinds.includes(value)));
    const option = (value, label) => `<label class="notif-check"><input type="checkbox" value="${value}" ${state.selected.has(value) || (value === 'all' && state.selected.size === 0) ? 'checked' : ''}><span>${label}</span></label>`;
    box.innerHTML = option('all', 'All') + option('unread', 'Unread') + kinds.map(kind => option(kind, labelOf(kind))).join('');
  }

  function render() {
    void fillFilter();
    const badge = $('notificationBadge');
    const unread = state.items.filter(item => !Number(item.is_read)).length;
    if (badge) {
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.hidden = unread === 0;
    }
    const list = $('notificationList');
    if (!list) return;
    const kinds = [...state.selected].filter(value => value !== 'unread');
    const unreadOnly = state.selected.has('unread');
    const visible = state.items.filter(item => {
      if (state.prefs && !state.prefs.has(item.kind)) return false;
      if (kinds.length && !kinds.includes(item.kind)) return false;
      if (unreadOnly && Number(item.is_read)) return false;
      return true;
    });
    list.innerHTML = visible.length ? visible.map(item => `
      <button type="button" class="notification-item ${Number(item.is_read) ? '' : 'unread'}" data-notification-id="${Number(item.id)}">
        <strong>${esc(item.title)}</strong>
        <p>${esc(item.message)}</p>
        <small>${esc(item.created_at || '')}</small>
      </button>`).join('') : '<div class="empty">No notifications.</div>';
  }

  async function load(silent = true) {
    if (!state.hydrated && accountId()) {
      state.hydrated = true;
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey()) || 'null');
        if (Array.isArray(cached)) { state.items = cached; render(); }
      } catch {}
    }
    if (state.loadPromise) return state.loadPromise;
    state.loadPromise = (async () => {
      try {
        const result = await request('/api/notifications');
        state.items = Array.isArray(result.items) ? result.items : [];
        saveCache();
        render();
      } catch (error) {
        if (!silent) notify(`Could not load notifications: ${error.message}`);
      } finally {
        state.loadPromise = null;
      }
    })();
    return state.loadPromise;
  }

  function applyRead(ids = []) {
    const selected = new Set((ids || []).map(Number));
    state.items = state.items.map(item => !selected.size || selected.has(Number(item.id)) ? { ...item, is_read: 1 } : item);
    saveCache();
    render();
  }

  async function markRead(ids = []) {
    try {
      await request('/api/notifications/read', { method: 'POST', body: JSON.stringify({ ids }), keepalive: true });
      applyRead(ids);
    } catch (error) {
      notify(`Could not update notifications: ${error.message}`);
    }
  }

  async function clearMine(button) {
    button.disabled = true;
    try {
      await request('/api/notifications/clear-mine', { method: 'POST', body: '{}' });
      state.items = [];
      saveCache();
      render();
    } catch (error) {
      notify(`Could not clear notifications: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  }

  function find(id) { return state.items.find(row => Number(row.id) === Number(id)) || null; }

  async function activate(id) {
    const item = find(id);
    if (!item) return;
    closePanel();
    if (typeof window.lvfrOpenNotification === 'function') return window.lvfrOpenNotification(id);
    await markRead([id]);
    if (item.kind === 'request' && window.lvfrCachedUser?.()?.is_admin) return location.assign('/administration');
    const target = new URL('/', location.origin);
    if (item.callsign) target.searchParams.set('notification_id', String(item.id));
    location.assign(target.toString());
  }

  function init() {
    const button = bellButton();
    if (!button) return;
    button.addEventListener('click', async () => {
      const p = panel();
      if (!p) return;
      p.hidden = !p.hidden;
      button.setAttribute('aria-expanded', String(!p.hidden));
      if (!p.hidden) { await load(false); await markRead(); }
    });
    $('markNotificationsRead')?.addEventListener('click', () => markRead());
    $('clearMyNotifications')?.addEventListener('click', event => clearMine(event.currentTarget));
    $('notificationList')?.addEventListener('click', event => {
      const item = event.target.closest?.('[data-notification-id]');
      if (item) void activate(Number(item.dataset.notificationId));
    });
    $('notificationFilter')?.addEventListener('change', event => {
      const input = event.target;
      if (!input.matches?.('input[type="checkbox"]')) return;
      if (input.value === 'all') state.selected = new Set();
      else if (input.checked) state.selected.add(input.value);
      else state.selected.delete(input.value);
      render();
    });
    document.addEventListener('click', event => {
      if (!event.target.closest?.('.notification-control')) closePanel();
    });
    document.addEventListener('notification-prefs-changed', () => {
      state.prefs = null;
      void enabledKinds().then(render);
    });
    document.addEventListener('notification-prefs-loaded', render);

    void load();
    setInterval(() => { if (!document.hidden) void load(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void load(); });
  }

  window.lvfrNotifications = { load, markRead, applyRead, render, find };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();