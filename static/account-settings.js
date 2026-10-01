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
  const close = () => dialog.classList.add('hidden');
  openButton.addEventListener('click', async () => {
    dialog.classList.remove('hidden');
    const user = window.lvfrCachedUser?.();
    field('accountSettingsName').textContent = user?.name || 'Loading…';
    field('accountSettingsCallsign').textContent = user?.callsign || '';
    field('accountSettingsRank').textContent = '';
    field('accountSettingsDate').textContent = '';
    field('accountSettingsActivity').textContent = '';
    field('accountSettingsInstructor').textContent = '';
    field('accountSettingsTraining').textContent = '';
    field('accountSettingsExam').textContent = '';
    try {
      const headers = {};
      const token = window.lvfrSessionToken?.();
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch('/auth/me', { headers });
      const profile = await response.json();
      if (!response.ok) throw new Error(profile.detail || profile.error || 'Could not load account.');
      field('accountSettingsName').textContent = profile.name || user?.name || '';
      field('accountSettingsCallsign').textContent = profile.callsign || user?.callsign || '';
      field('accountSettingsInstructor').textContent = profile.instructor_type || user?.instructor_type || 'Not an Instructor';
      const memberResponse = profile.callsign
        ? await fetch('/api/account/profile', { headers })
        : null;
      const member = memberResponse ? await memberResponse.json() : {};
      if (memberResponse?.ok) {
        field('accountSettingsRank').textContent = member.rank || '';
        field('accountSettingsDate').textContent = member.rank_assigned_date || member.date || '';
        field('accountSettingsActivity').textContent = member.activity || '';
        field('accountSettingsInstructor').textContent = member.instructor_type || profile.instructor_type || user?.instructor_type || 'Not an Instructor';
        field('accountSettingsTraining').textContent = [member.has_basic_firefighting && 'Basic Firefighting', member.has_advanced_firefighting && 'Advanced Firefighting', member.has_hert && 'HERT'].filter(Boolean).join(', ') || 'None';
        field('accountSettingsExam').textContent = member.has_supervisor_exam ? 'Passed' : 'Not completed';
      }
    } catch (error) {
      field('accountSettingsName').textContent = error.message;
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
