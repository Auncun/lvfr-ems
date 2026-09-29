const message = document.querySelector('#authMessage');
const signInButton = document.querySelector('#googleSignInButton');
const signupForm = document.querySelector('#signupForm');

async function checkGoogleAccount() {
  const response = await fetch('/auth/me');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || 'This Google account is not linked to an LVFR account.');
  if (payload.status !== 'approved') {
    message.textContent = 'Your account is waiting for Commander approval.';
    return;
  }
  if (payload.role === 'member') location.replace('/watch-command');
  else location.replace('/portal');
}

async function requestAccount() {
  const form = signupForm;
  const fields = Object.fromEntries(new FormData(form));
  fields.callsign = String(fields.callsign || '').trim().toUpperCase();
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  message.textContent = 'Connecting to Google…';
  const sendRequest = async () => {
    try {
      const response = await fetch('/auth/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || 'Could not request an account.');
      message.textContent = 'Request sent. A Commander must approve the account before you can sign in.';
      message.className = 'auth-message success';
      form.reset();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  };
  if (window.lvfrGoogleToken()) return sendRequest();
  window.lvfrStartGoogleSignIn(async error => {
    if (error) {
      message.textContent = error.message;
      submit.disabled = false;
      return;
    }
    await sendRequest();
  });
}

signInButton.addEventListener('click', () => {
  message.textContent = 'Waiting for Google sign-in…';
  message.className = 'auth-message';
  signInButton.disabled = true;
  window.lvfrStartGoogleSignIn(async error => {
    if (error) {
      message.textContent = error.message;
      signInButton.disabled = false;
      return;
    }
    try {
      await checkGoogleAccount();
    } catch (failure) {
      message.textContent = failure.message;
      signInButton.disabled = false;
    }
  });
});
signupForm.addEventListener('submit', event => {
  event.preventDefault();
  requestAccount();
});

if (window.lvfrGoogleToken()) {
  checkGoogleAccount().catch(() => {});
}
