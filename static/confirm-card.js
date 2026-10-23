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
})();