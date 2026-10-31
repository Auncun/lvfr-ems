// LVFR Academy on D1. D1 is the source of truth for recruits. Sheet changes are
// sent through the mirror queue to Apps Script routes with the same names, and
// Apps Script writes the roster rows and the AOS History sheet.

const PROBIE_RANKS = ["Probationary", "Probationary Volunteer"];
const GRADUATE_RANKS = ["EMT", "Volunteer"];
const TIG_DAYS_REQUIRED = 5;
const TRAINING_COLUMNS = { BM: "bm", EC: "ec", BV: "bv" };

const json = (body, status = 200) => Response.json(body, { status });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const nowIso = () => new Date().toISOString();

const isManager = user => ["admin", "commander"].includes(String(user.role || "").toLowerCase()) || user.permissions?.academy_manage === true;
const isViewer = user => isManager(user) || user.permissions?.academy_view === true;
const requireView = user => { if (!isViewer(user)) throw fail("Academy access is required.", 403); };
const requireManage = user => { if (!isManager(user)) throw fail("Academy management access is required.", 403); };

const NEXT_SLOT_SQL = "SELECT rank,callsign,sheet_row FROM callsign_slots WHERE lower(trim(rank))=lower(trim(?)) ORDER BY CASE WHEN sheet_row IS NULL THEN 1 ELSE 0 END, sheet_row, callsign LIMIT 1";
const MEMBER_INSERT_SQL = "INSERT INTO members(callsign,name,rank,date,rank_assigned_date,days_in_rank,discord_id,notes,has_basic_firefighting,has_advanced_firefighting,has_supervisor_exam,has_hert,activity,instructor_type,do_not_promote,do_not_terminate,sheet_row,synced_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";

async function tigDays(db, callsign) {
  const row = await db.prepare("SELECT days_in_rank FROM members WHERE upper(callsign)=upper(?)").bind(callsign).first();
  return Number(row?.days_in_rank) || 0;
}

function recruitView(r, tig) {
  const bm = !!r.bm_at, ec = !!r.ec_at, bv = !!r.bv_at, patrol = !!r.patrol_at;
  const tigOk = tig >= TIG_DAYS_REQUIRED;
  return {
    id: r.id, callsign: r.callsign, name: r.name, recruit_type: r.recruit_type, recruited_at: r.recruited_at,
    bm, ec, bv, tig_days: tig, tig_ok: tigOk, patrol,
    ready: bm && ec && bv && tigOk && patrol,
    exam_result: r.exam_result || "", discord_status: "", discord_error: ""
  };
}

async function loadActive(db, id) {
  const row = await db.prepare("SELECT * FROM academy_recruits WHERE id=? AND status='active'").bind(id).first();
  if (!row) throw fail("Recruit was not found.", 404);
  return row;
}

async function academyLog(db, user, action, callsign, name, detail) {
  await db.prepare("INSERT INTO academy_log(created_at,actor_name,callsign,name,action,detail) VALUES(?,?,?,?,?,?)")
    .bind(nowIso(), String(user.name || ""), callsign || "", name || "", action, detail || "").run();
}

// Probationary members already on the roster (added before the Academy page, or by hand in the Sheet)
// get an Academy row. Their trainings start empty; academy staff confirm them. Idempotent.
async function adoptRosterRecruits(db) {
  await db.prepare(`INSERT INTO academy_recruits(callsign,name,discord_user_id,recruit_type,status,recruited_at,recruited_by)
    SELECT m.callsign, m.name,
      COALESCE((SELECT l.discord_user_id FROM discord_member_links l WHERE upper(l.callsign)=upper(m.callsign)), ''),
      m.rank, 'active', COALESCE(NULLIF(m.date, ''), ''), 'Roster'
    FROM members m
    WHERE m.rank IN ('Probationary', 'Probationary Volunteer')
      AND NOT EXISTS (SELECT 1 FROM academy_recruits a WHERE upper(a.callsign)=upper(m.callsign) AND a.status='active')`).run();
}

async function listAcademy(db, user) {
  await adoptRosterRecruits(db);
  const active = (await db.prepare("SELECT * FROM academy_recruits WHERE status='active' ORDER BY recruited_at, id").all()).results || [];
  const recruits = [];
  for (const r of active) {
    const view = recruitView(r, await tigDays(db, r.callsign));
    const link = await db.prepare("SELECT status,last_error FROM discord_member_links WHERE discord_user_id=?").bind(r.discord_user_id).first();
    if (link?.status === "failed") { view.discord_status = "failed"; view.discord_error = link.last_error || ""; }
    recruits.push(view);
  }
  const done = (await db.prepare("SELECT * FROM academy_recruits WHERE status='graduated' ORDER BY graduated_at DESC, id DESC LIMIT 200").all()).results || [];
  return {
    can_manage: isManager(user),
    recruits,
    graduates: done.map(g => ({
      id: g.id, name: g.name, callsign: g.callsign, recruit_type: g.recruit_type,
      graduated_callsign: g.graduated_callsign, graduated_to: g.graduated_to,
      graduated_at: g.graduated_at, graduated_by: g.graduated_by
    }))
  };
}

