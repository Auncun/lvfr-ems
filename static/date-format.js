// Shared date formatter. Every date shown in the app uses one format: dd/mm/yyyy (time is not shown).
(() => {
  const pad = n => String(n).padStart(2, '0');
  const fromParts = (y, m, d) => `${pad(d)}/${pad(m)}/${y}`;
  window.lvfrDateOnly = value => {
    if (value === null || value === undefined) return '';
    const text = String(value).trim();
    if (!text) return '';
    // YYYY-MM-DD, optionally followed by a time.
    let m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?!\d)/);
    if (m && !/[T ]\d{2}:\d{2}/.test(text)) return fromParts(+m[1], +m[2], +m[3]);
    // MM/DD/YYYY as stored by the roster and training records (US order).
    m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return fromParts(+m[3], +m[1], +m[2]);
    // ISO timestamp or SQLite "YYYY-MM-DD HH:MM:SS" (stored in UTC when no zone is given).
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text)) {
      const normalized = /(Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : text.replace(' ', 'T') + 'Z';
      const date = new Date(normalized);
      if (!Number.isNaN(date.getTime())) return fromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
      const [y, mo, d] = text.slice(0, 10).split('-');
      return fromParts(y, mo, d);
    }
    return text;
  };
})();