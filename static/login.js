const message = document.querySelector('#authMessage');
const loginForm = document.querySelector('#loginForm');
const signupForm = document.querySelector('#signupForm');
try {
  const diagnostic = JSON.parse(localStorage.getItem('lvfr.auth.last-error') || 'null');
  if (diagnostic && Date.now() - Number(diagnostic.saved_at || 0) < 10 * 60 * 1000) {
    message.textContent = 'Your session ended. Please sign in again.';
    message.className = 'auth-message notice';
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
  location.replace(user.role === 'member' && !user.permissions?.portal_access ? '/watch-command' : '/portal');
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
// The sign-up form is a separate panel so a new user can find it immediately.
const signupPanel = document.querySelector('#signupPanel');
const authSwitch = document.querySelector('.auth-switch');
const forgotPanel = document.querySelector('#forgotPanel');
const forgotForm = document.querySelector('#forgotForm');
const resetForm = document.querySelector('#resetForm');
function showAuthPanel(panel) {
  loginForm.hidden = panel !== 'login';
  authSwitch.hidden = panel !== 'login';
  signupPanel.hidden = panel !== 'signup';
  forgotPanel.hidden = panel !== 'forgot';
  message.textContent = '';
  message.className = 'auth-message';
  const first = { login: loginForm, signup: signupForm, forgot: forgotForm }[panel]?.querySelector('input[name="name"]');
  first?.focus();
}
document.querySelector('#showSignup').addEventListener('click', () => showAuthPanel('signup'));
document.querySelector('#showLogin').addEventListener('click', () => showAuthPanel('login'));
document.querySelector('#showForgot').addEventListener('click', () => showAuthPanel('forgot'));
document.querySelector('#forgotBack').addEventListener('click', () => { resetForm.reset(); resetForm.hidden = true; showAuthPanel('login'); });
document.querySelectorAll('[data-show-password]').forEach(toggle => {
  toggle.addEventListener('change', () => {
    const password = toggle.closest('form').querySelector('input[name="password"], input[name="new_password"]');
    password.type = toggle.checked ? 'text' : 'password';
  });
});
async function postAuth(route, body) {
  const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.detail || 'Could not complete the request.');
  return result;
}
// Forgot password: step 1 asks the bot for a code, step 2 sends the code with a new password.
forgotForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = forgotForm.querySelector('button[type="submit"]');
  const name = String(new FormData(forgotForm).get('name') || '').trim().replace(/\s+/g, ' ');
  button.disabled = true;
  message.className = 'auth-message';
  message.textContent = 'Sending…';
  try {
    const result = await postAuth('/auth/forgot', { name });
    resetForm.elements.name.value = name;
    resetForm.hidden = false;
    message.textContent = result.message + ' If nothing arrives, allow direct messages from server members in Discord, or ask a Commander to reset your password.';
    message.className = 'auth-message success';
    resetForm.querySelector('input[name="code"]').focus();
  } catch (error) { message.textContent = error.message; } finally { button.disabled = false; }
});
resetForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = resetForm.querySelector('button[type="submit"]');
  const fields = Object.fromEntries(new FormData(resetForm));
  button.disabled = true;
  message.className = 'auth-message';
  message.textContent = 'Changing password…';
  try {
    const result = await postAuth('/auth/reset', fields);
    resetForm.reset();
    resetForm.hidden = true;
    forgotForm.reset();
    showAuthPanel('login');
    message.textContent = result.message;
    message.className = 'auth-message success';
  } catch (error) { message.textContent = error.message; } finally { button.disabled = false; }
});
if (window.lvfrSessionToken()) checkAccount().catch(() => {});
