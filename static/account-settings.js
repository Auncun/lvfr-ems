(() => {
  const openButton = document.querySelector('#manageAccountButton');
  if (!openButton) return;

  const dialog = document.createElement('div');
  dialog.id = 'accountSettingsDialog';
  dialog.className = 'modal hidden';
  dialog.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="accountSettingsTitle">
      <button type="button" class="close" id="closeAccountSettings" aria-label="Close">&times;</button>
      <h2 id="accountSettingsTitle">Manage account</h2>
      <dl class="account-details">
        <dt>Name</dt><dd id="accountSettingsName">Loading…</dd>
        <dt>Callsign</dt><dd id="accountSettingsCallsign"></dd>
        <dt>Rank</dt><dd id="accountSettingsRank"></dd>
        <dt>Rank assigned</dt><dd id="accountSettingsDate"></dd>
        <dt>Activity</dt><dd id="accountSettingsActivity"></dd>
        <dt>Instructor</dt><dd id="accountSettingsInstructor"></dd>
        <dt>Training</dt><dd id="accountSettingsTraining"></dd>
        <dt>Supervisor exam</dt><dd id="accountSettingsExam"></dd>
      </dl>
      <details class="account-password-section">
        <summary>Change password</summary>
        <form id="accountSettingsPassword" class="form-grid">
          <label>Current password<input name="current_password" type="password" autocomplete="current-password" required></label>
          <label>New password<input name="new_password" type="password" minlength="4" maxlength="20" pattern="[A-Za-z0-9]{4,20}" autocomplete="new-password" required></label>
          <button type="submit" class="primary">Change password</button>
          <p id="accountSettingsMessage" role="status" aria-live="polite"></p>
        </form>
      </details>
    </div>`;
  document.body.append(dialog);

  const field = id => dialog.querySelector(`#${id}`);
  let accountProfile = null;
  const profileCacheKey = accountId => `lvfr.account.profile.v1:${accountId || ''}`;
  const readRosterSnapshot = callsign => {
    try {
      const members = JSON.parse(sessionStorage.getItem('lvfr.roster.snapshot.v1') || '[]');
      return members.find(member => String(member.callsign || '').trim().toUpperCase() === String(callsign || '').trim().toUpperCase()) || null;
    } catch { return null; }
  };
  const renderProfile = (user, member) => {
    field('accountSettingsName').textContent = user?.name || '';
    field('accountSettingsCallsign').textContent = user?.callsign || member?.callsign || '';
    field('accountSettingsRank').textContent = member?.rank || '';
    field('accountSettingsDate').textContent = member?.rank_assigned_date || member?.date || '';
    field('accountSettingsActivity').textContent = member?.activity || '';
    field('accountSettingsInstructor').textContent = member?.instructor_type || user?.instructor_type || 'Not an Instructor';
    field('accountSettingsTraining').textContent = [member?.has_basic_firefighting && 'Basic Firefighting', member?.has_advanced_firefighting && 'Advanced Firefighting', member?.has_hert && 'HERT'].filter(Boolean).join(', ') || 'None';
    field('accountSettingsExam').textContent = member?.has_supervisor_exam ? 'Passed' : 'Not completed';
  };
  const close = () => dialog.classList.add('hidden');
  openButton.addEventListener('click', async () => {
    dialog.classList.remove('hidden');
    const user = window.lvfrCachedUser?.();
    const accountId = user?.account_id || user?.id || '';
    if (!accountProfile && accountId) {
      try { accountProfile = JSON.parse(sessionStorage.getItem(profileCacheKey(accountId)) || 'null'); } catch {}
    }
    const cachedMember = readRosterSnapshot(user?.callsign) || accountProfile;
    if (cachedMember) {
      accountProfile = cachedMember;
      renderProfile(user, cachedMember);
    }
    if (!user?.callsign) {
      if (!cachedMember) renderProfile(user, null);
      return;
    }
    if (!cachedMember) {
      field('accountSettingsName').textContent = user?.name || 'Loading…';
      field('accountSettingsCallsign').textContent = user?.callsign || '';
    }
    try {
      const headers = {};
      const token = window.lvfrSessionToken?.();
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch('/api/account/profile', { headers });
      const member = await response.json();
      if (!response.ok) throw new Error(member.detail || member.error || 'Could not load account.');
      accountProfile = member;
      if (accountId) try { sessionStorage.setItem(profileCacheKey(accountId), JSON.stringify(member)); } catch {}
      renderProfile(user, member);
    } catch (error) {
      if (!cachedMember) field('accountSettingsName').textContent = error.message;
    }
  });
  field('closeAccountSettings').addEventListener('click', close);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  field('accountSettingsPassword').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = field('accountSettingsMessage');
    message.textContent = 'Changing password…';
    try {
      const response = await fetch('/api/account/password', {
        method: 'POST', headers: {
          'Content-Type': 'application/json',
          ...(window.lvfrSessionToken?.() ? { Authorization: `Bearer ${window.lvfrSessionToken()}` } : {})
        },
        body: JSON.stringify(Object.fromEntries(new FormData(form)))
      });
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.detail || result.error || 'Password change failed.');
      form.reset();
      message.textContent = 'Password changed successfully.';
    } catch (error) {
      message.textContent = error.message;
    }
  });
})();
