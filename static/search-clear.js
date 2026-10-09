// Adds a Clear button to the right of the search bars in Training and Recent account activity.
// Clicking it empties the input and fires the same "input" event as typing, so search filters update.
(() => {
  const selector = '#trainingDirectory input[type="text"], #auditSearch';
  const enhance = input => {
    if (input.closest('.search-field')) return;
    const wrap = document.createElement('span');
    wrap.className = 'search-field';
    input.parentNode.insertBefore(wrap, input);
    wrap.append(input);
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'search-clear';
    clear.setAttribute('aria-label', 'Clear search');
    clear.title = 'Clear';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    });
    wrap.append(clear);
  };
  const run = () => document.querySelectorAll(selector).forEach(enhance);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
