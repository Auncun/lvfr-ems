(() => {
  const profileMenuItem = document.querySelector('#manageAccountButton');
  if (!profileMenuItem) return;

  const dialog = document.createElement('div');
  dialog.id = 'accountSettingsDialog';
  dialog.className = 'modal hidden';
  dialog.innerHTML = `
    <div class="modal-box acct-box" role="dialog" aria-modal="true" aria-labelledby="accountSettingsTitle">
      <div class="acct-head">
        <span class="acct-avatar" id="accountSettingsAvatar" aria-hidden="true">?</span>
        <div class="acct-head-text">
          <h2 id="accountSettingsTitle">My account</h2>
          <p class="muted" id="accountSettingsSubtitle"></p>
        </div>
        <button type="button" class="close" id="closeAccountSettings" aria-label="Close">&times;</button>
      </div>

      <section class="acct-card" id="accountProfileSection" aria-labelledby="accountProfileTitle">
        <h3 id="accountProfileTitle">Account</h3>
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
      </section>

      <section class="acct-card" id="accountNotificationsSection" aria-labelledby="accountNotificationsTitle">
        <h3 id="accountNotificationsTitle">Notification Settings</h3>
        <p class="muted">Choose the notifications you want to receive. You only see the types your role allows.</p>
        <div id="accountNotificationOptions" class="account-notification-options"><p class="muted">Loading…</p></div>
        <div class="acct-actions"><button type="button" class="primary" id="accountSaveNotifications">Save notification settings</button></div>
        <p id="accountNotificationMessage" class="acct-message" role="status" aria-live="polite"></p>
      </section>

      <section class="acct-card" id="accountPasswordSection" aria-labelledby="accountPasswordTitle">
        <h3 id="accountPasswordTitle">Account Settings</h3>
        <p class="muted">Change the password you use to sign in.</p>
        <form id="accountSettingsPassword" class="acct-form">
          <label>Current password<input name="current_password" type="password" autocomplete="current-password" required></label>
          <label>New password<input name="new_password" type="password" minlength="4" maxlength="20" pattern="[A-Za-z0-9]{4,20}" autocomplete="new-password" required></label>
          <label class="show-password"><input type="checkbox" id="accountShowPassword"> Show password</label>
          <div class="acct-actions"><button type="submit" class="primary">Save new password</button></div>
          <p id="accountSettingsMessage" class="acct-message" role="status" aria-live="polite"></p>
        </form>
      </section>
    </div>`;
  document.body.append(dialog);

  const field = id => dialog.querySelector(`#${id}`);
  // Explanation shown when the mouse rests on a notification name.
  const NOTIFICATION_HINTS = {
    termination: 'Members who were terminated (removed from the roster).',
    inactive: 'Due to Activity: members whose activity is Can Be Terminated.',
    overdue: 'Training Overdue: EMT members with 21+ days in rank who are missing Basic FORT or Advanced FORT.',
    promotion: 'Members who were promoted or had their rank changed.',
    eligible: 'Members who became eligible for promotion.',
    callsign: 'Callsign changes.',
    training: 'HERT and FORT training changes.',
    training_time: 'Training Hours changes.',
    loi: 'LOI (letter of intent) changes.',
    exam: 'Supervisor exam changes.',
    note: 'Member note changes.',
    activity: 'Activity status changes.',
    instructor: 'HERT and FORT instructor changes.',
    do_not_promote: 'Do Not Promote list changes.',
    request: 'New account requests waiting for approval.'
  };
  const sectionIds = { profile: 'accountProfileSection', notifications: 'accountNotificationsSection', password: 'accountPasswordSection' };
  let accountProfile = null;
  const profileCacheKey = accountId => `lvfr.account.profile.v1:${accountId || ''}`;
  const readRosterSnapshot = callsign => {
    try {
      const members = JSON.parse(sessionStorage.getItem('lvfr.roster.snapshot.v1') || '[]');
      return members.find(member => String(member.callsign || '').trim().toUpperCase() === String(callsign || '').trim().toUpperCase()) || null;
    } catch { return null; }
  };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  // Same colours as the roster: green/yellow/orange/red for activity, green when a qualification is held, red when missing.
  const activityBadge = value => {
    if (!value) return '<span class="muted">Not loaded</span>';
    const cls = value === 'Can Be Terminated' ? 'terminate-status' : value === 'Semi Active' ? 'semi-status' : value === 'Inactive' ? 'inactive-status' : 'active-status';
    return `<span class="badge ${cls}">${escapeHtml(value)}</span>`;
  };
  const flagBadge = (ok, yesText, noText) => `<span class="badge ${ok ? 'active-status' : 'terminate-status'}">${escapeHtml(ok ? yesText : noText)}</span>`;
  const initials = name => String(name || '').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || '?';
  const renderProfile = (user, member) => {
    field('accountSettingsAvatar').textContent = initials(user?.name || member?.name);
    field('accountSettingsSubtitle').textContent = [user?.callsign || member?.callsign, member?.rank].filter(Boolean).join(' · ');
    field('accountSettingsName').textContent = user?.name || '';
    field('accountSettingsCallsign').textContent = user?.callsign || member?.callsign || '';
    const badge = typeof rankBadgeHtml === 'function' ? rankBadgeHtml(member?.rank, user?.callsign || member?.callsign) : '';
    field('accountSettingsRank').innerHTML = `${badge}${escapeHtml(member?.rank || '')}`;
    field('accountSettingsDate').textContent = member?.rank_assigned_date || member?.date || '';
    field('accountSettingsActivity').innerHTML = activityBadge(member?.activity || '');
    const instructor = member?.instructor_type || user?.instructor_type || '';
    field('accountSettingsInstructor').innerHTML = instructor ? `<span class="badge active-status">${escapeHtml(instructor)}</span>` : flagBadge(false, '', 'Not an Instructor');
    const trainings = [member?.has_basic_firefighting && 'Basic Firefighting', member?.has_advanced_firefighting && 'Advanced Firefighting', member?.has_hert && 'HERT'].filter(Boolean);
    field('accountSettingsTraining').innerHTML = trainings.length
      ? trainings.map(name => `<span class="badge active-status">${escapeHtml(name)}</span>`).join(' ')
      : flagBadge(false, '', 'None');
    field('accountSettingsExam').innerHTML = flagBadge(!!member?.has_supervisor_exam, 'Passed', 'Not completed');
  };

  async function loadProfile() {
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
  }

  async function loadNotificationOptions() {
    const list = field('accountNotificationOptions');
    field('accountNotificationMessage').textContent = '';
    try {
      const response = await fetch('/api/account/notification-preferences');
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || result.error || 'Could not load notification settings.');
      const allowed = result.options.filter(option => option.allowed);
      list.innerHTML = allowed.length
        ? allowed.map(option => `<label class="account-notification-option" title="${escapeHtml(NOTIFICATION_HINTS[option.kind] || option.label)}"><input type="checkbox" data-notification-kind="${option.kind}" ${option.enabled ? 'checked' : ''}><span>${escapeHtml(option.label)}</span></label>`).join('')
        : '<p class="muted">Your role has no notification types to choose from.</p>';
      field('accountSaveNotifications').hidden = !allowed.length;
    } catch (error) {
      list.innerHTML = `<p class="muted">${error.message}</p>`;
    }
  }

  const closeMenu = () => {
    const menu = document.querySelector('#accountMenu');
    if (menu) menu.hidden = true;
    document.querySelector('#accountMenuButton')?.setAttribute('aria-expanded', 'false');
  };
  const close = () => dialog.classList.add('hidden');

  // Shows only the account window: closes the notification and online panels, other dialogs and the side menu.
  const hideOtherWindows = () => {
    document.querySelector('#notificationPanel')?.setAttribute('hidden', '');
    document.querySelector('#notificationButton')?.setAttribute('aria-expanded', 'false');
    document.querySelector('#onlineUsersPanel')?.setAttribute('hidden', '');
    document.querySelector('#topOnlineCount')?.setAttribute('aria-expanded', 'false');
    document.querySelectorAll('.modal:not(#accountSettingsDialog):not(.hidden)').forEach(modal => {
      if (modal.id === 'modal' && typeof window.closeModal === 'function') window.closeModal();
      else modal.classList.add('hidden');
    });
    document.querySelectorAll('dialog[open]').forEach(item => item.close?.());
    if (document.querySelector('#appSidebar')?.classList.contains('is-open')) document.querySelector('.sidebar-close')?.click();
  };

  // Opens the account window at the requested section (profile, notifications or password).
  function openSection(section) {
    closeMenu();
    hideOtherWindows();
    dialog.classList.remove('hidden');
    void loadProfile();
    void loadNotificationOptions();
    const target = document.getElementById(sectionIds[section] || sectionIds.profile);
    requestAnimationFrame(() => target?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    if (section === 'password') field('accountSettingsPassword').querySelector('input[name="current_password"]')?.focus();
  }

  document.querySelector('#manageAccountButton')?.addEventListener('click', () => openSection('profile'));
  document.querySelector('#accountNotificationsButton')?.addEventListener('click', () => openSection('notifications'));
  document.querySelector('#accountSettingsButton')?.addEventListener('click', () => openSection('password'));

  field('accountSaveNotifications').addEventListener('click', async () => {
    const button = field('accountSaveNotifications');
    const message = field('accountNotificationMessage');
    const preferences = {};
    dialog.querySelectorAll('[data-notification-kind]').forEach(input => { preferences[input.dataset.notificationKind] = input.checked; });
    button.disabled = true;
    message.textContent = 'Saving…';
    try {
      const response = await fetch('/api/account/notification-preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || result.error || 'Could not save notification settings.');
      message.textContent = 'Notification settings saved.';
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  field('closeAccountSettings').addEventListener('click', close);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !dialog.classList.contains('hidden')) close(); });
  field('accountShowPassword').addEventListener('change', event => {
    const visible = event.target.checked;
    field('accountSettingsPassword').querySelectorAll('input[name="current_password"], input[name="new_password"]').forEach(input => {
      input.type = visible ? 'text' : 'password';
    });
  });
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