async function recruit(db, user, data, mirror, discordRecruit) {
  const name = String(data.name || "").replace(/\s+/g, " ").trim();
  if (name.length < 3) throw fail("Enter the recruit's full name.");
  const rank = String(data.recruit_type || "").trim();
  if (!PROBIE_RANKS.includes(rank)) throw fail("Academy recruits start as Probationary or Probationary Volunteer.");
  const discordId = String(data.discord_user_id || "").trim();
  if (!/^\d{17,20}$/.test(discordId)) throw fail("Enter a valid Discord User ID.");

  const linked = await db.prepare("SELECT callsign FROM discord_member_links WHERE discord_user_id=?").bind(discordId).first();
  if (linked) throw fail(`This Discord account is already linked to callsign ${linked.callsign}.`);

  const slot = await db.prepare(NEXT_SLOT_SQL).bind(rank).first();
  const callsign = String(slot?.callsign || "").trim().toUpperCase();
  if (!callsign) throw fail(`No empty Callsign slot is recorded for ${rank}. Run Sync now first.`);
  if (await db.prepare("SELECT callsign FROM members WHERE upper(callsign)=?").bind(callsign).first()) {
    throw fail("That Callsign is already assigned. Run Sync now and retry.");
  }

  const now = nowIso(), today = now.slice(0, 10), who = String(user.name || "");
  await db.batch([
    db.prepare("DELETE FROM callsign_slots WHERE callsign=?").bind(callsign),
    db.prepare(MEMBER_INSERT_SQL).bind(callsign, name, rank, today, today, 0, "", "", 0, 0, 0, 0, "Active", "", 0, 0, slot.sheet_row ?? null, now),
    db.prepare("INSERT INTO academy_recruits(callsign,name,discord_user_id,recruit_type,status,recruited_at,recruited_by) VALUES(?,?,?,?,'active',?,?)")
      .bind(callsign, name, discordId, rank, now, who)
  ]);
  // The recruit's Discord account gets a link to the new callsign; the nickname prefix and the rank role follow in the background.
  await db.prepare("INSERT INTO discord_member_links(callsign,discord_user_id,member_name,rank,status,pending_callsign,pending_rank,pending_update_roles,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?,1,?,?)")
    .bind(callsign, discordId, name, rank, callsign, rank, now, now).run();
  await academyLog(db, user, "Recruited", callsign, name, rank);
  await mirror("Academy recruit", "/api/academy/recruit", { callsign, name, rank });
  const sync = discordRecruit ? discordRecruit.queue(discordId, name) : "unavailable";
  return { ok: true, callsign, name, new_rank: rank, discord: { ok: sync === "pending", message: sync === "pending" ? "Discord nickname and role are being updated in the background." : "Discord synchronization could not be started." } };
}

async function setTraining(db, user, data) {
  const key = TRAINING_COLUMNS[String(data.training || "").toUpperCase()];
  if (!key) throw fail("Unknown training.");
  const r = await loadActive(db, Number(data.id) || 0);
  const done = data.done === true || data.done === "true";
  await db.prepare(`UPDATE academy_recruits SET ${key}_at=?, ${key}_by=? WHERE id=?`)
    .bind(done ? nowIso() : "", done ? String(user.name || "") : "", r.id).run();
  await academyLog(db, user, `${key.toUpperCase()} ${done ? "done" : "cleared"}`, r.callsign, r.name, "");
  return { ok: true };
}

async function setPatrol(db, user, data) {
  const r = await loadActive(db, Number(data.id) || 0);
  const done = data.done === true || data.done === "true";
  await db.prepare("UPDATE academy_recruits SET patrol_at=?, patrol_by=? WHERE id=?")
    .bind(done ? nowIso() : "", done ? String(user.name || "") : "", r.id).run();
  await academyLog(db, user, `Supervised patrol ${done ? "confirmed" : "cleared"}`, r.callsign, r.name, "");
  return { ok: true };
}

