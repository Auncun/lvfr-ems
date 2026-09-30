/* Short lived username/password session bridge shared by the PWA and API proxy. */
(function () {
  const TOKEN_KEY = 'lvfr.session.token';
  const nativeFetch = window.fetch.bind(window);
  const apiPrefix = /^(?:\/api\/|\/auth\/)/;

  window.lvfrSessionToken = () => sessionStorage.getItem(TOKEN_KEY) || '';
  window.lvfrSetSession = token => sessionStorage.setItem(TOKEN_KEY, token);
  window.lvfrForgetSession = () => sessionStorage.removeItem(TOKEN_KEY);

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
