(() => {
  const openButton = document.querySelector('#manageAccountButton');
  if (!openButton) return;

  const dialog = document.createElement('div');
  dialog.id = 'accountSettingsDialog';
  dialog.className = 'modal hidden';
  dialog.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="accountSettingsTitle">
      <button type="button" class="close" id="closeAccountSettings" aria-label="Close">×</button>
      <h2 id="accountSettingsTitle">Account settings</h2>
      <p id="accountSettingsName">Loading account…</p>
      <p id="accountSettingsEmail" class="small-muted"></p>
      <p>Sign-in and account security are managed by Google.</p>
      <a href="https://myaccount.google.com/security" target="_blank" rel="noopener">Google account security</a>
    </div>`;
  document.body.append(dialog);

  openButton.addEventListener('click', async () => {
    dialog.classList.remove('hidden');
    try {
      const response = await fetch('/auth/me');
      const user = await response.json();
      if (!response.ok) throw new Error(user.detail || 'Could not load account details.');
      dialog.querySelector('#accountSettingsName').textContent = user.name || '';
      dialog.querySelector('#accountSettingsEmail').textContent = user.email || '';
    } catch (error) {
      dialog.querySelector('#accountSettingsName').textContent = error.message;
    }
  });
  dialog.querySelector('#closeAccountSettings').addEventListener('click', () => dialog.classList.add('hidden'));
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.classList.add('hidden'); });
})();