async function exam(db, user, data, mirror, discordRoster) {
  const r = await loadActive(db, Number(data.id) || 0);
  const now = nowIso(), who = String(user.name || "");

  if (data.result === "failed") {
    await db.prepare("UPDATE academy_recruits SET exam_result='failed', exam_at=?, exam_by=? WHERE id=?").bind(now, who, r.id).run();
    await academyLog(db, user, "Exit Exam failed", r.callsign, r.name, "");
    return { ok: true };
  }
  if (data.result !== "passed") throw fail("Choose passed or failed.");

  const newRank = String(data.new_rank || "").trim();
  if (!GRADUATE_RANKS.includes(newRank)) throw fail("Academy graduates become EMT or Volunteer.");
  if (!recruitView(r, await tigDays(db, r.callsign)).ready) throw fail("This recruit is not ready for the Exit Exam yet.");

  const member = await db.prepare("SELECT * FROM members WHERE upper(callsign)=upper(?)").bind(r.callsign).first();
  if (!member) throw fail("Member not found on the roster.", 404);
  if (member.do_not_promote) throw fail("This member is on the Do not Promote list.");
  const slot = await db.prepare(NEXT_SLOT_SQL).bind(newRank).first();
  const newCs = String(slot?.callsign || "").trim().toUpperCase();
  if (!newCs) throw fail(`No empty Callsign slot is recorded for ${newRank}. Run Sync now first.`);

  const today = now.slice(0, 10);
  await db.batch([
    db.prepare("DELETE FROM callsign_slots WHERE callsign=?").bind(newCs),
    db.prepare("DELETE FROM members WHERE callsign=?").bind(member.callsign),
    db.prepare("INSERT OR REPLACE INTO callsign_slots(rank,callsign,sheet_row,synced_at) VALUES(?,?,?,?)").bind(member.rank, member.callsign, member.sheet_row ?? null, now),
    db.prepare("UPDATE accounts SET callsign=?,updated_at=? WHERE upper(callsign)=upper(?)").bind(newCs, now, member.callsign),
    db.prepare(MEMBER_INSERT_SQL).bind(newCs, member.name, newRank, today, today, 0, member.discord_id || "", member.notes || "",
      member.has_basic_firefighting || 0, member.has_advanced_firefighting || 0, member.has_supervisor_exam || 0, member.has_hert || 0,
      member.activity || "Active", member.instructor_type || "", member.do_not_promote || 0, member.do_not_terminate || 0, slot.sheet_row ?? null, now),
    db.prepare("UPDATE academy_recruits SET status='graduated', exam_result='passed', exam_at=?, exam_by=?, graduated_to=?, graduated_callsign=?, graduated_at=?, graduated_by=? WHERE id=?")
      .bind(now, who, newRank, newCs, now, who, r.id)
  ]);
  await academyLog(db, user, "Passed Exit Exam", r.callsign, r.name, `${newCs} ${newRank}`);
  await mirror("Academy exam", "/api/academy/exam", { callsign: member.callsign, new_rank: newRank, d1_target_callsign: newCs, name: member.name });
  // Same Discord update as a promotion: the link moves to the new callsign and the nickname and role follow in the background.
  const sync = discordRoster ? await discordRoster(member, { new_callsign: newCs, new_rank: newRank }).catch(() => "unavailable") : "unavailable";
  const messages = {
    pending: "Discord nickname and role are being updated in the background.",
    not_linked: "No Discord link exists for this member, so Discord was not changed.",
    left_server: "This member is no longer in the Discord server, so Discord was not changed.",
    unavailable: "Discord synchronization could not be started."
  };
  return { ok: true, new_callsign: newCs, new_rank: newRank, discord: { ok: sync === "pending", message: messages[sync] || messages.unavailable } };
}

async function removeRecruit(db, user, data, mirror) {
  const r = await loadActive(db, Number(data.id) || 0);
  const member = await db.prepare("SELECT * FROM members WHERE upper(callsign)=upper(?)").bind(r.callsign).first();
  if (!member) throw fail("Member not found on the roster.", 404);
  if (!PROBIE_RANKS.includes(member.rank)) throw fail("This member is not an academy recruit.");
  const now = nowIso();
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO callsign_slots(rank,callsign,sheet_row,synced_at) VALUES(?,?,?,?)").bind(member.rank, member.callsign, member.sheet_row ?? null, now),
    db.prepare("DELETE FROM members WHERE callsign=?").bind(member.callsign),
    db.prepare("DELETE FROM academy_recruits WHERE id=?").bind(r.id)
  ]);
  await academyLog(db, user, "Removed — Resigned", r.callsign, r.name, "");
  await mirror("Academy remove", "/api/academy/remove", { callsign: member.callsign, name: member.name });
  return { ok: true };
}

// Called from handleD1 for every /api/academy route. Returns a Response, or null for a non-academy route.
export async function handleAcademy({ db, user, route, method, data, mirror, discordRoster, discordRecruit }) {
  if (route === "/api/academy" && method === "GET") { requireView(user); return json(await listAcademy(db, user)); }
  if (route === "/api/academy/recruit" && method === "POST") { requireManage(user); return json(await recruit(db, user, data, mirror, discordRecruit)); }
  if (route === "/api/academy/discord-retry" && method === "POST") {
    requireManage(user);
    const r = await db.prepare("SELECT * FROM academy_recruits WHERE id=?").bind(Number(data.id) || 0).first();
    if (!r) throw fail("Recruit was not found.", 404);
    return json({ ok: true, discord: await discordRecruit.run(r.discord_user_id, r.name) });
  }
  if (route === "/api/academy/training" && method === "POST") { requireManage(user); return json(await setTraining(db, user, data)); }
  if (route === "/api/academy/patrol" && method === "POST") { requireManage(user); return json(await setPatrol(db, user, data)); }
  if (route === "/api/academy/exam" && method === "POST") { requireManage(user); return json(await exam(db, user, data, mirror, discordRoster)); }
  if (route === "/api/academy/remove" && method === "POST") { requireManage(user); return json(await removeRecruit(db, user, data, mirror)); }
  return json({ detail: "Academy route was not found." }, 404);
}
