(() => {
  const profileMenuItem = document.querySelector('#manageAccountButton');
  if (!profileMenuItem) return;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const $ = id => document.getElementById(id);

  // Each account window is its own dialog: Account, Notification Settings and Account Settings.
  const makeDialog = (id, title, subtitleId, body) => {
    const dialog = document.createElement('div');
    dialog.id = id;
    dialog.className = 'modal hidden account-window';
    dialog.innerHTML = `
      <div class="modal-box acct-box" role="dialog" aria-modal="true" aria-labelledby="${id}Title">
        <div class="acct-head">
          ${id === 'accountProfileDialog' ? '<span class="acct-avatar" id="accountSettingsAvatar" aria-hidden="true">?</span>' : ''}
          <div class="acct-head-text">
            <h2 id="${id}Title">${title}</h2>
            ${subtitleId ? `<p class="muted" id="${subtitleId}"></p>` : ''}
          </div>
          <button type="button" class="close" data-close-account-window aria-label="Close">&times;</button>
        </div>
        ${body}
      </div>`;
    document.body.append(dialog);
    return dialog;
  };

  const profileDialog = makeDialog('accountProfileDialog', 'My account', 'accountSettingsSubtitle', `
      <section class="acct-card">
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
      </section>`);

  const notificationsDialog = makeDialog('accountNotificationsDialog', 'Notification Settings', null, `
      <section class="acct-card">
        <p class="muted">Choose the notifications you want to receive. You only see the types your role allows. Hover over a name to see what it means.</p>
        <div id="accountNotificationOptions" class="account-notification-options"><p class="muted">Loading…</p></div>
        <p id="accountNotificationMessage" class="acct-message" role="status" aria-live="polite"></p>
      </section>`);

  const passwordDialog = makeDialog('accountSettingsDialog', 'Account Settings', null, `
      <section class="acct-card">
        <h3 class="acct-card-title">Change password</h3>
        <form id="accountSettingsPassword" class="acct-form">
          <label>Current password<input name="current_password" type="password" autocomplete="current-password" required></label>
          <label>New password<input name="new_password" type="password" minlength="4" maxlength="20" pattern="[A-Za-z0-9]{4,20}" autocomplete="new-password" required></label>
          <label class="show-password"><input type="checkbox" id="accountShowPassword"> Show password</label>
          <div class="acct-actions"><button type="submit" class="primary">Save new password</button></div>
          <p id="accountSettingsMessage" class="acct-message" role="status" aria-live="polite"></p>
        </form>
      </section>`);

  const windows = [profileDialog, notificationsDialog, passwordDialog];

  // Same colours as the roster: activity uses the roster colours; qualifications are green when held, red when missing.
  const activityBadge = value => {
    if (!value) return '<span class="muted">Not loaded</span>';
    const cls = value === 'Can Be Terminated' ? 'terminate-status' : value === 'Semi Active' ? 'semi-status' : value === 'Inactive' ? 'inactive-status' : 'active-status';
    return `<span class="badge ${cls}">${escapeHtml(value)}</span>`;
  };
  const flagBadge = (ok, yesText, noText) => `<span class="badge ${ok ? 'active-status' : 'terminate-status'}">${escapeHtml(ok ? yesText : noText)}</span>`;
  const initials = name => String(name || '').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || '?';
  const readRosterSnapshot = callsign => {
    try {
      const members = JSON.parse(sessionStorage.getItem('lvfr.roster.snapshot.v1') || '[]');
      return members.find(member => String(member.callsign || '').trim().toUpperCase() === String(callsign || '').trim().toUpperCase()) || null;
    } catch { return null; }
  };
  let accountProfile = null;
  const profileCacheKey = accountId => `lvfr.account.profile.v1:${accountId || ''}`;

  const renderProfile = (user, member) => {
    $('accountSettingsAvatar').textContent = initials(user?.name || member?.name);
    $('accountSettingsSubtitle').textContent = [user?.callsign || member?.callsign, member?.rank].filter(Boolean).join(' · ');
    $('accountSettingsName').textContent = user?.name || '';
    $('accountSettingsCallsign').textContent = user?.callsign || member?.callsign || '';
    const badge = typeof rankBadgeHtml === 'function' ? rankBadgeHtml(member?.rank, user?.callsign || member?.callsign) : '';
    $('accountSettingsRank').innerHTML = `${badge}${escapeHtml(member?.rank || '')}`;
    $('accountSettingsDate').textContent = member?.rank_assigned_date || member?.date || '';
    $('accountSettingsActivity').innerHTML = activityBadge(member?.activity || '');
    const instructor = member?.instructor_type || user?.instructor_type || '';
    $('accountSettingsInstructor').innerHTML = instructor ? `<span class="badge active-status">${escapeHtml(instructor)}</span>` : flagBadge(false, '', 'Not an Instructor');
    const trainings = [member?.has_basic_firefighting && 'Basic Firefighting', member?.has_advanced_firefighting && 'Advanced Firefighting', member?.has_hert && 'HERT'].filter(Boolean);
    $('accountSettingsTraining').innerHTML = trainings.length
      ? trainings.map(name => `<span class="badge active-status">${escapeHtml(name)}</span>`).join(' ')
      : flagBadge(false, '', 'None');
    $('accountSettingsExam').innerHTML = flagBadge(!!member?.has_supervisor_exam, 'Passed', 'Not completed');
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
      $('accountSettingsName').textContent = user?.name || 'Loading…';
      $('accountSettingsCallsign').textContent = user?.callsign || '';
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
      if (!cachedMember) $('accountSettingsName').textContent = error.message;
    }
  }

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

  async function loadNotificationOptions() {
    const list = $('accountNotificationOptions');
    $('accountNotificationMessage').textContent = '';
    try {
      const response = await fetch('/api/account/notification-preferences');
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || result.error || 'Could not load notification settings.');
      const allowed = result.options.filter(option => option.allowed);
      list.innerHTML = allowed.length
        ? allowed.map(option => `<label class="account-notification-option" title="${escapeHtml(NOTIFICATION_HINTS[option.kind] || option.label)}"><input type="checkbox" data-notification-kind="${escapeHtml(option.kind)}" ${option.enabled ? 'checked' : ''}><span>${escapeHtml(option.label)}</span></label>`).join('')
        : '<p class="muted">Your role has no notification types to choose from.</p>';
    } catch (error) {
      list.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  }

  // Only one account window is ever shown; other panels and dialogs close when it opens.
  const hideOtherWindows = () => {
    document.querySelector('#accountMenu')?.setAttribute('hidden', '');
    document.querySelector('#accountMenuButton')?.setAttribute('aria-expanded', 'false');
    document.querySelector('#notificationPanel')?.setAttribute('hidden', '');
    document.querySelector('#notificationButton')?.setAttribute('aria-expanded', 'false');
    document.querySelector('#onlineUsersPanel')?.setAttribute('hidden', '');
    document.querySelector('#topOnlineCount')?.setAttribute('aria-expanded', 'false');
    document.querySelectorAll('.modal:not(.account-window):not(.hidden)').forEach(modal => {
      if (modal.id === 'modal' && typeof window.closeModal === 'function') window.closeModal();
      else modal.classList.add('hidden');
    });
    document.querySelectorAll('dialog[open]').forEach(item => item.close?.());
    if (document.querySelector('#appSidebar')?.classList.contains('is-open')) document.querySelector('.sidebar-close')?.click();
  };

  const closeAccountWindows = () => windows.forEach(dialog => dialog.classList.add('hidden'));

  function openWindow(target) {
    hideOtherWindows();
    closeAccountWindows();
    target.classList.remove('hidden');
    target.querySelector('.modal-box')?.scrollTo?.({ top: 0 });
    if (target === profileDialog) void loadProfile();
    if (target === notificationsDialog) void loadNotificationOptions();
    if (target === passwordDialog) passwordDialog.querySelector('input[name="current_password"]')?.focus();
  }

  document.querySelector('#manageAccountButton')?.addEventListener('click', () => openWindow(profileDialog));
  document.querySelector('#accountNotificationsButton')?.addEventListener('click', () => openWindow(notificationsDialog));
  document.querySelector('#accountSettingsButton')?.addEventListener('click', () => openWindow(passwordDialog));

  windows.forEach(dialog => {
    dialog.querySelector('[data-close-account-window]')?.addEventListener('click', () => dialog.classList.add('hidden'));
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.classList.add('hidden'); });
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeAccountWindows();
  });

  // Each change is saved as soon as it is made. A failed save puts the checkbox back.
  let notificationSaveQueue = Promise.resolve();
  notificationsDialog.addEventListener('change', event => {
    const input = event.target.closest?.('[data-notification-kind]');
    if (!input) return;
    const message = $('accountNotificationMessage');
    const preferences = {};
    notificationsDialog.querySelectorAll('[data-notification-kind]').forEach(item => { preferences[item.dataset.notificationKind] = item.checked; });
    message.textContent = 'Saving…';
    notificationSaveQueue = notificationSaveQueue.then(async () => {
      try {
        const response = await fetch('/api/account/notification-preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.detail || result.error || 'Could not save notification settings.');
        message.textContent = 'Saved.';
      } catch (error) {
        input.checked = !input.checked;
        message.textContent = error.message;
      }
    });
  });

  $('accountShowPassword').addEventListener('change', event => {
    const visible = event.target.checked;
    $('accountSettingsPassword').querySelectorAll('input[name="current_password"], input[name="new_password"]').forEach(input => {
      input.type = visible ? 'text' : 'password';
    });
  });
  $('accountSettingsPassword').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $('accountSettingsMessage');
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