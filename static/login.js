const message = document.querySelector('#authMessage');
const loginForm = document.querySelector('#loginForm');
const signupForm = document.querySelector('#signupForm');
const claimForm = document.querySelector('#claimForm');

async function checkAccount() {
  const response = await fetch('/auth/me');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || 'Session expired. Sign in again.');
  if (payload.status !== 'approved') {
    message.textContent = 'Your account is waiting for Commander approval.';
    return;
  }
  location.replace(payload.role === 'member' ? '/watch-command' : '/portal');
}

async function submitAuth(form, route) {
  const button = form.querySelector('button[type="submit"]');
  const fields = Object.fromEntries(new FormData(form));
  if (fields.callsign) fields.callsign = String(fields.callsign).trim().toUpperCase();
  button.disabled = true;
  message.className = 'auth-message';
  message.textContent = route === '/auth/login' ? 'Signing in…' : 'Submitting account request…';
  try {
    const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || 'Could not complete the request.');
    if (route === '/auth/signup') {
      form.reset();
      message.textContent = 'Request sent. A Commander must approve the account before you can sign in.';
      message.className = 'auth-message success';
      return;
    }
    window.lvfrSetSession(result.token);
    await checkAccount();
  } catch (error) {
    message.textContent = error.message;
  } finally { button.disabled = false; }
}

loginForm.addEventListener('submit', event => { event.preventDefault(); submitAuth(loginForm, '/auth/login'); });
signupForm.addEventListener('submit', event => { event.preventDefault(); submitAuth(signupForm, '/auth/signup'); });
claimForm.addEventListener('submit', event => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(claimForm));
  const button = claimForm.querySelector('button[type="submit"]');
  const clientId = window.LVFR_PUBLIC_CONFIG?.googleOAuthClientId;
  if (!clientId || !window.google?.accounts?.oauth2) { message.textContent = 'Google verification is not available yet. Try again shortly.'; return; }
  button.disabled = true;
  message.textContent = 'Verify your existing Google-linked account…';
  const client = google.accounts.oauth2.initTokenClient({
    client_id: clientId, scope: 'openid email profile', include_granted_scopes: true,
    callback: async result => {
      try {
        if (result.error || !result.access_token) throw new Error(result.error_description || 'Google verification was not completed.');
        const response = await fetch('/auth/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${result.access_token}` }, body: JSON.stringify(fields) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.detail || 'Could not update the account.');
        window.lvfrSetSession(payload.token);
        await checkAccount();
      } catch (error) { message.textContent = error.message; button.disabled = false; }
    },
    error_callback: () => { message.textContent = 'Google verification could not open. Allow popups and try again.'; button.disabled = false; }
  });
  client.requestAccessToken({ prompt: 'select_account' });
});
if (window.lvfrSessionToken()) checkAccount().catch(() => {});
