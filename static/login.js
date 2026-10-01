const message = document.querySelector('#authMessage');
const loginForm = document.querySelector('#loginForm');
const signupForm = document.querySelector('#signupForm');

async function checkAccount() {
  const response = await fetch('/auth/me');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || 'Session expired. Sign in again.');
  if (payload.status !== 'approved') {
    message.textContent = 'Your account is waiting for Commander approval.';
    return;
  }
  routeForUser(payload);
}

function routeForUser(user) {
  if (user.status !== 'approved') {
    message.textContent = 'Your account is waiting for Commander approval.';
    return;
  }
  location.replace(user.role === 'member' ? '/watch-command' : '/portal');
}

async function submitAuth(form, route) {
  const button = form.querySelector('button[type="submit"]');
  const fields = Object.fromEntries(new FormData(form));
  if (fields.name) fields.name = String(fields.name).trim().replace(/\s+/g, ' ');
  const remember = fields.remember_me === 'on';
  fields.remember_me = remember;
  fields.stay_logged_in = remember;
  button.disabled = true;
  message.className = 'auth-message';
  message.textContent = route === '/auth/login' ? 'Signing in…' : 'Submitting account request…';
  try {
    const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || 'Could not complete the request.');
    if (route === '/auth/signup') {
      form.reset();
      if (result.status === 'saving' && result.request_id) {
        message.textContent = 'Request received. Saving it securely…';
        message.className = 'auth-message success';
        location.assign('/verification-pending?request_id=' + encodeURIComponent(result.request_id));
      } else {
        message.textContent = `Your account request was received. A Commander must approve it before sign-in.`;
        message.className = 'auth-message success';
      }
      return;
    }
    window.lvfrSetSession(result.token, remember, result.user);
    // The login response already contains the authenticated user. Use it
    // directly instead of making a second /auth/me round-trip before redirect.
    routeForUser(result.user);
  } catch (error) {
    message.textContent = error.message;
  } finally { button.disabled = false; }
}

loginForm.addEventListener('submit', event => { event.preventDefault(); submitAuth(loginForm, '/auth/login'); });
signupForm.addEventListener('submit', event => { event.preventDefault(); submitAuth(signupForm, '/auth/signup'); });
document.querySelectorAll('[data-show-password]').forEach(toggle => {
  toggle.addEventListener('change', () => {
    const password = toggle.closest('form').querySelector('input[name="password"]');
    password.type = toggle.checked ? 'text' : 'password';
  });
});
if (window.lvfrSessionToken()) checkAccount().catch(() => {});
