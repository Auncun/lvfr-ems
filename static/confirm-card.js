// One confirmation style for the whole app: a card that shows what will change and who made the change, then asks to confirm.
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  window.lvfrConfirm = ({ title = 'Confirmation', subject = '', rows = [], message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) => new Promise(resolve => {
    const user = window.lvfrCachedUser?.() || {};
    const doneBy = user.name || user.display_name || user.callsign || '';
    const shownRows = [...rows];
    if (doneBy) shownRows.push(['Done by', doneBy]);

    const overlay = document.createElement('div');
    overlay.className = 'promotion-overlay confirm-overlay';
    overlay.innerHTML = `<div class="promotion-box" role="dialog" aria-modal="true" aria-labelledby="confirmCardTitle">
      <div class="promotion-head">
        <h2 id="confirmCardTitle">${esc(title)}</h2>
        <button type="button" class="promotion-close" data-confirm-cancel aria-label="Close">×</button>
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

    const onKey = event => { if (event.key === 'Escape') finish(false); };
    const finish = answer => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(answer);
    };
    overlay.addEventListener('click', event => {
      if (event.target.closest('[data-confirm-ok]')) finish(true);
      else if (event.target === overlay || event.target.closest('[data-confirm-cancel]')) finish(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    overlay.querySelector('[data-confirm-ok]')?.focus();
  });
})();