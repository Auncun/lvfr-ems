const message = document.querySelector('#authMessage');
const loginForm = document.querySelector('#loginForm');
const signupForm = document.querySelector('#signupForm');
try {
  const diagnostic = JSON.parse(localStorage.getItem('lvfr.auth.last-error') || 'null');
  if (diagnostic && Date.now() - Number(diagnostic.saved_at || 0) < 10 * 60 * 1000) {
    message.textContent = `Session rejected on ${diagnostic.path}: ${diagnostic.detail}`;
    message.className = 'auth-message error';
    localStorage.removeItem('lvfr.auth.last-error');
  }
} catch {}

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
    localStorage.removeItem('lvfr.auth.last-error');
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
    window.lvfrSetSession(result.token, remember);
    await checkAccount();
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
