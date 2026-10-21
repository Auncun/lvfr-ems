// Shared rank badge helper. Loaded on every page before account-settings.js and app.js.
// Rank badges. Each rank's image is a file in static/badges. Only ranks with a file are shown.
const RANK_BADGE_RULES = [
    { match: /^commissioners?$/i, file: '01-commissioner.png' },
    { match: /^chief$/i, file: '02-chief.png' },
    { match: /^assistant\s+deputy\s+chief$/i, file: '03-assistant-deputy-chief.png' },
    { match: /^(chief-?02\s+)?deputy\s+chief$/i, file: '04-deputy-chief.png' },
    { match: /^division\s+commander$/i, file: '05-division-commander.png' },
    { match: /^captain$|^captin$/i, file: '06-captain.png' },
    { match: /^lieutenant$/i, file: '07-lieutenant.png' },
    { match: /^lead\s+paramedic$/i, file: '08-lead-paramedic.png' },
    { match: /^paramedic$/i, file: '09-paramedic.png' },
    { match: /^aemt$/i, file: '10-aemt.png' },
    { match: /^emt$/i, file: '11-emt.png' },
    { match: /^senior\s+volunteer$/i, file: '12-senior-volunteer.png' },
    { match: /^volunteer$/i, file: '13-volunteer.png' },
    { match: /^probationary/i, file: '14-probationary.png' },
];
// Callsign first: CHIEF-02 is Deputy Chief, B-03 is Assistant Deputy Chief, DIV-X is Division Commander, C-X is Captain.
const CALLSIGN_BADGE_RULES = [
    { match: /^CHIEF-02$/i, file: '04-deputy-chief.png' },
    { match: /^CHIEF-/i, file: '02-chief.png' },
    { match: /^B-03$/i, file: '03-assistant-deputy-chief.png' },
    { match: /^DIV-/i, file: '05-division-commander.png' },
    { match: /^C-/i, file: '06-captain.png' },
    { match: /^COM-/i, file: '01-commissioner.png' },
];
function rankBadgeHtml(rank, callsign) {
    const byCallsign = CALLSIGN_BADGE_RULES.find(item => item.match.test(String(callsign || '').trim()));
    const byRank = RANK_BADGE_RULES.find(item => item.match.test(String(rank || '').trim()));
    const rule = byCallsign || byRank;
    return rule ? `<img class="rank-badge" src="/static/badges/${rule.file}" alt="" width="28" height="28"> ` : '';
}