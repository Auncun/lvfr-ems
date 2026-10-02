const requestId = new URLSearchParams(location.search).get('request_id');
const title = document.querySelector('#pendingTitle');
const message = document.querySelector('#pendingMessage');
if (!requestId) {
  title.textContent = 'Waiting for activation';
  message.textContent = 'Your account request was received. A Commander must approve it before you can sign in.';
} else {
  let checks = 0;
  const poll = async () => {
    checks += 1;
    try {
      const response = await fetch('/auth/signup-status/' + encodeURIComponent(requestId));
      const result = await response.json().catch(() => ({}));
      if (response.status === 404 || response.status === 410) {
        title.textContent = 'Signup status is unavailable';
        message.textContent = 'The server restarted or this request expired. Check whether the account was created, then sign in or submit the signup form again.';
        return;
      }
      if (!response.ok) throw new Error(result.detail || `Server returned ${response.status}.`);
      if (result.status === 'saved') {
        title.textContent = 'Account request received';
        message.textContent = 'Your signup was saved. A Commander must approve it before you can sign in.';
        return;
      }
      if (result.status === 'approved') {
        title.textContent = 'Account approved';
        message.textContent = 'A Commander approved your account. Return to sign in to continue.';
        return;
      }
      if (result.status === 'failed') {
        title.textContent = 'Signup could not be saved';
        message.textContent = result.error || 'Please return to sign up and try again.';
        return;
      }
    } catch (error) {
      if (checks >= 3) {
        title.textContent = 'Unable to check signup status';
        message.textContent = `${error.message} You can return to sign in and check whether your request was saved.`;
        return;
      }
    }
    if (checks < 60) setTimeout(poll, 1000);
    else {
      title.textContent = 'Signup status is taking longer than expected';
      message.textContent = 'Check whether your account was created, then sign in or return to sign up.';
    }
  };
  poll();
}
