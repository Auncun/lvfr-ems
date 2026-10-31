(() => {
  const $ = selector => document.querySelector(selector);
  const message = $('#academyMessage'), rows = $('#academyRows'), graduates = $('#academyGraduates');
  const recruitSection = $('#academyRecruitSection'), recruitForm = $('#academyRecruitForm');
  const passDialog = $('#academyPassDialog'), passStatus = $('#academyPassStatus');
  const TRAININGS = [['BM', 'Basic Medical'], ['EC', 'Basic Communication'], ['BV', 'Basic Vehicle']];
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
    if (!recruits.length) { rows.innerHTML = '<tr><td colspan="6">No recruits are in the academy.</td></tr>'; return; }
    rows.innerHTML = recruits.map(r => {
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
        <td><strong>${esc(r.name)}</strong><span class="acad-sub">${esc(r.callsign)} · ${esc(r.recruit_type)} · since ${esc(dateText(r.recruited_at))}</span>${discord}</td>
        <td><div class="acad-chips">${chips}</div></td>
        <td>${r.tig_days} / 5 days${r.tig_ok ? ' ✓' : ''}</td>
        <td>${patrol}</td>
        <td>${status}</td>
        <td>${exam}</td></tr>`;
    }).join('');
  }

  function renderGraduates(list) {
    graduates.innerHTML = list.length ? list.map(g => `<tr><td>${esc(g.name)}</td><td>${esc(g.callsign)} · ${esc(g.recruit_type)}</td><td>${esc(g.graduated_callsign)} · ${esc(g.graduated_to)}</td><td>${esc(dateText(g.graduated_at))}</td><td>${esc(g.graduated_by)}</td></tr>`).join('') : '<tr><td colspan="5">No graduates yet.</td></tr>';
  }

  async function load() {
    try {
      const data = await api('/api/academy');
      canManage = data.can_manage === true;
      recruits = data.recruits || [];
      recruitSection.hidden = !canManage;
      renderRecruits();
      renderGraduates(data.graduates || []);
    } catch (error) { rows.innerHTML = `<tr><td colspan="6">${esc(error.message)}</td></tr>`; }
  }

  async function run(action, success) {
    if (busy) return;
    busy = true; say('Working…');
    try { const result = await action(); await load(); say(typeof success === 'function' ? success(result) : success, 'success'); }
    catch (error) { say(error.message, 'error'); }
    finally { busy = false; }
  }

  recruitForm.addEventListener('submit', event => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(recruitForm));
    run(() => api('/api/academy/recruit', form), result => {
      recruitForm.reset();
      return `${result.name} was recruited as ${result.callsign}.` + (result.discord?.ok ? ` Discord nickname: ${result.nickname}.` : ` Discord was not updated: ${result.discord?.message || 'unknown error'}. Use Retry Discord below.`);
    });
  });

  rows.addEventListener('click', event => {
    const button = event.target.closest('button[data-act]');
    if (!button || !canManage) return;
    const id = Number(button.dataset.id), act = button.dataset.act;
    if (act === 'training') run(() => api('/api/academy/training', { id, training: button.dataset.training, done: button.dataset.done === 'true' }), 'Saved.');
    else if (act === 'patrol') run(() => api('/api/academy/patrol', { id, done: button.dataset.done === 'true' }), 'Saved.');
    else if (act === 'discord') run(() => api('/api/academy/discord-retry', { id }), result => result.discord?.ok ? 'Discord updated.' : `Discord still failed: ${result.discord?.message}`);
    else if (act === 'failed') { if (confirm(`Record the Exit Exam of ${button.dataset.name} as failed?`)) run(() => api('/api/academy/exam', { id, result: 'failed' }), 'Exit Exam recorded as failed.'); }
    else if (act === 'passed') {
      passingId = id; passStatus.textContent = '';
      $('#academyPassText').textContent = `${button.dataset.name} passed the Exit Exam. Choose the rank. The Callsign and rank change in the roster, the Sheet and Discord, and the previous Probationary rank no longer matters.`;
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

  load();
})();
