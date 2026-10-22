// Shared date formatter: shows only the calendar date (YYYY-MM-DD), never the full ISO timestamp.
(() => {
  const pad = n => String(n).padStart(2, '0');
  window.lvfrDateOnly = value => {
    if (value === null || value === undefined || value === '') return '';
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    // SQLite-style "YYYY-MM-DD HH:MM:SS" (no zone) is stored in UTC.
    const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(text)
      ? text.replace(' ', 'T') + 'Z'
      : text;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return text.split('T')[0].split(' ')[0];
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
})();