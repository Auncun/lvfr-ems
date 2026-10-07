const enc = new TextEncoder();
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const nowSeconds = () => Math.floor(Date.now() / 1000);
const LOG_VIEW_PERMISSIONS = ["promotion_log_view","callsign_log_view","termination_log_view","training_log_view","training_hours_log_view","loi_log_view","exam_log_view","note_log_view","activity_log_view","instructor_log_view"];
const TRAINING_VIEW_PERMISSIONS = ["hert_certified_view","hert_instructor_view","hert_loi_view","fort_training_view","fort_instructor_view","fort_loi_view"];
const ROLE_PERMISSION_KEYS = ["portal_access","operation_command_access","watch_command_view","watch_command_edit","watch_command_roster","members_view","eligible_view","promotion_access","profile_view","inactive_view","logs_view",...LOG_VIEW_PERMISSIONS,"logs_delete_d1","logs_clean_full","training_view",...TRAINING_VIEW_PERMISSIONS,"training_fort_manage","training_hert_manage","training_hours_view","training_hours_manage","loi_manage","statistics_view","notes_manage","promotion_manage","callsign_manage","activity_manage","exam_manage","rank_date_manage","rank_manage","termination_manage","do_not_promote_view","do_not_promote_manage","instructor_manage","sync_view","sync_manage","full_sync_manage"];
const DEFAULT_ROLE_PERMISSIONS = {
  member: { portal_access:false,operation_command_access:false,watch_command_view:true,watch_command_edit:true,watch_command_roster:true,members_view:false,eligible_view:false,promotion_access:false,profile_view:false,inactive_view:false,logs_view:false,training_view:false,training_fort_manage:false,training_hert_manage:false,training_hours_view:false,training_hours_manage:false,loi_manage:false,statistics_view:false,notes_manage:false,promotion_manage:false,callsign_manage:false,activity_manage:false,exam_manage:false,rank_date_manage:false,rank_manage:false,termination_manage:false,do_not_promote_view:false,do_not_promote_manage:false,instructor_manage:false,sync_view:false,sync_manage:false },
  leader: { portal_access:true,operation_command_access:false,watch_command_view:true,watch_command_edit:true,watch_command_roster:true,members_view:true,eligible_view:true,promotion_access:true,profile_view:true,inactive_view:false,logs_view:true,training_view:true,training_fort_manage:true,training_hert_manage:true,training_hours_view:true,training_hours_manage:true,loi_manage:true,statistics_view:true,notes_manage:true,promotion_manage:true,callsign_manage:true,activity_manage:false,exam_manage:false,rank_date_manage:false,rank_manage:false,termination_manage:false,do_not_promote_view:false,do_not_promote_manage:false,instructor_manage:false,sync_view:true,sync_manage:true },
  commander: Object.fromEntries(ROLE_PERMISSION_KEYS.map(key=>[key,!['logs_delete_d1','logs_clean_full'].includes(key)]))
};
async function rolePermissions(db, role) {
  const normalized=String(role||"").toLowerCase();
  const base=DEFAULT_ROLE_PERMISSIONS[normalized]||{};
  const row=await db.prepare("SELECT permissions_json FROM role_permissions WHERE role=?").bind(normalized).first();
  let saved={}; try { saved=JSON.parse(row?.permissions_json||"{}"); } catch {}
  const result=Object.fromEntries(ROLE_PERMISSION_KEYS.map(key=>[key,typeof saved[key]==="boolean"?saved[key]:Boolean(base[key])]));
  // Existing role profiles used the two parent capabilities for every child list.
  for(const key of LOG_VIEW_PERMISSIONS) if(typeof saved[key]!=="boolean") result[key]=typeof saved.logs_view==="boolean"?saved.logs_view:Boolean(base.logs_view);
  for(const key of TRAINING_VIEW_PERMISSIONS) if(typeof saved[key]!=="boolean") result[key]=typeof saved.training_view==="boolean"?saved.training_view:Boolean(base.training_view);
  result.logs_view=LOG_VIEW_PERMISSIONS.every(key=>result[key]);
  result.training_view=TRAINING_VIEW_PERMISSIONS.every(key=>result[key]);
  return result;
}
function parsePermissionOverrides(value) {
  try {
    const parsed=JSON.parse(String(value||"{}"));
    return Object.fromEntries(ROLE_PERMISSION_KEYS.filter(key=>typeof parsed[key]==="boolean").map(key=>[key,parsed[key]]));
  } catch { return {}; }
}
function expandLegacyPermissionOverrides(value) {
  const overrides={...value};
  if(Object.hasOwn(overrides,"logs_view")) {
    for(const key of LOG_VIEW_PERMISSIONS) if(!Object.hasOwn(overrides,key)) overrides[key]=overrides.logs_view;
    delete overrides.logs_view;
  }
  if(Object.hasOwn(overrides,"training_view")) {
    for(const key of TRAINING_VIEW_PERMISSIONS) if(!Object.hasOwn(overrides,key)) overrides[key]=overrides.training_view;
    delete overrides.training_view;
  }
  return overrides;
}
async function accountPermissions(db, account) {
  if(String(account.role||"").toLowerCase()==="admin") return Object.fromEntries(ROLE_PERMISSION_KEYS.map(key=>[key,true]));
  const role=await rolePermissions(db,account.role), overrides=expandLegacyPermissionOverrides(parsePermissionOverrides(account.permissions_override_json));
  const result=Object.fromEntries(ROLE_PERMISSION_KEYS.map(key=>[key,Object.hasOwn(overrides,key)?overrides[key]:role[key]]));
  for(const key of LOG_VIEW_PERMISSIONS) if(!Object.hasOwn(overrides,key)&&Object.hasOwn(overrides,"logs_view")) result[key]=overrides.logs_view;
  for(const key of TRAINING_VIEW_PERMISSIONS) if(!Object.hasOwn(overrides,key)&&Object.hasOwn(overrides,"training_view")) result[key]=overrides.training_view;
  result.logs_view=LOG_VIEW_PERMISSIONS.every(key=>result[key]);
  result.training_view=TRAINING_VIEW_PERMISSIONS.every(key=>result[key]);
  return result;
}
function permissionForRequest(route, method, data={}) {
  if(route==="/api/members"&&method==="GET") return ["members_view",...TRAINING_VIEW_PERMISSIONS,"training_view","statistics_view","loi_manage","training_fort_manage","training_hert_manage","training_hours_manage","instructor_manage"];
  if(route==="/api/eligible"&&method==="GET") return ["eligible_view","promotion_access"];
  if(route==="/api/inactive"&&method==="GET") return "inactive_view";
  if(route==="/api/members-log"&&method==="GET") return logViewPermission(data.log_type);
  if(route==="/api/members-log/clear"&&method==="POST") return "logs_delete_d1";
  if(route==="/api/logs/clean"&&method==="POST") return "logs_clean_full";
  if(route==="/api/promotions"&&method==="GET") return "promotion_log_view";
  if(route==="/api/training-log"&&method==="GET") return "training_log_view";
  if(route==="/api/exam-log"&&method==="GET") return "exam_log_view";
  if(route==="/api/termination-log"&&method==="GET") return "termination_log_view";
  if(route==="/api/training-hours") return method==="GET"?"training_hours_view":"training_hours_manage";
  if(route==="/api/loi") return method==="GET"?["hert_loi_view","fort_loi_view","loi_manage"]:"loi_manage";
  if(route==="/api/instructors"&&method==="GET") return ["hert_instructor_view","fort_instructor_view"];
  if(route==="/api/statistics"&&method==="GET") return "statistics_view";
  if(route==="/api/sync-status"&&method==="GET") return "sync_view";
  if(route==="/api/sync"&&method==="POST") return "sync_manage";
  if(route==="/api/full-sync"&&method==="POST") return "full_sync_manage";
  if(route==="/api/notifications/clear"&&method==="POST") return "sync_manage";
  if(route==="/api/do-not-promote"&&method==="GET") return "do_not_promote_view";
  if(route==="/api/do-not-promote"&&method==="POST") return "do_not_promote_manage";
  if(route==="/api/member/instructor"||/^\/api\/member\/[^/]+\/instructor$/.test(route)) return "instructor_manage";
  if(route==="/api/account/profile"&&method==="GET") return "profile_view";
  if(route==="/api/watch-command/current-user") return null;
  if(route==="/api/watch-command/members"&&method==="GET") return "watch_command_roster";
  if(route.startsWith("/api/watch-command/member/")&&method==="GET") return "watch_command_roster";
  if(route==="/api/watch-command") return method==="GET"?"watch_command_view":"watch_command_edit";
  if(route.startsWith("/api/member/")&&method==="GET") return "profile_view";
  if(route==="/api/training"&&method==="POST") return String(data.training||"").toLowerCase()==="hert"?"training_hert_manage":"training_fort_manage";
  const writes={"/api/note":"notes_manage","/api/promote":"promotion_manage","/api/change-callsign":"callsign_manage","/api/activity":"activity_manage","/api/exam":"exam_manage","/api/date":"rank_date_manage","/api/force-promote":"rank_manage","/api/demote":"rank_manage","/api/change-rank":"rank_manage","/api/terminate":"termination_manage"};
  return method==="POST"?writes[route]||null:null;
}
function logViewPermission(kind) {
  return ({promotion:"promotion_log_view",callsign:"callsign_log_view",termination:"termination_log_view",training:"training_log_view",training_time:"training_hours_log_view",loi:"loi_log_view",exam:"exam_log_view",note:"note_log_view",activity:"activity_log_view",instructor:"instructor_log_view"})[String(kind||"").toLowerCase()]||"logs_view";
}
function requireRolePermission(user, permissions, key) {
  if(!key || user.role === "admin") return;
  if(Array.isArray(key)?key.some(item=>permissions[item]):permissions[key]) return;
  throw Object.assign(new Error("Your role does not have permission for this action."),{status:403});
}
const nameKey = value => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = text => Uint8Array.from(atob(String(text).replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const sha256 = async value => b64url(await crypto.subtle.digest("SHA-256", typeof value === "string" ? enc.encode(value) : value));

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
}
async function passwordHash(password, salt) {
  const material = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return b64url(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64url(salt), iterations: 100000 }, material, 256));
}
async function signedClaims(account, secret) {
  const claims = { sub: account.account_id, name: account.name, callsign: account.callsign, status: account.status, role: account.role, permissions: account.permissions || {}, permission_overrides: parsePermissionOverrides(account.permissions_override_json), exp: nowSeconds() + 90 };
  const body = b64url(enc.encode(JSON.stringify(claims)));
  return `d1v1.${body}.${await hmac(secret, `d1v1.${body}`)}`;
}
function sessionTokens(request) {
  const header = request.headers.get("Authorization") || "";
  const result = header.startsWith("Bearer ") ? [header.slice(7).trim()] : [];
  // Try the same-origin HttpOnly cookie too. A stale header from a tab should
  // not mask a valid cookie session from the current login.
  const cookies = request.headers.get("Cookie") || "";
  const pair = cookies.split(";").map(value => value.trim()).find(value => value.startsWith("lvfr_d1_session="));
  if (pair) {
    try {
      const cookieToken = decodeURIComponent(pair.slice("lvfr_d1_session=".length));
      if (cookieToken && !result.includes(cookieToken)) result.push(cookieToken);
    } catch {}
  }
  return result;
}
async function accountForToken(db, token) {
  if (!token) return null;
  return db.prepare(`SELECT a.account_id, a.name, a.callsign, a.status, a.role, a.permissions_override_json
    FROM auth_sessions s JOIN accounts a ON a.account_id=s.account_id
    WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token), nowSeconds()).first();
}
async function accountForRequest(db, request) {
  const tokens = sessionTokens(request);
  for (const token of tokens) {
    const account = await accountForToken(db, token);
    if (account) return { account, token };
  }
  return { account: null, token: tokens[0] || "" };
}
async function gasCall(env, route, method, data = {}, token = "", params = {}) {
  const target = String(env.GAS_WEB_APP_URL || "").trim();
  if (!target || !env.LVFR_D1_WORKER_SECRET) throw new Error("Apps Script bridge is not configured.");
  const response = await fetch(target, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ route, method, data, params, sessionToken: token, workerSecret: env.LVFR_D1_WORKER_SECRET }), redirect: "follow" });
  const responseText = await response.text();
  let payload = null;
  try { payload = JSON.parse(responseText); } catch {}
  if (!payload || typeof payload.ok !== "boolean") {
    const contentType = response.headers.get("content-type") || "unknown content type";
    const detail = responseText.replace(/\s+/g," ").trim().slice(0,240);
    let responseLocation = response.url;
    try { const parsedUrl=new URL(response.url); responseLocation=parsedUrl.origin+parsedUrl.pathname; } catch {}
    const htmlHint = /text\/html/i.test(contentType)
      ? ` Google returned an HTML page from ${responseLocation}; set the Cloudflare GAS_WEB_APP_URL variable to the active Apps Script /exec URL, then confirm the Web App is deployed to execute as its owner and allows access to anyone. Do not use a /dev or script.googleusercontent.com URL.`
      : "";
    throw new Error(`Apps Script request ${route} returned an invalid response (HTTP ${response.status}, ${contentType}).${htmlHint}${detail?` Response: ${detail}`:""}`);
  }
  if (!payload.ok) throw new Error(payload.error || "Apps Script request failed.");
  return payload.data;
}
async function rosterIdentity(env, name) {
  const member = await gasCall(env, "/auth/roster-lookup", "POST", { name });
  if (!member || !member.name || !member.callsign) throw new Error("Name was not found on the LVFR roster.");
  return member;
}
async function syncMembersFromAppsScript(env, token = "", fullSync = false) {
  // Manual sync endpoints read the Sheet and let Apps Script check/commit its
  // fingerprint before it posts the snapshot to D1.
  const snapshot = fullSync
    ? await gasCall(env, "/api/full-sync", "POST", {}, token)
    : await gasCall(env, "/api/sync", "POST", {}, token);
  if (!snapshot || snapshot.ok !== true) throw new Error("Apps Script returned an invalid sync result.");
  if (fullSync && snapshot.skipped) throw new Error("Apps Script unexpectedly skipped the requested Full Sync.");
  return snapshot;
}
async function saveCallsignSlots(db, slots) {
  await ensureCallsignSlotsTable(db);
  const items=Array.isArray(slots)?slots:Object.entries(slots||{}).map(([rank,v])=>typeof v==="string"?({rank,callsign:v}):({rank,...v}));
  const rows=items.filter(v=>v&&v.callsign).map(v=>db.prepare("INSERT INTO callsign_slots(rank,callsign,sheet_row,synced_at) VALUES(?,?,?,?) ON CONFLICT(rank,callsign) DO UPDATE SET sheet_row=excluded.sheet_row,synced_at=excluded.synced_at").bind(String(v.rank||""),String(v.callsign).toUpperCase(),Number(v.row)||null,new Date().toISOString()));
  await db.prepare("DELETE FROM callsign_slots").run(); if(rows.length) await db.batch(rows);
}
async function ensureCallsignSlotsTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS callsign_slots (
    rank TEXT NOT NULL,
    callsign TEXT NOT NULL,
    sheet_row INTEGER,
    synced_at TEXT NOT NULL,
    PRIMARY KEY (rank, callsign),
    UNIQUE (callsign)
  )`).run();
}
async function replaceMembers(db, members, syncedAt = new Date().toISOString()) {
  const statements = [db.prepare("DELETE FROM members")];

  for (const member of members) {
    statements.push(
      db.prepare(`
        INSERT INTO members (
          callsign,
          name,
          rank,
          date,
          rank_assigned_date,
          days_in_rank,
          discord_id,
          notes,
          has_basic_firefighting,
          has_advanced_firefighting,
          has_supervisor_exam,
          has_hert,
          activity,
          instructor_type,
          do_not_promote,
          sheet_row,
          synced_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
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
        Number(member.sheet_row || member.row || 0) || null,
        syncedAt
      )
    );
  }

  await db.batch(statements);

  return { ok: true, members: members.length, synced_at: syncedAt };
}
const MEMBER_WRITE_ROUTES = new Set(["/api/activity", "/api/note", "/api/date", "/api/training", "/api/exam", "/api/promote", "/api/force-promote", "/api/demote", "/api/change-rank", "/api/change-callsign", "/api/terminate", "/api/do-not-promote"]);
const RANK_PREFIX = { Commissioners:"COM", Chief:"CHIEF", "County Command":"B", "Division Commander":"DIV", Captain:"C", Lieutenant:"E", "Lead Paramedic":"L", Paramedic:"M", AEMT:"A", EMT:"R", Probationary:"P", EMR:"P", "Senior Volunteer":"S", Volunteer:"V", "Probationary Volunteer":"V", "EMR/Volunteer":"P" };
function rankForCallsign(cs) { const p=String(cs||"").match(/^[A-Z]+/); if(!p)return ""; if(p[0]==="V") return [1,2,3,4,5,6,7,8,9,14,21,22,23,24,25,26,27,28,29,36,37,38,39,40].includes(Number(cs.split("-")[1]))?"Probationary Volunteer":"Volunteer"; return ({COM:"Commissioners",CHIEF:"Chief",B:"County Command",DIV:"Division Commander",C:"Captain",E:"Lieutenant",L:"Lead Paramedic",M:"Paramedic",A:"AEMT",R:"EMT",P:"Probationary",S:"Senior Volunteer"})[p[0]]||""; }
let orderedMembersViewReady = false;
async function ensureOrderedMembersView(db) {
  if(orderedMembersViewReady) return;
  await db.prepare(`CREATE VIEW IF NOT EXISTS members_roster_ordered AS
    SELECT * FROM members
    ORDER BY CASE substr(upper(callsign),1,instr(callsign,'-')-1)
      WHEN 'COM' THEN 0 WHEN 'CHIEF' THEN 1 WHEN 'B' THEN 2 WHEN 'DIV' THEN 3
      WHEN 'C' THEN 4 WHEN 'E' THEN 5 WHEN 'L' THEN 6 WHEN 'M' THEN 7
      WHEN 'A' THEN 8 WHEN 'R' THEN 9 WHEN 'P' THEN 10 WHEN 'S' THEN 11
      WHEN 'V' THEN CASE WHEN CAST(substr(callsign,instr(callsign,'-')+1) AS INTEGER) IN (1,2,3,4,5,6,7,8,9,14,21,22,23,24,25,26,27,28,29,36,37,38,39,40) THEN 13 ELSE 12 END
      ELSE 999 END,
      CAST(substr(callsign,instr(callsign,'-')+1) AS INTEGER),
      callsign COLLATE NOCASE`).run();
  orderedMembersViewReady = true;
}
const RANK_LEVEL = { "Probationary Volunteer":1, "Probationary":1, EMR:1, "EMR/Volunteer":1, Volunteer:2, "Senior Volunteer":3, EMT:4, AEMT:5, "Advanced EMT":5, Paramedic:6, "Lead Paramedic":7, Lieutenant:8, Captain:9, "Division Commander":10, "County Command":11, Chief:12, Commissioners:13 };
async function applyRosterMutationD1(db, route, data, actor) {
  await ensureCallsignSlotsTable(db);
  const admin=["admin","commander"].includes(String(actor.role||""));
  const cs=String(data.callsign||"").trim().toUpperCase(), old=await db.prepare("SELECT * FROM members WHERE upper(callsign)=?").bind(cs).first();
  if(!old) throw Object.assign(new Error("Member not found."),{status:404});
  const now=new Date().toISOString(), cols={callsign:old.callsign,name:old.name,rank:old.rank,date:old.date,rank_assigned_date:old.rank_assigned_date,days_in_rank:old.days_in_rank,discord_id:old.discord_id,notes:old.notes,has_basic_firefighting:old.has_basic_firefighting,has_advanced_firefighting:old.has_advanced_firefighting,has_supervisor_exam:old.has_supervisor_exam,has_hert:old.has_hert,activity:old.activity,instructor_type:old.instructor_type,do_not_promote:old.do_not_promote,sheet_row:old.sheet_row,synced_at:now};
  let result={ok:true};
  if(route==="/api/activity") { const val=String(data.activity||""); if(!["Active","Semi Active","Inactive","Can Be Terminated"].includes(val)) throw new Error("Invalid activity status."); cols.activity=val; }
  else if(route==="/api/note") { const action=String(data.action||""), entered=String(data.note||"").trim(); if(action==="Add"&&old.notes) throw new Error("This member already has a note. Choose Edit or Delete."); if(action==="Edit"&&!old.notes) throw new Error("This member has no note to edit. Choose Add."); if(action==="Delete") cols.notes=""; else if(["Add","Edit"].includes(action)){if(!entered) throw new Error("Enter a note before saving it.");cols.notes=entered;} else throw new Error("Invalid note action."); result.note=cols.notes; }
  else if(route==="/api/date") { const m=String(data.date_str||"").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if(!m) throw new Error("Enter a date in MM/DD/YYYY format."); const d=new Date(+m[3],+m[1]-1,+m[2]); if(d.getFullYear()!==+m[3]||d.getMonth()!==+m[1]-1||d.getDate()!==+m[2]) throw new Error("Enter a valid date."); cols.date=cols.rank_assigned_date=`${m[1].padStart(2,"0")}/${m[2].padStart(2,"0")}/${m[3]}`; cols.days_in_rank=0; }
  else if(route==="/api/training") {
    const training=String(data.training||"");
    const key=training.toLowerCase()==="hert"?"has_hert":training==="Basic Firefighting"?"has_basic_firefighting":training==="Advanced Firefighting"?"has_advanced_firefighting":"";
    if(!key) throw new Error("Unknown training.");
    const present=Boolean(Number(old[key]||0)), remove=Boolean(data.remove);
    if(present===!remove) return {ok:false,changed:false,status:remove?"already_removed":"already_completed",message:remove?"Training already removed":"Already certified"};
    cols[key]=remove?0:1;
    result={ok:true,changed:true,status:remove?"removed":"added",message:remove?"Training removed":"Training added"};
  }
  else if(route==="/api/exam") {
    const present=Boolean(Number(old.has_supervisor_exam||0)), remove=Boolean(data.remove);
    if(present===!remove) return {ok:false,changed:false,status:remove?"already_removed":"already_passed",message:remove?"Exam already removed":"Already passed the exam"};
    cols.has_supervisor_exam=remove?0:1;
    result={ok:true,changed:true,status:remove?"removed":"added",message:remove?"Exam removed":"Exam added"};
  }
  else if(route==="/api/member/"+cs+"/instructor") {
    const type=String(data.instructor_type||"").toUpperCase(), assigned=Boolean(data.assigned);
    if(!["HERT","FORT"].includes(type)) throw new Error("Choose HERT or FORT.");
    const set=new Set(String(old.instructor_type||"").toUpperCase().split(/\s*\/\s*/).filter(Boolean));
    const wasAssigned=set.has(type);
    if(wasAssigned===assigned) result={ok:true,changed:false,assigned,instructor_type:type,status:assigned?"already_assigned":"already_removed",message:assigned?"Already assigned":"Already removed"};
    else {
      if(assigned)set.add(type);else set.delete(type);
      result={ok:true,changed:true,assigned,instructor_type:type,status:assigned?"assigned":"removed",message:assigned?"Instructor added":"Instructor removed"};
    }
    cols.instructor_type=[...set].sort().join(" / ");
  }
  else if(route==="/api/do-not-promote") cols.do_not_promote=data.blocked?1:0;
  else if(route==="/api/terminate") {
    await db.batch([
      db.prepare("DELETE FROM members WHERE callsign=?").bind(old.callsign),
      db.prepare("DELETE FROM training_hours WHERE upper(callsign)=upper(?)").bind(old.callsign),
      db.prepare("DELETE FROM loi_entries WHERE upper(callsign)=upper(?) OR (coalesce(callsign,'')='' AND lower(trim(name))=lower(trim(?)))").bind(old.callsign,old.name),
      db.prepare("INSERT OR REPLACE INTO callsign_slots(rank,callsign,sheet_row,synced_at) VALUES(?,?,?,?)").bind(rankForCallsign(old.callsign),old.callsign,old.sheet_row,now)
    ]);
    return {ok:true};
  }
  else if(["/api/promote","/api/force-promote","/api/demote","/api/change-rank","/api/change-callsign"].includes(route)) {
    const nextRank=route==="/api/promote"?(rankEligibility(memberFromRow(old)).next_rank):String(data.new_rank||old.rank).trim();
    let nextCs=String(data.d1_target_callsign||data.new_callsign||"").trim().toUpperCase();
    let slot;
    if(route!=="/api/change-callsign") {
      slot=await db.prepare("SELECT rank,callsign,sheet_row FROM callsign_slots WHERE lower(trim(rank))=lower(trim(?)) ORDER BY CASE WHEN sheet_row IS NULL THEN 1 ELSE 0 END,sheet_row,callsign LIMIT 1").bind(nextRank).first();
      const firstCallsign=String(slot?.callsign||"").trim().toUpperCase();
      if(!firstCallsign) throw new Error("No empty Callsign slot is recorded for " + nextRank + ". Please run Sync now.");
      if(nextCs && nextCs!==firstCallsign) throw new Error("The first empty Callsign in the roster has changed. Please run Sync now and retry.");
      nextCs=firstCallsign;
    }
    if(!nextCs||nextCs===old.callsign) throw new Error("No empty Callsign slot is available for " + nextRank + ". Run Sync now to refresh the available slots.");
    if(!slot) slot=await db.prepare("SELECT rank,callsign,sheet_row FROM callsign_slots WHERE upper(callsign)=?").bind(nextCs).first();
    if(!slot) throw new Error("That Callsign is not an available roster slot. Run Sync now and try again.");
    const slotRank=String(slot.rank||"").trim().toLowerCase();
    if(route!=="/api/change-callsign" && slotRank!==nextRank.toLowerCase()) throw new Error("The destination Callsign does not match the selected rank.");
    if(route==="/api/change-callsign" && !admin && slotRank!==String(old.rank||"").trim().toLowerCase()) throw new Error("Supervisors may only change a Callsign while keeping the member’s current rank.");
    if(route==="/api/change-callsign" && admin && slotRank!==String(old.rank||"").trim().toLowerCase() && !data.force) throw new Error("The Callsign belongs to a different rank. Confirm a rank change first.");
    if(old.do_not_promote && (RANK_LEVEL[nextRank]||0)>(RANK_LEVEL[old.rank]||0)) throw new Error("This member is on the Do not Promote list.");
    if(route==="/api/force-promote" && (RANK_LEVEL[nextRank]||0)<=(RANK_LEVEL[old.rank]||0)) throw new Error("You can only promote to a higher rank.");
    if(route==="/api/demote" && (RANK_LEVEL[nextRank]||0)>=(RANK_LEVEL[old.rank]||0)) throw new Error("You can only demote to a lower rank.");
    if(route==="/api/promote") { const elig=rankEligibility(memberFromRow(old)); if(!elig.eligible) throw new Error(elig.reason); if(!admin&&(old.rank!=="EMT"||elig.next_rank!=="AEMT")) throw new Error("Supervisors may only promote EMT members to AEMT."); }
    if(route==="/api/change-rank" && !["EMT|AEMT","AEMT|Senior Volunteer","EMT|Volunteer","Senior Volunteer|AEMT","Volunteer|EMT"].includes(old.rank+"|"+nextRank)) throw new Error("This rank change is not supported.");
    const finalRank=route==="/api/change-callsign"?(admin?slot.rank:old.rank):nextRank;
    const date=route==="/api/change-callsign"?old.date:now.slice(0,10);
    await db.batch([db.prepare("DELETE FROM callsign_slots WHERE callsign=?").bind(nextCs),db.prepare("DELETE FROM members WHERE callsign=?").bind(old.callsign),db.prepare(`INSERT INTO members(callsign,name,rank,date,rank_assigned_date,days_in_rank,discord_id,notes,has_basic_firefighting,has_advanced_firefighting,has_supervisor_exam,has_hert,activity,instructor_type,do_not_promote,sheet_row,synced_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(nextCs,old.name,finalRank,date,date,0,old.discord_id,old.notes,old.has_basic_firefighting,old.has_advanced_firefighting,old.has_supervisor_exam,old.has_hert,old.activity,old.instructor_type,old.do_not_promote,slot.sheet_row||null,now),db.prepare("INSERT OR IGNORE INTO callsign_slots(rank,callsign,sheet_row,synced_at) VALUES(?,?,?,?)").bind(rankForCallsign(old.callsign),old.callsign,old.sheet_row,now)]);
    return {ok:true,new_callsign:nextCs,new_rank:finalRank};
  }
  const assignments=Object.keys(cols).filter(k=>k!=="callsign").map(k=>`${k}=?`).join(",");
  await db.prepare(`UPDATE members SET ${assignments} WHERE callsign=?`).bind(...Object.keys(cols).filter(k=>k!=="callsign").map(k=>cols[k]),old.callsign).run();
  return result;
}
function memberFromRow(row) {
  const assigned=String(row.rank_assigned_date||row.date||"");
  const us=assigned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const assignedTime=us?Date.UTC(Number(us[3]),Number(us[1])-1,Number(us[2])):Date.parse(assigned);
  const days=Number.isFinite(assignedTime)?Math.max(0,Math.floor((Date.now()-assignedTime)/86400000)):Number(row.days_in_rank||0);
  return { ...row, row: row.sheet_row, has_basic_firefighting: !!row.has_basic_firefighting,
    has_advanced_firefighting: !!row.has_advanced_firefighting, has_supervisor_exam: !!row.has_supervisor_exam,
    has_hert: !!row.has_hert, do_not_promote: !!row.do_not_promote, days_in_rank: days };
}
function compareCallsigns(a, b) {
  const left=String(a||"").trim().toUpperCase().match(/^([A-Z]+)-(\d+)$/);
  const right=String(b||"").trim().toUpperCase().match(/^([A-Z]+)-(\d+)$/);
  if(left && right && left[1]===right[1]) return Number(left[2])-Number(right[2]);
  return String(a||"").localeCompare(String(b||""),undefined,{numeric:true,sensitivity:"base"});
}
async function readMembers(db, search = "", env = null, token = "") {
  // Do not seed an empty D1 database from Sheet during a read. Run Sync now.
  await ensureOrderedMembersView(db);
  const q = String(search || "").trim().toLowerCase();
  const result = q
    ? await db.prepare("SELECT * FROM members_roster_ordered WHERE lower(callsign) LIKE ? OR lower(name) LIKE ? OR lower(rank) LIKE ?").bind(`%${q}%`,`%${q}%`,`%${q}%`).all()
    : await db.prepare("SELECT * FROM members_roster_ordered").all();
  const rankOrder=["Commissioners","Chief","County Command","Division Commander","Captain","Lieutenant","Lead Paramedic","Paramedic","AEMT","EMT","Probationary","Senior Volunteer","Volunteer","Probationary Volunteer","EMR","EMR/Volunteer"];
  const sortRank = member => {
    const fromCallsign=rankForCallsign(member.callsign);
    if(fromCallsign) return rankOrder.indexOf(fromCallsign)<0?999:rankOrder.indexOf(fromCallsign);
    const stored=String(member.rank||"").trim().toLowerCase();
    const canonical=rankOrder.find(rank=>rank.toLowerCase()===stored);
    const index=rankOrder.indexOf(canonical);
    return index<0?999:index;
  };
  return (result.results || []).map(memberFromRow).sort((a,b)=>sortRank(a)-sortRank(b) || compareCallsigns(a.callsign,b.callsign));
}
function rankEligibility(member) {
  const rules = { EMR:["EMT",7,[],[]], Probationary:["EMT",7,[],[]], EMT:["AEMT",14,["has_basic_firefighting"],[]], AEMT:["Paramedic",21,["has_basic_firefighting","has_advanced_firefighting"],["has_supervisor_exam"]], "Advanced EMT":["Paramedic",21,["has_basic_firefighting","has_advanced_firefighting"],["has_supervisor_exam"]], "EMR/Volunteer":["Volunteer",7,[],[]], "Probationary Volunteer":["Volunteer",7,[],[]], Volunteer:["Senior Volunteer",14,[],[]] };
  const rule=rules[member.rank];
  if(member.do_not_promote) return {eligible:false,reason:"Can't be promoted (Do not Promote list)",next_rank:rule?.[0]||""};
  if(!rule || ["Probationary","Probationary Volunteer"].includes(member.rank)) return {eligible:false,reason:"No automatic promotion available",next_rank:""};
  const missing=[]; if(Number(member.days_in_rank||0)<rule[1]) missing.push(`${rule[1]-Number(member.days_in_rank||0)} more day(s)`);
  for(const key of [...rule[2],...rule[3]]) if(!member[key]) missing.push(key.replaceAll("_"," "));
  return {eligible:!missing.length,reason:missing.length?`Missing: ${missing.join(", ")}`:"Eligible for promotion",next_rank:rule[0]};
}
async function appendAudit(db, account, action, actor) {
  await db.prepare(`INSERT INTO account_audit(created_at,account_id,name,callsign,action,actor_name)
    VALUES(?,?,?,?,?,?)`).bind(new Date().toISOString(), account.account_id, account.name, account.callsign, action, actor || "").run();
}
async function publicUser(db, account) {
  const member = account.callsign
    ? await db.prepare("SELECT instructor_type FROM members WHERE upper(callsign)=upper(?)").bind(account.callsign).first()
    : null;
  const permissions=await accountPermissions(db,account);
  return { account_id: account.account_id, id: account.account_id, name: account.name, callsign: account.callsign,
    role: account.role, status: account.status, is_admin: ["admin","commander"].includes(account.role), is_operation: account.role === "admin", is_commander: account.role === "commander",
    is_command: ["admin", "commander"].includes(account.role) || /^(E|C|DIV|B|CHIEF|COM)-/.test(account.callsign),
    instructor_type: String(member?.instructor_type || ""), permissions, permission_overrides: parsePermissionOverrides(account.permissions_override_json) };
}
async function login(db, data) {
  const name = nameKey(data.username || data.name), password = String(data.password || "");
  const loginKey = await sha256(name), now = nowSeconds();
  const attempt = await db.prepare("SELECT * FROM auth_login_attempts WHERE login_key=?").bind(loginKey).first();
  if (attempt && now - attempt.window_started_at < 600 && attempt.attempts >= 8) throw Object.assign(new Error("Too many sign-in attempts. Wait 10 minutes and try again."), { status: 429 });
  const account = await db.prepare("SELECT * FROM accounts WHERE name_key=? AND status NOT IN ('removed','denied')").bind(name).first();
  const valid = account && await passwordHash(password, account.password_salt) === account.password_hash;
  if (!valid) {
    if (attempt && now - attempt.window_started_at < 600) await db.prepare("UPDATE auth_login_attempts SET attempts=attempts+1 WHERE login_key=?").bind(loginKey).run();
    else await db.prepare("INSERT OR REPLACE INTO auth_login_attempts(login_key,window_started_at,attempts) VALUES(?,?,1)").bind(loginKey, now).run();
    throw Object.assign(new Error("Incorrect name or password."), { status: 401 });
  }
  await db.prepare("DELETE FROM auth_login_attempts WHERE login_key=?").bind(loginKey).run();
  if (account.status !== "approved") throw Object.assign(new Error("This account is pending approval or inactive. Contact a Commander."), { status: 403 });
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const lifetime = data.remember_me === true || String(data.remember_me || "").toLowerCase() === "on" ? 30 * 86400 : 6 * 3600;
  await db.prepare("INSERT INTO auth_sessions(token_hash,account_id,expires_at,created_at,remember_me) VALUES(?,?,?,?,?)")
    .bind(await sha256(token), account.account_id, now + lifetime, now, lifetime > 21600 ? 1 : 0).run();
  return { token, user: await publicUser(db,account), max_age: lifetime };
}
async function signup(db, env, data) {
  const setup = await db.prepare("SELECT value FROM account_migration_state WHERE migration_key='initial_commander_created'").first();
  if (!setup) throw Object.assign(new Error("New registration is temporarily closed until the first Operation account is set up."), { status: 503 });
  const identity = await rosterIdentity(env, data.name);
  const password = String(data.password || "");
  if (!/^[A-Za-z0-9]{4,20}$/.test(password)) throw new Error("Password must be 4–20 letters or numbers.");
  const salt = b64url(crypto.getRandomValues(new Uint8Array(16))), id = crypto.randomUUID(), now = new Date().toISOString();
  const hash = await passwordHash(password, salt), key = nameKey(identity.name);
  try {
    await db.batch([
      db.prepare(`INSERT INTO accounts(account_id,name,name_key,callsign,password_salt,password_hash,password_hash_version,status,role,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'pbkdf2-sha256-100000','pending','member',?,?)`).bind(id, identity.name, key, identity.callsign, salt, hash, now, now),
      db.prepare(`INSERT INTO account_audit(created_at,account_id,name,callsign,action,actor_name) VALUES(?,?,?,?,?,?)`).bind(now, id, identity.name, identity.callsign, "Account Requested", identity.name)
    ]);
  } catch (error) {
    if (/unique|constraint/i.test(String(error))) throw new Error("An account is already linked to this member name. Contact a Commander.");
    throw error;
  }
  return { ok: true, status: "pending", request_id: id, callsign: identity.callsign };
}
async function bootstrapCommander(db, env, request, data) {
  const configured = String(env.LVFR_D1_BOOTSTRAP_SECRET || "");
  const supplied = request.headers.get("X-LVFR-Bootstrap-Secret") || "";
  if (configured.length < 32 || supplied !== configured) throw Object.assign(new Error("Bootstrap authorization failed."), { status: 403 });
  if (!/^[A-Za-z0-9]{4,20}$/.test(String(data.password || ""))) throw new Error("Password must be 4–20 letters or numbers.");
  const state = await db.prepare("SELECT value FROM account_migration_state WHERE migration_key='initial_commander_created'").first();
  const count = await db.prepare("SELECT COUNT(*) AS n FROM accounts").first();
  if (state || Number(count.n) !== 0) throw Object.assign(new Error("Operation bootstrap is closed because account setup has already started."), { status: 409 });
  const identity = await rosterIdentity(env, data.name);
  const id = crypto.randomUUID(), now = new Date().toISOString(), salt = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await passwordHash(data.password, salt);
  try {
    await db.batch([
      db.prepare("INSERT INTO account_migration_state(migration_key,value,updated_at) VALUES('initial_commander_created',?,?)").bind(id, now),
      db.prepare(`INSERT INTO accounts(account_id,name,name_key,callsign,password_salt,password_hash,password_hash_version,status,role,created_at,activated_at,approved_by,updated_at)
        VALUES(?,?,?,?,?,?,'pbkdf2-sha256-100000','approved','admin',?,?,?,?)`).bind(id, identity.name, nameKey(identity.name), identity.callsign, salt, hash, now, now, "Initial D1 setup", now),
      db.prepare("INSERT INTO account_audit(created_at,account_id,name,callsign,action,actor_name) VALUES(?,?,?,?,?,?)").bind(now,id,identity.name,identity.callsign,"Initial Operation Created",identity.name)
    ]);
  } catch (error) {
    if (/unique|constraint/i.test(String(error))) throw Object.assign(new Error("Bootstrap already completed or account name is already in use."), { status: 409 });
    throw error;
  }
  return { ok:true, status:"approved", callsign:identity.callsign, message:"Initial Operation account created. Remove LVFR_D1_BOOTSTRAP_SECRET now." };
}
async function requireAdmin(db, token) {
  const account = await accountForToken(db, token);
  if (!account || account.status !== "approved") throw Object.assign(new Error("Sign in again."), { status: 401 });
  if (!["admin", "commander"].includes(account.role)) throw Object.assign(new Error("Only Commanders can perform this action."), { status: 403 });
  return account;
}
async function requireOperation(db, token) {
  const account = await accountForToken(db, token);
  if (!account || account.status !== "approved") throw Object.assign(new Error("Sign in again."), { status: 401 });
  if (account.role !== "admin") throw Object.assign(new Error("Only Operation can manage access permissions and elevated roles."), { status: 403 });
  return account;
}
function requireRoleProfileManager(actor) {
  if(actor.role!=="admin"&&actor.role!=="commander"&&actor.permissions?.operation_command_access!==true)
    throw Object.assign(new Error("Operation Command access is required."),{status:403});
}
async function leaders(db, actor) {
  const rows = await db.prepare("SELECT account_id,name,callsign,status,role,permissions_override_json,created_at,activated_at,approved_by,admin_changed_at,admin_changed_by FROM accounts WHERE status NOT IN ('removed','denied') ORDER BY created_at DESC").all();
  const audit = await db.prepare("SELECT id,created_at,account_id,name,callsign,action,actor_name,actor_name AS by FROM account_audit ORDER BY id DESC LIMIT 200").all();
  const online = await db.prepare("SELECT account_id,last_seen FROM account_presence WHERE last_seen>?").bind(nowSeconds() - 90).all();
  const on = new Set((online.results || []).map(x => x.account_id));
  const accounts = (rows.results || []).map(({ permissions_override_json, ...row }) => ({ ...row, permission_overrides: actor.role === "admin" ? parsePermissionOverrides(permissions_override_json) : undefined, id: row.account_id, display_name: row.name, requested_at: row.created_at, linked_at: row.created_at, approved_at: row.activated_at, is_admin: row.role === "admin", is_commander: row.role === "commander", is_elevated: ["admin","commander"].includes(row.role), online: row.status === "approved" && on.has(row.account_id) }));
  return { approved: accounts.filter(x => x.status === "approved"), pending: accounts.filter(x => x.status === "pending"), deactivated: accounts.filter(x => x.status === "deactivated"), audit: audit.results || [], online_count: accounts.filter(x => x.online).length };
}
async function accountAction(db, id, action, actor) {
  const target = await db.prepare("SELECT * FROM accounts WHERE account_id=?").bind(id).first();
  if (!target) throw new Error("Account not found.");
  if (id === actor.account_id && ["demote", "member", "deactivate", "delete"].includes(action)) throw new Error("You cannot remove or restrict your own account.");
  let status = target.status, role = target.role, activated = target.activated_at, approvedBy = target.approved_by, changedAt = target.admin_changed_at, changedBy = target.admin_changed_by;
  const now = new Date().toISOString();
  switch (action) {
    case "allow": if (status !== "pending") throw new Error("Account is not pending."); status="approved"; role="member"; activated=now; approvedBy=actor.name; break;
    case "deny": if (status !== "pending") throw new Error("Account is not pending."); status="denied"; break;
    case "admin": if (status !== "approved") throw new Error("Activate the account first."); role="admin"; changedAt=now; changedBy=actor.name; break;
    case "commander": if (status !== "approved") throw new Error("Activate the account first."); role="commander"; changedAt=now; changedBy=actor.name; break;
    case "demote": if (role === "admin") role="commander"; else if (role === "commander") role="leader"; else throw new Error("Account is not Operation or Commander."); changedAt=now; changedBy=actor.name; break;
    case "member": if(status!=="approved" || ["admin","commander"].includes(role)) throw new Error("Remove Commander access first."); role="member"; changedAt=now; changedBy=actor.name; break;
    case "leader": if(status!=="approved" || role!=="member") throw new Error("Only an approved Member can become a Supervisor."); role="leader"; changedAt=now; changedBy=actor.name; break;
    case "deactivate": if(status!=="approved" || ["admin","commander"].includes(role)) throw new Error("Remove Commander access first."); status="deactivated"; changedAt=now; changedBy=actor.name; break;
    case "reactivate": if(status!=="deactivated") throw new Error("Account is not deactivated."); status="approved"; activated=now; approvedBy=actor.name; break;
    case "delete": if(["admin","commander"].includes(role)) throw new Error("Remove Commander access before deleting the account."); status="removed"; break;
    default: throw new Error("Unknown account action.");
  }
  await db.batch([
    db.prepare("UPDATE accounts SET status=?,role=?,permissions_override_json=?,activated_at=?,approved_by=?,admin_changed_at=?,admin_changed_by=?,updated_at=? WHERE account_id=?").bind(status,role,role!==target.role?"{}":target.permissions_override_json||"{}",activated,approvedBy,changedAt,changedBy,now,id),
    db.prepare("INSERT INTO account_audit(created_at,account_id,name,callsign,action,actor_name) VALUES(?,?,?,?,?,?)").bind(now,id,target.name,target.callsign,action,actor.name),
    ...(["deny","delete","deactivate"].includes(action) ? [db.prepare("DELETE FROM auth_sessions WHERE account_id=?").bind(id)] : [])
  ]);
  return { ok:true, status:"saving" };
}
function isCommandRank(user) {
  return ["admin","commander"].includes(String(user.role||"").toLowerCase()) || /^(E|C|DIV|B|CHIEF|COM)-/i.test(String(user.callsign||""));
}
function notificationVisible(row,user) {
  if(row.kind==="request") return ["admin","commander"].includes(String(user.role||""));
  if(row.kind==="inactive") return isCommandRank(user);
  if(row.kind!=="eligible") return false;
  return ["admin","commander"].includes(String(user.role||"")) || isCommandRank(user) || ["AEMT","Senior Volunteer"].includes(String(row.target_rank||""));
}
async function refreshD1Notifications(db,user) {
  const rows=(await db.prepare("SELECT * FROM members").all()).results||[];
  const stateRows=(await db.prepare("SELECT state_key,state_value FROM notification_state").all()).results||[];
  const state=new Map(stateRows.map(row=>[row.state_key,row.state_value]));
  const additions=[],now=new Date().toISOString();
  for(const member of rows) {
    const eligible=rankEligibility(memberFromRow(member));
    if(eligible.eligible&&eligible.next_rank) additions.push({kind:"eligible",eventKey:"eligible:"+member.callsign+":"+eligible.next_rank,title:"New eligible promotion",message:member.name+" ("+member.callsign+") is eligible for "+eligible.next_rank+".",callsign:member.callsign,targetRank:eligible.next_rank,stateKey:"eligible:"+member.callsign,stateValue:eligible.next_rank});
  }
  const command=isCommandRank(user);
  if(command) for(const member of rows) if(member.activity==="Can Be Terminated") additions.push({kind:"inactive",eventKey:"inactive:"+member.callsign,title:"Can Be Terminated",message:member.name+" ("+member.callsign+") is marked Can Be Terminated.",callsign:member.callsign,targetRank:"",stateKey:"inactive:"+member.callsign,stateValue:"1"});
  if(["admin","commander"].includes(String(user.role||""))) {
    const pending=(await db.prepare("SELECT account_id,name,callsign,created_at FROM accounts WHERE status='pending'").all()).results||[];
    for(const account of pending) additions.push({kind:"request",eventKey:"request:"+account.account_id,title:"New account request",message:(account.name||"New account")+" requested an account.",callsign:account.callsign||"",targetRank:"",stateKey:"request:"+account.account_id,stateValue:"1",createdAt:account.created_at});
  }
  const statements=[];
  for(const item of additions) {
    const seeded=state.has(item.stateKey);
    const isEligible=item.kind==="eligible";
    const shouldNotify=isEligible ? state.get(item.stateKey)!==item.stateValue
      : item.kind==="request" ? !state.has(item.stateKey)
      : item.kind==="inactive" && state.has("inactive_seeded") && !state.has(item.stateKey);
    if(shouldNotify) {
      statements.push(db.prepare("INSERT OR IGNORE INTO notifications(kind,event_key,title,message,callsign,target_rank,created_at) VALUES(?,?,?,?,?,?,?)")
        .bind(item.kind,item.eventKey,item.title,item.message,item.callsign,item.targetRank,item.createdAt||now));
    }
    state.set(item.stateKey,item.stateValue);
  }
  for(const key of [...state.keys()]) {
    if(key.startsWith("eligible:")&&!additions.some(item=>item.stateKey===key)) state.delete(key);
    if(command&&key.startsWith("inactive:")&&!additions.some(item=>item.stateKey===key)) state.delete(key);
  }
  if(!state.has("eligibility_seeded")) state.set("eligibility_seeded","1");
  if(command&&!state.has("inactive_seeded")) state.set("inactive_seeded","1");
  if(statements.length) await db.batch(statements);
  const lastState=(await db.prepare("SELECT state_key FROM notification_state").all()).results||[];
  const existing=new Set(lastState.map(row=>row.state_key));
  const writes=[];
  for(const key of existing) if(!state.has(key)) writes.push(db.prepare("DELETE FROM notification_state WHERE state_key=?").bind(key));
  for(const [key,value] of state) writes.push(db.prepare("INSERT INTO notification_state(state_key,state_value) VALUES(?,?) ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value").bind(key,value));
  if(writes.length) await db.batch(writes);
}
async function writeOperationalLog(db,old,route,data,result,user) {
  const now=new Date().toISOString(), callsign=String(old.callsign||data.callsign||"");
  let kind="",action="",details="",newRank="",newCallsign="";
  if(route==="/api/activity") { kind="activity"; action="Activity Changed"; details=String(old.activity||"")+" -> "+String(data.activity||""); }
  else if(route==="/api/note") { kind="note"; action=String(data.action||"").toUpperCase(); details=String(result.note||"")||"Deleted"; }
  else if(route==="/api/date") { kind="date"; action="Rank Date Changed"; details=String(data.date_str||""); }
  else if(route==="/api/training") { kind="training"; action=data.remove?"REMOVED":"ADDED"; details=String(data.training||""); }
  else if(route==="/api/exam") { kind="exam"; action=data.remove?"REMOVED":"ADDED"; details="Supervisor Exam"; }
  else if(route==="/api/do-not-promote") { kind="activity"; action=data.blocked?"Do Not Promote Added":"Do Not Promote Removed"; details=action; }
  else if(route==="/api/terminate") { kind="termination"; action="Terminated"; details=String(data.note||""); }
  else if(route==="/api/member/"+callsign+"/instructor") { kind="instructor"; const type=String(data.instructor_type||"").toUpperCase(); action=type+" Instructor "+(data.assigned?"Assigned":"Removed"); details=type; }
  else if(route==="/api/change-callsign") { kind="callsign"; action="Callsign Changed"; newCallsign=String(result.new_callsign||data.new_callsign||""); newRank=String(result.new_rank||old.rank||""); }
  else if(["/api/promote","/api/force-promote","/api/demote","/api/change-rank"].includes(route)) { kind="promotion"; action=route==="/api/demote"?"Demoted":route==="/api/change-rank"?"Rank Changed":"Promoted"; newCallsign=String(result.new_callsign||""); newRank=String(result.new_rank||""); }
  if(!kind) return;
  if(!newCallsign) newCallsign=callsign;
  await db.prepare(`INSERT INTO operational_logs(kind,log_date,callsign,member_name,action,details,changed_by,old_rank,new_rank,old_callsign,new_callsign)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(kind,now,callsign,String(old.name||""),action,details,String(user.name||""),String(old.rank||""),newRank||String(old.rank||""),kind==="callsign"||kind==="promotion"?callsign:"",kind==="callsign"||kind==="promotion"?newCallsign:"").run();
}

export async function handleD1(context) {
  const { request, env } = context, url = new URL(request.url), route = url.pathname, method=request.method;
  const db=env.LVFR_DB;
  try {
    if (!db) return json({ detail:"LVFR_DB D1 binding is missing." },503);
    let data={}; if(!["GET","HEAD"].includes(method)) data=await request.json().catch(()=>({}));
    if (route === "/internal/members/sync" && method === "POST") {
      const expected=String(env.LVFR_D1_WORKER_SECRET||"");
      if(!expected || request.headers.get("X-LVFR-Worker-Secret") !== expected) return json({detail:"Worker authentication failed."},403);
      if(!Array.isArray(data.members)) return json({detail:"Members payload is invalid."},400);
      if(data.members.length===0) return json({detail:"Roster replacement stopped because the Google Sheet returned no members. D1 was not changed."},400);
      const result=await replaceMembers(db,data.members);
      if(data.callsign_slots||data.available_callsigns) await saveCallsignSlots(db,data.callsign_slots||data.available_callsigns);
      return json(result);
    }
    if(route==="/internal/training-hours/import" && method==="POST") {
      const expected=String(env.LVFR_D1_WORKER_SECRET||"");
      if(!expected || request.headers.get("X-LVFR-Worker-Secret")!==expected) return json({detail:"Worker authentication failed."},403);
      if(!Array.isArray(data.records)) return json({detail:"Training Hours payload is invalid."},400);
      const timestamp=new Date().toISOString();
      const today=new Intl.DateTimeFormat("en-US",{timeZone:"UTC",month:"2-digit",day:"2-digit",year:"numeric"}).format(new Date());
      // Two reads, then one batch containing only rows that actually changed.
      const memberRows=(await db.prepare("SELECT callsign,name FROM members").all()).results||[];
      const memberByCallsign=new Map(memberRows.map(row=>[String(row.callsign||"").toUpperCase(),row]));
      const existingRows=(await db.prepare("SELECT id,source_row,callsign,name,training_date,time FROM training_hours").all()).results||[];
      const bySourceRow=new Map(), legacyRows=[];
      for(const row of existingRows) { if(row.source_row!==null&&row.source_row!==undefined) bySourceRow.set(Number(row.source_row),row); else legacyRows.push(row); }
      const liveSourceRows=new Set(), statements=[]; let imported=0, skipped=0, unchanged=0;
      for(const record of data.records) {
        const sourceRow=Number(record.source_row)||null;
        // A Sheet row that exists but cannot be matched right now is still "live":
        // never let it be deleted as stale.
        if(sourceRow) liveSourceRows.add(sourceRow);
        const callsign=String(record.callsign||"").trim().toUpperCase(), time=String(record.time||"").trim();
        const member=memberByCallsign.get(callsign);
        if(!callsign||!time||!member) { skipped++; continue; }
        const trainingDate=String(record.date||"").trim()||today;
        let target=sourceRow?bySourceRow.get(sourceRow):null;
        if(sourceRow&&!target) {
          const index=legacyRows.findIndex(row=>String(row.callsign||"").toUpperCase()===member.callsign&&row.training_date===trainingDate&&row.time===time);
          if(index>=0) target=legacyRows.splice(index,1)[0];
        }
        imported++;
        if(target&&target.callsign===member.callsign&&target.name===member.name&&target.training_date===trainingDate&&target.time===time&&Number(target.source_row)===sourceRow) { unchanged++; continue; }
        if(target) statements.push(db.prepare("UPDATE training_hours SET source_row=?,callsign=?,name=?,training_date=?,time=?,updated_at=?,updated_by=? WHERE id=?")
          .bind(sourceRow,member.callsign,member.name,trainingDate,time,timestamp,"Sheet sync",target.id));
        else statements.push(db.prepare("INSERT INTO training_hours(source_row,callsign,name,training_date,time,updated_at,updated_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_row) DO UPDATE SET callsign=excluded.callsign,name=excluded.name,training_date=excluded.training_date,time=excluded.time,updated_at=excluded.updated_at,updated_by=excluded.updated_by")
          .bind(sourceRow,member.callsign,member.name,trainingDate,time,timestamp,"Sheet sync"));
      }
      if(data.reconcile===true) {
        for(const row of existingRows) {
          if(row.source_row!==null&&row.source_row!==undefined&&!liveSourceRows.has(Number(row.source_row))) statements.push(db.prepare("DELETE FROM training_hours WHERE id=?").bind(row.id));
        }
      }
      for(let index=0;index<statements.length;index+=50) await db.batch(statements.slice(index,index+50));
      return json({ok:true,imported,skipped,unchanged,written:statements.length});
    }
    if(route==="/internal/loi/import" && method==="POST") {
      const expected=String(env.LVFR_D1_WORKER_SECRET||"");
      if(!expected || request.headers.get("X-LVFR-Worker-Secret")!==expected) return json({detail:"Worker authentication failed."},403);
      if(!Array.isArray(data.records)) return json({detail:"LOI payload is invalid."},400);
      const members=(await db.prepare("SELECT callsign,name FROM members").all()).results||[];
      const byCallsign=new Map(members.map(row=>[String(row.callsign||"").trim().toUpperCase(),row]));
      const byName=new Map();
      for(const member of members) {
        const key=nameKey(member.name);
        if(byName.has(key)) byName.set(key,null); else byName.set(key,member);
      }
      const timestamp=new Date().toISOString(), seenSourceRows=new Set(), recordsByKey=new Map(), recordsBySourceRow=new Map();
      let skipped=0; const unmatched=[];
      for(const raw of data.records) {
        const type=String(raw?.type||"").trim().toUpperCase();
        const name=String(raw?.name||"").trim().replace(/\s+/g," ");
        const callsign=String(raw?.callsign||"").trim().toUpperCase();
        const member=(callsign&&byCallsign.get(callsign))||byName.get(nameKey(name));
        const sourceRow=Number(raw?.source_row)||null;
        if(sourceRow) seenSourceRows.add(`${type}:${sourceRow}`);
        if(!["HERT","FORT"].includes(type)||!name||!member) { skipped++; if(name) unmatched.push(`${type} row ${sourceRow||"?"}: ${name}`); continue; }
        // The Sheet may show the percentage as "85", "85%" or "85.0". An unreadable value
        // keeps the person on the list with a blank percentage instead of dropping them.
        const rawPercent=raw?.test_percent;
        const cleaned=rawPercent==null?"":String(rawPercent).replace(/[%\s]/g,"").replace(",",".");
        let percent=cleaned===""?null:Number(cleaned);
        if(percent!==null&&(!Number.isFinite(percent)||percent<0||percent>100)) percent=null;
        const record={type,callsign:member.callsign,name:member.name,test_percent:type==="FORT"?percent:null,source_row:sourceRow};
        recordsByKey.set(`${type}:${member.callsign}`,record);
        if(sourceRow) recordsBySourceRow.set(`${type}:${sourceRow}`,record);
      }
      const existing=(await db.prepare("SELECT id,type,callsign,source_row FROM loi_entries").all()).results||[];
      const statements=[];
      for(const row of existing) {
        if(row.source_row===null||row.source_row===undefined) continue;
        const incoming=recordsBySourceRow.get(`${row.type}:${Number(row.source_row)}`);
        if(incoming&&incoming.callsign!==row.callsign) statements.push(db.prepare("DELETE FROM loi_entries WHERE id=?").bind(row.id));
      }
      for(const record of recordsByKey.values()) statements.push(db.prepare(`INSERT INTO loi_entries(type,callsign,name,test_percent,source_row,updated_at,updated_by)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(type,callsign) DO UPDATE SET name=excluded.name,test_percent=excluded.test_percent,source_row=excluded.source_row,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
        .bind(record.type,record.callsign,record.name,record.test_percent,record.source_row,timestamp,"Sheet sync"));
      if(data.reconcile===true&&skipped===0) {
        for(const row of existing) if(row.source_row!==null&&row.source_row!==undefined&&
          !seenSourceRows.has(`${row.type}:${Number(row.source_row)}`)&&!recordsByKey.has(`${row.type}:${row.callsign}`)) {
          statements.push(db.prepare("DELETE FROM loi_entries WHERE id=?").bind(row.id));
        }
      }
      for(let i=0;i<statements.length;i+=50) await db.batch(statements.slice(i,i+50));
      return json({ok:true,imported:recordsByKey.size,skipped,written:statements.length,unmatched});
    }
    if(route==="/internal/logs/import" && method==="POST") {
      const expected=String(env.LVFR_D1_WORKER_SECRET||"");
      if(!expected || request.headers.get("X-LVFR-Worker-Secret")!==expected) return json({detail:"Worker authentication failed."},403);
      const statements=[];
      // Full Sync sends this flag on its first batch only: the Sheet is treated as
      // the source of truth, so logs deleted from D1 come back and stale D1-only
      // rows are dropped. Ordinary imports keep INSERT OR IGNORE behaviour.
      if(data.replace_operational_logs===true) statements.push(db.prepare("DELETE FROM operational_logs"));
      for(const row of (Array.isArray(data.operational_logs)?data.operational_logs:[])) statements.push(db.prepare(`INSERT OR IGNORE INTO operational_logs(source_key,kind,log_date,callsign,member_name,action,details,changed_by,old_rank,new_rank,old_callsign,new_callsign)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(String(row.source_key||""),String(row.kind||""),String(row.log_date||""),String(row.callsign||""),String(row.member_name||""),String(row.action||""),String(row.details||""),String(row.changed_by||""),String(row.old_rank||""),String(row.new_rank||""),String(row.old_callsign||""),String(row.new_callsign||"")));
      for(const row of (Array.isArray(data.account_audit)?data.account_audit:[])) statements.push(db.prepare("INSERT OR IGNORE INTO account_audit(source_key,created_at,account_id,name,callsign,action,actor_name) VALUES(?,?,?,?,?,?,?)")
        .bind(String(row.source_key||""),String(row.created_at||""),String(row.account_id||""),String(row.name||""),String(row.callsign||""),String(row.action||""),String(row.actor_name||"")));
      for(const row of (Array.isArray(data.notifications)?data.notifications:[])) statements.push(db.prepare("INSERT OR IGNORE INTO notifications(kind,event_key,title,message,callsign,target_rank,created_at) VALUES(?,?,?,?,?,?,?)")
        .bind(String(row.kind||""),String(row.event_key||("legacy-sheet:"+String(row.id||""))),String(row.title||""),String(row.message||""),String(row.callsign||""),String(row.target_rank||""),String(row.created_at||new Date().toISOString())));
      for(let i=0;i<statements.length;i+=50) await db.batch(statements.slice(i,i+50));
      const reads=Array.isArray(data.notification_reads)?data.notification_reads:[];
      for(const row of reads) {
        const key=String(row.event_key||("legacy-sheet:"+String(row.notification_id||"")));
        const id=await db.prepare("SELECT id FROM notifications WHERE event_key=?").bind(key).first();
        if(id&&row.account_id) await db.prepare("INSERT OR IGNORE INTO notification_reads(account_id,notification_id,read_at) VALUES(?,?,?)").bind(String(row.account_id),id.id,String(row.read_at||new Date().toISOString())).run();
      }
      for(const row of (Array.isArray(data.notification_state)?data.notification_state:[])) await db.prepare("INSERT INTO notification_state(state_key,state_value) VALUES(?,?) ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value").bind(String(row.key||""),String(row.value||"")).run();
      return json({ok:true,operational_logs:(data.operational_logs||[]).length,account_audit:(data.account_audit||[]).length,notifications:(data.notifications||[]).length});
    }
    const session=await accountForRequest(db,request), token=session.token, authRoute=route.startsWith("/auth/");
    if (route==="/api/health" && method==="GET") return json({ok:true,backend:"Cloudflare D1",auth_store:"D1"});
    if (route==="/auth/signup" && method==="POST") return json(await signup(db,env,data));
    if (route==="/auth/login" && method==="POST") {
      const result = await login(db,data);
      return json({ token:result.token, user:result.user },200,{ "Set-Cookie":`lvfr_d1_session=${encodeURIComponent(result.token)}; Path=/; Max-Age=${result.max_age}; HttpOnly; Secure; SameSite=Lax` });
    }
    if (route==="/auth/logout" && method==="POST") {
      for (const candidate of sessionTokens(request)) await db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").bind(await sha256(candidate)).run();
      return json({ok:true},200,{ "Set-Cookie":"lvfr_d1_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" });
    }
    if (route==="/auth/me" && method==="GET") {
      const a=session.account;
      if(!a) return json({detail:token ? "Session token was not found or has expired in D1." : "No session token or login cookie reached the API."},401);
      return json(await publicUser(db,a));
    }
    const signupStatus = route.match(/^\/auth\/signup-status\/([^/]+)$/);
    if (signupStatus && method==="GET") {
      const account = await db.prepare("SELECT status FROM accounts WHERE account_id=?").bind(decodeURIComponent(signupStatus[1])).first();
      if (!account) return json({detail:"Signup request was not found."},404);
      if (account.status === "pending") return json({status:"saved"});
      if (account.status === "approved") return json({status:"approved"});
      return json({status:"failed",error: account.status === "denied" ? "A Commander denied the account request." : "This account request is no longer active."});
    }
    if (route==="/auth/bootstrap-commander" && method==="POST") return json(await bootstrapCommander(db,env,request,data));
    const user=session.account;
    if(!token) return json({detail:"No session token or login cookie reached the API."},401);
    if(!user) return json({detail:"Session token was not found or has expired in D1."},401);
    if(user.status!=="approved") return json({detail:"This D1 account is not approved."},401);
    user.permissions=await accountPermissions(db,user);
    const individualPermissionRoute=route.match(/^\/api\/leaders\/([^/]+)\/permissions$/);
    if(individualPermissionRoute&&(method==="GET"||method==="POST")) {
      const actor=await requireOperation(db,token), id=decodeURIComponent(individualPermissionRoute[1]);
      const target=await db.prepare("SELECT account_id,name,role,permissions_override_json FROM accounts WHERE account_id=?").bind(id).first();
      if(!target||target.role==="admin") throw Object.assign(new Error("That account's permissions cannot be changed."),{status:404});
      const defaults=await rolePermissions(db,target.role);
      if(method==="GET") return json({account_id:id,role:target.role,defaults,overrides:expandLegacyPermissionOverrides(parsePermissionOverrides(target.permissions_override_json))});
      const overrides=data.reset===true?{}:expandLegacyPermissionOverrides(parsePermissionOverrides(JSON.stringify(data.overrides||{})));
      const now=new Date().toISOString();
      await db.prepare("UPDATE accounts SET permissions_override_json=?,updated_at=? WHERE account_id=?").bind(JSON.stringify(overrides),now,id).run();
      await appendAudit(db,{account_id:id,name:target.name,callsign:target.callsign||""},data.reset===true?"Reset individual permissions":"Updated individual permissions",actor.name);
      return json({ok:true,account_id:id,role:target.role,defaults,overrides,permissions:Object.fromEntries(ROLE_PERMISSION_KEYS.map(key=>[key,Object.hasOwn(overrides,key)?overrides[key]:defaults[key]]))});
    }
    if(route==="/api/role-permissions"&&method==="GET") {
      const actor=session.account;
      requireRoleProfileManager(actor);
      const rows=(await db.prepare("SELECT role FROM role_permissions ORDER BY role").all()).results||[];
      const roles=new Set(["member","leader","commander",...rows.map(row=>String(row.role||"").toLowerCase())]);
      const profiles={}, effective=await accountPermissions(db,actor);
      const visibleKeys=actor.role==="admin"?ROLE_PERMISSION_KEYS:ROLE_PERMISSION_KEYS.filter(key=>effective[key]===true);
      for(const role of roles) if(role!=="admin"&&role!==actor.role) {
        const profile=await rolePermissions(db,role);
        profiles[role]=Object.fromEntries(visibleKeys.map(key=>[key,Boolean(profile[key])]));
      }
      return json({profiles,keys:visibleKeys,actor_permissions:Object.fromEntries(visibleKeys.map(key=>[key,true]))});
    }
    if(route==="/api/role-permissions"&&method==="POST") {
      const actor=session.account, role=String(data.role||"").toLowerCase();
      requireRoleProfileManager(actor);
      if(!/^[a-z][a-z0-9_-]{1,31}$/.test(role)||role==="admin") throw Object.assign(new Error("Choose a valid role name."),{status:400});
      if(role===actor.role) throw Object.assign(new Error("You cannot edit the permission profile for your own role."),{status:403});
      const incoming={...(data.permissions&&typeof data.permissions==="object"?data.permissions:{})};
      // Parent list permissions are aggregate UI controls; only child capabilities
      // are authoritative so a partial profile can never inherit the whole list.
      delete incoming.logs_view; delete incoming.training_view;
      let permissions=Object.fromEntries(ROLE_PERMISSION_KEYS.map(key=>[key,Boolean(incoming[key])]));
      const effective=await accountPermissions(db,actor);
      if(actor.role!=="admin") {
        const current=await rolePermissions(db,role);
        const attemptedChange=ROLE_PERMISSION_KEYS.find(key=>!effective[key]&&Object.hasOwn(incoming,key)&&Boolean(incoming[key])!==Boolean(current[key]));
        if(attemptedChange) throw Object.assign(new Error("You cannot change a permission that you do not have."),{status:403});
        permissions={...current};
        for(const key of ROLE_PERMISSION_KEYS) if(effective[key]===true&&Object.hasOwn(incoming,key)) permissions[key]=Boolean(incoming[key]);
      }
      permissions.logs_view=LOG_VIEW_PERMISSIONS.every(key=>permissions[key]===true);
      permissions.training_view=TRAINING_VIEW_PERMISSIONS.every(key=>permissions[key]===true);
      const now=new Date().toISOString();
      await db.prepare(`INSERT INTO role_permissions(role,permissions_json,updated_at,updated_by) VALUES(?,?,?,?)
        ON CONFLICT(role) DO UPDATE SET permissions_json=excluded.permissions_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
        .bind(role,JSON.stringify(permissions),now,actor.name).run();
      // A role-level revocation must also remove conflicting personal grants;
      // otherwise account overrides would keep the revoked capability active.
      const affected=(await db.prepare("SELECT account_id,permissions_override_json FROM accounts WHERE role=? AND permissions_override_json!='{}'").bind(role).all()).results||[];
      const revocations=affected.map(account=>{
        const overrides=parsePermissionOverrides(account.permissions_override_json);
        let changed=false;
        for(const key of ROLE_PERMISSION_KEYS) if(permissions[key]===false&&Object.hasOwn(overrides,key)) { delete overrides[key]; changed=true; }
        return changed?db.prepare("UPDATE accounts SET permissions_override_json=?,updated_at=? WHERE account_id=?").bind(JSON.stringify(overrides),now,account.account_id):null;
      }).filter(Boolean);
      if(revocations.length) await db.batch(revocations);
      await appendAudit(db,{account_id:"role:"+role,name:role,callsign:""},"Updated role permissions",actor.name);
      const responsePermissions=actor.role==="admin"?permissions:Object.fromEntries(ROLE_PERMISSION_KEYS.filter(key=>effective[key]===true).map(key=>[key,permissions[key]]));
      return json({ok:true,role,permissions:responsePermissions,updated_at:now,updated_by:actor.name});
    }
    requireRolePermission(user,user.permissions,permissionForRequest(route,method,{...data,log_type:data.log_type||url.searchParams.get("log_type")}));
    if(route==="/api/notifications" && method==="GET") {
      await refreshD1Notifications(db,user);
      const recent=(await db.prepare("SELECT n.id,n.kind,n.title,n.message,n.callsign,n.target_rank,n.created_at,CASE WHEN r.notification_id IS NULL THEN 0 ELSE 1 END AS is_read FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.account_id=? ORDER BY n.id DESC LIMIT 250").bind(user.account_id).all()).results||[];
      const items=recent.filter(item=>notificationVisible(item,user)).slice(0,100);
      const response=json({items,unread_count:items.filter(item=>!Number(item.is_read)).length});
      // Keep the legacy notification sheet in sync without delaying the D1 response.
      if(env.LVFR_D1_AUTH_BRIDGE_SECRET) {
        const assertion=await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET);
        const {proxyToAppsScript}=await import("../[[path]].js");
        context.waitUntil((async()=>{try{const mirror=await proxyToAppsScript(context,route,url,assertion,{});if(!mirror.ok)console.error("Notification Sheet mirror failed:",await mirror.text());}catch(error){console.error("Notification Sheet mirror failed:",error);}})());
      }
      return response;
    }
    if(route==="/api/notifications/read" && method==="POST") {
      const requested=Array.isArray(data.ids)?[...new Set(data.ids.map(value=>Number(value)).filter(Number.isSafeInteger))]:[];
      const now=new Date().toISOString();
      if(requested.length) await db.batch(requested.map(id=>db.prepare("INSERT OR IGNORE INTO notification_reads(account_id,notification_id,read_at) VALUES(?,?,?)").bind(user.account_id,id,now)));
      else await db.prepare("INSERT OR IGNORE INTO notification_reads(account_id,notification_id,read_at) SELECT ?,id,? FROM notifications").bind(user.account_id,now).run();
      if(env.LVFR_D1_AUTH_BRIDGE_SECRET) {
        const assertion=await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET), {proxyToAppsScript}=await import("../[[path]].js");
        context.waitUntil((async()=>{try{const mirror=await proxyToAppsScript(context,route,url,assertion,data);if(!mirror.ok)console.error("Notification read Sheet mirror failed:",await mirror.text());}catch(error){console.error("Notification read Sheet mirror failed:",error);}})());
      }
      return json({ok:true});
    }
    if(route==="/api/notifications/clear" && method==="POST") {
      const assertion=env.LVFR_D1_AUTH_BRIDGE_SECRET?await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET):"";
      const {proxyToAppsScript}=await import("../[[path]].js");
      const sheetMirror=await proxyToAppsScript(context,"/internal/notifications/clear",url,assertion,{});
      const mirrorResult=await sheetMirror.json().catch(()=>({}));
      if(!sheetMirror.ok||mirrorResult.ok!==true) throw Object.assign(new Error("Could not clear notifications from the Google Sheet: "+String(mirrorResult.detail||mirrorResult.error||"mirror failed")),{status:502});
      await db.batch([db.prepare("DELETE FROM notification_reads"),db.prepare("DELETE FROM notifications")]);
      return json({ok:true,cleared:true});
    }
    if(route==="/api/members-log/clear" && method==="POST") {
      requireRolePermission(user,user.permissions,"logs_delete_d1");
      const kind=String(data.log_type||"").trim().toLowerCase();
      const allowed=["promotion","callsign","termination","training","training_time","loi","exam","note","activity","instructor"];
      if(!allowed.includes(kind)) throw new Error("Choose a valid log category.");
      if(kind==="training_time") await db.prepare("DELETE FROM training_hours_log").run();
      else await db.prepare("DELETE FROM operational_logs WHERE kind=?").bind(kind).run();
      return json({ok:true,kind});
    }
    if(route==="/api/logs/clean" && method==="POST") {
      const allowed=["promotion","callsign","termination","training","training_time","loi","exam","note","activity","instructor","account_audit","notifications"];
      const selected=[...new Set((Array.isArray(data.items)?data.items:[]).map(value=>String(value||"").trim().toLowerCase()))];
      const kinds=selected.includes("all")?allowed:selected;
      if(!kinds.length||kinds.some(kind=>!allowed.includes(kind))) throw Object.assign(new Error("Choose valid log categories."),{status:400});
      const assertion=env.LVFR_D1_AUTH_BRIDGE_SECRET?await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET):"";
      const {proxyToAppsScript}=await import("../[[path]].js");
      const mirror=await proxyToAppsScript(context,"/internal/logs/clear",url,assertion,{items:kinds});
      const mirrorResult=await mirror.json().catch(()=>({}));
      if(!mirror.ok||mirrorResult.ok!==true) throw Object.assign(new Error("Google Sheets cleanup failed: "+String(mirrorResult.detail||mirrorResult.error||"mirror failed")),{status:502});
      const statements=[];
      for(const kind of kinds) {
        if(kind==="notifications") statements.push(db.prepare("DELETE FROM notification_reads"),db.prepare("DELETE FROM notifications"));
        else if(kind==="account_audit") statements.push(db.prepare("DELETE FROM account_audit"));
        else if(kind==="training_time") statements.push(db.prepare("DELETE FROM training_hours_log"));
        else statements.push(db.prepare("DELETE FROM operational_logs WHERE kind=?").bind(kind));
      }
      if(statements.length) await db.batch(statements);
      return json({ok:true,items:kinds});
    }
    const directLogKind={"/api/promotions":"promotion","/api/training-log":"training","/api/exam-log":"exam","/api/termination-log":"termination"}[route];
    if((route==="/api/members-log"||directLogKind) && method==="GET") {
      const kind=directLogKind||String(url.searchParams.get("log_type")||"promotion").toLowerCase();
      const allowed=["promotion","callsign","termination","training","training_time","loi","exam","note","activity","instructor"];
      if(!allowed.includes(kind)) throw Object.assign(new Error("Invalid log type: "+kind),{status:400});
      if(kind==="training_time") {
        const rows=await db.prepare("SELECT id,log_date,callsign,member_name,action,previous_time,new_time,changed_by FROM training_hours_log ORDER BY id DESC LIMIT 200").all();
        return json(rows.results||[]);
      }
      const rows=await db.prepare("SELECT id,kind,log_date,callsign,member_name,action,details,changed_by,old_rank,new_rank,old_callsign,new_callsign FROM operational_logs WHERE kind=? ORDER BY id DESC LIMIT 200").bind(kind).all();
      return json((rows.results||[]).map(row=>({ ...row,
        ...(kind==="training"?{training_name:row.details}:{}),
        ...(kind==="loi"?(()=>{let details={};try{details=JSON.parse(row.details||"{}")}catch{}return {loi_type:details.loi_type||"",test_percent:details.test_percent??""}})():{}),
        ...(kind==="exam"?{exam_name:row.details}:{}),
        ...(kind==="note"?{note:row.details}:{}),
        ...(kind==="instructor"?{instructor_type:row.details}:{}),
        ...(kind==="activity"?{old_status:String(row.details||"").split(" -> ")[0]||"",new_status:String(row.details||"").split(" -> ")[1]||"",changed_at:row.log_date}:{}),
        ...(kind==="termination"?{termination_date:row.log_date,rank:row.old_rank,terminated_by:row.changed_by,reason:row.details}:{}),
        ...(["promotion","callsign"].includes(kind)?{promo_date:row.log_date,promoted_by:row.changed_by}:{}),
      })));
    }
    if(route==="/api/leaders/audit/clear" && method==="POST") {
      await requireAdmin(db,token);
      await db.prepare("DELETE FROM account_audit").run();
      return json({ok:true});
    }
    if(route==="/api/loi" && (method==="GET"||method==="POST")) {
      if(method==="GET") {
        const rows=(await db.prepare("SELECT id,type,callsign,name,test_percent,source_row FROM loi_entries ORDER BY name COLLATE NOCASE,id").all()).results||[];
        return json({hert:user.permissions.hert_loi_view||user.permissions.loi_manage?rows.filter(row=>row.type==="HERT").map(row=>({...row,row:row.id})):[],fort:user.permissions.fort_loi_view||user.permissions.loi_manage?rows.filter(row=>row.type==="FORT").map(row=>({...row,row:row.id})):[]});
      }
      const action=String(data.action||"").toLowerCase(), type=String(data.type||"").toUpperCase();
      if(!["add","passed","failed"].includes(action)||!["HERT","FORT"].includes(type)) throw new Error("Choose a valid LOI action and type.");
      const callsign=String(data.callsign||"").trim().toUpperCase();
      const member=await db.prepare("SELECT callsign,name FROM members WHERE upper(callsign)=upper(?)").bind(callsign).first();
      if(!member) throw new Error("Choose a current roster member.");
      const rawPercent=data.test_percent;
      const percent=rawPercent==null||String(rawPercent).trim()===""?null:Number(rawPercent);
      if(action==="add"&&type==="FORT"&&(!Number.isFinite(percent)||percent<0||percent>100)) throw new Error("FORT LOI % on test must be a number from 0 to 100.");
      let entryId=Number(data.row)||0, previous=null;
      if(action==="add") {
        const saved=await db.prepare("INSERT INTO loi_entries(type,callsign,name,test_percent,source_row,updated_at,updated_by) VALUES(?,?,?,?,NULL,?,?) ON CONFLICT(type,callsign) DO NOTHING RETURNING id")
          .bind(type,member.callsign,member.name,type==="FORT"?percent:null,new Date().toISOString(),String(user.name||"")).first();
        if(!saved) throw new Error(member.name+" is already on the "+type+" LOI list.");
        entryId=Number(saved.id);
      } else {
        previous=entryId
          ? await db.prepare("SELECT id,type,callsign,name,test_percent,source_row FROM loi_entries WHERE id=?").bind(entryId).first()
          : await db.prepare("SELECT id,type,callsign,name,test_percent,source_row FROM loi_entries WHERE type=? AND upper(callsign)=upper(?)").bind(type,member.callsign).first();
        if(!previous||previous.type!==type||previous.callsign!==member.callsign) throw new Error("This "+type+" LOI entry has changed. Refresh the list and try again.");
        await db.prepare("DELETE FROM loi_entries WHERE id=?").bind(previous.id).run();
        entryId=Number(previous.id);
      }
      const eventAction=action==="add"?"Added":action==="passed"?"Passed":"Failed";
      const testPercent=type==="FORT"?(action==="add"?percent:(previous.test_percent==null?"":Number(previous.test_percent))):null;
      const logDate=new Date().toISOString(), details=JSON.stringify({loi_type:type,test_percent:testPercent});
      await db.prepare("INSERT INTO operational_logs(kind,log_date,callsign,member_name,action,details,changed_by) VALUES('loi',?,?,?,?,?,?)")
        .bind(logDate,member.callsign,member.name,eventAction,details,String(user.name||"")).run();
      const {proxyToAppsScript}=await import("../[[path]].js");
      const mirrorData={type,action,name:member.name,callsign:member.callsign,test_percent:testPercent,source_row:previous?.source_row||null};
      const sheetAssertion=env.LVFR_D1_AUTH_BRIDGE_SECRET?await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET):"";
      const logAssertion=env.LVFR_D1_AUTH_BRIDGE_SECRET?await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET):"";
      let sheetSynced=true, sheetSyncError="";
      try {
        const mirror=await proxyToAppsScript(context,"/internal/loi",url,sheetAssertion,mirrorData);
        if(!mirror.ok) {
          const failure=await mirror.json().catch(()=>({}));
          sheetSynced=false; sheetSyncError=String(failure.detail||"Apps Script rejected the LOI update.");
          console.error("LOI Sheet mirror failed:",sheetSyncError);
        } else if(action==="add") {
          const synced=await mirror.json().catch(()=>({}));
          if(Number(synced.row)>0) await db.prepare("UPDATE loi_entries SET source_row=? WHERE id=?").bind(Number(synced.row),entryId).run();
        }
      } catch(error) { sheetSynced=false; sheetSyncError=String(error?.message||error); console.error("LOI Sheet mirror failed:",error); }
      context.waitUntil((async()=>{
        try {
          const mirror=await proxyToAppsScript(context,"/internal/logs/mirror",url,logAssertion,{kind:"loi",log_date:logDate,callsign:member.callsign,member_name:member.name,action:eventAction,details,changed_by:String(user.name||"")});
          if(!mirror.ok) console.error("LOI log Sheet mirror failed:",await mirror.text());
        } catch(error) { console.error("LOI log Sheet mirror failed:",error); }
      })());
      return json({ok:true,changed:true,id:entryId,row:entryId,type,name:member.name,callsign:member.callsign,test_percent:testPercent,action:eventAction,sheet_synced:sheetSynced,sheet_sync_error:sheetSyncError});
    }
    if(route==="/api/training-hours" && method==="GET") {
      const result=await db.prepare("SELECT h.id,h.source_row,h.callsign,h.name,h.training_date AS date,h.time,m.rank FROM training_hours h LEFT JOIN members m ON upper(m.callsign)=upper(h.callsign) ORDER BY lower(h.name),h.callsign,h.training_date,h.id").all();
      return json(result.results||[]);
    }
    if(route==="/api/training-hours" && method==="POST") {
      const action=String(data.action||"").trim().toLowerCase();
      const callsign=String(data.callsign||"").trim().toUpperCase();
      if(!callsign) throw new Error("Choose a roster member.");
      const member=await db.prepare("SELECT callsign,name FROM members WHERE upper(callsign)=upper(?)").bind(callsign).first();
      if(!member) throw Object.assign(new Error("Member was not found on the current roster."),{status:404});
      const recordId=Number(data.id)||0;
      const existing=recordId?await db.prepare("SELECT id,source_row,callsign,name,training_date,time FROM training_hours WHERE id=?").bind(recordId).first():null;
      if(action!=="add"&&!existing) throw Object.assign(new Error("Training Hours record was not found."),{status:404});
      if(existing&&existing.callsign!==member.callsign) throw Object.assign(new Error("Training Hours record does not belong to this member."),{status:400});
      const previousTime=String(existing?.time||"");
      const time=String(data.time||"").trim();
      if(action==="add") {
        if(!time) throw new Error("Enter a training time.");
      } else if(action==="time") {
        if(!time) throw new Error("Enter a training time.");
        if(previousTime===time) return json({ok:true,changed:false,message:"Time is already set."});
      } else if(action!=="remove") throw new Error("Choose Add, Remove, or Time.");
      const timestamp=new Date().toISOString();
      const trainingDate=new Intl.DateTimeFormat("en-US",{timeZone:"UTC",month:"2-digit",day:"2-digit",year:"numeric"}).format(new Date());
      const newTime=action==="remove"?"":time;
      const logAction=action==="time"?"Time Changed":action==="add"?"Added":"Removed";
      const log=db.prepare("INSERT INTO training_hours_log(log_date,callsign,member_name,action,previous_time,new_time,changed_by) VALUES(?,?,?,?,?,?,?)")
        .bind(timestamp,member.callsign,member.name,logAction,previousTime,newTime,user.name);
      let savedId=recordId;
      if(action==="add") {
        const inserted=await db.prepare("INSERT INTO training_hours(callsign,name,training_date,time,updated_at,updated_by) VALUES(?,?,?,?,?,?) RETURNING id")
          .bind(member.callsign,member.name,trainingDate,time,timestamp,user.name).first();
        savedId=Number(inserted?.id)||0;
        await log.run();
      } else {
        const change=action==="remove"?db.prepare("DELETE FROM training_hours WHERE id=?").bind(recordId)
          :db.prepare("UPDATE training_hours SET time=?,updated_at=?,updated_by=? WHERE id=?").bind(time,timestamp,user.name,recordId);
        await db.batch([change,log]);
      }
      const bridgeAssertion=env.LVFR_D1_AUTH_BRIDGE_SECRET?await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET):"";
      const {proxyToAppsScript}=await import("../[[path]].js");
      const sheetLog={kind:"training_time",log_date:timestamp,callsign:member.callsign,member_name:member.name,action:logAction,details:JSON.stringify({previous_time:previousTime,new_time:newTime}),changed_by:user.name};
      try {
        const logMirror=await proxyToAppsScript(context,"/internal/logs/mirror",url,bridgeAssertion,sheetLog);
        if(!logMirror.ok) console.error("Training Hours log Sheet mirror failed:",(await logMirror.text()).slice(0,500));
      } catch(error) { console.error("Training Hours log Sheet mirror failed:",error); }
      let sheetSynced=true,sheetSyncError="";
      try {
        const sheetMirror=await proxyToAppsScript(context,"/internal/training-hours/mirror",url,bridgeAssertion,{action,callsign:member.callsign,id:savedId,source_row:existing?.source_row,time:newTime,previous_time:previousTime,date:action==="add"?trainingDate:existing.training_date});
        const mirrorResult=await sheetMirror.json().catch(()=>({}));
        if(!sheetMirror.ok||mirrorResult.ok!==true) {
          const responseDetail=mirrorResult.detail||mirrorResult.error||JSON.stringify(mirrorResult);
          throw new Error("Apps Script Sheet1 mirror was not confirmed (HTTP "+sheetMirror.status+"): "+String(responseDetail||"empty response").slice(0,400));
        }
        if(mirrorResult.row&&!existing?.source_row) {
          const sheetRow=Number(mirrorResult.row);
          // A Sheet-to-D1 import can claim this row between the Apps Script
          // write and this acknowledgement. Only attach the row if no other
          // D1 record owns it; otherwise collapse an identical import-created
          // duplicate into that already-mapped record.
          await db.prepare("UPDATE training_hours SET source_row=? WHERE id=? AND source_row IS NULL AND NOT EXISTS (SELECT 1 FROM training_hours WHERE source_row=? AND id<>?)")
            .bind(sheetRow,savedId,sheetRow,savedId).run();
          const saved=await db.prepare("SELECT id,source_row,callsign,training_date,time FROM training_hours WHERE id=?").bind(savedId).first();
          if(saved&&Number(saved.source_row)===sheetRow) {
            // The web-created record retained ownership of the Sheet row.
          } else {
            const imported=await db.prepare("SELECT id,callsign,training_date,time FROM training_hours WHERE source_row=?").bind(sheetRow).first();
            if(!imported||imported.callsign!==member.callsign||imported.training_date!==trainingDate||imported.time!==time) {
              throw new Error("The Training Hours Sheet row was claimed by a different D1 record; refresh the row mapping before retrying.");
            }
            // The import found the just-created Sheet entry and attached its
            // source_row first. Keep that canonical row and remove the
            // unlinked placeholder created by this request.
            await db.prepare("DELETE FROM training_hours WHERE id=? AND source_row IS NULL").bind(savedId).run();
            savedId=Number(imported.id)||savedId;
          }
        }
      } catch(error) {
        sheetSynced=false;
        sheetSyncError=String(error?.message||error).slice(0,500);
        console.error("Training Hours Sheet mirror failed:",sheetSyncError);
      }
      return json({ok:true,changed:true,id:savedId,message:"Training Hours record updated.",sheet_synced:sheetSynced,sheet_sync_error:sheetSyncError});
    }
    if(route==="/api/members" && method==="GET") {
      return json(await readMembers(db,url.searchParams.get("search")||"",env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET)));
    }
    if(route==="/api/sync-status" && method==="GET") {
      const snapshot=await db.prepare("SELECT COUNT(*) AS members,COALESCE(MAX(synced_at),'') AS synced_at FROM members").first();
      return json({synced_at:snapshot?.synced_at||null,members:Number(snapshot?.members||0),sync_running:false,sync_last_source:"",sync_last_success:snapshot?.synced_at||null,sync_error:null,auto_sync_enabled:false,auto_sync_interval_seconds:0,google_write:{running:false,pending:0,last_error:null,last_success:snapshot?.synced_at||null},archive:{enabled:true,status:"idle",pending:0,last_error:null,last_success:snapshot?.synced_at||null}});
    }
    if(route==="/api/config" && method==="GET") {
      await ensureCallsignSlotsTable(db);
      const slots=await db.prepare("SELECT rank,callsign,sheet_row AS row FROM callsign_slots ORDER BY CASE WHEN sheet_row IS NULL THEN 1 ELSE 0 END,sheet_row,callsign").all();
      const available={}; for(const x of slots.results||[]) if(!available[x.rank]) available[x.rank]=x.callsign;
      return json({ranks:["Commissioners","Chief","County Command","Division Commander","Captain","Lieutenant","Lead Paramedic","Paramedic","AEMT","EMT","Probationary","Senior Volunteer","Volunteer","Probationary Volunteer","EMR","EMR/Volunteer"],available_callsigns:available,trainings:["Basic Firefighting","Advanced Firefighting","Hert"],activities:["Active","Semi Active","Inactive","Can Be Terminated"],exams:["Supervisor Exam"]});
    }
    if(route==="/api/eligible" && method==="GET") {
      const rows=await readMembers(db,"",env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET));
      const admin=["admin","commander"].includes(user.role);
      return json(rows.reduce((eligibleRows,row)=>{
        if(["Probationary","Probie","Probationary Volunteer","Probie Volunteer"].includes(row.rank)) return eligibleRows;
        const eligibility=rankEligibility(row);
        if(!eligibility.eligible || (!admin && (row.rank!=="EMT" || eligibility.next_rank!=="AEMT"))) return eligibleRows;
        eligibleRows.push({...row,eligible:true,next_rank:eligibility.next_rank,eligibility_reason:eligibility.reason});
        return eligibleRows;
      },[]));
    }
    if(route==="/api/inactive" && method==="GET") return json((await readMembers(db,"",env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET))).filter(row=>row.activity==="Can Be Terminated").map(({callsign,name})=>({callsign,name})));
    if(route==="/api/do-not-promote" && method==="GET") return json((await readMembers(db,"",env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET))).filter(row=>row.do_not_promote).map(({callsign,name})=>({callsign,name,added_at:"",added_by:""})));
    if(route==="/api/instructors" && method==="GET") return json((await readMembers(db,"",env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET))).flatMap(row=>String(row.instructor_type||"").toUpperCase().split(/\s*\/\s*/).filter(type=>(type==="HERT"&&user.permissions.hert_instructor_view)||(type==="FORT"&&user.permissions.fort_instructor_view)).map(type=>({name:row.name,type,date:""}))));
    const memberRoute=route.match(/^\/api\/member\/([^/]+)$/);
    if(route==="/api/account/profile" && method==="GET") {
      const rows=await readMembers(db,user.callsign,env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET));
      const member=rows.find(row=>row.callsign.toUpperCase()===user.callsign.toUpperCase());
      if(!member) return json({detail:"Member not found."},404);
      const eligible=rankEligibility(member);
      member.trainings=[...(member.has_basic_firefighting?["basic_firefighting"]:[]),...(member.has_advanced_firefighting?["advanced_firefighting"]:[])];
      member.exams=member.has_supervisor_exam?["supervisor_exam"]:[]; member.hert=member.has_hert; member.eligible=eligible.eligible;
      member.eligibility_reason=eligible.reason; member.next_rank=eligible.next_rank; member.instructor_type=""; member.instructor_date="";
      return json(member);
    }
    if(memberRoute && method==="GET") {
      const rows=await readMembers(db,decodeURIComponent(memberRoute[1]),env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET));
      const member=rows.find(row=>row.callsign.toUpperCase()===decodeURIComponent(memberRoute[1]).trim().toUpperCase());
      if(!member) return json({detail:"Member not found."},404);
      const eligible=rankEligibility(member);
      member.trainings=[...(member.has_basic_firefighting?["basic_firefighting"]:[]),...(member.has_advanced_firefighting?["advanced_firefighting"]:[])];
      member.exams=member.has_supervisor_exam?["supervisor_exam"]:[]; member.hert=member.has_hert;
      member.eligible=eligible.eligible; member.eligibility_reason=eligible.reason; member.next_rank=eligible.next_rank;
      if(!["admin","commander"].includes(user.role) && !/^(E|C|DIV|B|CHIEF|COM)-/.test(user.callsign)) member.instructor_type="";
      member.instructor_date="";
      return json(member);
    }
    if(route==="/api/watch-command/current-user" && method==="GET") return json({account_id:user.account_id,callsign:user.callsign,name:user.name,role:user.role,permissions:user.permissions||{}});
    if(route==="/api/watch-command/members" && method==="GET") return json((await readMembers(db,"",env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET))).map(({callsign,name,rank})=>({callsign,name,rank})));
    const watchMember=route.match(/^\/api\/watch-command\/member\/([^/]+)$/);
    if(watchMember && method==="GET") {
      const callsign=decodeURIComponent(watchMember[1]).trim().toUpperCase();
      const rows=await readMembers(db,callsign,env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET));
      const member=rows.find(row=>row.callsign===callsign);
      return member?json({callsign:member.callsign,name:member.name,rank:member.rank}):json({detail:"Callsign was not found on the roster."},404);
    }
    if(route==="/api/sync" && method==="POST") {
      if(!["admin","commander","leader"].includes(user.role)) throw Object.assign(new Error("Only a Supervisor or Commander can synchronize the roster."),{status:403});
      const result=await syncMembersFromAppsScript(env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET));
      return json({...result,message:result.skipped?"Roster snapshot unchanged; sync skipped":"Roster synchronized from Google Sheets"});
    }
    if(route==="/api/full-sync" && method==="POST") {
      const result=await syncMembersFromAppsScript(env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET),true);
      return json({...result,message:"Full roster sync completed from Google Sheets"});
    }
    const instructorWrite=route.match(/^\/api\/member\/([^/]+)\/instructor$/);
    if(method==="POST" && (MEMBER_WRITE_ROUTES.has(route)||instructorWrite)) {
      const admin=["admin","commander"].includes(user.role), leader=admin||user.role==="leader";
      if(instructorWrite&&!admin&&!user.permissions.instructor_manage) throw Object.assign(new Error("This account is not authorized to manage instructor status."),{status:403});
      if(route==="/api/training"&&!admin) {
        const needed=String(data.training||"").toLowerCase()==="hert"?"HERT":"FORT";
        const instructor=await db.prepare("SELECT instructor_type FROM members WHERE upper(callsign)=upper(?)").bind(user.callsign).first();
        if(!String(instructor?.instructor_type||"").toUpperCase().split(/\s*\/\s*/).includes(needed)) throw Object.assign(new Error(needed+" Instructor status is required for this training."),{status:403});
      }
      if(route==="/api/exam"&&!admin&&!user.permissions.exam_manage&&!/^(E|C|DIV|B|CHIEF|COM)-/.test(user.callsign)) throw Object.assign(new Error("Command rank or Exam permission is required for this action."),{status:403});
      const mutationData={...data};
      if(instructorWrite) mutationData.callsign=decodeURIComponent(instructorWrite[1]).toUpperCase();
      const oldMember=await db.prepare("SELECT * FROM members WHERE upper(callsign)=upper(?)").bind(mutationData.callsign).first();
      const result=await applyRosterMutationD1(db,route,mutationData,user);
      if(result.changed!==false && oldMember) await writeOperationalLog(db,oldMember,route,mutationData,result,user);
      const isHertTraining=route==="/api/training" && String(mutationData.training||"").trim().toLowerCase()==="hert";
      // Sheets can be out of sync with D1 (for example after a manual edit or
      // a prior background write failure). Always mirror instructor changes,
      // even when D1 already has the requested instructor state. Wait for the
      // Sheet write so the UI can report a failed cleanup instead of silently
      // claiming the instructor was removed.
      if(instructorWrite) {
        const assertion=await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET);
        const { proxyToAppsScript } = await import("../[[path]].js");
        const sheetResponse=await proxyToAppsScript(context,route,url,assertion,mutationData);
        if(!sheetResponse.ok) return json({detail:"Instructor state was saved in D1, but Google Sheets could not be updated: "+await sheetResponse.text()},502);
      } else if(route==="/api/terminate") {
        let sheetCleaned=true,sheetCleanupError="";
        try {
          const assertion=await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET);
          const { proxyToAppsScript } = await import("../[[path]].js");
          const sheetResponse=await proxyToAppsScript(context,route,url,assertion,mutationData);
          if(!sheetResponse.ok) throw new Error(await sheetResponse.text());
          const sheetResult=await sheetResponse.json().catch(()=>({}));
          if(sheetResult.ok!==true) throw new Error(sheetResult.error||"Apps Script did not confirm the termination and training cleanup.");
        } catch(error) {
          sheetCleaned=false;
          sheetCleanupError=String(error?.message||error).slice(0,400);
          console.error("Terminated member Sheet cleanup failed:",sheetCleanupError);
        }
        result.sheet_cleaned=sheetCleaned;
        if(sheetCleanupError) result.sheet_cleanup_error=sheetCleanupError;
      } else if(result.changed!==false || isHertTraining) {
        const assertion=await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET);
        const { proxyToAppsScript } = await import("../[[path]].js");
        const bg=(async()=>{ try { const response=await proxyToAppsScript(context,route,url,assertion,mutationData); if(!response.ok) console.error("Background Sheet write failed after D1 commit:",await response.text()); } catch(error) { console.error("Background Sheet write failed after D1 commit:",error); } })();
        context.waitUntil(bg);
      }
      return json(result);
    }
    // Only the heartbeat writes presence, and only when the stored value is older
    // than 45 s. Writing on every request (the members view polls every 3 s)
    // consumed D1 rows for no benefit.
    if (route==="/api/presence" && method==="POST") {
      await db.prepare("INSERT INTO account_presence(account_id,last_seen) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET last_seen=excluded.last_seen WHERE account_presence.last_seen < excluded.last_seen - 45").bind(user.account_id,nowSeconds()).run();
      return json({ok:true});
    }
    if (route==="/api/presence/summary" && method==="GET") { const r=await db.prepare("SELECT a.name,a.callsign FROM account_presence p JOIN accounts a ON a.account_id=p.account_id WHERE a.status='approved' AND p.last_seen>? ORDER BY lower(a.name)").bind(nowSeconds()-90).all(); const online=(r.results||[]).map(x=>({name:x.name,callsign:x.callsign})); return json({online_count:online.length,online}); }
    if (route==="/api/leaders" && method==="GET") { const admin=await requireAdmin(db,token); return json(await leaders(db,admin)); }
    if (route==="/api/leaders/audit" && method==="GET") { await requireAdmin(db,token); const r=await db.prepare("SELECT id,created_at,account_id,name,callsign,action,actor_name,actor_name AS by FROM account_audit ORDER BY id DESC LIMIT 200").all(); return json(r.results||[]); }
    const action=route.match(/^\/api\/leaders\/([^/]+)\/(allow|deny|admin|commander|demote|member|leader|deactivate|reactivate)$/);
    if(action && method==="POST") {
      const admin=action[2]==="admin"||action[2]==="commander"?await requireOperation(db,token):await requireAdmin(db,token), target=await db.prepare("SELECT account_id,name,callsign,role FROM accounts WHERE account_id=?").bind(decodeURIComponent(action[1])).first();
      if(admin.role==="commander"&&target&&["admin","commander"].includes(target.role)) throw Object.assign(new Error("Only Operation can manage Operation or Commander accounts."),{status:403});
      const result=await accountAction(db,decodeURIComponent(action[1]),action[2],admin);
      if(target&&env.LVFR_D1_AUTH_BRIDGE_SECRET) {
        const assertion=await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET), {proxyToAppsScript}=await import("../[[path]].js");
        context.waitUntil((async()=>{try{const mirror=await proxyToAppsScript(context,"/internal/logs/mirror",url,assertion,{kind:"account_audit",account_id:target.account_id,name:target.name,callsign:target.callsign,action:action[2],actor_name:admin.name});if(!mirror.ok)console.error("Account Audit Sheet mirror failed:",await mirror.text());}catch(error){console.error("Account Audit Sheet mirror failed:",error);}})());
      }
      return json(result);
    }
    const deletion=route.match(/^\/api\/leaders\/([^/]+)$/);
    if(deletion && method==="DELETE") {
      const admin=await requireAdmin(db,token), id=decodeURIComponent(deletion[1]);
      const target=await db.prepare("SELECT account_id,name,callsign FROM accounts WHERE account_id=?").bind(id).first();
      const result=await accountAction(db,id,"delete",admin);
      if(target&&env.LVFR_D1_AUTH_BRIDGE_SECRET) {
        const assertion=await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET), {proxyToAppsScript}=await import("../[[path]].js");
        context.waitUntil((async()=>{try{const mirror=await proxyToAppsScript(context,"/internal/logs/mirror",url,assertion,{kind:"account_audit",account_id:target.account_id,name:target.name,callsign:target.callsign,action:"delete",actor_name:admin.name});if(!mirror.ok)console.error("Account Audit Sheet mirror failed:",await mirror.text());}catch(error){console.error("Account Audit Sheet mirror failed:",error);}})());
      }
      return json(result);
    }
    if(route==="/api/account/password" && method==="POST") {
      const current=await db.prepare("SELECT * FROM accounts WHERE account_id=?").bind(user.account_id).first();
      if(await passwordHash(String(data.current_password||""),current.password_salt)!==current.password_hash) throw Object.assign(new Error("Current password is incorrect."),{status:400});
      if(!/^[A-Za-z0-9]{4,20}$/.test(String(data.new_password||""))) throw new Error("New password must be 4–20 letters or numbers.");
      const salt=b64url(crypto.getRandomValues(new Uint8Array(16))), hash=await passwordHash(data.new_password,salt);
      await db.prepare("UPDATE accounts SET password_salt=?,password_hash=?,password_hash_version='pbkdf2-sha256-100000',updated_at=? WHERE account_id=?").bind(salt,hash,new Date().toISOString(),user.account_id).run();
      await db.prepare("DELETE FROM auth_sessions WHERE account_id=? AND token_hash<>?").bind(user.account_id,await sha256(token)).run(); return json({ok:true,status:"changed",message:"Password changed."});
    }
    if(authRoute) return json({detail:"Unknown authentication route."},404);
    if(!env.LVFR_D1_AUTH_BRIDGE_SECRET) return json({detail:"D1 Apps Script bridge is not configured."},503);
    const assertion=await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET);
    const { proxyToAppsScript } = await import("../[[path]].js");
    const response=await proxyToAppsScript(context,route,url,assertion,data);
    return response;
  } catch(error) { console.error("D1 API request failed:",error); return json({detail:error.message||"Request failed."},error.status||400); }
}
