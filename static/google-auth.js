/* Google OAuth token bridge shared by the PWA and its Pages API proxy. */
(function () {
  const TOKEN_KEY = "lvfr.google.access_token";
  const nativeFetch = window.fetch.bind(window);
  const apiPrefix = /^(?:\/api\/|\/auth\/)/;

  window.lvfrGoogleToken = () => sessionStorage.getItem(TOKEN_KEY) || "";
  window.lvfrForgetGoogleToken = () => sessionStorage.removeItem(TOKEN_KEY);

  window.fetch = (input, init = {}) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(requestUrl, location.href);
    if (url.origin !== location.origin || !apiPrefix.test(url.pathname)) return nativeFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    const token = window.lvfrGoogleToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const requestInit = { ...init, headers, credentials: "omit" };
    if (input instanceof Request && init.body === undefined && !["GET", "HEAD"].includes(input.method)) {
      requestInit.body = input.clone().body;
    }
    return nativeFetch(input, requestInit).then(response => {
      if (response.status === 401) window.lvfrForgetGoogleToken();
      if (url.pathname === "/auth/logout") window.lvfrForgetGoogleToken();
      return response;
    });
  };

  window.lvfrStartGoogleSignIn = function (onResult) {
    const clientId = window.LVFR_PUBLIC_CONFIG?.googleOAuthClientId;
    if (!clientId || !window.google?.accounts?.oauth2) {
      onResult(new Error("Google sign-in is not configured for this site."));
      return;
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "openid email profile https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly",
      include_granted_scopes: true,
      callback: result => {
        if (result.error || !result.access_token) {
          onResult(new Error(result.error_description || result.error || "Google sign-in was not completed."));
          return;
        }
        sessionStorage.setItem(TOKEN_KEY, result.access_token);
        onResult(null, result.access_token);
      }
    });
    client.requestAccessToken({ prompt: "select_account" });
  };
})();
