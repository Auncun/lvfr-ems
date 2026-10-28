// One confirmation style for the whole app: a card that shows what will change and who made the change, then asks to confirm.
// It opens as a modal <dialog>, so it always sits above the page and other open dialogs.
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  window.lvfrConfirm = ({ title = 'Confirmation', subject = '', rows = [], message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) => new Promise(resolve => {
    const shownRows = [...rows];

    const dialog = document.createElement('dialog');
    dialog.className = 'confirm-dialog';
    dialog.innerHTML = `<div class="promotion-box" role="document">
      <div class="promotion-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="promotion-close" data-confirm-cancel aria-label="Close">&times;</button>
      </div>
      <div class="promotion-body">
        <section class="promotion-item">
          ${subject ? `<h3>${esc(subject)}</h3>` : ''}
          ${shownRows.length ? `<table class="promotion-table">${shownRows.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join('')}</table>` : ''}
          ${message ? `<p class="promotion-note">${esc(message)}</p>` : ''}
          <div class="confirm-actions">
            <button type="button" data-confirm-cancel>${esc(cancelText)}</button>
            <button type="button" class="${danger ? 'danger' : 'promotion-save'}" data-confirm-ok>${esc(confirmText)}</button>
          </div>
        </section>
      </div>
    </div>`;

    let answered = false;
    const finish = answer => {
      if (answered) return;
      answered = true;
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-confirm-ok]')) finish(true);
      else if (event.target === dialog || event.target.closest('[data-confirm-cancel]')) finish(false);
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('[data-confirm-ok]')?.focus();
  });

  // Shared card shell and close handling for the helpers below. Resolves once with the value; closing returns cancelValue.
  const makeCard = (title, body) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'confirm-dialog';
    dialog.innerHTML = `<div class="promotion-box" role="document">
      <div class="promotion-head"><h2>${esc(title)}</h2><button type="button" class="promotion-close" data-confirm-cancel aria-label="Close">&times;</button></div>
      <div class="promotion-body"><section class="promotion-item">${body}</section></div>
    </div>`;
    return dialog;
  };
  const mountCard = (dialog, resolve, cancelValue) => {
    let answered = false;
    const finish = value => { if (answered) return; answered = true; dialog.close(); dialog.remove(); resolve(value); };
    dialog.addEventListener('click', event => { if (event.target === dialog || event.target.closest('[data-confirm-cancel]')) finish(cancelValue); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(cancelValue); });
    document.body.append(dialog);
    dialog.showModal();
    return finish;
  };
  const subjectHtml = (subject, message) => `${subject ? `<h3>${esc(subject)}</h3>` : ''}${message ? `<p class="promotion-note" style="white-space:pre-line">${esc(message)}</p>` : ''}`;

  // Several choices plus Cancel. Resolves the chosen value, or null.
  window.lvfrChoose = ({ title = 'Confirmation', subject = '', message = '', choices = [], cancelText = 'Cancel' } = {}) => new Promise(resolve => {
    const dialog = makeCard(title, `${subjectHtml(subject, message)}
      <div class="lvfr-choice-list">${choices.map(choice => `<button type="button" class="${choice.danger ? 'danger' : ''}" data-choice="${esc(choice.value)}">${esc(choice.label)}</button>`).join('')}</div>
      <div class="confirm-actions"><button type="button" data-confirm-cancel>${esc(cancelText)}</button></div>`);
    const finish = mountCard(dialog, resolve, null);
    dialog.addEventListener('click', event => { const choice = event.target.closest('[data-choice]'); if (choice) finish(choice.dataset.choice); });
  });

  // One text field with OK and Cancel. Resolves the typed text, or null.
  window.lvfrText = ({ title = 'Confirmation', subject = '', message = '', label = '', initial = '', confirmText = 'OK', cancelText = 'Cancel' } = {}) => new Promise(resolve => {
    const dialog = makeCard(title, `${subjectHtml(subject, message)}
      <form method="dialog" class="lvfr-form">
        <label class="lvfr-form-field"><span>${esc(label)}</span><input type="text" autocomplete="off" value="${esc(initial)}"></label>
        <div class="confirm-actions"><button type="button" data-confirm-cancel>${esc(cancelText)}</button><button type="submit" class="promotion-save">${esc(confirmText)}</button></div>
      </form>`);
    const input = dialog.querySelector('input');
    const finish = mountCard(dialog, resolve, null);
    dialog.querySelector('form').addEventListener('submit', event => { event.preventDefault(); finish(input.value); });
    input.focus();
  });

  // Edit a Discord link: choose the Discord User ID or the nickname; the current value is filled in.
  // Resolves { what: 'id' | 'nickname', value } or null.
  window.lvfrEditLink = ({ callsign = '', discordId = '', nickname = '' } = {}) => new Promise(resolve => {
    const current = { id: discordId, nickname };
    const details = {
      id: { label: 'Discord User ID', hint: '17 to 20 digits.' },
      nickname: { label: 'Nickname', hint: `Must start with [${callsign}].` },
    };
    const dialog = makeCard(`Edit ${callsign}`, `
      <form method="dialog" class="lvfr-form">
        <label class="lvfr-form-field"><span>What to change</span>
          <select data-edit-what><option value="id">Discord User ID</option><option value="nickname">Nickname</option></select></label>
        <label class="lvfr-form-field"><span data-edit-label></span><input type="text" autocomplete="off" data-edit-value><small class="muted" data-edit-hint></small></label>
        <div class="confirm-actions"><button type="button" data-confirm-cancel>Cancel</button><button type="submit" class="promotion-save">Save</button></div>
      </form>`);
    const select = dialog.querySelector('[data-edit-what]');
    const input = dialog.querySelector('[data-edit-value]');
    const show = () => {
      const what = select.value;
      dialog.querySelector('[data-edit-label]').textContent = details[what].label;
      dialog.querySelector('[data-edit-hint]').textContent = details[what].hint;
      input.value = current[what] || '';
      input.placeholder = details[what].label;
    };
    select.addEventListener('change', show);
    show();
    const finish = mountCard(dialog, resolve, null);
    dialog.querySelector('form').addEventListener('submit', event => { event.preventDefault(); finish({ what: select.value, value: input.value.trim() }); });
    input.focus();
    input.select();
  });
})();
