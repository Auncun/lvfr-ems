/* Short lived member-name/password session bridge shared by the PWA and API proxy. */
(function () {
  const TOKEN_KEY = 'lvfr.session.token';
  const USER_KEY = 'lvfr.session.user';
  const API_CACHE_INDEX = 'lvfr.api.cache.index.v1';
  const nativeFetch = window.fetch.bind(window);
  const apiPrefix = /^(?:\/api\/|\/auth\/)/;

  const cachedApiRoute = pathname => pathname === '/api/config'
    || pathname === '/api/members'
    || pathname === '/api/eligible'
    || pathname === '/api/inactive'
    || pathname === '/api/account/profile'
    || pathname.startsWith('/api/member/')
    || pathname.startsWith('/api/members-log')
    || ['/api/promotions', '/api/training-log', '/api/exam-log', '/api/termination-log', '/api/instructors', '/api/watch-command/members'].includes(pathname);
  const readApiCacheIndex = () => {
    try { return JSON.parse(sessionStorage.getItem(API_CACHE_INDEX) || '[]'); }
    catch { return []; }
  };
  const clearApiCache = () => {
    for (const key of readApiCacheIndex()) sessionStorage.removeItem(key);
    sessionStorage.removeItem(API_CACHE_INDEX);
    sessionStorage.removeItem('lvfr.roster.snapshot.v1');
    const accountId = window.lvfrCachedUser?.()?.account_id || window.lvfrCachedUser?.()?.id || '';
    if (accountId) sessionStorage.removeItem(`lvfr.account.profile.v1:${accountId}`);
  };
  const cachedResponse = entry => new Response(entry.body, {
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers || { 'Content-Type': 'application/json' }
  });

  window.lvfrSessionToken = () => localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || '';
  window.lvfrCachedUser = () => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  };
  window.lvfrCacheUser = user => {
    if (!user) return;
    const store = localStorage.getItem(TOKEN_KEY) ? localStorage : sessionStorage;
    try { store.setItem(USER_KEY, JSON.stringify(user)); } catch {}
  };
  window.lvfrSetSession = (token, remember = false, user = null) => {
    clearApiCache();
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem('lvfr.roster.snapshot.v1');
    const store = remember ? localStorage : sessionStorage;
    if (token) store.setItem(TOKEN_KEY, token);
    if (user) store.setItem(USER_KEY, JSON.stringify(user));
  };
  window.lvfrForgetSession = () => {
    clearApiCache();
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem('lvfr.roster.snapshot.v1');
  };

  window.lvfrLogout = () => {
    const token = window.lvfrSessionToken();
    window.lvfrForgetSession();
    location.replace('/login');
    nativeFetch('/auth/logout', {
      method: 'POST', keepalive: true, credentials: 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    }).catch(() => {});
  };
  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !new URL(form.action, location.href).pathname.endsWith('/auth/logout')) return;
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.textContent = 'Signing out…'; }
    window.lvfrLogout();
  });

  const sendPresence = () => {
    const token = window.lvfrSessionToken();
    if (!token || document.hidden) return;
    nativeFetch('/api/presence', {
      method: 'POST', keepalive: true, credentials: 'same-origin',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}'
    }).catch(() => {});
  };
  sendPresence();
  window.setInterval(sendPresence, 30000);
  document.addEventListener('visibilitychange', sendPresence);

  window.fetch = (input, init = {}) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(requestUrl, location.href);
    if (url.origin !== location.origin || !apiPrefix.test(url.pathname)) return nativeFetch(input, init);
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const canCache = method === 'GET' && cachedApiRoute(url.pathname);
    const cacheKey = `lvfr.api.response.v1:${url.pathname}${url.search}`;
    if (canCache && window.lvfrSessionToken?.()) {
      try {
        const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
        if (cached && Date.now() - Number(cached.saved_at || 0) < 15 * 60 * 1000) return Promise.resolve(cachedResponse(cached));
      } catch {}
    }
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    const token = window.lvfrSessionToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const requestInit = { ...init, headers, credentials: 'same-origin' };
    if (input instanceof Request && init.body === undefined && !['GET', 'HEAD'].includes(input.method)) requestInit.body = input.clone().body;
    return nativeFetch(input, requestInit).then(async response => {
      if (response.status === 401) window.lvfrForgetSession();
      if (url.pathname === '/auth/logout') window.lvfrForgetSession();
      if (canCache && response.ok) {
        try {
          const body = await response.clone().text();
          const entry = {
            saved_at: Date.now(), body, status: response.status, statusText: response.statusText,
            headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json' }
          };
          sessionStorage.setItem(cacheKey, JSON.stringify(entry));
          const keys = readApiCacheIndex();
          if (!keys.includes(cacheKey)) {
            keys.push(cacheKey);
            sessionStorage.setItem(API_CACHE_INDEX, JSON.stringify(keys));
          }
        } catch {}
      }
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && response.ok && url.pathname.startsWith('/api/')) {
        clearApiCache();
        if (url.pathname === '/api/sync' || /^\/api\/(activity|note|date|training|exam|promote|force-promote|demote|change-rank|change-callsign|terminate)$/.test(url.pathname) || /^\/api\/member\/[^/]+\/instructor$/.test(url.pathname)) {
          sessionStorage.removeItem('lvfr.watch.member.directory.v1');
        }
      }
      return response;
    });
  };
})();
