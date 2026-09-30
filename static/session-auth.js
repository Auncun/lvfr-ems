/* Short lived member-name/password session bridge shared by the PWA and API proxy. */
(function () {
  const TOKEN_KEY = 'lvfr.session.token';
  const USER_KEY = 'lvfr.session.user';
  const nativeFetch = window.fetch.bind(window);
  const apiPrefix = /^(?:\/api\/|\/auth\/)/;

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
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem('lvfr.roster.snapshot.v1');
    const store = remember ? localStorage : sessionStorage;
    store.setItem(TOKEN_KEY, token);
    if (user) store.setItem(USER_KEY, JSON.stringify(user));
  };
  window.lvfrForgetSession = () => {
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
    if (token) nativeFetch('/auth/logout', {
      method: 'POST', keepalive: true, credentials: 'omit',
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => {});
  };
  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !new URL(form.action, location.href).pathname.endsWith('/auth/logout')) return;
    event.preventDefault();
    window.lvfrLogout();
  });

  window.fetch = (input, init = {}) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(requestUrl, location.href);
    if (url.origin !== location.origin || !apiPrefix.test(url.pathname)) return nativeFetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    const token = window.lvfrSessionToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const requestInit = { ...init, headers, credentials: 'omit' };
    if (input instanceof Request && init.body === undefined && !['GET', 'HEAD'].includes(input.method)) requestInit.body = input.clone().body;
    return nativeFetch(input, requestInit).then(response => {
      if (response.status === 401) window.lvfrForgetSession();
      if (url.pathname === '/auth/logout') window.lvfrForgetSession();
      return response;
    });
  };
})();
