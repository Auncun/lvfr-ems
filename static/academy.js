(() => {
  const $ = selector => document.querySelector(selector);
  const message = $('#academyMessage');
  const recruitSection = $('#academyRecruitSection'), recruitForm = $('#academyRecruitForm');
  const passDialog = $('#academyPassDialog'), passStatus = $('#academyPassStatus');
  const rowsFull = $('#academyRowsFull'), rowsVolunteer = $('#academyRowsVolunteer'), logRows = $('#academyLogRows');
  let logEntries = [], logKindSelected = 'recruited', recruitQuery = '', logQuery = '';
  const termDialog = $('#academyTermDialog'), termStatus = $('#academyTermStatus');
  let termingId = 0, termingName = '', termingCallsign = '', termMode = 'terminate', nextCallsigns = {};
  const confirmDialog = $('#academyConfirmDialog');
  const TRAININGS = [['BM', 'Basic Medical'], ['EC', 'Basic Communication'], ['BV', 'Basic Vehicle']];
  let canTerminate = false, canResign = false, canKick = false;
  let canManage = false, recruits = [], passingId = 0, busy = false;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const say = (text, kind = '') => { message.className = 'admin-status' + (kind ? ' ' + kind : ''); message.textContent = text; };
  const dateText = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(); };

  async function api(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = window.lvfrSessionToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(path, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : (result.detail?.message || result.error || 'The request failed.'));
    return result;
  }

  function missing(r) {
    const list = [];
    for (const [key] of TRAININGS) if (!r[key.toLowerCase()]) list.push(key);
    if (!r.tig_ok) list.push(`TIG (${Math.max(0, 5 - r.tig_days)} more days)`);
    if (!r.patrol) list.push('7h patrol');
    return list;
  }

  function renderRecruits() {
    const q = recruitQuery.trim().toLowerCase();
    const hit = r => !q || `${r.callsign} ${r.name}`.toLowerCase().includes(q);
    const byCallsign = (a, b) => String(a.callsign).localeCompare(String(b.callsign), undefined, { numeric: true, sensitivity: 'base' });
    renderGroup(recruits.filter(r => r.recruit_type !== 'Probationary Volunteer' && hit(r)).sort(byCallsign), rowsFull, 'No full-time recruits.');
    renderGroup(recruits.filter(r => r.recruit_type === 'Probationary Volunteer' && hit(r)).sort(byCallsign), rowsVolunteer, 'No volunteer recruits.');
  }

  function renderGroup(list, target, empty) {
    if (!list.length) { target.innerHTML = `<tr><td colspan="7">${empty}</td></tr>`; return; }
    target.innerHTML = list.map(r => {
      const chips = TRAININGS.map(([key, label]) => {
        const done = r[key.toLowerCase()];
        return `<button type="button" class="acad-chip${done ? ' done' : ''}" title="${esc(label)}" data-act="training" data-id="${r.id}" data-training="${key}" data-done="${done ? 'false' : 'true'}"${canManage ? '' : ' disabled'}>${key}${done ? ' ✓' : ''}</button>`;
      }).join('');
      const patrol = `<button type="button" class="acad-chip${r.patrol ? ' done' : ''}" data-act="patrol" data-id="${r.id}" data-done="${r.patrol ? 'false' : 'true'}"${canManage ? '' : ' disabled'}>${r.patrol ? '7h confirmed ✓' : 'Confirm 7h'}</button>`;
      const left = missing(r);
      const status = r.ready ? '<span class="acad-ready">Ready for the Exit Exam</span>' : `<span class="acad-wait">Missing: ${esc(left.join(', '))}</span>`;
      const exam = r.ready && canManage
        ? `<div class="admin-actions"><button type="button" class="primary" data-act="passed" data-id="${r.id}" data-name="${esc(r.name)}">Passed</button><button type="button" class="danger" data-act="failed" data-id="${r.id}" data-name="${esc(r.name)}">Failed</button></div>${r.exam_result === 'failed' ? '<span class="acad-failed">Last result: failed</span>' : ''}`
        : (r.exam_result === 'failed' ? '<span class="acad-failed">Last result: failed</span>' : '<span class="acad-wait">Not available yet</span>');
      const discord = r.discord_status === 'failed' && canManage
        ? `<span class="acad-sub acad-failed" title="${esc(r.discord_error)}">Discord not updated. <button type="button" data-act="discord" data-id="${r.id}">Retry Discord</button></span>` : '';
      return `<tr>
        <td>${esc(r.callsign)}</td><td><strong>${esc(r.name)}</strong><span class="acad-sub">${esc(r.recruit_type)} · since ${esc(dateText(r.recruited_at))}</span>${discord}${canManage ? `<details class="acad-action"><summary class="tab">Action</summary><div class="acad-action-menu"><button type="button" data-act="switch" data-id="${r.id}" data-name="${esc(r.name)}" data-to="${r.recruit_type === 'Probationary' ? 'Probationary Volunteer' : 'Probationary'}">${r.recruit_type === 'Probationary' ? 'Switch to Volunteer' : 'Switch to Full time'}</button><button type="button" class="danger" data-act="remove" data-id="${r.id}" data-name="${esc(r.name)}" ${canResign ? '' : 'disabled'}>Resigned</button>${canResign ? '' : '<small class="acad-note">Needs the Academy: resign permission.</small>'}${r.overdue ? `<button type="button" class="danger" data-act="terminate" data-id="${r.id}" data-name="${esc(r.name)}" ${canTerminate ? '' : 'disabled'}>Terminate</button>${canTerminate ? '' : '<small class="acad-note">Needs the Academy: terminate permission.</small>'}` : ''}</div></details>` : ''}</td>
        <td><div class="acad-chips">${chips}</div></td>
        <td>${r.tig_days} / 5 days${r.tig_ok ? ' ✓' : ''}</td>
        <td>${patrol}</td>
        <td>${status}${r.overdue ? '<br><span class="acad-failed">Exit Exam overdue</span>' : ''}</td>
        <td>${exam}</td></tr>`;
    }).join('');
  }

  async function load() {
    try {
      const data = await api('/api/academy');
      canManage = data.can_manage === true;
      canTerminate = data.can_terminate === true;
      canResign = data.can_resign === true;
      canKick = data.can_kick === true;
      recruits = data.recruits || [];
      recruitSection.hidden = !canManage;
      nextCallsigns = data.next_callsigns || {};
      document.querySelector('[data-tab="academyRecruit"]').hidden = !canManage;
      if (!canManage && document.querySelector('nav.tabs [data-tab="academyRecruit"]').classList.contains('active')) showTab('academyRecruits');
      $('#academyLogClear').hidden = !canManage;
      renderRecruits();
      await loadLog();
    } catch (error) { rowsFull.innerHTML = `<tr><td colspan="7">${esc(error.message)}</td></tr>`; }
  }


  // Every action except training and patrol asks first, in the page's own dialog.
  function askConfirm(text, okLabel = 'Confirm') {
    $('#academyConfirmText').textContent = text;
    $('#academyConfirmOk').textContent = okLabel;
    return new Promise(resolve => {
      $('#academyConfirmOk').addEventListener('click', () => { resolve(true); confirmDialog.close(); }, { once: true });
      $('#academyConfirmNo').addEventListener('click', () => { resolve(false); confirmDialog.close(); }, { once: true });
      confirmDialog.addEventListener('close', () => resolve(false), { once: true });
      confirmDialog.showModal();
    });
  }

  // Log: one request, filtered on the page by the chosen category.
  async function loadLog() {
    try { logEntries = (await api('/api/academy/log')).entries || []; }
    catch (error) { logEntries = []; logRows.innerHTML = `<tr><td colspan="7">${esc(error.message)}</td></tr>`; return; }
    renderLog();
  }

  function renderLog() {
    const q = logQuery.trim().toLowerCase();
    const list = logEntries.filter(e => e.kind === logKindSelected && (!q || `${e.name} ${e.callsign} ${e.action} ${e.actor_name} ${e.detail}`.toLowerCase().includes(q)));
    logRows.innerHTML = list.length ? list.map(e => `<tr><td>${esc(new Date(e.created_at).toLocaleString())}</td><td>${esc(e.name)}</td><td>${esc(e.callsign)}</td><td>${esc(e.action)}</td><td>${esc(e.actor_name)}</td><td>${esc(e.detail)}</td><td></td></tr>`).join('') : '<tr><td colspan="7">No entries.</td></tr>';
    document.querySelectorAll('[data-log]').forEach(b => {
      const on = b.dataset.log === logKindSelected;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  document.querySelectorAll('.academy-recruit-search').forEach(input => input.addEventListener('input', event => {
    recruitQuery = event.target.value;
    document.querySelectorAll('.academy-recruit-search').forEach(other => { if (other !== event.target) other.value = recruitQuery; });
    renderRecruits();
  }));
  $('#academyLogSearch').addEventListener('input', event => { logQuery = event.target.value; renderLog(); });
  $('#academyLogClear').addEventListener('click', async () => {
    if (!(await askConfirm('Delete the WHOLE academy log from D1? Every entry is removed. The Sheet and AOS History are not changed.', 'Delete all'))) return;
    try { await api('/api/academy/log/clear', {}); await loadLog(); say('Academy log deleted from D1.', 'success'); }
    catch (error) { say(error.message, 'error'); }
  });
  document.querySelector('nav[aria-label="Log categories"]')?.addEventListener('click', event => {
    const button = event.target.closest('button[data-log]');
    if (!button) return;
    logKindSelected = button.dataset.log;
    renderLog();
  });

  // Tabs work like the EMS page: one panel is shown, and the sidebar selects a tab by its data-tab.
  function showTab(name) {
    document.querySelectorAll('nav.tabs [data-tab]').forEach(b => {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    document.querySelectorAll('.panel[id]').forEach(panel => panel.classList.toggle('active', panel.id === name));
  }
  document.querySelector('nav.tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-tab]');
    if (!button || button.hidden) return;
    if (button.dataset.tab === 'academyRecruit' && !canManage) return;
    showTab(button.dataset.tab);
  });
  function showSub(name) {
    document.querySelectorAll('nav[aria-label="Recruit lists"] [data-tab]').forEach(b => {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('.subpanel').forEach(panel => panel.classList.toggle('active', panel.id === name));
  }
  document.querySelector('nav[aria-label="Recruit lists"]').addEventListener('click', event => {
    const button = event.target.closest('[data-tab]');
    if (!button) return;
    showTab('academyRecruits');
    showSub(button.dataset.tab);
  });
  showTab('academyRecruit');
  showSub('academyFull');

  async function run(action, success) {
    if (busy) return;
    busy = true; say('Working…');
    try { const result = await action(); await load(); say(typeof success === 'function' ? success(result) : success, 'success'); }
    catch (error) { say(error.message, 'error'); }
    finally { busy = false; }
  }

  recruitForm.addEventListener('submit', async event => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(recruitForm));
    const ok = await askConfirm(`Recruit ${form.name} as ${form.recruit_type}. The callsign will be ${nextCallsigns[form.recruit_type] || '(no empty slot)'}. Discord will be updated.`, 'Recruit');
    if (!ok) return;
    run(() => api('/api/academy/recruit', form), result => {
      recruitForm.reset();
      return `${result.name} was recruited as ${result.callsign}.` + (result.discord?.ok ? ' Discord update started.' : ` Discord was not updated: ${result.discord?.message || 'unknown error'}`);
    });
  });

  $('#academyRows').addEventListener('click', async event => {
    const button = event.target.closest('button[data-act]');
    if (!button || !canManage) return;
    const id = Number(button.dataset.id), act = button.dataset.act, name = button.dataset.name || '';
    if (act === 'training') run(() => api('/api/academy/training', { id, training: button.dataset.training, done: button.dataset.done === 'true' }), 'Saved.');
    else if (act === 'patrol') run(() => api('/api/academy/patrol', { id, done: button.dataset.done === 'true' }), 'Saved.');
    else if (act === 'discord') {
      if (await askConfirm(`Retry the Discord update for ${name}?`, 'Retry')) run(() => api('/api/academy/discord-retry', { id }), result => result.discord?.ok ? 'Discord updated.' : `Discord still failed: ${result.discord?.message}`);
    }
    else if (act === 'switch') {
      if (await askConfirm(`Switch ${name} to ${button.dataset.to}. The callsign will be ${nextCallsigns[button.dataset.to] || '(no empty slot)'}. Discord will be updated.`, 'Switch')) run(() => api('/api/academy/switch', { id, new_rank: button.dataset.to }), 'Recruit switched.');
    }
    else if (act === 'remove') {
      termMode = 'resign'; termingId = id; termingName = name; termingCallsign = recruits.find(r => r.id === id)?.callsign || ''; termStatus.textContent = '';
      $('#academyTermTitle').textContent = 'Resign recruit';
      $('#academyTermText').textContent = `${name} will be removed from the Academy and the roster as resigned.`;
      openTermDialog();
    }
    else if (act === 'terminate') {
      termMode = 'terminate'; termingId = id; termingName = name; termingCallsign = recruits.find(r => r.id === id)?.callsign || ''; termStatus.textContent = '';
      $('#academyTermTitle').textContent = 'Terminate recruit';
      $('#academyTermText').textContent = `${name} has been in probie rank for 21 days without passing the Exit Exam.`;
      openTermDialog();
    }
    else if (act === 'failed') {
      if (await askConfirm(`Record the Exit Exam of ${name} as failed?`, 'Record failed')) run(() => api('/api/academy/exam', { id, result: 'failed' }), 'Exit Exam recorded as failed.');
    }
    else if (act === 'passed') {
      passingId = id; passStatus.textContent = '';
      $('#academyPassText').textContent = `${name} passed the Exit Exam. Choose the rank. The Callsign and rank change in the roster, the Sheet and Discord, and the previous Probationary rank no longer matters.`;
      passDialog.showModal();
    }
  });

  passDialog.addEventListener('click', async event => {
    const choice = event.target.closest('button[data-pass-rank]');
    if (!choice) return;
    const rank = choice.dataset.passRank;
    passDialog.querySelectorAll('button').forEach(b => { b.disabled = true; });
    passStatus.textContent = 'Promoting…';
    try {
      const result = await api('/api/academy/exam', { id: passingId, result: 'passed', new_rank: rank });
      passDialog.close();
      await load();
      say(`Promoted to ${result.new_rank}, Callsign ${result.new_callsign}.` + (result.discord?.ok ? ' Discord updated.' : ` Discord was not updated: ${result.discord?.message || 'unknown error'}.`), result.discord?.ok ? 'success' : 'error');
    } catch (error) { passStatus.textContent = error.message; passStatus.className = 'admin-status error'; }
    finally { passDialog.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
  });
  $('#academyPassCancel').addEventListener('click', () => passDialog.close());
  $('#academyTermCancel').addEventListener('click', () => termDialog.close());
  const termInput = $('#academyTermConfirmInput');
  function syncTermButtons() {
    const typed = termInput.value.trim().toUpperCase();
    const ok = !!termingCallsign && typed === termingCallsign.toUpperCase();
    termDialog.querySelectorAll('button[data-discord-action]').forEach(b => { b.disabled = !ok || (b.dataset.discordAction === 'kick' && !canKick); });
  }
  function openTermDialog() {
    $('#academyTermCallsign').textContent = termingCallsign;
    $('#academyKickNote').hidden = canKick;
    termInput.value = '';
    syncTermButtons();
    termDialog.showModal();
  }
  termInput.addEventListener('input', syncTermButtons);
  termDialog.addEventListener('click', async event => {
    const choice = event.target.closest('button[data-discord-action]');
    if (!choice) return;
    const buttons = termDialog.querySelectorAll('button');
    buttons.forEach(b => { b.disabled = true; });
    termStatus.textContent = termMode === 'resign' ? 'Removing…' : 'Terminating…';
    try {
      const path = termMode === 'resign' ? '/api/academy/remove' : '/api/academy/terminate';
      const result = await api(path, { id: termingId, discord_action: choice.dataset.discordAction });
      termDialog.close();
      await load();
      const label = termMode === 'resign' ? 'removed as resigned' : 'terminated';
      say(`${termingName} was ${label}.` + (result.discord?.ok ? ' Discord updated.' : ` Discord was not updated: ${result.discord?.message || 'unknown error'}.`), result.discord?.ok ? 'success' : 'error');
    } catch (error) { termStatus.textContent = error.message; termStatus.className = 'admin-status error'; }
    finally { buttons.forEach(b => { b.disabled = false; }); syncTermButtons(); }
  });

  load();
})();
