// Roster write planning: compare the incoming Sheet roster with the stored rows and
// return only the rows that must be inserted, updated, or deleted.
// Used by the regular sync. Full Sync still replaces every row (see d1-auth.js).

// Normalised member values in the same order as the members INSERT columns (without synced_at).
// Both the incoming Sheet rows and the stored D1 rows go through this function, so they compare equal
// whenever their content is equal, regardless of how SQLite returned the types.
export function memberColumnValues(member) {
  return [
    String(member.callsign || "").trim().toUpperCase(),
    String(member.name || "").trim(),
    String(member.rank || ""),
    String(member.date || ""),
    String(member.rank_assigned_date || ""),
    Number(member.days_in_rank || 0),
    String(member.discord_id || ""),
    String(member.notes || ""),
    member.has_basic_firefighting ? 1 : 0,
    member.has_advanced_firefighting ? 1 : 0,
    member.has_supervisor_exam ? 1 : 0,
    member.has_hert ? 1 : 0,
    String(member.activity || "Active"),
    String(member.instructor_type || ""),
    member.do_not_promote ? 1 : 0,
    member.do_not_terminate ? 1 : 0,
    Number(member.sheet_row || member.row || 0) || null,
  ];
}

// Returns { inserts, updates, deletes }: inserts and updates are normalised value arrays, deletes are callsigns.
// The stored rows must be compared against the database, not against the previous Sheet snapshot,
// so that any website edit that differs from the Sheet is overwritten exactly as a full replace would do.
export function planMemberWrites(storedRows, incomingMembers) {
  const stored = new Map(storedRows.map(row => {
    const values = memberColumnValues(row);
    return [values[0], JSON.stringify(values)];
  }));
  const incoming = new Map(incomingMembers.map(member => {
    const values = memberColumnValues(member);
    return [values[0], values];
  }));
  const deletes = [...stored.keys()].filter(callsign => !incoming.has(callsign));
  const inserts = [];
  const updates = [];
  for (const [callsign, values] of incoming) {
    if (!stored.has(callsign)) inserts.push(values);
    else if (stored.get(callsign) !== JSON.stringify(values)) updates.push(values);
  }
  return { inserts, updates, deletes };
}

// Callsign slots: the key is (rank, callsign), and only sheet_row can change for an existing key.
export function slotValues(item) {
  return {
    rank: String(item.rank || ""),
    callsign: String(item.callsign || "").toUpperCase(),
    sheet_row: Number(item.row) || null,
  };
}

export function planSlotWrites(storedRows, incomingSlots) {
  const keyOf = slot => `${slot.rank}\u0000${slot.callsign}`;
  const stored = new Map(storedRows.map(row => [keyOf(row), Number(row.sheet_row) || null]));
  const incoming = new Map(incomingSlots.map(slot => [keyOf(slot), slot]));
  const deletes = storedRows.map(row => ({ rank: row.rank, callsign: row.callsign })).filter(row => !incoming.has(keyOf(row)));
  const inserts = [];
  const updates = [];
  for (const [key, slot] of incoming) {
    if (!stored.has(key)) inserts.push(slot);
    else if (stored.get(key) !== slot.sheet_row) updates.push(slot);
  }
  return { inserts, updates, deletes };
}

// A Discord link needs a write only when something it stores is different.
// existing: the stored link row (or undefined); candidate: { userId, nick }; member: { name, rank }.
export function discordLinkUnchanged(existing, candidate, member) {
  return Boolean(existing)
    && existing.status === "linked"
    && String(existing.discord_user_id) === String(candidate.userId)
    && String(existing.member_name ?? "") === String(member.name || "")
    && String(existing.rank ?? "") === String(member.rank || "")
    && String(existing.discord_nickname ?? "") === String(candidate.nick || "");
}
