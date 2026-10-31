import { memberColumnValues, planMemberWrites, slotValues, planSlotWrites, discordLinkUnchanged } from "./roster-diff.js";
const enc = new TextEncoder();
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const nowSeconds = () => Math.floor(Date.now() / 1000);
// Notification types a person can choose to receive, each tied to the permission that allows it.
const NOTIFICATION_PREFERENCE_KINDS=[
  {kind:"termination",label:"Termination",key:"notif_termination",bases:["termination_manage"]},
  {kind:"inactive",label:"Due to Activity",key:"notif_inactive",bases:["inactive_view"]},
  {kind:"overdue",label:"Training Overdue",key:"notif_overdue",bases:["inactive_view"]},
  {kind:"promotion",label:"Promotion",key:"notif_promotion",bases:["promotion_manage","rank_manage"]},
  {kind:"eligible",label:"Can be promoted",key:"notif_eligible",bases:["eligible_view","promotion_access"]},
  {kind:"callsign",label:"Callsign",key:"notif_callsign",bases:["callsign_manage"]},
  {kind:"training",label:"Training",key:"notif_training",bases:["training_hert_manage","training_fort_manage"]},
  {kind:"training_time",label:"Training Hours",key:"notif_training_time",bases:["training_hours_manage"]},
  {kind:"loi",label:"LOI",key:"notif_loi",bases:["loi_manage"]},
  {kind:"exam",label:"Exam",key:"notif_exam",bases:["exam_manage"]},
  {kind:"note",label:"Note",key:"notif_note",bases:["notes_manage"]},
  {kind:"activity",label:"Activity",key:"notif_activity",bases:["activity_manage"]},
  {kind:"instructor",label:"Instructor",key:"notif_instructor",bases:["instructor_manage"]},
  {kind:"do_not_promote",label:"Do Not Promote",key:"notif_do_not_promote",bases:["do_not_promote_manage"]},
  {kind:"do_not_terminate",label:"Do Not Terminate",key:"notif_do_not_terminate",bases:["do_not_promote_manage"]},
  {kind:"request",label:"New account request",key:null,bases:[],roles:["admin","commander"]}
];
// A notification type is allowed only if its own key AND one of its base permissions are on.
function notifAllowed(user,item){
  const role=String(user.role||"").toLowerCase();
  if(role==="admin") return true;
  if((item.roles||[]).includes(role)) return true;
  if(!item.key) return false;
  const perms=user.permissions||{};
  return perms[item.key]===true&&item.bases.some(key=>perms[key]===true);
}
// Keeps notification keys consistent with their base permissions. Unsaved keys default to on when a base is on.
function enforceNotificationKeys(result,saved={}){
  for(const item of NOTIFICATION_PREFERENCE_KINDS) {
    if(!item.key) continue;
    if(typeof saved[item.key]!=="boolean") result[item.key]=item.bases.some(key=>result[key]===true);
    result[item.key]=result[item.key]===true&&item.bases.some(key=>result[key]===true);
  }
  return result;
}
// Turns off a notification switch whose base permission is missing, without overwriting the saved switch.
function clampNotificationKeys(result){
  for(const item of NOTIFICATION_PREFERENCE_KINDS) {
    if(!item.key) continue;
    result[item.key]=result[item.key]===true&&item.bases.some(key=>result[key]===true);
  }
  return result;
}
const DEFAULT_ON_NOTIFICATION_KINDS=["eligible","inactive","overdue","request"];
const LOG_VIEW_PERMISSIONS = ["promotion_log_view","callsign_log_view","termination_log_view","training_log_view","training_hours_log_view","loi_log_view","exam_log_view","note_log_view","activity_log_view","instructor_log_view"];
const TRAINING_VIEW_PERMISSIONS = ["hert_certified_view","hert_instructor_view","hert_loi_view","fort_training_view","fort_instructor_view","fort_loi_view"];
const ROLE_PERMISSION_KEYS = ["portal_access","operation_command_access","role_manage","rank_add","rank_rename","rank_delete","rank_reorder","watch_command_view","watch_command_edit","watch_command_roster","academy_view","academy_manage","members_view","eligible_view","promotion_access","profile_view","inactive_view","logs_view",...LOG_VIEW_PERMISSIONS,"logs_delete_d1","logs_clean_full","notifications_clear_all","do_not_promote_log_view","do_not_terminate_log_view","notif_termination","notif_inactive","notif_overdue","notif_promotion","notif_eligible","notif_callsign","notif_training","notif_training_time","notif_loi","notif_exam","notif_note","notif_activity","notif_instructor","notif_do_not_promote","notif_do_not_terminate","training_view",...TRAINING_VIEW_PERMISSIONS,"training_fort_manage","training_hert_manage","training_hours_view","training_hours_manage","loi_manage","statistics_view","notes_manage","promotion_manage","callsign_manage","activity_manage","exam_manage","rank_date_manage","rank_manage","termination_manage","do_not_promote_view","do_not_promote_manage","instructor_manage","sync_view","sync_manage","full_sync_manage","discord_view","discord_manage","discord_sync_manage","discord_log_clear"];
const DEFAULT_ROLE_PERMISSIONS = {
  member: { portal_access:false,operation_command_access:false,watch_command_view:true,watch_command_edit:true,watch_command_roster:true,members_view:false,eligible_view:false,promotion_access:false,profile_view:false,inactive_view:false,logs_view:false,training_view:false,training_fort_manage:false,training_hert_manage:false,training_hours_view:false,training_hours_manage:false,loi_manage:false,statistics_view:false,notes_manage:false,promotion_manage:false,callsign_manage:false,activity_manage:false,exam_manage:false,rank_date_manage:false,rank_manage:false,termination_manage:false,do_not_promote_view:false,do_not_promote_manage:false,instructor_manage:false,sync_view:false,sync_manage:false },
  leader: { portal_access:true,operation_command_access:false,watch_command_view:true,watch_command_edit:true,watch_command_roster:true,members_view:true,eligible_view:true,promotion_access:true,profile_view:true,inactive_view:false,logs_view:true,training_view:true,training_fort_manage:true,training_hert_manage:true,training_hours_view:true,training_hours_manage:true,loi_manage:true,statistics_view:true,notes_manage:true,promotion_manage:true,callsign_manage:true,activity_manage:false,exam_manage:false,rank_date_manage:false,rank_manage:false,termination_manage:false,do_not_promote_view:false,do_not_promote_manage:false,instructor_manage:false,sync_view:true,sync_manage:true },
  commander: Object.fromEntries(ROLE_PERMISSION_KEYS.map(key=>[key,!['logs_delete_d1','logs_clean_full','notifications_clear_all'].includes(key)]))
};
// Rank limits for a role. A limit that is not set means the role is not restricted by it.
async function roleScopes(db,role){
  const row=await db.prepare("SELECT scopes_json FROM role_permissions WHERE role=?").bind(String(role||"").toLowerCase()).first();
  try { return JSON.parse(row?.scopes_json||"{}")||{}; } catch { return {}; }
}
async function assertRankScope(db,actor,scope,fromRank,toRank){
  if(String(actor.role||"").toLowerCase()==="admin") return;
  const rule=(await roleScopes(db,actor.role))[scope];
  if(!rule) return;
  if(Array.isArray(rule.from)&&!rule.from.includes(fromRank)) throw Object.assign(new Error("Your role cannot change members of rank "+fromRank+"."),{status:403});
  if(toRank&&Array.isArray(rule.to)&&!rule.to.includes(toRank)) throw Object.assign(new Error("Your role cannot move a member to "+toRank+"."),{status:403});
}
// Ranks whose members the actor may see in lists and notifications. Null means no limit.
async function viewRanks(db,actor){
  if(String(actor.role||"").toLowerCase()==="admin") return null;
  const rule=(await roleScopes(db,actor.role)).view;
  return rule&&Array.isArray(rule.from)?rule.from:null;
}
async function filterRowsByViewRanks(db,actor,rows){
  const viewable=await viewRanks(db,actor);
  if(!viewable) return rows;
  const rankByCallsign=new Map(((await db.prepare("SELECT callsign,rank FROM members").all()).results||[]).map(row=>[String(row.callsign||"").toUpperCase(),row.rank]));
  return rows.filter(row=>viewable.includes(rankByCallsign.get(String(row.callsign||"").toUpperCase())||""));
}
// Permissions that a rank limit belongs to. A viewer without any of them cannot see or set that limit.
const SCOPE_BASE_PERMISSIONS={
  promote:["promotion_manage","rank_manage"],
  demote:["rank_manage"],
  terminate:["termination_manage"],
  view:["members_view","eligible_view","inactive_view","promotion_access"],
};
// Shows a non-admin viewer only the permissions and limits they hold.
function limitSnapshotToActor(snapshot,effective){
  const permissions=Object.fromEntries(Object.entries(snapshot?.permissions||{}).filter(([key])=>effective[key]===true));
  const scopes=Object.fromEntries(Object.entries(snapshot?.scopes||{}).filter(([scope])=>(SCOPE_BASE_PERMISSIONS[scope]||[]).some(key=>effective[key]===true)));
  return {permissions,scopes};
}
function sanitizeScopes(input){
  const out={};
  for(const scope of ["promote","demote","terminate","view"]) {
    const rule=input?.[scope];
    if(!rule||typeof rule!=="object") continue;
    const clean={};
    for(const field of (scope==="terminate"||scope==="view"?["from"]:["from","to"])) {
      if(!Array.isArray(rule[field])) continue;
      clean[field]=[...new Set(rule[field].map(String).filter(rank=>Object.hasOwn(RANK_LEVEL,rank)))];
    }
    if(Object.keys(clean).length) out[scope]=clean;
  }
  return out;
}
// Instructor requirement: the acting member must hold one of the listed instructor types. Admins are exempt.
async function assertInstructorType(db,user,types,message){
  if(String(user.role||"").toLowerCase()==="admin") return;
  const row=await db.prepare("SELECT instructor_type FROM members WHERE upper(callsign)=upper(?)").bind(String(user.callsign||"")).first();
  const held=String(row?.instructor_type||"").toUpperCase().split(/\s*\/\s*/).filter(Boolean);
  if(!types.some(type=>held.includes(type))) throw Object.assign(new Error(message),{status:403});
}

async function rolePermissions(db, role) {
  const normalized=String(role||"").toLowerCase();
  const base=DEFAULT_ROLE_PERMISSIONS[normalized]||{};
  const row=await db.prepare("SELECT permissions_json FROM role_permissions WHERE role=?").bind(normalized).first();
  let saved={}; try { saved=JSON.parse(row?.permissions_json||"{}"); } catch {}
  const result=Object.fromEntries(ROLE_PERMISSION_KEYS.map(key=>[key,typeof saved[key]==="boolean"?saved[key]:Boolean(base[key])]));
  enforceNotificationKeys(result,saved);
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
  // Edit rank permission (operation_command_access) includes the rank actions.
  if(result.operation_command_access===true) for(const key of ["rank_add","rank_rename","rank_delete","rank_reorder","role_manage"]) result[key]=true;
  clampNotificationKeys(result);
  return result;
}
function permissionForRequest(route, method, data={}) {
  if((route==="/api/members"||route==="/api/members/version")&&method==="GET") return ["members_view",...TRAINING_VIEW_PERMISSIONS,"training_view","statistics_view","loi_manage","training_fort_manage","training_hert_manage","training_hours_manage","instructor_manage"];
  if(route==="/api/eligible"&&method==="GET") return ["eligible_view","promotion_access"];
  if(route==="/api/inactive"&&method==="GET") return "inactive_view";
  if(route==="/api/discord/link-status"&&method==="GET") return ["termination_manage","rank_manage","callsign_manage","discord_view"];
  if(route==="/api/training-overdue"&&method==="GET") return "inactive_view";
  if(route==="/api/members-log"&&method==="GET") return logViewPermission(data.log_type);
  if(route==="/api/members-log/clear"&&method==="POST") return "logs_delete_d1";
  if(route==="/api/logs/clean"&&method==="POST") return String(data?.scope||"").toLowerCase()==="d1"?"logs_delete_d1":"logs_clean_full";
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
  if(route==="/api/notifications/clear"&&method==="POST") return "notifications_clear_all";
  if(route==="/api/do-not-promote"&&method==="GET") return "do_not_promote_view";
  if(route==="/api/do-not-promote"&&method==="POST") return "do_not_promote_manage";
  if(route==="/api/do-not-terminate"&&method==="GET") return "do_not_promote_view";
  if(route==="/api/do-not-terminate"&&method==="POST") return "do_not_promote_manage";
  if(route==="/api/member/instructor"||/^\/api\/member\/[^/]+\/instructor$/.test(route)) return "instructor_manage";
  if(route==="/api/account/profile"&&method==="GET") return "profile_view";
  if(route==="/api/watch-command/current-user") return null;
  if(route==="/api/watch-command/members"&&method==="GET") return "watch_command_roster";
  if(route.startsWith("/api/watch-command/member/")&&method==="GET") return "watch_command_roster";
  if(route.startsWith("/api/academy")) return method==="GET"?"academy_view":"academy_manage";
  if(route==="/api/watch-command") return method==="GET"?"watch_command_view":"watch_command_edit";
  if(route.startsWith("/api/member/")&&method==="GET") return "profile_view";
  if(route==="/api/training"&&method==="POST") return String(data.training||"").toLowerCase()==="hert"?"training_hert_manage":"training_fort_manage";
  const writes={"/api/note":"notes_manage","/api/promote":"promotion_manage","/api/change-callsign":"callsign_manage","/api/activity":"activity_manage","/api/exam":"exam_manage","/api/date":"rank_date_manage","/api/force-promote":"rank_manage","/api/demote":"rank_manage","/api/change-rank":"rank_manage","/api/terminate":"termination_manage"};
  return method==="POST"?writes[route]||null:null;
}
function logViewPermission(kind) {
  return ({promotion:"promotion_log_view",callsign:"callsign_log_view",termination:"termination_log_view",training:"training_log_view",training_time:"training_hours_log_view",loi:"loi_log_view",exam:"exam_log_view",note:"note_log_view",activity:"activity_log_view",instructor:"instructor_log_view",do_not_promote:"do_not_promote_log_view",do_not_terminate:"do_not_terminate_log_view"})[String(kind||"").toLowerCase()]||"logs_view";
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
export async function rosterIdentity(env, name, db = null) {
  // D1 holds the roster mirror, so registration is answered from D1 alone.
  // Apps Script is asked only when the roster was never synced into D1 (empty
  // members table) or when no D1 binding is supplied (initial Operation setup).
  if (db) {
    let rows;
    try { rows = (await db.prepare("SELECT name,callsign FROM members").all()).results || []; }
    catch (error) {
      console.error("D1 roster lookup failed:", error);
      throw Object.assign(new Error("The roster is temporarily unavailable. Try again in a minute."), { status: 503 });
    }
    if (rows.length) {
      const key = nameKey(name);
      const matches = rows.filter(row => nameKey(row.name) === key && row.callsign);
      if (matches.length === 1) return { name: matches[0].name, callsign: matches[0].callsign };
      if (matches.length > 1) throw Object.assign(new Error("More than one roster member matches this name. Contact a Commander."), { status: 409 });
      throw new Error("Name was not found on the LVFR roster.");
    }
  }
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
async function saveCallsignSlots(db, slots, fullSync = true) {
  await ensureCallsignSlotsTable(db);
  const items=Array.isArray(slots)?slots:Object.entries(slots||{}).map(([rank,v])=>typeof v==="string"?({rank,callsign:v}):({rank,...v}));
  if (!fullSync) return diffSaveCallsignSlots(db, items);
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
// Regular sync: compare with the stored slots and write only the rows that changed.
const SLOT_INSERT_SQL = "INSERT INTO callsign_slots(rank,callsign,sheet_row,synced_at) VALUES(?,?,?,?)";
const SLOT_UPDATE_SQL = "UPDATE callsign_slots SET sheet_row=?,synced_at=? WHERE rank=? AND callsign=?";
async function diffSaveCallsignSlots(db, items) {
  await ensureCallsignSlotsTable(db);
  const incoming = items.filter(v => v && v.callsign).map(slotValues);
  const stored = (await db.prepare("SELECT rank,callsign,sheet_row FROM callsign_slots").all()).results || [];
  const plan = planSlotWrites(stored, incoming);
  const now = new Date().toISOString();
  const statements = [
    ...plan.deletes.map(row => db.prepare("DELETE FROM callsign_slots WHERE rank=? AND callsign=?").bind(row.rank, row.callsign)),
    ...plan.updates.map(slot => db.prepare(SLOT_UPDATE_SQL).bind(slot.sheet_row, now, slot.rank, slot.callsign)),
    ...plan.inserts.map(slot => db.prepare(SLOT_INSERT_SQL).bind(slot.rank, slot.callsign, slot.sheet_row, now)),
  ];
  if (statements.length) await db.batch(statements);
}
// One row that records when the roster was last synchronised, so the status shows the time even when no member changed.
async function ensureRosterSyncStateTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS roster_sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    synced_at TEXT NOT NULL
  )`).run();
}
function rosterSyncStateStatement(db, syncedAt) {
  return db.prepare("INSERT INTO roster_sync_state(id,synced_at) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET synced_at=excluded.synced_at").bind(syncedAt);
}
const MEMBER_INSERT_SQL = `INSERT INTO members (callsign,name,rank,date,rank_assigned_date,days_in_rank,discord_id,notes,has_basic_firefighting,has_advanced_firefighting,has_supervisor_exam,has_hert,activity,instructor_type,do_not_promote,do_not_terminate,sheet_row,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
const MEMBER_UPDATE_SQL = "UPDATE members SET name=?,rank=?,date=?,rank_assigned_date=?,days_in_rank=?,discord_id=?,notes=?,has_basic_firefighting=?,has_advanced_firefighting=?,has_supervisor_exam=?,has_hert=?,activity=?,instructor_type=?,do_not_promote=?,do_not_terminate=?,sheet_row=?,synced_at=? WHERE callsign=?";
// Regular sync: insert, update and delete only the members that differ from the stored rows.
async function diffReplaceMembers(db, uniqueMembers, syncedAt) {
  await ensureRosterSyncStateTable(db);
  const stored = (await db.prepare("SELECT * FROM members").all()).results || [];
  const plan = planMemberWrites(stored, uniqueMembers);
  await db.batch([
    ...plan.deletes.map(callsign => db.prepare("DELETE FROM members WHERE callsign=?").bind(callsign)),
    ...plan.updates.map(values => db.prepare(MEMBER_UPDATE_SQL).bind(...values.slice(1), syncedAt, values[0])),
    ...plan.inserts.map(values => db.prepare(MEMBER_INSERT_SQL).bind(...values, syncedAt)),
    rosterSyncStateStatement(db, syncedAt),
  ]);
}
async function replaceMembers(db, members, syncedAt = new Date().toISOString(), fullSync = true) {
  // A callsign can appear twice in the Sheet roster; D1 allows it only once.
  // Keep the first row, skip the rest, and log them so the Sheet can be corrected.
  const seenCallsigns = new Set();
  const uniqueMembers = [];
  const duplicateCallsigns = [];
  for (const member of members) {
    const key = String(member.callsign || "").trim().toUpperCase();
    if (!key) continue;
    if (seenCallsigns.has(key)) { duplicateCallsigns.push(key); continue; }
    seenCallsigns.add(key);
    uniqueMembers.push(member);
  }
  if (duplicateCallsigns.length) console.warn("Roster sync skipped duplicate callsigns:", duplicateCallsigns.join(", "));
  if (!fullSync) {
    await diffReplaceMembers(db, uniqueMembers, syncedAt);
    return { ok: true, members: members.length, synced_at: syncedAt };
  }
  const statements = [db.prepare("DELETE FROM members")];

  for (const member of uniqueMembers) {
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
          do_not_terminate,
          sheet_row,
          synced_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        member.do_not_terminate ? 1 : 0,
        Number(member.sheet_row || member.row || 0) || null,
        syncedAt
      )
    );
  }

  await ensureRosterSyncStateTable(db);
  statements.push(rosterSyncStateStatement(db, syncedAt));
  await db.batch(statements);

  return { ok: true, members: members.length, synced_at: syncedAt };
}
const MEMBER_WRITE_ROUTES = new Set(["/api/activity", "/api/note", "/api/date", "/api/training", "/api/exam", "/api/promote", "/api/force-promote", "/api/demote", "/api/change-rank", "/api/change-callsign", "/api/terminate", "/api/do-not-promote", "/api/do-not-terminate"]);
const RANK_PREFIX = { Commissioners:"COM", Chief:"CHIEF", "County Command":"B", "Division Commander":"DIV", Captain:"C", Lieutenant:"E", "Lead Paramedic":"L", Paramedic:"M", AEMT:"A", EMT:"R", Probationary:"P", EMR:"P", "Senior Volunteer":"S", Volunteer:"V", "Probationary Volunteer":"V", "EMR/Volunteer":"P", Liaison:"F" };
function rankForCallsign(cs) { const p=String(cs||"").match(/^[A-Z]+/); if(!p)return ""; if(p[0]==="V") return [1,2,3,4,5,6,7,8,9,14,21,22,23,24,25,26,27,28,29,36,37,38,39,40].includes(Number(cs.split("-")[1]))?"Probationary Volunteer":"Volunteer"; return ({COM:"Commissioners",CHIEF:"Chief",B:"County Command",DIV:"Division Commander",C:"Captain",E:"Lieutenant",L:"Lead Paramedic",M:"Paramedic",A:"AEMT",R:"EMT",P:"Probationary",S:"Senior Volunteer",F:"Liaison"})[p[0]]||""; }
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
const RANK_LEVEL = { Liaison:0, "Probationary Volunteer":1, "Probationary":1, EMR:1, "EMR/Volunteer":1, Volunteer:2, "Senior Volunteer":3, EMT:4, AEMT:5, "Advanced EMT":5, Paramedic:6, "Lead Paramedic":7, Lieutenant:8, Captain:9, "Division Commander":10, "County Command":11, Chief:12, Commissioners:13 };
async function applyRosterMutationD1(db, route, data, actor) {
  await ensureCallsignSlotsTable(db);
  const admin=["admin","commander"].includes(String(actor.role||""));
  const cs=String(data.callsign||"").trim().toUpperCase(), old=await db.prepare("SELECT * FROM members WHERE upper(callsign)=?").bind(cs).first();
  if(!old) throw Object.assign(new Error("Member not found."),{status:404});
  const now=new Date().toISOString(), cols={callsign:old.callsign,name:old.name,rank:old.rank,date:old.date,rank_assigned_date:old.rank_assigned_date,days_in_rank:old.days_in_rank,discord_id:old.discord_id,notes:old.notes,has_basic_firefighting:old.has_basic_firefighting,has_advanced_firefighting:old.has_advanced_firefighting,has_supervisor_exam:old.has_supervisor_exam,has_hert:old.has_hert,activity:old.activity,instructor_type:old.instructor_type,do_not_promote:old.do_not_promote,do_not_terminate:old.do_not_terminate,sheet_row:old.sheet_row,synced_at:now};
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
    // Advanced FORT can be added only to someone who already has Basic FORT.
    if(!remove&&training==="Advanced Firefighting"&&Number(old.has_basic_firefighting||0)!==1) throw new Error("Advanced FORT can be added only after Basic FORT.");
    cols[key]=remove?0:1;
    result={ok:true,changed:true,status:remove?"removed":"added",message:remove?"Training removed":"Training added"};
    // HERT, Basic FORT and Advanced FORT all qualify a member for the ops Discord role.
    result.training_qualifies=Boolean(cols.has_hert||cols.has_basic_firefighting||cols.has_advanced_firefighting);
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
  else if(route==="/api/do-not-promote") {
    // Already in the requested state: change nothing, so no duplicate log row or notification is written.
    if(Number(old.do_not_promote||0)===(data.blocked?1:0)) return {ok:true,changed:false,status:"unchanged",message:"Already set"};
    cols.do_not_promote=data.blocked?1:0;
  }
  else if(route==="/api/do-not-terminate") {
    if(Number(old.do_not_terminate||0)===(data.blocked?1:0)) return {ok:true,changed:false,status:"unchanged",message:"Already set"};
    cols.do_not_terminate=data.blocked?1:0;
  }
  else if(route==="/api/terminate") {
    if(Number(old.do_not_terminate||0)===1) throw new Error("This member is on the Do Not Terminate list.");
    await assertRankScope(db,actor,"terminate",String(old.rank||"").trim());
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
    if(route==="/api/promote"||route==="/api/force-promote") await assertRankScope(db,actor,"promote",String(old.rank||"").trim(),String(nextRank||"").trim());
    if(route==="/api/demote") await assertRankScope(db,actor,"demote",String(old.rank||"").trim(),String(nextRank||"").trim());
    let nextCs=String(data.d1_target_callsign||data.new_callsign||"").trim().toUpperCase();
    let slot;
    if(route!=="/api/change-callsign") {
      slot=await db.prepare("SELECT rank,callsign,sheet_row FROM callsign_slots WHERE lower(trim(rank))=lower(trim(?)) ORDER BY CASE WHEN sheet_row IS NULL THEN 1 ELSE 0 END,sheet_row,callsign LIMIT 1").bind(nextRank).first();
      const firstCallsign=String(slot?.callsign||"").trim().toUpperCase();
      if(!firstCallsign) throw new Error("No empty Callsign slot is recorded for " + nextRank + ". Please run Sync now.");
      if(nextCs){
        // Accept the Callsign that was chosen, as long as D1 has it as an empty slot for this rank.
        const chosen=await db.prepare("SELECT rank,callsign,sheet_row FROM callsign_slots WHERE upper(callsign)=? AND lower(trim(rank))=lower(trim(?))").bind(nextCs,nextRank).first();
        if(!chosen) throw new Error("Callsign " + nextCs + " is not an empty " + nextRank + " slot now. Please run Sync now and retry.");
        slot=chosen;
      } else {
        nextCs=firstCallsign;
      }
    }
    if(!nextCs||nextCs===old.callsign) throw new Error("No empty Callsign slot is available for " + nextRank + ". Run Sync now to refresh the available slots.");
    if(!slot) slot=await db.prepare("SELECT rank,callsign,sheet_row FROM callsign_slots WHERE upper(callsign)=?").bind(nextCs).first();
    if(!slot) throw new Error("This callsign doesn't exist.");
    if(route==="/api/change-callsign") {
      const taken=await db.prepare("SELECT callsign FROM members WHERE upper(callsign)=? AND upper(callsign)<>upper(?) LIMIT 1").bind(nextCs,old.callsign).first();
      if(taken) throw new Error("This callsign is already taken.");
    }
    const slotRank=String(slot.rank||"").trim().toLowerCase();
    if(route!=="/api/change-callsign" && slotRank!==nextRank.toLowerCase()) throw new Error("The destination Callsign does not match the selected rank.");
    if(route==="/api/change-callsign" && !admin && slotRank!==String(old.rank||"").trim().toLowerCase()) throw new Error("This callsign doesn't belong to \""+(String(old.rank||"").trim()||"this rank")+"\".");
    const rankChangeNeeded=route==="/api/change-callsign" && admin && slotRank!==String(old.rank||"").trim().toLowerCase();
    if(route==="/api/change-callsign" && rankChangeNeeded && !data.force && !data.dry_run) throw new Error("The Callsign belongs to a different rank. Confirm a rank change first.");
    if(old.do_not_promote && (RANK_LEVEL[nextRank]||0)>(RANK_LEVEL[old.rank]||0)) throw new Error("This member is on the Do not Promote list.");
    if(route==="/api/force-promote" && (RANK_LEVEL[nextRank]||0)<=(RANK_LEVEL[old.rank]||0)) throw new Error("You can only promote to a higher rank.");
    if(route==="/api/demote" && (RANK_LEVEL[nextRank]||0)>=(RANK_LEVEL[old.rank]||0)) throw new Error("You can only demote to a lower rank.");
    if(data.dry_run && route==="/api/change-callsign") return {ok:true, dry_run:true, rank_change_needed:rankChangeNeeded, new_callsign:nextCs};
    if(route==="/api/promote") { const elig=rankEligibility(memberFromRow(old)); if(!elig.eligible) throw new Error(elig.reason); if(!admin&&(old.rank!=="EMT"||elig.next_rank!=="AEMT")) throw new Error("Supervisors may only promote EMT members to AEMT."); }
    if(route==="/api/change-rank" && !["EMT|AEMT","AEMT|Senior Volunteer","EMT|Volunteer","Senior Volunteer|AEMT","Volunteer|EMT"].includes(old.rank+"|"+nextRank)) throw new Error("This rank change is not supported.");
    const finalRank=route==="/api/change-callsign"?(admin?slot.rank:old.rank):nextRank;
    const date=route==="/api/change-callsign"?old.date:now.slice(0,10);
    await db.batch([db.prepare("DELETE FROM callsign_slots WHERE callsign=?").bind(nextCs),db.prepare("DELETE FROM members WHERE callsign=?").bind(old.callsign),db.prepare("UPDATE accounts SET callsign=?,updated_at=? WHERE upper(callsign)=upper(?)").bind(nextCs,now,old.callsign),db.prepare(`INSERT INTO members(callsign,name,rank,date,rank_assigned_date,days_in_rank,discord_id,notes,has_basic_firefighting,has_advanced_firefighting,has_supervisor_exam,has_hert,activity,instructor_type,do_not_promote,do_not_terminate,sheet_row,synced_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(nextCs,old.name,finalRank,date,date,0,old.discord_id,old.notes,old.has_basic_firefighting,old.has_advanced_firefighting,old.has_supervisor_exam,old.has_hert,old.activity,old.instructor_type,old.do_not_promote,old.do_not_terminate,slot.sheet_row||null,now),db.prepare("INSERT OR IGNORE INTO callsign_slots(rank,callsign,sheet_row,synced_at) VALUES(?,?,?,?)").bind(rankForCallsign(old.callsign),old.callsign,old.sheet_row,now)]);
    // Record the promotion for PORTAL and Discord confirmation, with the person who made it.
    if(route==="/api/promote"||route==="/api/force-promote") await db.prepare("INSERT INTO promotion_confirmations(callsign,name,old_rank,new_rank,old_callsign,new_callsign,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)").bind(nextCs,String(old.name||""),String(old.rank||""),String(finalRank||nextRank||""),String(old.callsign||""),nextCs,now,String(actor.name||"")).run();
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
    has_hert: !!row.has_hert, do_not_promote: !!row.do_not_promote, do_not_terminate: !!row.do_not_terminate, days_in_rank: days };
}
function compareCallsigns(a, b) {
  const left=String(a||"").trim().toUpperCase().match(/^([A-Z]+)-(\d+)$/);
  const right=String(b||"").trim().toUpperCase().match(/^([A-Z]+)-(\d+)$/);
  if(left && right && left[1]===right[1]) return Number(left[2])-Number(right[2]);
  return String(a||"").localeCompare(String(b||""),undefined,{numeric:true,sensitivity:"base"});
}
async function resolveAccountMember(db, env, user) {
  // A rank change moves the member to a new callsign, so the callsign stored on the account can be out of date.
  // Match by the account's name first (unique match), then fall back to the stored callsign.
  const rows=await readMembers(db,"",env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET));
  const userCallsign=String(user.callsign||"").trim().toUpperCase();
  const byName=rows.filter(row=>nameKey(row.name)===nameKey(user.name));
  const byCallsign=rows.find(row=>String(row.callsign||"").trim().toUpperCase()===userCallsign);
  const member=byName.length===1?byName[0]:(byCallsign||byName[0]||null);
  if(!member) return null;
  const memberCallsign=String(member.callsign||"").trim().toUpperCase();
  if(memberCallsign && memberCallsign!==userCallsign) {
    await db.prepare("UPDATE accounts SET callsign=?,updated_at=? WHERE account_id=?").bind(memberCallsign,new Date().toISOString(),user.account_id).run();
    user.callsign=memberCallsign;
  }
  return member;
}
async function readMembers(db, search = "", env = null, token = "") {
  // Do not seed an empty D1 database from Sheet during a read. Run Sync now.
  await ensureOrderedMembersView(db);
  const q = String(search || "").trim().toLowerCase();
  const result = q
    ? await db.prepare("SELECT * FROM members_roster_ordered WHERE lower(callsign) LIKE ? OR lower(name) LIKE ? OR lower(rank) LIKE ?").bind(`%${q}%`,`%${q}%`,`%${q}%`).all()
    : await db.prepare("SELECT * FROM members_roster_ordered").all();
  const rankOrder=["Commissioners","Chief","County Command","Division Commander","Captain","Lieutenant","Lead Paramedic","Paramedic","AEMT","EMT","Probationary","Senior Volunteer","Volunteer","Probationary Volunteer","EMR","EMR/Volunteer","Liaison"];
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
  const missing=[]; if(Number(member.days_in_rank||0)<rule[1]) missing.push(`${rule[1]-Number(member.days_in_rank||0)} day`);
  const requirementNames={has_basic_firefighting:"basic FORT",has_advanced_firefighting:"advanced FORT",has_supervisor_exam:"supervisor exam"};
  for(const key of [...rule[2],...rule[3]]) if(!member[key]) missing.push(requirementNames[key]||key.replaceAll("_"," "));
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
  return { account_id: account.account_id, id: account.account_id, name: account.name, callsign: account.callsign, view_ranks: await viewRanks(db,account),
    role: account.role, status: account.status, is_admin: ["admin","commander"].includes(account.role), is_operation: account.role === "admin", is_commander: account.role === "commander",
    is_command: ["admin", "commander"].includes(account.role) || /^(E|C|DIV|B|CHIEF|COM)-/.test(account.callsign),
    instructor_type: String(member?.instructor_type || ""), permissions, permission_overrides: parsePermissionOverrides(account.permissions_override_json) };
}
// 10 characters without look-alikes (0/O, 1/l/I). Always passes the 4-20 letters-or-numbers rule.
export function temporaryPassword(length = 10) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && out.length < length) out += alphabet[byte % alphabet.length];
    }
  }
  return out;
}
// ---- Forgot password: a code sent by the Discord bot --------------------------
const RESET_CODE_SECONDS = 600, RESET_MAX_CODE_TRIES = 5, RESET_MAX_REQUESTS_PER_HOUR = 3;
// Six digits, uniformly random.
export function resetCode() {
  const limit = 4294967296 - (4294967296 % 1000000);
  let value;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= limit);
  return String(value % 1000000).padStart(6, "0");
}
async function resetCodeHash(env, accountId, code) {
  const key = String(env.LVFR_D1_AUTH_BRIDGE_SECRET || env.LVFR_D1_WORKER_SECRET || "");
  return key ? hmac(key, `reset:${accountId}:${code}`) : sha256(`reset:${accountId}:${code}`);
}
// Counts requests per client address in the sign-in attempts table (10 per 10 minutes by default).
async function throttleByAddress(db, request, scope, max = 10, windowSeconds = 600) {
  return throttleCounter(db, `${scope}-ip:${request.headers.get("CF-Connecting-IP") || "unknown"}`, max, windowSeconds);
}
async function throttleCounter(db, rawKey, max, windowSeconds) {
  const key = await sha256(rawKey), now = nowSeconds();
  const row = await db.prepare("SELECT window_started_at,attempts FROM auth_login_attempts WHERE login_key=?").bind(key).first();
  if (row && now - row.window_started_at < windowSeconds) {
    if (row.attempts >= max) throw Object.assign(new Error("Too many requests. Wait a few minutes and try again."), { status: 429 });
    await db.prepare("UPDATE auth_login_attempts SET attempts=attempts+1 WHERE login_key=?").bind(key).run();
  } else {
    await db.prepare("INSERT OR REPLACE INTO auth_login_attempts(login_key,window_started_at,attempts) VALUES(?,?,1)").bind(key, now).run();
  }
}
async function sendDiscordDirectMessage(env, discordUserId, content) {
  const channel = await discordRequest(env, "/users/@me/channels", { method: "POST", body: JSON.stringify({ recipient_id: String(discordUserId) }) });
  if (!channel?.id) throw new Error("Discord did not open a direct message channel.");
  await discordRequest(env, `/channels/${channel.id}/messages`, { method: "POST", body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) });
}
async function linkedDiscordUser(db, callsign) {
  return db.prepare("SELECT discord_user_id FROM discord_member_links WHERE upper(callsign)=upper(?) AND status IN ('linked','pending')").bind(callsign).first();
}
// Why a code was not sent goes to the Discord action log, which only staff can open.
function resetCodeLog(db, account, discordUserId, detail) {
  return writeDiscordLog(db, { name: "Password reset" }, "Password reset code sent", account.callsign, account.name, discordUserId, "failed", detail).catch(() => {});
}
// The answer never says whether the name exists or is linked, and all the work after the
// address check runs after the response, so nobody can learn which accounts are linked.
function forgotPassword(context, db, env, request, data) {
  const key = nameKey(data.name);
  context.waitUntil((async () => {
    try {
      if (!key) return;
      const account = await db.prepare("SELECT account_id,name,callsign FROM accounts WHERE name_key=? AND status='approved'").bind(key).first();
      if (!account) return;
      const link = await linkedDiscordUser(db, account.callsign);
      if (!link) { await resetCodeLog(db, account, "", "No Discord link with status linked for this callsign, so no code was sent."); return; }
      const now = nowSeconds();
      const existing = await db.prepare("SELECT request_count,window_started_at FROM password_reset_codes WHERE account_id=?").bind(account.account_id).first();
      const inWindow = existing && now - existing.window_started_at < 3600;
      if (inWindow && existing.request_count >= RESET_MAX_REQUESTS_PER_HOUR) { await resetCodeLog(db, account, link.discord_user_id, "No code was sent: 3 requests in the last hour."); return; }
      const code = resetCode(), hash = await resetCodeHash(env, account.account_id, code);
      await db.prepare(`INSERT INTO password_reset_codes(account_id,code_hash,expires_at,attempts,request_count,window_started_at,requested_at) VALUES(?,?,?,0,?,?,?)
        ON CONFLICT(account_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,request_count=excluded.request_count,window_started_at=excluded.window_started_at,requested_at=excluded.requested_at`)
        .bind(account.account_id, hash, now + RESET_CODE_SECONDS, inWindow ? existing.request_count + 1 : 1, inWindow ? existing.window_started_at : now, now).run();
      try {
        await sendDiscordDirectMessage(env, link.discord_user_id, `LVFR EMS password reset code: **${code}**\nIt expires in 10 minutes. Never share it. If you did not ask for it, ignore this message and tell a Commander.`);
        await writeDiscordLog(db, { name: "Password reset" }, "Password reset code sent", account.callsign, account.name, link.discord_user_id, "done", "A reset code was sent by direct message.");
      } catch (error) {
        await db.prepare("UPDATE password_reset_codes SET expires_at=0 WHERE account_id=?").bind(account.account_id).run();
        await resetCodeLog(db, account, link.discord_user_id, "Discord did not deliver the message (the member may block direct messages from server members). " + String(error?.message || error).slice(0, 160));
        console.error("Password reset direct message failed:", String(error?.message || error).slice(0, 200));
      }
    } catch (error) {
      console.error("Password reset request failed:", String(error?.message || error).slice(0, 200));
      try {
        const known = key ? await db.prepare("SELECT name,callsign FROM accounts WHERE name_key=? AND status='approved'").bind(key).first() : null;
        if (known) await resetCodeLog(db, known, "", "The code could not be created: " + String(error?.message || error).slice(0, 160) + " (is migration 0029 applied?)");
      } catch {}
    }
  })());
  return { ok: true, message: "If this account is linked to Discord, a 6-digit code was sent to it by direct message. It expires in 10 minutes." };
}
async function resetPasswordWithCode(context, db, env, request, data) {
  await throttleByAddress(db, request, "reset");
  const invalid = () => Object.assign(new Error("The code is incorrect or has expired. Request a new code."), { status: 400 });
  const key = nameKey(data.name), code = String(data.code || "").trim();
  if (!key || !/^\d{6}$/.test(code)) throw invalid();
  const account = await db.prepare("SELECT account_id,name,name_key,callsign FROM accounts WHERE name_key=? AND status='approved'").bind(key).first();
  if (!account) throw invalid();
  const row = await db.prepare("SELECT code_hash,expires_at,attempts FROM password_reset_codes WHERE account_id=?").bind(account.account_id).first();
  const now = nowSeconds();
  if (!row || row.expires_at <= now || row.attempts >= RESET_MAX_CODE_TRIES) throw invalid();
  const supplied = await resetCodeHash(env, account.account_id, code);
  if (supplied !== row.code_hash) {
    const attempts = row.attempts + 1;
    await db.prepare("UPDATE password_reset_codes SET attempts=?,expires_at=CASE WHEN ?>=? THEN 0 ELSE expires_at END WHERE account_id=?").bind(attempts, attempts, RESET_MAX_CODE_TRIES, account.account_id).run();
    throw invalid();
  }
  const password = String(data.new_password || "");
  if (!/^[A-Za-z0-9]{4,20}$/.test(password)) throw new Error("New password must be 4–20 letters or numbers.");
  // Spend the code first so it works exactly once, even if two requests arrive together.
  // The row stays, emptied, so the 3-requests-per-hour count is not reset by a successful change.
  const spent = await db.prepare("UPDATE password_reset_codes SET code_hash='',expires_at=0 WHERE account_id=? AND code_hash=? AND expires_at>?").bind(account.account_id, row.code_hash, now).run();
  if (!spent.meta?.changes) throw invalid();
  const salt = b64url(crypto.getRandomValues(new Uint8Array(16))), hash = await passwordHash(password, salt), stamp = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE accounts SET password_salt=?,password_hash=?,password_hash_version='pbkdf2-sha256-100000',updated_at=? WHERE account_id=?").bind(salt, hash, stamp, account.account_id),
    db.prepare("DELETE FROM auth_sessions WHERE account_id=?").bind(account.account_id),
    db.prepare("DELETE FROM auth_login_attempts WHERE login_key=?").bind(await sha256(account.name_key)),
    db.prepare("INSERT INTO account_audit(created_at,account_id,name,callsign,action,actor_name) VALUES(?,?,?,?,?,?)").bind(stamp, account.account_id, account.name, account.callsign, "reset_password_discord", account.name)
  ]);
  if (env.LVFR_D1_AUTH_BRIDGE_SECRET) context.waitUntil(mirrorToSheetInBackground(context, "Account audit", "/internal/logs/mirror", new URL(request.url), "", { kind: "account_audit", account_id: account.account_id, name: account.name, callsign: account.callsign, action: "reset_password_discord", actor_name: account.name }));
  // Tell the member on Discord so a stolen account is noticed.
  context.waitUntil((async () => {
    try {
      const link = await linkedDiscordUser(db, account.callsign);
      if (link) await sendDiscordDirectMessage(env, link.discord_user_id, "Your LVFR EMS password was just changed with a Discord code. If this was not you, tell a Commander now.");
    } catch (error) { console.error("Password change notice failed:", String(error?.message || error).slice(0, 200)); }
  })());
  return { ok: true, message: "Password changed. Sign in with your new password." };
}
// ---- Change the Discord ID from Account Settings ------------------------------
// Three proofs: the site password, a nickname in the LVFR server that starts with the
// account's own callsign, and a code the bot sends to the NEW Discord account.
const DISCORD_CHANGE_COOLDOWN_SECONDS = 86400;
async function discordChangeHash(env, accountId, newId, code) {
  const key = String(env.LVFR_D1_AUTH_BRIDGE_SECRET || env.LVFR_D1_WORKER_SECRET || "");
  const text = `discord:${accountId}:${newId}:${code}`;
  return key ? hmac(key, text) : sha256(text);
}
// Checks the new ID against the server and the callsign. Used when the code is requested and again when it is confirmed.
async function checkNewDiscordId(db, env, callsign, newId) {
  if (!/^\d{17,20}$/.test(newId)) throw Object.assign(new Error("Enter a valid Discord User ID (17 to 20 digits)."), { status: 400 });
  const taken = await db.prepare("SELECT callsign FROM discord_member_links WHERE discord_user_id=? AND callsign<>?").bind(newId, callsign).first();
  if (taken) throw Object.assign(new Error("This Discord User ID is already linked to another member."), { status: 409 });
  const { guildId } = discordConfig(env);
  let guildMember;
  try { guildMember = await discordRequest(env, `/guilds/${guildId}/members/${encodeURIComponent(newId)}`); }
  catch { throw Object.assign(new Error("This Discord User ID was not found in the LVFR Discord server."), { status: 400 }); }
  const nickname = String(guildMember?.nick || "");
  const parsed = parseDiscordNickname(nickname);
  if (!parsed || parsed.callsign !== callsign) throw Object.assign(new Error("Callsign doesn't match"), { status: 400 });
  return { nickname };
}
async function startDiscordIdChange(context, db, env, request, user, data) {
  const member = await resolveAccountMember(db, env, user);
  if (!member) throw Object.assign(new Error("Member not found."), { status: 404 });
  const callsign = String(member.callsign || "").trim().toUpperCase(), newId = String(data.discord_user_id || "").trim();
  const account = await db.prepare("SELECT password_salt,password_hash FROM accounts WHERE account_id=?").bind(user.account_id).first();
  if (!account || await passwordHash(String(data.current_password || ""), account.password_salt) !== account.password_hash) {
    // Wrong passwords are counted, so a stolen session cannot guess the password here (5 tries per 10 minutes).
    await throttleCounter(db, `discord-password:${user.account_id}`, 5, 600);
    throw Object.assign(new Error("Current password is incorrect."), { status: 400 });
  }
  const link = await db.prepare("SELECT discord_user_id FROM discord_member_links WHERE callsign=?").bind(callsign).first();
  if (link && String(link.discord_user_id) === newId) throw Object.assign(new Error("This Discord User ID is already linked to your account."), { status: 400 });
  const now = nowSeconds();
  const row = await db.prepare("SELECT request_count,window_started_at,last_changed_at FROM discord_change_codes WHERE account_id=?").bind(user.account_id).first();
  if (row && row.last_changed_at && now - row.last_changed_at < DISCORD_CHANGE_COOLDOWN_SECONDS) throw Object.assign(new Error("Your Discord ID was changed in the last 24 hours. Try again tomorrow, or ask a Commander."), { status: 429 });
  const inWindow = row && now - row.window_started_at < 3600;
  if (inWindow && row.request_count >= RESET_MAX_REQUESTS_PER_HOUR) throw Object.assign(new Error("Too many codes were requested. Try again in an hour."), { status: 429 });
  await checkNewDiscordId(db, env, callsign, newId);
  const code = resetCode(), hash = await discordChangeHash(env, user.account_id, newId, code);
  await db.prepare(`INSERT INTO discord_change_codes(account_id,new_discord_id,code_hash,expires_at,attempts,request_count,window_started_at,requested_at)
    VALUES(?,?,?,?,0,?,?,?)
    ON CONFLICT(account_id) DO UPDATE SET new_discord_id=excluded.new_discord_id,code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,request_count=excluded.request_count,window_started_at=excluded.window_started_at,requested_at=excluded.requested_at`)
    .bind(user.account_id, newId, hash, now + RESET_CODE_SECONDS, inWindow ? row.request_count + 1 : 1, inWindow ? row.window_started_at : now, now).run();
  try {
    await sendDiscordDirectMessage(env, newId, `LVFR EMS Discord link code: **${code}**\nIt expires in 10 minutes. Enter it in Account Settings to link this Discord account to callsign ${callsign}. Never share it. If you did not ask for it, ignore this message.`);
  } catch (error) {
    await db.prepare("UPDATE discord_change_codes SET expires_at=0,code_hash='' WHERE account_id=?").bind(user.account_id).run();
    console.error("Discord link code message failed:", String(error?.message || error).slice(0, 200));
    throw Object.assign(new Error("The bot could not send a message to that Discord account. Allow direct messages from server members in Discord, then try again."), { status: 400 });
  }
  return { ok: true, message: "A 6-digit code was sent to that Discord account by direct message. It expires in 10 minutes." };
}
async function confirmDiscordIdChange(context, db, env, request, user, data) {
  const member = await resolveAccountMember(db, env, user);
  if (!member) throw Object.assign(new Error("Member not found."), { status: 404 });
  const callsign = String(member.callsign || "").trim().toUpperCase();
  await throttleCounter(db, `discord-confirm:${user.account_id}`, 10, 600);
  const invalid = () => Object.assign(new Error("The code is incorrect or has expired. Request a new code."), { status: 400 });
  const code = String(data.code || "").trim();
  if (!/^\d{6}$/.test(code)) throw invalid();
  const row = await db.prepare("SELECT new_discord_id,code_hash,expires_at,attempts FROM discord_change_codes WHERE account_id=?").bind(user.account_id).first();
  const now = nowSeconds();
  if (!row || !row.code_hash || row.expires_at <= now || row.attempts >= RESET_MAX_CODE_TRIES) throw invalid();
  const newId = String(row.new_discord_id);
  if (await discordChangeHash(env, user.account_id, newId, code) !== row.code_hash) {
    const attempts = row.attempts + 1;
    await db.prepare("UPDATE discord_change_codes SET attempts=?,expires_at=CASE WHEN ?>=? THEN 0 ELSE expires_at END WHERE account_id=?").bind(attempts, attempts, RESET_MAX_CODE_TRIES, user.account_id).run();
    throw invalid();
  }
  // The server and the nickname may have changed since the code was sent, so they are checked again.
  const { nickname } = await checkNewDiscordId(db, env, callsign, newId);
  const spent = await db.prepare("UPDATE discord_change_codes SET code_hash='',expires_at=0,last_changed_at=? WHERE account_id=? AND code_hash=? AND expires_at>?").bind(now, user.account_id, row.code_hash, now).run();
  if (!spent.meta?.changes) throw invalid();
  const previous = await db.prepare("SELECT discord_user_id FROM discord_member_links WHERE callsign=?").bind(callsign).first();
  const stamp = new Date().toISOString();
  await db.prepare(`INSERT INTO discord_member_links(callsign,discord_user_id,member_name,rank,discord_nickname,status,created_at,updated_at)
    VALUES(?,?,?,?,?,'linked',?,?)
    ON CONFLICT(callsign) DO UPDATE SET discord_user_id=excluded.discord_user_id,member_name=excluded.member_name,rank=excluded.rank,discord_nickname=excluded.discord_nickname,status='linked',last_error='',last_synced_at=excluded.updated_at,updated_at=excluded.updated_at`)
    .bind(callsign, newId, String(member.name || ""), String(member.rank || ""), nickname, stamp, stamp).run();
  const oldId = previous?.discord_user_id ? String(previous.discord_user_id) : "";
  await writeDiscordLog(db, user, oldId ? "edit" : "link", callsign, member.name, newId, "done", oldId ? `Changed by the member after a code check: ${oldId} to ${newId}.` : `Linked by the member after a code check: ${newId}.`);
  await db.prepare("INSERT INTO account_audit(created_at,account_id,name,callsign,action,actor_name) VALUES(?,?,?,?,?,?)").bind(stamp, user.account_id, user.name, callsign, "discord_id_changed", user.name).run();
  if (env.LVFR_D1_AUTH_BRIDGE_SECRET) context.waitUntil(mirrorToSheetInBackground(context, "Account audit", "/internal/logs/mirror", new URL(request.url), "", { kind: "account_audit", account_id: user.account_id, name: user.name, callsign, action: "discord_id_changed", actor_name: user.name }));
  context.waitUntil((async () => {
    try {
      if (oldId && oldId !== newId) await sendDiscordDirectMessage(env, oldId, `Your LVFR EMS account ${callsign} was linked to a different Discord account. If this was not you, tell a Commander now.`);
      await sendDiscordDirectMessage(env, newId, `This Discord account is now linked to LVFR EMS callsign ${callsign}.`);
    } catch (error) { console.error("Discord link notice failed:", String(error?.message || error).slice(0, 200)); }
  })());
  return { ok: true, discord_user_id: newId };
}
// Presence: the page sends a heartbeat every 120 s, D1 writes at most once per 100 s per account,
// and an account counts as online for 180 s after its last write. D1 charges every row written
// (an index counts as an extra row), so this keeps the online list inside the free daily limit.
const PRESENCE_WRITE_GAP_SECONDS = 100, PRESENCE_ONLINE_SECONDS = 180;
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
  const identity = await rosterIdentity(env, data.name, db);
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
  return { ok: true, status: "pending", request_id: id, callsign: identity.callsign, sheet_account:{account_id:id,name:identity.name,callsign:identity.callsign,status:"pending",role:"member",created_at:now} };
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
async function requireDiscordPermission(db, token, key) {
  const account = await accountForToken(db, token);
  if (!account || account.status !== "approved") throw Object.assign(new Error("Sign in again."), { status: 401 });
  const permissions = await accountPermissions(db, account);
  if (!permissions[key]) throw Object.assign(new Error("Your role does not have permission for this Discord action."), { status: 403 });
  return account;
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
// Position of a role in the hierarchy (RANK 1 is the top). Admin is always 1.
const DEFAULT_ROLE_ORDER={admin:1,commander:2,leader:3,member:4};
// Records what must be confirmed in PORTAL (and in Discord when required) for an action.
async function recordActionConfirmation(db,route,data,oldMember,result,actor){
  if(!oldMember||result?.changed===false) return;
  const callsign=String(oldMember.callsign||""), name=String(oldMember.name||"");
  const rank=String(oldMember.rank||"");
  let action="", needsDiscord=0, perms="", newRank=rank, newCallsign=callsign;
  // The Discord item always appears in the confirmation bar after these actions, even for a member who is not linked.
  // Before the action, only a linked member is asked about Discord (see the app's pre-action confirmation).
  const discordNeeded=1;
  if(route==="/api/demote"){ action="Demotion"; needsDiscord=discordNeeded; perms="rank_manage"; newRank=String(result.new_rank||rank); newCallsign=String(result.new_callsign||callsign); }
  else if(route==="/api/change-callsign"){ action="Callsign change"; needsDiscord=discordNeeded; perms="callsign_manage"; newCallsign=String(result.new_callsign||data.new_callsign||callsign); }
  else if(route==="/api/terminate"){ action="Termination"; needsDiscord=discordNeeded; perms="termination_manage"; newRank="Terminated"; }
  else if(route==="/api/exam"){ action=data.remove?"Supervisor exam removed":"Supervisor exam"; needsDiscord=0; perms="exam_manage"; }
  else if(route==="/api/training"){
    const training=String(data.training||""), removing=Boolean(data.remove);
    const isKey=training==="Hert"||training==="Basic Firefighting";
    const hertLeft=Number(oldMember.has_hert)===1&&!(removing&&training==="Hert");
    const basicLeft=Number(oldMember.has_basic_firefighting)===1&&!(removing&&training==="Basic Firefighting");
    const hadNone=!(Number(oldMember.has_hert)===1||Number(oldMember.has_basic_firefighting)===1);
    // Adding HERT or Basic to someone with neither needs Discord. Removing the last HERT/Basic needs Discord too.
    needsDiscord=!removing ? ((hadNone&&isKey)?1:0) : ((isKey&&!(hertLeft||basicLeft))?1:0);
    action=(removing?"Training removed: ":"Training added: ")+training;
    perms=training==="Hert"?"training_hert_manage":"training_fort_manage";
  } else if(/\/instructor$/.test(route)){
    // Instructor status: Portal only. Asked when the first instructor type is given, or when the last one is removed.
    const type=String(data.instructor_type||"").toUpperCase(), assigned=Boolean(data.assigned);
    const before=String(oldMember.instructor_type||"").toUpperCase().split(/\s*\/\s*/).filter(Boolean);
    const afterCount=before.filter(t=>t!==type).length+(assigned?1:0);
    if(assigned){ if(before.length>0) return; action="Instructor added: "+type; }
    else { if(afterCount>0) return; action="Instructor removed: "+type; }
    needsDiscord=0; perms="instructor_manage";
  } else return;
  await db.prepare("INSERT INTO promotion_confirmations(callsign,name,old_rank,new_rank,old_callsign,new_callsign,created_at,created_by,action,needs_discord,required_permissions) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .bind(callsign,name,rank,newRank,callsign,newCallsign,new Date().toISOString(),String(actor.name||""),action,needsDiscord,perms).run();
}
async function roleOrderOf(db,role){
  const r=String(role||"").toLowerCase();
  if(r==="admin") return 1;
  const row=await db.prepare("SELECT sort_order FROM role_permissions WHERE role=?").bind(r).first();
  if(row&&row.sort_order!=null) return Number(row.sort_order);
  return DEFAULT_ROLE_ORDER[r]??100;
}
// A non-admin may change only roles strictly below their own rank.
async function assertOutranks(db,actor,targetRole){
  if(String(actor.role||"").toLowerCase()==="admin") return;
  const mine=await roleOrderOf(db,actor.role), theirs=await roleOrderOf(db,targetRole);
  if(theirs<=mine) throw Object.assign(new Error("You cannot change permissions of a role with your rank or higher."),{status:403});
}
function requireRoleProfileManager(actor) {
  if(actor.role!=="admin"&&actor.role!=="commander"&&actor.permissions?.operation_command_access!==true)
    throw Object.assign(new Error("Operation Command access is required."),{status:403});
}
function requireRankPermission(actor,key) {
  if(actor.role==="admin"||actor.permissions?.operation_command_access===true) return;
  if(actor.role!=="admin"&&actor.permissions?.[key]!==true&&actor.permissions?.role_manage!==true) throw Object.assign(new Error("Rank management permission is required."),{status:403});
}
async function leaders(db, actor) {
  const rows = await db.prepare("SELECT account_id,name,callsign,status,role,permissions_override_json,created_at,activated_at,approved_by,admin_changed_at,admin_changed_by FROM accounts WHERE status NOT IN ('removed','denied') ORDER BY created_at DESC").all();
  const audit = await db.prepare("SELECT id,created_at,account_id,name,callsign,action,actor_name,actor_name AS by FROM account_audit ORDER BY id DESC LIMIT 200").all();
  const online = await db.prepare("SELECT account_id,last_seen FROM account_presence WHERE last_seen>?").bind(nowSeconds() - PRESENCE_ONLINE_SECONDS).all();
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
    db.prepare("INSERT INTO account_audit(created_at,account_id,name,callsign,action,actor_name) VALUES(?,?,?,?,?,?)").bind(now,id,target.name,target.callsign,action,actor.name),
    ...(["deny","delete","deactivate"].includes(action) ? [db.prepare("DELETE FROM auth_sessions WHERE account_id=?").bind(id)] : []),
    ...(action==="delete" ? [db.prepare("DELETE FROM account_presence WHERE account_id=?").bind(id)] : []),
    ...(action==="delete" ? [db.prepare("DELETE FROM accounts WHERE account_id=?").bind(id)] : [db.prepare("UPDATE accounts SET status=?,role=?,permissions_override_json=?,activated_at=?,approved_by=?,admin_changed_at=?,admin_changed_by=?,updated_at=? WHERE account_id=?").bind(status,role,role!==target.role?"{}":target.permissions_override_json||"{}",activated,approvedBy,changedAt,changedBy,now,id)])
  ]);
  return { ok:true, status:"saving", sheet_account:{account_id:id,name:target.name,callsign:target.callsign,status:action==="delete"?"removed":status,role,created_at:target.created_at} };
}
function isCommandRank(user) {
  return ["admin","commander"].includes(String(user.role||"").toLowerCase()) || /^(E|C|DIV|B|CHIEF|COM)-/i.test(String(user.callsign||""));
}
function notificationVisible(row,user) {
  // Types tied to a permission are visible to anyone who holds that permission.
  const pref=NOTIFICATION_PREFERENCE_KINDS.find(item=>item.kind===row.kind);
  if(pref) return notifAllowed(user,pref);
  if(row.kind==="request") return ["admin","commander"].includes(String(user.role||""));
  if(row.kind==="inactive") return isCommandRank(user);
  if(row.kind!=="eligible") return false;
  return ["admin","commander"].includes(String(user.role||"")) || isCommandRank(user) || ["AEMT","Senior Volunteer"].includes(String(row.target_rank||""));
}
async function refreshD1Notifications(db,user) {
  const rows=(await db.prepare("SELECT * FROM members").all()).results||[];
  const stateRows=(await db.prepare("SELECT state_key,state_value FROM notification_state").all()).results||[];
  const state=new Map(stateRows.map(row=>[row.state_key,row.state_value]));
  const storedState=new Map(state);
  const additions=[],now=new Date().toISOString();
  for(const member of rows) {
    const eligible=rankEligibility(memberFromRow(member));
    if(eligible.eligible&&eligible.next_rank) additions.push({kind:"eligible",eventKey:"eligible:"+member.callsign+":"+eligible.next_rank,title:"New eligible promotion",message:member.name+" ("+member.callsign+") is eligible for "+eligible.next_rank+".",callsign:member.callsign,targetRank:eligible.next_rank,stateKey:"eligible:"+member.callsign,stateValue:eligible.next_rank});
  }
  const command=isCommandRank(user);
  if(command) for(const member of rows) if(member.activity==="Can Be Terminated"&&!member.do_not_terminate) additions.push({kind:"inactive",eventKey:"inactive:"+member.callsign,title:"Can Be Terminated",message:member.name+" ("+member.callsign+") can be terminated for activity.",callsign:member.callsign,targetRank:"",stateKey:"inactive:"+member.callsign,stateValue:"1"});
  if(command) for(const member of rows) { const m=memberFromRow(member); if(m.rank==="EMT"&&Number(m.days_in_rank||0)>=21&&(!m.has_basic_firefighting||!m.has_advanced_firefighting)) additions.push({kind:"overdue",eventKey:"overdue:"+member.callsign,title:"Training Overdue",message:member.name+" ("+member.callsign+") can be terminated for training overdue.",callsign:member.callsign,targetRank:"",stateKey:"overdue:"+member.callsign,stateValue:"1"}); }
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
      : (item.kind==="inactive"||item.kind==="overdue") && state.has("inactive_seeded") && !state.has(item.stateKey);
    if(shouldNotify) {
      statements.push(db.prepare("INSERT OR IGNORE INTO notifications(kind,event_key,title,message,callsign,target_rank,created_at) VALUES(?,?,?,?,?,?,?)")
        .bind(item.kind,item.eventKey,item.title,item.message,item.callsign,item.targetRank,item.createdAt||now));
    }
    state.set(item.stateKey,item.stateValue);
  }
  for(const key of [...state.keys()]) {
    if(key.startsWith("eligible:")&&!additions.some(item=>item.stateKey===key)) state.delete(key);
    if(command&&key.startsWith("inactive:")&&!additions.some(item=>item.stateKey===key)) state.delete(key);
    if(command&&key.startsWith("overdue:")&&!additions.some(item=>item.stateKey===key)) state.delete(key);
  }
  if(!state.has("eligibility_seeded")) state.set("eligibility_seeded","1");
  if(command&&!state.has("inactive_seeded")) state.set("inactive_seeded","1");
  if(statements.length) await db.batch(statements);
  const lastState=(await db.prepare("SELECT state_key FROM notification_state").all()).results||[];
  const existing=new Set(lastState.map(row=>row.state_key));
  const writes=[];
  for(const key of existing) if(!state.has(key)) writes.push(db.prepare("DELETE FROM notification_state WHERE state_key=?").bind(key));
  // Write only the rows whose value changed, so polling does not rewrite the whole table.
  for(const [key,value] of state) if(storedState.get(key)!==value) writes.push(db.prepare("INSERT INTO notification_state(state_key,state_value) VALUES(?,?) ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value").bind(key,value));
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
  else if(route==="/api/do-not-promote") { kind="do_not_promote"; action=data.blocked?"ADDED":"REMOVED"; details="Do Not Promote"; }
  else if(route==="/api/do-not-terminate") { kind="do_not_terminate"; action=data.blocked?"ADDED":"REMOVED"; details="Do Not Terminate"; }
  else if(route==="/api/terminate") { kind="termination"; action="Terminated"; details=String(data.note||""); }
  else if(/^\/api\/member\/[^/]+\/instructor$/.test(route)) { kind="instructor"; const type=String(data.instructor_type||"").toUpperCase(); action=type+" Instructor "+(data.assigned?"Assigned":"Removed"); details=type; }
  else if(route==="/api/change-callsign") { kind="callsign"; action="Callsign Changed"; newCallsign=String(result.new_callsign||data.new_callsign||""); newRank=String(result.new_rank||old.rank||""); }
  else if(["/api/promote","/api/force-promote","/api/demote","/api/change-rank"].includes(route)) { kind="promotion"; action=route==="/api/demote"?"Demoted":route==="/api/change-rank"?"Rank Changed":"Promoted"; newCallsign=String(result.new_callsign||""); newRank=String(result.new_rank||""); }
  if(!kind) return;
  if(!newCallsign) newCallsign=callsign;
  const inserted=await db.prepare(`INSERT INTO operational_logs(kind,log_date,callsign,member_name,action,details,changed_by,old_rank,new_rank,old_callsign,new_callsign)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(kind,now,callsign,String(old.name||""),action,details,String(user.name||""),String(old.rank||""),newRank||String(old.rank||""),kind==="callsign"||kind==="promotion"?callsign:"",kind==="callsign"||kind==="promotion"?newCallsign:"").run();
  await createLogNotification(db,kind,{action,details,oldRank:String(old.rank||""),newRank,callsign,newCallsign,name:String(old.name||""),logId:inserted?.meta?.last_row_id});
}
// Titles for operational-log changes that also create a notification. Who sees each one is still decided by Notification Settings.
const LOG_NOTIFICATION_TITLES={promotion:"Promotion",termination:"Termination",callsign:"Callsign",training:"Training",exam:"Exam",note:"Note",activity:"Activity",instructor:"Instructor",do_not_promote:"Do Not Promote",do_not_terminate:"Do Not Terminate",loi:"LOI",training_time:"Training Hours"};
async function createLogNotification(db,kind,info) {
  const eventKey=info.eventKey||(info.logId?"log:"+info.logId:"");
  if(!LOG_NOTIFICATION_TITLES[kind]||!eventKey) return;
  try {
    const shownCallsign=info.newCallsign||info.callsign;
    const change=info.oldRank&&info.newRank&&info.oldRank!==info.newRank?" ("+info.oldRank+" → "+info.newRank+")":"";
    const detail=info.details?" - "+info.details:"";
    const message=((info.name||shownCallsign)+" ("+shownCallsign+") "+info.action+change+detail).trim();
    await db.prepare("INSERT OR IGNORE INTO notifications(kind,event_key,title,message,callsign,target_rank,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(kind,eventKey,LOG_NOTIFICATION_TITLES[kind],message,shownCallsign,info.newRank||"",new Date().toISOString()).run();
  } catch(error) {
    console.error("Notification write failed:",error);
  }
}

// FORT LOI passes may certify Basic and/or Advanced Firefighting.
const FORT_PASS_TRAININGS=["Basic Firefighting","Advanced Firefighting"];

// ---- Sheet mirror queue (manual) -------------------------------------------
// D1 is the source of truth. A Google Sheet mirror that still fails after its
// immediate retries is stored in mirror_queue. Nothing replays it automatically:
// a replay writes the old change into the Sheet, so an Operation or Commander
// account reviews the rows and retries or discards them from Operation Command.
const MIRROR_MAX_PENDING = 500;
const MIRROR_MAX_PAYLOAD = 200000;
async function enqueueMirror(db, { label, route, method, query, actorId, data, error, dedupe }) {
  try {
    if (!db) return false;
    const payload = JSON.stringify(data ?? {});
    if (payload.length > MIRROR_MAX_PAYLOAD) { console.error(label + " Sheet mirror is too large to queue."); return false; }
    const actor = String(actorId || "");
    if (dedupe) {
      const existing = await db.prepare("SELECT id FROM mirror_queue WHERE status IN ('pending','running') AND route=? AND actor_account_id=? AND data_json=? LIMIT 1").bind(route, actor, payload).first();
      if (existing) return true;
    }
    const pending = await db.prepare("SELECT COUNT(*) AS n FROM mirror_queue WHERE status IN ('pending','running')").first();
    if (Number(pending?.n || 0) >= MIRROR_MAX_PENDING) { console.error(label + " Sheet mirror was dropped: the queue is full."); return false; }
    const now = nowSeconds();
    await db.prepare("INSERT INTO mirror_queue(label,route,method,query,actor_account_id,data_json,status,attempts,last_error,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,'pending',1,?,0,?,?)")
      .bind(String(label || ""), route, String(method || "POST").toUpperCase(), String(query || "").replace(/^\?/, ""), actor, payload, String(error || "").slice(0, 500), now, now).run();
    return true;
  } catch (queueError) { console.error("Could not queue the Sheet mirror:", queueError); return false; }
}

// Sheet mirror for writes whose D1 change is already committed. Runs after the
// response via waitUntil, retries transient failures, then queues what is left.
// D1 is never rolled back.
async function mirrorToSheetInBackground(context,label,route,url,assertion,data,actorId="",options={}){
  let lastError="";
  for(let attempt=1;attempt<=3;attempt++){
    try {
      const { proxyToAppsScript } = await import("../[[path]].js");
      const response=await proxyToAppsScript(context,route,url,assertion,data);
      if(response.ok) return;
      lastError=String(await response.text()).slice(0,500);
    } catch(error) { lastError=String(error?.message||error).slice(0,500); }
    if(attempt<3) await new Promise(resolve=>setTimeout(resolve,1000*attempt));
  }
  console.error(label+" Sheet mirror failed after retries; kept in the mirror queue:",lastError);
  await enqueueMirror(context.env.LVFR_DB,{label,route,method:context.request.method,query:url.search,actorId,data,error:lastError,dedupe:options.dedupe===true});
}

// Replays pending rows oldest first (or just one row when id is given).
export async function processMirrorQueue(context, { id = null, limit = 20 } = {}) {
  const { env } = context, db = env.LVFR_DB;
  const summary = { processed: 0, done: 0, failed: 0 };
  if (!db) return summary;
  const now = nowSeconds();
  const due = id
    ? (await db.prepare("SELECT * FROM mirror_queue WHERE id=? AND (status='pending' OR (status='running' AND locked_until<?))").bind(Number(id), now).all()).results || []
    : (await db.prepare("SELECT * FROM mirror_queue WHERE status='pending' OR (status='running' AND locked_until<?) ORDER BY id LIMIT ?").bind(now, limit).all()).results || [];
  for (const row of due) {
    // Claim the row first so two clicks never replay the same write twice.
    const claim = await db.prepare("UPDATE mirror_queue SET status='running',locked_until=?,updated_at=? WHERE id=? AND (status='pending' OR (status='running' AND locked_until<?))").bind(now + 120, now, row.id, now).run();
    if (!claim.meta?.changes) continue;
    summary.processed++;
    let error = "";
    try {
      let assertion = "";
      if (row.actor_account_id) {
        if (!env.LVFR_D1_AUTH_BRIDGE_SECRET) throw new Error("LVFR_D1_AUTH_BRIDGE_SECRET is not configured.");
        const actor = await db.prepare("SELECT account_id,name,callsign,status,role,permissions_override_json FROM accounts WHERE account_id=?").bind(row.actor_account_id).first();
        if (!actor) throw new Error("The account that made this change no longer exists.");
        actor.permissions = await accountPermissions(db, actor);
        // Assertions expire after 90 seconds, so a fresh one is signed for every replay.
        assertion = await signedClaims(actor, env.LVFR_D1_AUTH_BRIDGE_SECRET);
      }
      const target = new URL(row.route + (row.query ? "?" + row.query : ""), "https://lvfr.invalid");
      const replayContext = { env, request: new Request(target.toString(), { method: row.method || "POST" }) };
      const { proxyToAppsScript } = await import("../[[path]].js");
      const response = await proxyToAppsScript(replayContext, row.route, target, assertion, JSON.parse(row.data_json || "{}"));
      if (!response.ok) error = String(await response.text()).slice(0, 500) || ("HTTP " + response.status);
    } catch (replayError) { error = String(replayError?.message || replayError).slice(0, 500); }
    const finished = nowSeconds();
    if (!error) {
      await db.prepare("UPDATE mirror_queue SET status='done',locked_until=0,last_error='',updated_at=? WHERE id=?").bind(finished, row.id).run();
      summary.done++;
    } else {
      await db.prepare("UPDATE mirror_queue SET status='pending',attempts=attempts+1,last_error=?,locked_until=0,updated_at=? WHERE id=?").bind(error, finished, row.id).run();
      summary.failed++;
    }
  }
  return summary;
}

const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_CALLSIGN_RE = /^\s*\[([^\]]{1,32})\]\s*(.*)$/;
const discordSleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function normalizeDiscordCallsign(value) { return String(value || "").trim().toUpperCase(); }
export function parseDiscordNickname(value) {
  const match = String(value || "").match(DISCORD_CALLSIGN_RE);
  if (!match) return null;
  const callsign = normalizeDiscordCallsign(match[1]);
  if (!/^[A-Z]+-\d+$/.test(callsign)) return null;
  return { callsign, namePart: String(match[2] || "").trim() };
}
function discordRoleMap(env) {
  let parsed;
  try { parsed = JSON.parse(String(env.DISCORD_ROLE_MAP || "{}")); }
  catch { throw new Error("DISCORD_ROLE_MAP must be valid JSON mapping website rank names to Discord role IDs."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("DISCORD_ROLE_MAP must be a JSON object.");
  const map = new Map();
  for (const [rank, roleIdRaw] of Object.entries(parsed)) {
    const roleId = String(roleIdRaw || "").trim();
    if (!rank.trim() || !/^\d{17,20}$/.test(roleId)) throw new Error("DISCORD_ROLE_MAP contains an invalid rank or Discord role ID.");
    map.set(String(rank).trim().toLowerCase(), roleId);
  }
  return map;
}
function discordConfig(env) {
  const token = String(env.DISCORD_BOT_TOKEN || "").trim();
  const guildId = String(env.DISCORD_GUILD_ID || "").trim();
  if (!token || !guildId) throw new Error("Discord is not configured. Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID in Cloudflare Secrets/Variables.");
  if (!/^\d{17,20}$/.test(guildId)) throw new Error("DISCORD_GUILD_ID is not a valid Discord snowflake ID.");
  return { token, guildId };
}
async function discordRequest(env, path, options = {}) {
  const { token } = discordConfig(env);
  for (let attempt = 0; attempt < 4; attempt++) {
    let response;
    try {
      response = await fetch(DISCORD_API_BASE + path, {
        ...options,
        headers: { Authorization: `Bot ${token}`, ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
      });
    } catch {
      throw new Error("Could not connect to the Discord API.");
    }
    if (response.status === 429 && attempt < 3) {
      const payload = await response.json().catch(() => ({}));
      const delay = Math.ceil(Number(payload.retry_after || response.headers.get("Retry-After") || 1) * 1000);
      if (delay > 5000) throw new Error("Discord rate limit requires a longer wait. Retry the operation shortly.");
      await discordSleep(Math.max(250, delay));
      continue;
    }
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = String(payload.message || payload.error || `HTTP ${response.status}`).slice(0, 180);
      if (response.status === 401) throw new Error("Discord rejected the bot token. Check DISCORD_BOT_TOKEN.");
      if (response.status === 403) throw new Error("Discord denied the request. Check bot permissions, role hierarchy, and the Server Members Intent.");
      if (response.status === 404) throw new Error("The Discord member or resource was not found.");
      throw new Error(`Discord API error (${response.status}): ${detail}`);
    }
    return payload;
  }
  throw new Error("Discord rate limit retries were exhausted. Try again shortly.");
}
async function updateDiscordMemberFromMapping(db, env, discordUserId) {
  const row = await db.prepare("SELECT * FROM discord_member_links WHERE discord_user_id=?").bind(String(discordUserId)).first();
  if (!row) throw new Error("Discord mapping was not found.");
  const newCallsign = normalizeDiscordCallsign(row.pending_callsign || row.callsign);
  const newRank = String(row.pending_rank || row.rank || "").trim();
  const shouldUpdateRoles = Number(row.pending_update_roles || 0) === 1;
  if (!newCallsign) throw new Error("The target callsign is empty.");
  const { guildId } = discordConfig(env);
  const conflicting = await db.prepare("SELECT discord_user_id FROM discord_member_links WHERE callsign=? AND discord_user_id<>?").bind(newCallsign, String(discordUserId)).first();
  if (conflicting) throw new Error("The new callsign is already mapped to another Discord member; mapping was not overwritten.");
  const roleMap = shouldUpdateRoles ? discordRoleMap(env) : new Map();
  const desiredRoleId = shouldUpdateRoles ? roleMap.get(newRank.toLowerCase()) : "";
  if (shouldUpdateRoles && !desiredRoleId) throw new Error(`No Discord role is configured for website rank "${newRank}". Set DISCORD_ROLE_MAP before retrying.`);

  const member = await discordRequest(env, `/guilds/${guildId}/members/${encodeURIComponent(String(discordUserId))}`);
  // Only the server nickname carries the callsign; display names and usernames are never parsed.
  const currentNickname = String(member.nick || "").trim();
  const parsed = parseDiscordNickname(currentNickname);
  if (!parsed) throw new Error("The member's current nickname does not start with a valid [Callsign] prefix; refusing to guess the name.");
  // Only the [CALLSIGN] prefix changes; the rest of the nickname stays exactly as it is in Discord.
  const desiredNickname = currentNickname.replace(/^\s*\[[^\]]*\]/, `[${newCallsign}]`);
  if (desiredNickname.length > 32) throw new Error("The resulting Discord nickname exceeds Discord's 32-character limit.");
  if (currentNickname !== desiredNickname) {
    await discordRequest(env, `/guilds/${guildId}/members/${encodeURIComponent(String(discordUserId))}`, {
      method: "PATCH", body: JSON.stringify({ nick: desiredNickname }),
    });
  }

  if (shouldUpdateRoles) {
    const managedRoleIds = [...new Set([...roleMap.values()])];
    const currentRoles = new Set(Array.isArray(member.roles) ? member.roles.map(String) : []);
    if (!currentRoles.has(desiredRoleId)) {
      await discordRequest(env, `/guilds/${guildId}/members/${encodeURIComponent(String(discordUserId))}/roles/${desiredRoleId}`, { method: "PUT" });
    }
    for (const roleId of managedRoleIds) {
      if (roleId !== desiredRoleId && currentRoles.has(roleId)) {
        await discordRequest(env, `/guilds/${guildId}/members/${encodeURIComponent(String(discordUserId))}/roles/${roleId}`, { method: "DELETE" });
      }
    }
  }

  const now = new Date().toISOString();
  const oldCallsign = String(row.callsign || "");
  await db.prepare(`UPDATE discord_member_links SET callsign=?,rank=?,discord_nickname=?,status='linked',pending_callsign='',pending_rank='',pending_update_roles=0,last_error='',last_synced_at=?,updated_at=? WHERE discord_user_id=?`)
    .bind(newCallsign, newRank, desiredNickname, now, now, String(discordUserId)).run();
  return { ok: true, discord_user_id: String(discordUserId), old_callsign: oldCallsign, callsign: newCallsign, rank: newRank };
}
// Audit log for Discord actions (termination, edits, delinking). Visible to Operation Command.
async function writeDiscordLog(db, actor, action, callsign, memberName, discordUserId, outcome, detail) {
  await db.prepare("INSERT INTO discord_action_log(created_at,actor_name,action,callsign,member_name,discord_user_id,outcome,detail) VALUES(?,?,?,?,?,?,?,?)")
    .bind(new Date().toISOString(), String(actor?.name||""), String(action||""), normalizeDiscordCallsign(callsign), String(memberName||""), String(discordUserId||""), String(outcome), String(detail||"").slice(0,400)).run();
}
// Applies the admin's chosen Discord action to a terminated member.
//   kick:         remove the member from the server.
//   remove_roles: remove the managed job roles and clear the nickname.
//   none:         clear the nickname only.
// Each option then removes the Discord link. The roster termination is already saved and is never undone here.
// If Discord refuses, the link is kept with status failed and the log records why.
async function discordTerminationAction(db, env, actor, callsign, action, memberName) {
  const cs = normalizeDiscordCallsign(callsign);
  const link = await db.prepare("SELECT discord_user_id FROM discord_member_links WHERE callsign=?").bind(cs).first();
  if (!link) {
    await writeDiscordLog(db, actor, action, cs, memberName, "", "skipped", "No Discord link for this callsign.");
    return { status: "skipped", detail: "No Discord link for this callsign." };
  }
  const uid = String(link.discord_user_id);
  const reason = "LVFR EMS termination (" + action + ")";
  const auditHeaders = { "X-Audit-Log-Reason": encodeURIComponent(reason) };
  try {
    const { guildId } = discordConfig(env);
    const base = `/guilds/${guildId}/members/${encodeURIComponent(uid)}`;
    let member = null;
    try { member = await discordRequest(env, base); }
    catch (error) { if (!/was not found/.test(String(error?.message || ""))) throw error; }
    let detail;
    if (!member) detail = "Member is no longer in the Discord server; nothing changed in Discord.";
    else if (action === "kick") {
      await discordRequest(env, base, { method: "DELETE", headers: auditHeaders });
      detail = "Removed from the Discord server.";
    } else {
      if (action === "remove_roles") {
        const managed = [...new Set(discordRoleMap(env).values())];
        const current = new Set(Array.isArray(member.roles) ? member.roles.map(String) : []);
        for (const roleId of managed) {
          if (current.has(roleId)) await discordRequest(env, `${base}/roles/${roleId}`, { method: "DELETE", headers: auditHeaders });
        }
      }
      if (member.nick) await discordRequest(env, base, { method: "PATCH", body: JSON.stringify({ nick: null }), headers: auditHeaders });
      detail = action === "remove_roles" ? "Managed job roles removed and nickname cleared." : "Nickname cleared.";
    }
    await db.prepare("DELETE FROM discord_member_links WHERE callsign=?").bind(cs).run();
    await writeDiscordLog(db, actor, action, cs, memberName, uid, "done", detail);
    return { status: "done", detail };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 300);
    // Blank pending fields so the automatic retry never re-applies a nickname to a terminated member.
    await db.prepare("UPDATE discord_member_links SET status='failed',last_error=?,pending_callsign='',pending_rank='',pending_update_roles=0,updated_at=? WHERE callsign=?")
      .bind("Termination Discord action failed: " + message, new Date().toISOString(), cs).run();
    await writeDiscordLog(db, actor, action, cs, memberName, uid, "failed", message);
    console.error("Discord termination action failed:", message);
    return { status: "failed", message };
  }
}
// Ops role: a linked member who holds HERT, Basic FORT or Advanced FORT gets the ops Discord role;
// a linked member who holds none of them loses it. Needs DISCORD_OPS_ROLE_ID (a Discord role ID).
function discordOpsRoleId(env) {
  const roleId = String(env.DISCORD_OPS_ROLE_ID || "").trim();
  if (!roleId) return "";
  if (!/^\d{17,20}$/.test(roleId)) throw new Error("DISCORD_OPS_ROLE_ID is not a valid Discord role ID.");
  return roleId;
}
async function applyDiscordOpsRole(db, env, callsign, qualifies) {
  const link = await db.prepare("SELECT discord_user_id,status FROM discord_member_links WHERE callsign=?").bind(normalizeDiscordCallsign(callsign)).first();
  if (!link || link.status === "left") return { outcome: "not_linked", discord_user_id: "" };
  const discordUserId = String(link.discord_user_id);
  const roleId = discordOpsRoleId(env);
  if (!roleId) return { outcome: "not_configured", discord_user_id: discordUserId };
  const { guildId } = discordConfig(env);
  const path = `/guilds/${guildId}/members/${encodeURIComponent(discordUserId)}`;
  const member = await discordRequest(env, path);
  const hasRole = Array.isArray(member.roles) && member.roles.map(String).includes(roleId);
  if (qualifies && !hasRole) {
    await discordRequest(env, `${path}/roles/${roleId}`, { method: "PUT" });
    return { outcome: "ops role added", discord_user_id: discordUserId };
  }
  if (!qualifies && hasRole) {
    await discordRequest(env, `${path}/roles/${roleId}`, { method: "DELETE" });
    return { outcome: "ops role removed", discord_user_id: discordUserId };
  }
  return { outcome: "no change", discord_user_id: discordUserId };
}
// True when a roster row holds HERT, Basic FORT or Advanced FORT.
function holdsOpsTraining(row) {
  return Boolean(Number(row?.has_hert || 0) || Number(row?.has_basic_firefighting || 0) || Number(row?.has_advanced_firefighting || 0));
}
// Applies the ops role to a list of callsigns whose training changed (Sheet sync). Runs in the background.
async function applyOpsRoleChanges(db, env, actor, changes) {
  for (const change of changes) {
    try {
      const outcome = await applyDiscordOpsRole(db, env, change.callsign, change.qualifies);
      if (outcome.outcome !== "not_linked" && outcome.outcome !== "no change")
        await writeDiscordLog(db, actor, change.qualifies ? "Ops role added" : "Ops role removed", change.callsign, change.name, outcome.discord_user_id, "done", outcome.outcome);
    } catch (error) {
      const message = String(error?.message || error).slice(0, 400);
      console.error("Discord ops role update failed:", { callsign: change.callsign, error: message });
      const link = await db.prepare("SELECT discord_user_id FROM discord_member_links WHERE callsign=?").bind(change.callsign).first().catch(() => null);
      if (link) await writeDiscordLog(db, actor, change.qualifies ? "Ops role added" : "Ops role removed", change.callsign, change.name, link.discord_user_id, "failed", message).catch(() => {});
    }
  }
}
// Checks every linked member against the roster and fixes the ops role. Started by Sync Discord.
async function reconcileDiscordOpsRoles(db, env, actor) {
  if (!discordOpsRoleId(env)) {
    await writeDiscordLog(db, actor, "Ops role check", "", "", "", "skipped", "DISCORD_OPS_ROLE_ID is not set, so no ops roles were changed.");
    return;
  }
  const rows = (await db.prepare(`SELECT l.callsign,l.discord_user_id,m.name,m.has_hert,m.has_basic_firefighting,m.has_advanced_firefighting
    FROM discord_member_links l JOIN members m ON m.callsign=l.callsign WHERE l.status<>'left'`).all()).results || [];
  const changes = rows.map(row => ({ callsign: normalizeDiscordCallsign(row.callsign), name: row.name || "", qualifies: holdsOpsTraining(row) }));
  let added = 0, removed = 0, failed = 0;
  for (const change of changes) {
    try {
      const outcome = await applyDiscordOpsRole(db, env, change.callsign, change.qualifies);
      if (outcome.outcome === "ops role added") added++;
      else if (outcome.outcome === "ops role removed") removed++;
    } catch (error) {
      failed++;
      console.error("Discord ops role check failed:", { callsign: change.callsign, error: String(error?.message || error).slice(0, 400) });
    }
  }
  await writeDiscordLog(db, actor, "Ops role check", "", "", "", failed ? "partial" : "done", `Checked ${changes.length} linked members; added ${added}; removed ${removed}; failed ${failed}.`);
}
// Name used to compare the roster name stored on a Discord link with a roster member's name: case and spacing ignored.
function sameRosterName(a, b) {
  const key = value => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
  return key(a) !== "" && key(a) === key(b);
}
// Finds Discord links whose callsign is no longer on the roster. A link moves to the roster member who has the same name
// (the name stored with the link) and no Discord link yet. Only a single clear match moves; anything else is left for an admin.
function planDiscordCallsignMoves(links, rosterMembers) {
  const roster = rosterMembers.map(member => ({
    callsign: normalizeDiscordCallsign(member.callsign), name: String(member.name || "").trim(), rank: String(member.rank || "").trim(),
  })).filter(member => member.callsign);
  const rosterCallsigns = new Set(roster.map(member => member.callsign));
  const linkedCallsigns = new Set(links.map(link => normalizeDiscordCallsign(link.callsign)));
  const free = roster.filter(member => !linkedCallsigns.has(member.callsign));
  const claims = new Map();
  for (const link of links) {
    const oldCallsign = normalizeDiscordCallsign(link.callsign);
    if (rosterCallsigns.has(oldCallsign)) continue;
    const matches = free.filter(member => sameRosterName(member.name, link.member_name));
    if (matches.length !== 1) continue;
    const target = matches[0].callsign;
    claims.set(target, [...(claims.get(target) || []), { link, oldCallsign, member: matches[0] }]);
  }
  // Two links matching the same roster member: neither is moved.
  return [...claims.values()].filter(list => list.length === 1).map(([{ link, oldCallsign, member }]) => ({
    oldCallsign, newCallsign: member.callsign, name: member.name, rank: member.rank, discordUserId: String(link.discord_user_id),
    updateRoles: String(link.rank || "").trim().toLowerCase() !== member.rank.toLowerCase(),
  }));
}
// Moves the link in D1 right away, so Linked members shows the new callsign. The Discord nickname is updated in the background.
async function moveDiscordLinks(db, moves) {
  const now = new Date().toISOString();
  for (const move of moves) {
    await db.prepare(`UPDATE discord_member_links SET callsign=?,member_name=?,pending_callsign=?,pending_rank=?,pending_update_roles=?,status='pending',last_error='',updated_at=? WHERE discord_user_id=? AND callsign=?`)
      .bind(move.newCallsign, move.name, move.newCallsign, move.rank, move.updateRoles ? 1 : 0, now, move.discordUserId, move.oldCallsign).run();
  }
}
async function runDiscordCallsignMoves(db, env, moves) {
  const actor = { name: "Google Sheet sync" };
  for (const move of moves) {
    try {
      await updateDiscordMemberFromMapping(db, env, move.discordUserId);
      await writeDiscordLog(db, actor, "Callsign moved", move.newCallsign, move.name, move.discordUserId, "done", `From ${move.oldCallsign} to ${move.newCallsign}, matched by name.`);
    } catch (error) {
      const message = String(error?.message || error).slice(0, 400);
      await db.prepare("UPDATE discord_member_links SET status='failed',last_error=?,updated_at=? WHERE discord_user_id=?").bind(message, new Date().toISOString(), move.discordUserId).run().catch(() => {});
      await writeDiscordLog(db, actor, "Callsign moved", move.newCallsign, move.name, move.discordUserId, "failed", message).catch(() => {});
    }
  }
}
// A linked member whose rank changed in the Sheet gets the Discord rank role updated, the same way a website rank change does.
async function applyRankChanges(db, changes) {
  const now = new Date().toISOString();
  for (const change of changes) {
    await db.prepare(`UPDATE discord_member_links SET pending_callsign=?,pending_rank=?,pending_update_roles=1,status='pending',last_error='',updated_at=? WHERE discord_user_id=?`)
      .bind(change.callsign, change.rank, now, change.discordUserId).run();
  }
}
async function runRankChanges(db, env, changes) {
  const actor = { name: "Google Sheet sync" };
  for (const change of changes) {
    try {
      await updateDiscordMemberFromMapping(db, env, change.discordUserId);
      await writeDiscordLog(db, actor, "Rank changed", change.callsign, change.name, change.discordUserId, "done", `New rank: ${change.rank}.`);
    } catch (error) {
      const message = String(error?.message || error).slice(0, 400);
      await db.prepare("UPDATE discord_member_links SET status='failed',last_error=?,updated_at=? WHERE discord_user_id=?").bind(message, new Date().toISOString(), change.discordUserId).run().catch(() => {});
      await writeDiscordLog(db, actor, "Rank changed", change.callsign, change.name, change.discordUserId, "failed", message).catch(() => {});
    }
  }
}
async function queueDiscordRosterChange(db, context, env, oldMember, result) {
  const route = String(new URL(context.request.url).pathname);
  if (!oldMember || !["/api/promote","/api/force-promote","/api/demote","/api/change-rank","/api/change-callsign"].includes(route)) return "not_applicable";
  const oldCallsign = normalizeDiscordCallsign(oldMember.callsign);
  const newCallsign = normalizeDiscordCallsign(result?.new_callsign || oldCallsign);
  const newRank = String(result?.new_rank || oldMember.rank || "").trim();
  if (!oldCallsign || !newCallsign) return "not_linked";
  const link = await db.prepare("SELECT * FROM discord_member_links WHERE callsign=? OR pending_callsign=? LIMIT 1").bind(oldCallsign, oldCallsign).first();
  if (!link) return "not_linked";
  if (link.status === "left") return "left_server";
  const rankChanged = String(link.rank || oldMember.rank || "").trim().toLowerCase() !== newRank.toLowerCase();
  const now = new Date().toISOString();
  await db.prepare("UPDATE discord_member_links SET pending_callsign=?,pending_rank=?,pending_update_roles=?,status='pending',last_error='',updated_at=? WHERE discord_user_id=?")
    .bind(newCallsign, newRank, rankChanged ? 1 : 0, now, link.discord_user_id).run();
  context.waitUntil((async () => {
    try {
      await updateDiscordMemberFromMapping(db, env, link.discord_user_id);
    } catch (error) {
      const message = String(error?.message || error).slice(0, 400);
      await db.prepare("UPDATE discord_member_links SET status='failed',last_error=?,updated_at=? WHERE discord_user_id=?")
        .bind(message, new Date().toISOString(), link.discord_user_id).run();
      console.error("Discord roster synchronization failed:", { callsign: oldCallsign, error: message });
    }
  })());
  return "pending";
}
async function runInitialDiscordLinkSync(db, env, user) {
  const { guildId } = discordConfig(env);
  if (!env.LVFR_D1_AUTH_BRIDGE_SECRET) throw new Error("The Google Sheets bridge is not configured; cannot refresh the authoritative roster.");
  // Refresh the roster snapshot from Google Sheets before linking identities.
  await syncMembersFromAppsScript(env, await signedClaims(user, env.LVFR_D1_AUTH_BRIDGE_SECRET), true);
  const rosterRows = (await db.prepare("SELECT callsign,name,rank FROM members WHERE trim(callsign)<>''").all()).results || [];
  const roster = new Map(rosterRows.map(row => [normalizeDiscordCallsign(row.callsign), row]));
  const foundByCallsign = new Map();
  const unmatchedDiscord = [], malformed = [];
  let processed = 0, after = "";
  const seenUserIds = new Set();
  // Discord returns up to 1,000 members per request. Keep the scan bounded to avoid an unbounded Pages Function invocation.
  const maxMembers = 10000;
  while (true) {
    const query = new URLSearchParams({ limit: "1000" });
    if (after) query.set("after", after);
    const page = await discordRequest(env, `/guilds/${guildId}/members?${query.toString()}`);
    if (!Array.isArray(page)) throw new Error("Discord returned an invalid guild-members response.");
    processed += page.length;
    for (const member of page) {
      if (member.user?.id) seenUserIds.add(String(member.user.id));
      const nickname = String(member.nick || "");
      const parsed = parseDiscordNickname(nickname);
      if (!parsed) { malformed.push({ user: member.user?.username || member.user?.id || "unknown", reason: "Nickname has no [Callsign] prefix" }); continue; }
      const rosterMember = roster.get(parsed.callsign);
      if (!rosterMember) { unmatchedDiscord.push({ callsign: parsed.callsign, user: member.user?.username || member.user?.id || "unknown" }); continue; }
      const candidates = foundByCallsign.get(parsed.callsign) || [];
      candidates.push({ userId: String(member.user?.id || ""), username: String(member.user?.username || ""), callsign: parsed.callsign, rosterMember, nick: nickname });
      foundByCallsign.set(parsed.callsign, candidates);
    }
    if (page.length < 1000) break;
    if (processed >= maxMembers) throw new Error(`The server has at least ${maxMembers} members. The initial sync is safely stopped before linking because this implementation's one-run scan limit was reached. Increase the bounded limit or implement resumable scanning before retrying.`);
    after = String(page[page.length - 1]?.user?.id || "");
    if (!after) throw new Error("Discord pagination returned no last user ID; no links were written.");
  }

  const now = new Date().toISOString(), linked = [], conflicts = [], duplicates = [], unmatchedRoster = [];
  const linksByCallsign = new Map(), linksByUser = new Map();
  for (const row of ((await db.prepare("SELECT callsign,discord_user_id,member_name,rank,discord_nickname,status FROM discord_member_links").all()).results || [])) {
    linksByCallsign.set(row.callsign, row);
    if (!linksByUser.has(String(row.discord_user_id))) linksByUser.set(String(row.discord_user_id), row);
  }
  for (const [callsign, rosterMember] of roster) {
    const candidates = foundByCallsign.get(callsign) || [];
    if (!candidates.length) { unmatchedRoster.push({ callsign, name: rosterMember.name }); continue; }
    if (candidates.length !== 1) { duplicates.push({ callsign, count: candidates.length, users: candidates.slice(0, 5).map(candidate => candidate.username || candidate.userId) }); continue; }
    const candidate = candidates[0];
    if (!/^\d{17,20}$/.test(candidate.userId)) { conflicts.push({ callsign, reason: "Discord returned an invalid user ID" }); continue; }
    const byCallsign = linksByCallsign.get(callsign);
    const byUser = linksByUser.get(String(candidate.userId));
    if ((byCallsign && String(byCallsign.discord_user_id) !== candidate.userId) || (byUser && normalizeDiscordCallsign(byUser.callsign) !== callsign)) {
      conflicts.push({ callsign, user: candidate.username, reason: "Existing Discord mapping conflicts with the discovered match" }); continue;
    }
    if (discordLinkUnchanged(byCallsign, candidate, rosterMember)) {
      linked.push({ callsign, name: rosterMember.name, rank: rosterMember.rank, user: candidate.username || candidate.userId });
      continue;
    }
    await db.prepare(`INSERT INTO discord_member_links(callsign,discord_user_id,member_name,rank,discord_nickname,status,pending_callsign,pending_rank,pending_update_roles,last_error,last_synced_at,created_at,updated_at)
      VALUES(?,?,?,?,?,'linked','','',0,'','',?,?)
      ON CONFLICT(callsign) DO UPDATE SET member_name=excluded.member_name,rank=excluded.rank,discord_nickname=excluded.discord_nickname,updated_at=excluded.updated_at,
        status=CASE WHEN discord_member_links.status='left' THEN 'linked' ELSE discord_member_links.status END,
        last_error=CASE WHEN discord_member_links.status='left' THEN '' ELSE discord_member_links.last_error END
      WHERE discord_member_links.discord_user_id=excluded.discord_user_id`)
      .bind(callsign, candidate.userId, String(rosterMember.name || ""), String(rosterMember.rank || ""), String(candidate.nick || ""), now, now).run();
    linked.push({ callsign, name: rosterMember.name, rank: rosterMember.rank, user: candidate.username || candidate.userId });
  }
  // A complete scan that no longer contains a linked Discord account means that member has left the server.
  // The row is kept (status left) so the member can be relinked later without losing the history.
  let leftCount = 0;
  const activeRows = (await db.prepare("SELECT callsign, discord_user_id FROM discord_member_links WHERE status IN ('linked','pending','failed')").all()).results || [];
  for (const row of activeRows) {
    if (seenUserIds.has(String(row.discord_user_id))) continue;
    await db.prepare("UPDATE discord_member_links SET status='left',last_error='Not found in the Discord server',updated_at=? WHERE callsign=?").bind(now, row.callsign).run();
    leftCount++;
  }
  const saved = await db.prepare("SELECT COUNT(*) AS count FROM discord_member_links WHERE status='linked'").first();
  return {
    ok: true, processed, roster_members: rosterRows.length, linked_count: linked.length, left_count: leftCount,
    total_linked: Number(saved?.count || 0), unmatched_roster_count: unmatchedRoster.length,
    unmatched_discord_count: unmatchedDiscord.length, malformed_count: malformed.length,
    duplicate_count: duplicates.length, conflict_count: conflicts.length,
    unmatched_roster: unmatchedRoster.slice(0, 50), unmatched_discord: unmatchedDiscord.slice(0, 50),
    malformed: malformed.slice(0, 50), duplicates: duplicates.slice(0, 50), conflicts: conflicts.slice(0, 50),
    message: "Initial linking completed. Discord nicknames and roles were not changed.",
  };
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
      // Discord links whose callsign left the roster are matched by name before the roster is replaced.
      const linkRows=(await db.prepare("SELECT callsign,discord_user_id,member_name,discord_nickname,rank,status FROM discord_member_links WHERE status<>'left'").all()).results||[];
      const callsignMoves=planDiscordCallsignMoves(linkRows,data.members);
      // Training flags before the replacement, so only members whose ops eligibility changed get a Discord update.
      const trainingBefore=new Map(((await db.prepare("SELECT callsign,name,rank,has_hert,has_basic_firefighting,has_advanced_firefighting FROM members").all()).results||[]).map(row=>[normalizeDiscordCallsign(row.callsign),row]));
      const fullSync=data.full_sync!==false;
      const result=await replaceMembers(db,data.members,undefined,fullSync);
      if(callsignMoves.length) {
        await moveDiscordLinks(db,callsignMoves);
        context.waitUntil(runDiscordCallsignMoves(db,env,callsignMoves));
      }
      if(data.callsign_slots||data.available_callsigns) await saveCallsignSlots(db,data.callsign_slots||data.available_callsigns,fullSync);
      if(trainingBefore.size) {
        const trainingAfter=new Map(((await db.prepare("SELECT callsign,name,rank,has_hert,has_basic_firefighting,has_advanced_firefighting FROM members").all()).results||[]).map(row=>[normalizeDiscordCallsign(row.callsign),row]));
        const opsChanges=[];
        for(const callsign of new Set([...trainingBefore.keys(),...trainingAfter.keys()])) {
          const before=trainingBefore.get(callsign), after=trainingAfter.get(callsign);
          // Skip callsigns that are no longer on the roster: their Discord link is not removed or changed here.
          if(!callsign || !after) continue;
          if(holdsOpsTraining(before)!==holdsOpsTraining(after)) opsChanges.push({callsign, name:(after||before)?.name||"", qualifies:holdsOpsTraining(after)});
        }
        if(opsChanges.length) context.waitUntil(applyOpsRoleChanges(db, env, { name: "Google Sheet sync" }, opsChanges));
        // Rank changes for members who are already linked (callsign unchanged).
        const linkByCallsign=new Map(linkRows.map(row=>[normalizeDiscordCallsign(row.callsign),row]));
        const rankChanges=[];
        for(const [callsign,after] of trainingAfter) {
          const before=trainingBefore.get(callsign), link=linkByCallsign.get(callsign);
          if(!callsign||!before||!link) continue;
          if(String(before.rank||"").trim().toLowerCase()===String(after.rank||"").trim().toLowerCase()) continue;
          rankChanges.push({callsign, name:after.name||"", rank:String(after.rank||"").trim(), discordUserId:String(link.discord_user_id)});
        }
        if(rankChanges.length) {
          await applyRankChanges(db,rankChanges);
          context.waitUntil(runRankChanges(db,env,rankChanges));
        }
      }
      // Create notifications from the fresh roster even when nobody is signed in.
      // Visibility is still decided per user when they read the list.
      try { await refreshD1Notifications(db,{role:"admin",account_id:"system",callsign:""}); }
      catch(error) { console.error("Notification refresh after roster sync failed:",error); }
      return json(result);
    }
    if(route==="/internal/accounts/sync"&&method==="POST") {
      const expected=String(env.LVFR_D1_WORKER_SECRET||"");
      if(!expected||request.headers.get("X-LVFR-Worker-Secret")!==expected) return json({detail:"Worker authentication failed."},403);
      const account=data.account||{},id=String(account.account_id||"").trim(),status=String(account.status||"").toLowerCase(),role=String(account.role||"").toLowerCase();
      if(!id||!account.name||!account.callsign||!['pending','approved','deactivated','denied','removed'].includes(status)||!/^([a-z][a-z0-9_-]{1,31})$/.test(role)) return json({detail:"Account update is invalid."},400);
      const existing=await db.prepare("SELECT account_id FROM accounts WHERE account_id=?").bind(id).first();
      const profile=await db.prepare("SELECT role FROM role_permissions WHERE role=?").bind(role).first();
      if(!existing||(!profile&&role!=="admin")) return json({detail:"Account or role was not found."},404);
      const timestamp=new Date().toISOString();
      await db.prepare("UPDATE accounts SET name=?,name_key=?,callsign=?,status=?,role=?,updated_at=? WHERE account_id=?").bind(String(account.name).trim(),nameKey(account.name),String(account.callsign).trim().toUpperCase(),status,role,timestamp,id).run();
      await db.prepare("DELETE FROM auth_sessions WHERE account_id=? AND ? IN ('denied','removed','deactivated')").bind(id,status).run();
      return json({ok:true,account_id:id});
    }
    if(route==="/internal/accounts/delete"&&method==="POST") {
      const expected=String(env.LVFR_D1_WORKER_SECRET||"");
      if(!expected||request.headers.get("X-LVFR-Worker-Secret")!==expected) return json({detail:"Worker authentication failed."},403);
      if(!Array.isArray(data.account_ids)||data.account_ids.length>100) return json({detail:"Account deletion payload is invalid."},400);
      const ids=[...new Set(data.account_ids.map(value=>String(value||"").trim()).filter(Boolean))];
      const statements=[],now=new Date().toISOString();
      for(const id of ids) {
        const account=await db.prepare("SELECT account_id,name,callsign FROM accounts WHERE account_id=?").bind(id).first();
        if(!account) continue;
        statements.push(db.prepare("INSERT INTO account_audit(created_at,account_id,name,callsign,action,actor_name) VALUES(?,?,?,?,?,?)").bind(now,id,account.name,account.callsign,"Deleted from Accounts Sheet","Google Sheets"));
        statements.push(db.prepare("DELETE FROM auth_sessions WHERE account_id=?").bind(id));
        statements.push(db.prepare("DELETE FROM account_presence WHERE account_id=?").bind(id));
        statements.push(db.prepare("DELETE FROM accounts WHERE account_id=?").bind(id));
      }
      for(let i=0;i<statements.length;i+=50) await db.batch(statements.slice(i,i+50));
      return json({ok:true,deleted:statements.length/4});
    }
    if(route==="/internal/accounts/reconcile"&&method==="POST") {
      const expected=String(env.LVFR_D1_WORKER_SECRET||"");
      if(!expected||request.headers.get("X-LVFR-Worker-Secret")!==expected) return json({detail:"Worker authentication failed."},403);
      if(!Array.isArray(data.accounts)) return json({detail:"Accounts snapshot is invalid."},400);
      const rows=(await db.prepare("SELECT account_id,name,callsign,status,role FROM accounts").all()).results||[];
      const incoming=new Map(data.accounts.filter(row=>row&&row.account_id).map(row=>[String(row.account_id).trim(),row]));
      const statements=[],missing=[]; let updated=0,deleted=0;
      for(const row of rows) {
        const sheet=incoming.get(String(row.account_id));
        if(!sheet) {
          statements.push(db.prepare("DELETE FROM auth_sessions WHERE account_id=?").bind(row.account_id));
          statements.push(db.prepare("DELETE FROM account_presence WHERE account_id=?").bind(row.account_id));
          statements.push(db.prepare("DELETE FROM accounts WHERE account_id=?").bind(row.account_id)); deleted++; continue;
        }
        incoming.delete(String(row.account_id));
        const name=String(sheet.name||"").trim(), callsign=String(sheet.callsign||"").trim().toUpperCase(), status=String(sheet.status||"").trim().toLowerCase(), role=String(sheet.role||"").trim().toLowerCase();
        if(!name||!['pending','approved','deactivated','denied','removed'].includes(status)||!/^([a-z][a-z0-9_-]{1,31})$/.test(role)) return json({detail:"Accounts Sheet row is invalid for account "+row.account_id+"; D1 was not changed."},400);
        if(!await db.prepare("SELECT role FROM role_permissions WHERE role=?").bind(role).first()&&role!=="admin") return json({detail:"Unknown account role in Sheet: "+role+"; D1 was not changed."},400);
        statements.push(db.prepare("UPDATE accounts SET name=?,name_key=?,callsign=?,status=?,role=?,updated_at=? WHERE account_id=?").bind(name,nameKey(name),callsign,status,role,new Date().toISOString(),row.account_id));
        if(['denied','removed','deactivated'].includes(status)) statements.push(db.prepare("DELETE FROM auth_sessions WHERE account_id=?").bind(row.account_id));
        updated++;
      }
      for(let i=0;i<statements.length;i+=50) await db.batch(statements.slice(i,i+50));
      missing.push(...incoming.keys());
      return json({ok:true,updated,deleted,unmatched_sheet_accounts:missing});
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
        const callsign=String(record.callsign||"").trim().toUpperCase(), time=String(record.time||"").trim();
        const member=memberByCallsign.get(callsign);
        if(!callsign||!time||!member) { skipped++; continue; }
        if(sourceRow) liveSourceRows.add(sourceRow);
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
      // An empty sheet read must never delete every Training Hours record. This usually means the wrong spreadsheet or tab was read.
      if(data.reconcile===true&&data.records.length===0&&existingRows.length>0) return json({detail:"The Training Hours sheet returned no rows, so D1 was not changed. Check LVFR_ROSTER_SPREADSHEET_ID and the Sheet1 tab."},400);
      if(data.reconcile===true) {
        for(const row of existingRows) {
          if(row.source_row===null||row.source_row===undefined||!liveSourceRows.has(Number(row.source_row))) statements.push(db.prepare("DELETE FROM training_hours WHERE id=?").bind(row.id));
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
        // LOI coordinators sometimes append the roster-independent leave
        // marker to a person's Sheet name. Match that annotation away, but
        // keep the canonical roster name in D1.
        const lookupName=name.replace(/\s*\((?:LOA|LEAVE OF ABSENCE)\)\s*$/i,"").trim();
        const callsign=String(raw?.callsign||"").trim().toUpperCase();
        const member=(callsign&&byCallsign.get(callsign))||byName.get(nameKey(lookupName));
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
      // LOI rows are keyed by current roster callsign in D1. Keep importing
      // valid rows when the legacy Sheet contains stale/non-roster names;
      // reconcile removes D1 rows absent from the valid Sheet snapshot below.
      if(data.reconcile===true) {
        for(const row of existing) if(!recordsByKey.has(`${row.type}:${row.callsign}`)) statements.push(db.prepare("DELETE FROM loi_entries WHERE id=?").bind(row.id));
      }
      for(let i=0;i<statements.length;i+=50) await db.batch(statements.slice(i,i+50));
      return json({ok:true,imported:recordsByKey.size,skipped,unmatched,written:statements.length,reconciled:data.reconcile===true});
    }
    if(route==="/internal/logs/import" && method==="POST") {
      const expected=String(env.LVFR_D1_WORKER_SECRET||"");
      if(!expected || request.headers.get("X-LVFR-Worker-Secret")!==expected) return json({detail:"Worker authentication failed."},403);
      const statements=[];
      // Full Sync sends this flag on its first batch only: the Sheet is treated as
      // the source of truth, so logs deleted from D1 come back and stale D1-only
      // rows are dropped. Ordinary imports keep INSERT OR IGNORE behaviour.
      if(data.replace_operational_logs===true) statements.push(db.prepare("DELETE FROM operational_logs"));
      if(data.replace_account_audit===true) statements.push(db.prepare("DELETE FROM account_audit"));
      if(data.replace_notifications===true) { statements.push(db.prepare("DELETE FROM notification_hidden")); statements.push(db.prepare("DELETE FROM notification_reads")); statements.push(db.prepare("DELETE FROM notifications")); }
      if(data.replace_notification_state===true) statements.push(db.prepare("DELETE FROM notification_state"));
      if(data.replace_training_hours_log===true) statements.push(db.prepare("DELETE FROM training_hours_log"));
      for(const row of (Array.isArray(data.operational_logs)?data.operational_logs:[])) statements.push(db.prepare(`INSERT OR IGNORE INTO operational_logs(source_key,kind,log_date,callsign,member_name,action,details,changed_by,old_rank,new_rank,old_callsign,new_callsign)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(String(row.source_key||""),String(row.kind||""),String(row.log_date||""),String(row.callsign||""),String(row.member_name||""),String(row.action||""),String(row.details||""),String(row.changed_by||""),String(row.old_rank||""),String(row.new_rank||""),String(row.old_callsign||""),String(row.new_callsign||"")));
      for(const row of (Array.isArray(data.account_audit)?data.account_audit:[])) statements.push(db.prepare("INSERT OR IGNORE INTO account_audit(source_key,created_at,account_id,name,callsign,action,actor_name) VALUES(?,?,?,?,?,?,?)")
        .bind(String(row.source_key||""),String(row.created_at||""),String(row.account_id||""),String(row.name||""),String(row.callsign||""),String(row.action||""),String(row.actor_name||"")));
      for(const row of (Array.isArray(data.training_hours_log)?data.training_hours_log:[])) statements.push(db.prepare("INSERT INTO training_hours_log(log_date,callsign,member_name,action,previous_time,new_time,changed_by) VALUES(?,?,?,?,?,?,?)")
        .bind(String(row.log_date||""),String(row.callsign||""),String(row.member_name||""),String(row.action||""),String(row.previous_time||""),String(row.new_time||""),String(row.changed_by||"")));
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
    // Every permission check on the server reads account.permissions, so load the real values once per request.
    if(session.account) session.account.permissions=await accountPermissions(db,session.account);
    if (route==="/api/health" && method==="GET") return json({ok:true,backend:"Cloudflare D1",auth_store:"D1"});
    if (route==="/auth/signup" && method==="POST") {
      const result=await signup(db,env,data);
      const sheetAccount=result.sheet_account;
      if(env.LVFR_D1_AUTH_BRIDGE_SECRET) context.waitUntil(mirrorToSheetInBackground(context,"Account signup","/internal/accounts/mirror",url,"",sheetAccount));
      delete result.sheet_account;
      return json(result);
    }
    if (route==="/auth/forgot" && method==="POST") {
      await throttleByAddress(db,request,"forgot");
      return json(forgotPassword(context,db,env,request,data));
    }
    if (route==="/auth/reset" && method==="POST") return json(await resetPasswordWithCode(context,db,env,request,data));
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
    if (route.startsWith("/internal/mirror-queue")) {
      if (!["admin","commander"].includes(user.role)) return json({detail:"Only Operation or Commander accounts can manage the Sheet mirror queue."},403);
      if (route === "/internal/mirror-queue" && method === "GET") {
        const counts=(await db.prepare("SELECT status,COUNT(*) AS n FROM mirror_queue GROUP BY status").all()).results||[];
        const items=(await db.prepare("SELECT id,label,route,status,attempts,last_error,created_at,updated_at,substr(data_json,1,300) AS preview FROM mirror_queue WHERE status<>'done' ORDER BY id LIMIT 100").all()).results||[];
        return json({counts:Object.fromEntries(counts.map(row=>[row.status,Number(row.n)])),items});
      }
      if (route === "/internal/mirror-queue/retry" && method === "POST") {
        const result=await processMirrorQueue(context,{id:data.id||null});
        await db.prepare("DELETE FROM mirror_queue WHERE status='done' AND updated_at<?").bind(nowSeconds()-7*86400).run();
        return json(result);
      }
      if (route === "/internal/mirror-queue/discard" && method === "POST") {
        const removed=data.all===true
          ? await db.prepare("DELETE FROM mirror_queue WHERE status='pending'").run()
          : await db.prepare("DELETE FROM mirror_queue WHERE id=? AND status='pending'").bind(Number(data.id)||0).run();
        return json({removed:Number(removed.meta?.changes||0)});
      }
      return json({detail:"Mirror queue route was not found."},404);
    }
    if (route === "/api/discord/sync" && method === "POST") {
      const actor = await requireDiscordPermission(db, token, "discord_sync_manage");
      const lockToken = crypto.randomUUID();
      const now = nowSeconds();
      await db.prepare(`INSERT INTO discord_sync_lock(lock_id,locked_until,locked_by) VALUES(1,?,?)
        ON CONFLICT(lock_id) DO UPDATE SET locked_until=excluded.locked_until,locked_by=excluded.locked_by
        WHERE discord_sync_lock.locked_until<?`).bind(now + 600, lockToken, now).run();
      const lock = await db.prepare("SELECT locked_until,locked_by FROM discord_sync_lock WHERE lock_id=1").first();
      if (lock?.locked_by !== lockToken) throw Object.assign(new Error("A Discord member synchronization is already running. Wait for it to finish before starting another."), { status: 409 });
      try {
        const result = await runInitialDiscordLinkSync(db, env, actor);
        context.waitUntil(reconcileDiscordOpsRoles(db, env, actor).catch(error => console.error("Discord ops role check failed:", String(error?.message || error).slice(0, 400))));
        result.ops_role_check = "started";
        result.ops_role_message = "Ops roles are being checked in the background. The result appears in the Discord action log.";
        return json(result);
      } finally {
        await db.prepare("UPDATE discord_sync_lock SET locked_until=0,locked_by='' WHERE lock_id=1 AND locked_by=?").bind(lockToken).run();
      }
    }
    if (route === "/api/discord/links" && method === "GET") {
      await requireDiscordPermission(db, token, "discord_view");
      // Every roster member, then any link whose callsign is no longer on the roster.
      // discord_state is "linked" (green) or "not_linked" (red); a left-server link counts as not linked.
      const rows = (await db.prepare(`SELECT m.callsign AS callsign, m.name AS roster_name, m.rank AS roster_rank,
            l.discord_user_id, l.member_name, l.status, l.last_error, l.last_synced_at, l.discord_nickname,
            CASE WHEN l.callsign IS NULL OR l.status='left' THEN 'not_linked' ELSE 'linked' END AS discord_state,
            1 AS on_roster
          FROM members m LEFT JOIN discord_member_links l ON upper(l.callsign)=upper(m.callsign)
          UNION ALL
          SELECT l.callsign, l.member_name, l.rank, l.discord_user_id, l.member_name, l.status, l.last_error, l.last_synced_at, l.discord_nickname,
            CASE WHEN l.status='left' THEN 'not_linked' ELSE 'linked' END, 0
          FROM discord_member_links l WHERE NOT EXISTS (SELECT 1 FROM members m WHERE upper(m.callsign)=upper(l.callsign))
          ORDER BY callsign`).all()).results || [];
      return json({ links: rows });
    }
    if (route === "/api/discord/links/edit" && method === "POST") {
      const actor = await requireDiscordPermission(db, token, "discord_manage");
      const cs = normalizeDiscordCallsign(data.callsign), newId = String(data.discord_user_id || "").trim();
      if (!/^\d{17,20}$/.test(newId)) throw Object.assign(new Error("Enter a valid Discord User ID (17 to 20 digits)."), { status: 400 });
      const link = await db.prepare("SELECT * FROM discord_member_links WHERE callsign=?").bind(cs).first();
      const rosterRow = link ? null : await db.prepare("SELECT name, rank FROM members WHERE upper(callsign)=upper(?)").bind(cs).first();
      if (!link && !rosterRow) throw Object.assign(new Error("This callsign is not on the roster."), { status: 404 });
      const taken = await db.prepare("SELECT callsign FROM discord_member_links WHERE discord_user_id=? AND callsign<>?").bind(newId, cs).first();
      if (taken) throw Object.assign(new Error("This Discord User ID is already linked to " + taken.callsign + "."), { status: 409 });
      const { guildId } = discordConfig(env);
      let guildMember;
      try { guildMember = await discordRequest(env, `/guilds/${guildId}/members/${encodeURIComponent(newId)}`); }
      catch { throw Object.assign(new Error("This Discord User ID was not found in the LVFR Discord server."), { status: 400 }); }
      const parsed = parseDiscordNickname(String(guildMember?.nick || ""));
      if (!parsed || parsed.callsign !== cs) throw Object.assign(new Error("That member's Discord nickname does not start with [" + cs + "]. Correct it in Discord first."), { status: 400 });
      const stamp = new Date().toISOString();
      if (link) {
        await db.prepare("UPDATE discord_member_links SET discord_user_id=?,discord_nickname=?,status='linked',last_error='',pending_callsign='',pending_rank='',pending_update_roles=0,last_synced_at=?,updated_at=? WHERE callsign=?")
          .bind(newId, String(guildMember?.nick || ""), stamp, stamp, cs).run();
        await writeDiscordLog(db, actor, "edit", cs, link.member_name, newId, "done", "Discord User ID changed from " + link.discord_user_id + " to " + newId + ".");
      } else {
        await db.prepare(`INSERT INTO discord_member_links(callsign,discord_user_id,member_name,rank,discord_nickname,status,last_synced_at,created_at,updated_at) VALUES(?,?,?,?,?,'linked',?,?,?)`)
          .bind(cs, newId, String(rosterRow.name || ""), String(rosterRow.rank || ""), String(guildMember?.nick || ""), stamp, stamp, stamp).run();
        await writeDiscordLog(db, actor, "link", cs, rosterRow.name, newId, "done", "Linked manually to Discord User ID " + newId + ".");
      }
      return json({ ok: true });
    }
    if (route === "/api/discord/links/delink" && method === "POST") {
      const actor = await requireDiscordPermission(db, token, "discord_manage");
      const cs = normalizeDiscordCallsign(data.callsign);
      const link = await db.prepare("SELECT * FROM discord_member_links WHERE callsign=?").bind(cs).first();
      if (!link) throw Object.assign(new Error("This callsign has no Discord link."), { status: 404 });
      await db.prepare("DELETE FROM discord_member_links WHERE callsign=?").bind(cs).run();
      await writeDiscordLog(db, actor, "delink", cs, link.member_name, link.discord_user_id, "done", "Link removed. Discord was not changed.");
      return json({ ok: true });
    }
    if (route === "/api/discord/log" && method === "DELETE") {
      const actor = await requireDiscordPermission(db, token, "discord_log_clear");
      await db.prepare("DELETE FROM discord_action_log").run();
      await writeDiscordLog(db, actor, "clear log", "", "", "", "done", "Discord action log cleared.");
      return json({ ok: true });
    }
    if (route === "/api/discord/log" && method === "GET") {
      await requireDiscordPermission(db, token, "discord_view");
      const rows = (await db.prepare("SELECT id, created_at, actor_name, action, callsign, member_name, discord_user_id, outcome, detail FROM discord_action_log ORDER BY id DESC LIMIT 200").all()).results || [];
      return json({ log: rows });
    }
    const discordMemberRoute = route.match(/^\/api\/discord\/member\/([^/]+)(\/nickname)?$/);
    if (discordMemberRoute && method === "GET") {
      await requireDiscordPermission(db, token, "discord_view");
      const cs = normalizeDiscordCallsign(decodeURIComponent(discordMemberRoute[1]));
      const link = await db.prepare("SELECT discord_user_id, status, last_error FROM discord_member_links WHERE callsign=?").bind(cs).first();
      const linked = Boolean(link && link.status !== "left");
      if (!discordMemberRoute[2]) {
        return json({ callsign: cs, linked, discord_user_id: link ? String(link.discord_user_id) : "", status: link ? link.status : "none", last_error: link?.last_error || "" });
      }
      if (!linked) return json({ callsign: cs, linked: false, nickname: "", in_server: false });
      const { guildId } = discordConfig(env);
      try {
        const member = await discordRequest(env, `/guilds/${guildId}/members/${encodeURIComponent(String(link.discord_user_id))}`);
        return json({ callsign: cs, linked: true, nickname: String(member?.nick || ""), in_server: true });
      } catch (error) {
        if (/was not found/.test(String(error?.message || ""))) return json({ callsign: cs, linked: true, nickname: "", in_server: false });
        throw error;
      }
    }
    if (discordMemberRoute && discordMemberRoute[2] && method === "POST") {
      const actor = await requireDiscordPermission(db, token, "discord_manage");
      const cs = normalizeDiscordCallsign(decodeURIComponent(discordMemberRoute[1]));
      const link = await db.prepare("SELECT discord_user_id, member_name FROM discord_member_links WHERE callsign=? AND status<>'left'").bind(cs).first();
      if (!link) throw Object.assign(new Error("This member is not linked to Discord. Set the Discord ID first."), { status: 400 });
      const nick = String(data.nickname ?? "").trim();
      if (nick.length > 32) throw Object.assign(new Error("A Discord nickname can be at most 32 characters."), { status: 400 });
      if (nick && parseDiscordNickname(nick)?.callsign !== cs) throw Object.assign(new Error("The nickname must start with [" + cs + "]."), { status: 400 });
      const { guildId } = discordConfig(env);
      try {
        await discordRequest(env, `/guilds/${guildId}/members/${encodeURIComponent(String(link.discord_user_id))}`, {
          method: "PATCH", body: JSON.stringify({ nick: nick || null }),
          headers: { "X-Audit-Log-Reason": encodeURIComponent("LVFR EMS nickname set by " + String(actor.name || "admin")).slice(0, 480) },
        });
      } catch (error) {
        await writeDiscordLog(db, actor, "nickname", cs, link.member_name, link.discord_user_id, "failed", String(error?.message || error).slice(0, 300));
        throw error;
      }
      await db.prepare("UPDATE discord_member_links SET discord_nickname=?, updated_at=? WHERE callsign=?").bind(nick, new Date().toISOString(), cs).run();
      await writeDiscordLog(db, actor, "nickname", cs, link.member_name, link.discord_user_id, "done", nick ? "Nickname set to " + nick + "." : "Nickname cleared.");
      return json({ ok: true, nickname: nick });
    }
    if (route === "/api/discord/link-status" && method === "GET") {
      // Only whether the callsign has a Discord link; no IDs or nicknames are returned.
      const cs = normalizeDiscordCallsign(url.searchParams.get("callsign"));
      const link = cs ? await db.prepare("SELECT 1 AS found FROM discord_member_links WHERE callsign=?").bind(cs).first() : null;
      return json({ linked: Boolean(link) });
    }
    if (route === "/api/discord/status" && method === "GET") {
      await requireDiscordPermission(db, token, "discord_view");
      const [totals, failed, pending] = await Promise.all([
        db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='linked' THEN 1 ELSE 0 END) AS linked FROM discord_member_links").first(),
        db.prepare("SELECT COUNT(*) AS count FROM discord_member_links WHERE status='failed'").first(),
        db.prepare("SELECT COUNT(*) AS count FROM discord_member_links WHERE status='pending'").first(),
      ]);
      const left = await db.prepare("SELECT COUNT(*) AS count FROM discord_member_links WHERE status='left'").first();
      return json({ total: Number(totals?.total || 0), linked: Number(totals?.linked || 0), failed: Number(failed?.count || 0), pending: Number(pending?.count || 0), left: Number(left?.count || 0) });
    }
    if (route === "/api/discord/retry" && method === "POST") {
      await requireDiscordPermission(db, token, "discord_sync_manage");
      const stuckBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const rows = (await db.prepare("SELECT discord_user_id FROM discord_member_links WHERE (status='failed' OR (status='pending' AND updated_at<?)) AND (pending_callsign<>'' OR pending_rank<>'') ORDER BY updated_at LIMIT 25").bind(stuckBefore).all()).results || [];
      for (const row of rows) {
        await db.prepare("UPDATE discord_member_links SET status='pending',last_error='',updated_at=? WHERE discord_user_id=?").bind(new Date().toISOString(), row.discord_user_id).run();
        context.waitUntil((async () => {
          try { await updateDiscordMemberFromMapping(db, env, row.discord_user_id); }
          catch (error) {
            const message = String(error?.message || error).slice(0, 400);
            await db.prepare("UPDATE discord_member_links SET status='failed',last_error=?,updated_at=? WHERE discord_user_id=?").bind(message, new Date().toISOString(), row.discord_user_id).run();
            console.error("Discord retry failed:", { discord_user_id: row.discord_user_id, error: message });
          }
        })());
      }
      const remaining = Math.max(0, Number((await db.prepare("SELECT COUNT(*) AS count FROM discord_member_links WHERE status='failed' OR (status='pending' AND updated_at<?)").bind(stuckBefore).first())?.count || 0) - rows.length);
      return json({ ok: true, queued: rows.length, remaining_estimate: remaining, message: rows.length ? `Queued ${rows.length} failed Discord update(s).` : "No failed Discord updates are waiting for retry." });
    }
    const individualPermissionRoute=route.match(/^\/api\/leaders\/([^/]+)\/permissions$/);
    if(individualPermissionRoute&&(method==="GET"||method==="POST")) {
      const actor=await accountForToken(db,token);
      if(!actor||actor.status!=="approved") throw Object.assign(new Error("Sign in again."),{status:401});
      const actorRights=actor.role==="admin"?null:await accountPermissions(db,actor);
      if(actorRights&&actor.role!=="commander"&&actorRights.operation_command_access!==true) throw Object.assign(new Error("Operation Command access is required."),{status:403});
      const id=decodeURIComponent(individualPermissionRoute[1]);
      const target=await db.prepare("SELECT account_id,name,role,permissions_override_json FROM accounts WHERE account_id=?").bind(id).first();
      if(!target||target.role==="admin") throw Object.assign(new Error("That account's permissions cannot be changed."),{status:404});
      if(actorRights) await assertOutranks(db,actor,target.role);
      const defaults=await rolePermissions(db,target.role);
      if(method==="GET") return json({account_id:id,role:target.role,defaults,overrides:expandLegacyPermissionOverrides(parsePermissionOverrides(target.permissions_override_json))});
      const currentOverrides=expandLegacyPermissionOverrides(parsePermissionOverrides(target.permissions_override_json));
      const overrides=data.reset===true?{}:expandLegacyPermissionOverrides(parsePermissionOverrides(JSON.stringify(data.overrides||{})));
      // A non-admin changes only the permissions they hold; the rest keep their current state.
      if(actorRights) for(const key of ROLE_PERMISSION_KEYS) {
        if(actorRights[key]===true) continue;
        if(Object.hasOwn(currentOverrides,key)) overrides[key]=currentOverrides[key]; else delete overrides[key];
      }
      const now=new Date().toISOString();
      await db.prepare("UPDATE accounts SET permissions_override_json=?,updated_at=? WHERE account_id=?").bind(JSON.stringify(overrides),now,id).run();
      await appendAudit(db,{account_id:id,name:target.name,callsign:target.callsign||""},data.reset===true?"Reset individual permissions":"Updated individual permissions",actor.name);
      return json({ok:true,account_id:id,role:target.role,defaults,overrides,permissions:Object.fromEntries(ROLE_PERMISSION_KEYS.map(key=>[key,Object.hasOwn(overrides,key)?overrides[key]:defaults[key]]))});
    }
    if(route==="/api/role-permissions"&&method==="GET") {
      const actor=session.account;
      if(actor.role!=="admin"&&actor.role!=="commander"&&actor.permissions?.operation_command_access!==true&&!actor.permissions?.role_manage&&!actor.permissions?.rank_add&&!actor.permissions?.rank_rename&&!actor.permissions?.rank_delete&&!actor.permissions?.rank_reorder) throw Object.assign(new Error("Access Panel permission is required."),{status:403});
      const rows=(await db.prepare("SELECT role,sort_order,display_name FROM role_permissions ORDER BY sort_order,role").all()).results||[];
      const roles=new Set(["member","leader","commander",...rows.map(row=>String(row.role||"").toLowerCase())]);
      const profiles={}, effective=await accountPermissions(db,actor);
      const canEditProfiles=actor.role==="admin"||actor.role==="commander"||effective.operation_command_access===true;
      const visibleKeys=actor.role==="admin"?ROLE_PERMISSION_KEYS:ROLE_PERMISSION_KEYS.filter(key=>effective[key]===true);
      for(const role of roles) if(role!=="admin"&&role!==actor.role) {
        const profile=await rolePermissions(db,role);
        profiles[role]=Object.fromEntries(visibleKeys.map(key=>[key,Boolean(profile[key])]));
      }
      const scopes={};
      for(const role of roles) if(role!=="admin"&&role!==actor.role) scopes[role]=await roleScopes(db,role);
      const order=[{role:"admin",sort_order:1,display_name:"Operation"},...rows.filter(row=>row.role!=="admin").map(row=>({role:String(row.role).toLowerCase(),sort_order:Number(row.sort_order)||100,display_name:String(row.display_name||"")}))];
      for(const [role,sort_order,display_name] of [["commander",2,"Commander"],["leader",3,"Leader"],["member",4,"Member"]]) if(!order.some(row=>row.role===role)) order.push({role,sort_order,display_name});
      order.sort((a,b)=>a.sort_order-b.sort_order||a.role.localeCompare(b.role));
      return json({profiles,scopes,ranks:Object.keys(RANK_LEVEL),keys:visibleKeys,actor_permissions:Object.fromEntries(visibleKeys.map(key=>[key,true])),order});
    }
    const historyDelete=route.match(/^\/api\/role-permissions\/history(?:\/(\d+))?$/);
    if(historyDelete&&method==="DELETE") {
      const actor=session.account;
      if(actor.role!=="admin"&&actor.permissions?.logs_delete_d1!==true) throw Object.assign(new Error("You need the Delete logs from D1 permission."),{status:403});
      if(historyDelete[1]) await db.prepare("DELETE FROM role_permission_history WHERE id=?").bind(Number(historyDelete[1])).run();
      else await db.prepare("DELETE FROM role_permission_history").run();
      return json({ok:true});
    }
    if(route==="/api/role-permissions/history"&&method==="GET") {
      const actor=session.account;
      if(actor.role!=="admin"&&actor.role!=="commander"&&actor.permissions?.operation_command_access!==true) throw Object.assign(new Error("You cannot view the permission history."),{status:403});
      const rows=(await db.prepare("SELECT id,role,changed_at,changed_by,before_json,after_json FROM role_permission_history ORDER BY id DESC LIMIT 30").all()).results||[];
      const viewerRights=actor.role==="admin"?null:await accountPermissions(db,actor);
      const limit=snapshot=>viewerRights?limitSnapshotToActor(snapshot,viewerRights):snapshot;
      return json({can_delete:actor.role==="admin"||actor.permissions?.logs_delete_d1===true,items:rows.map(row=>({id:row.id,role:row.role,changed_at:row.changed_at,changed_by:row.changed_by,before:limit(JSON.parse(row.before_json||"{}")),after:limit(JSON.parse(row.after_json||"{}"))}))});
    }
    if(route==="/api/account-preview"&&method==="GET") {
      const actor=session.account;
      if(actor.role!=="admin"&&actor.role!=="commander"&&actor.permissions?.operation_command_access!==true) throw Object.assign(new Error("You cannot preview account permissions."),{status:403});
      const account=await db.prepare("SELECT account_id,name,callsign,role,status,permissions_override_json FROM accounts WHERE account_id=?").bind(String(url.searchParams.get("account_id")||"")).first();
      if(!account) throw Object.assign(new Error("Account was not found."),{status:404});
      const effective=await accountPermissions(db,account), scopes=await roleScopes(db,account.role);
      const definitions=[
        {key:"promote",label:"Promote",perms:["promotion_manage","rank_manage"],scope:"promote",field:"from"},
        {key:"demote",label:"Demote",perms:["rank_manage"],scope:"demote",field:"from"},
        {key:"terminate",label:"Terminate",perms:["termination_manage"],scope:"terminate",field:"from"},
        {key:"view",label:"See members",perms:["members_view","eligible_view","inactive_view","promotion_access"],scope:"view",field:"from"},
      ];
      const actions=definitions.map(item=>{
        if(!item.perms.some(key=>effective[key]===true)) return {key:item.key,label:item.label,allowed:false,reason:"No permission."};
        const rule=scopes[item.scope];
        const ranks=rule&&Array.isArray(rule[item.field])?rule[item.field]:null;
        return {key:item.key,label:item.label,allowed:true,reason:ranks?"Ranks: "+ranks.join(", "):"All ranks"};
      });
      return json({name:account.name,callsign:account.callsign,role:account.role,actions});
    }
    if(route==="/api/promotion-confirmations"&&method==="GET") {
      if(!session.account) throw Object.assign(new Error("Sign in again."),{status:401});
      // Each person sees only the confirmations for permissions they hold.
      const viewer=session.account, viewerAdmin=viewer.role==="admin";
      const rows=(await db.prepare("SELECT p.id,p.callsign,COALESCE(NULLIF(p.name,''),(SELECT m.name FROM members m WHERE upper(m.callsign)=upper(p.new_callsign) LIMIT 1),'') AS name,p.old_rank,p.new_rank,p.old_callsign,p.new_callsign,p.created_at,p.created_by,p.action,p.needs_discord,p.required_permissions,p.portal_done,p.discord_done FROM promotion_confirmations p WHERE p.confirmed_at IS NULL ORDER BY p.id DESC LIMIT 50").all()).results||[];
      const visible=rows.filter(row=>viewerAdmin||String(row.required_permissions||"").split(",").some(key=>viewer.permissions?.[key.trim()]===true));
      return json({items:visible});
    }
    if(route==="/api/promotion-confirmations"&&method==="POST") {
      if(!session.account) throw Object.assign(new Error("Sign in again."),{status:401});
      await db.prepare("INSERT INTO promotion_confirmations(callsign,name,old_rank,new_rank,old_callsign,new_callsign,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)")
        .bind(String(data.callsign||""),String(data.name||""),String(data.old_rank||""),String(data.new_rank||""),String(data.old_callsign||""),String(data.new_callsign||""),new Date().toISOString(),String(session.account.name||"")).run();
      return json({ok:true});
    }
    if(route==="/api/promotion-confirmations/confirm"&&method==="POST") {
      if(!session.account) throw Object.assign(new Error("Sign in again."),{status:401});
      const confirmRow=await db.prepare("SELECT needs_discord,required_permissions FROM promotion_confirmations WHERE id=? AND confirmed_at IS NULL").bind(Number(data.id)||0).first();
      if(!confirmRow) throw Object.assign(new Error("This confirmation is already saved."),{status:404});
      const saver=session.account;
      if(saver.role!=="admin"&&!String(confirmRow.required_permissions||"").split(",").some(key=>saver.permissions?.[key.trim()]===true)) throw Object.assign(new Error("You do not have the permission for this confirmation."),{status:403});
      if(data.portal!==true||(Number(confirmRow.needs_discord)===1&&data.discord!==true)) throw Object.assign(new Error("PORTAL (and Discord, when required) must be ticked."),{status:400});
      await db.prepare("UPDATE promotion_confirmations SET portal_done=1,discord_done=1,confirmed_at=?,confirmed_by=? WHERE id=? AND confirmed_at IS NULL")
        .bind(new Date().toISOString(),String(session.account.name||""),Number(data.id)||0).run();
      return json({ok:true});
    }
    if(route==="/api/role-preview"&&method==="GET") {
      const actor=session.account;
      if(actor.role!=="admin"&&actor.role!=="commander"&&actor.permissions?.operation_command_access!==true) throw Object.assign(new Error("You cannot preview role permissions."),{status:403});
      const role=String(url.searchParams.get("role")||"").toLowerCase(), rank=String(url.searchParams.get("rank")||"").trim();
      if(!rank) return json({role,rank,actions:[]});
      const profile=await rolePermissions(db,role), scopes=await roleScopes(db,role);
      const definitions=[
        {key:"promote",label:"Promote",perms:["promotion_manage","rank_manage"],scope:"promote",field:"from"},
        {key:"demote",label:"Demote",perms:["rank_manage"],scope:"demote",field:"from"},
        {key:"terminate",label:"Terminate",perms:["termination_manage"],scope:"terminate",field:"from"},
        {key:"view",label:"See members of this rank",perms:["members_view","eligible_view","inactive_view","promotion_access"],scope:"view",field:"from"},
      ];
      const actions=definitions.map(item=>{
        if(!item.perms.some(key=>profile[key]===true)) return {key:item.key,label:item.label,allowed:false,reason:"This role does not have the permission."};
        const rule=scopes[item.scope];
        if(rule&&Array.isArray(rule[item.field])&&!rule[item.field].includes(rank)) return {key:item.key,label:item.label,allowed:false,reason:"Rank "+rank+" is outside this role's limit."};
        return {key:item.key,label:item.label,allowed:true,reason:rule&&Array.isArray(rule[item.field])?"Allowed for this rank.":"Allowed for all ranks."};
      });
      return json({role,rank,actions});
    }
    if(route==="/api/role-permissions/order"&&method==="POST") {
      const actor=session.account; requireRankPermission(actor,"rank_reorder");
      const order=(await db.prepare("SELECT role,sort_order,display_name FROM role_permissions ORDER BY sort_order,role").all()).results||[];
      const canonical=[{role:"admin",sort_order:1},...order.filter(row=>row.role!=="admin")];
      for(const [role,sort_order,display_name] of [["commander",2,"Commander"],["leader",3,"Leader"],["member",4,"Member"]]) if(!canonical.some(row=>row.role===role)) canonical.push({role,sort_order,display_name});
      canonical.sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||a.role.localeCompare(b.role));
      const index=canonical.findIndex(row=>row.role===String(data.role||""));
      const other=index+(data.direction==="up"?-1:1), actorRank=actor.role==="admin"?1:Number(canonical.find(row=>row.role===actor.role)?.sort_order)||2;
      if(index<1||other<1||other>=canonical.length||Number(canonical[index].sort_order)<=actorRank||Number(canonical[other].sort_order)<=actorRank) throw Object.assign(new Error("You cannot reorder your rank or a higher rank."),{status:403});
      [canonical[index],canonical[other]]=[canonical[other],canonical[index]];
      const nowOrder=new Date().toISOString();
      const statements=canonical.filter(row=>row.role!=="admin").map((row,i)=>db.prepare(`INSERT INTO role_permissions(role,sort_order,display_name,permissions_json,updated_at,updated_by) VALUES(?,?,?,'{}',?,?)
        ON CONFLICT(role) DO UPDATE SET sort_order=excluded.sort_order`).bind(row.role,i+2,String(row.display_name||""),nowOrder,String(actor.name||"")));
      await db.batch(statements);
      return json({ok:true,order:canonical});
    }
    if(route==="/api/role-permissions/name"&&method==="POST") {
      const actor=session.account; requireRankPermission(actor,"rank_rename");
      const role=String(data.role||"").toLowerCase(),name=String(data.display_name||"").trim().replace(/\s+/g," ");
      const target=await db.prepare("SELECT sort_order FROM role_permissions WHERE role=?").bind(role).first();
      const actorRank=actor.role==="admin"?1:Number((await db.prepare("SELECT sort_order FROM role_permissions WHERE role=?").bind(actor.role).first())?.sort_order)||2;
      if(!target||Number(target.sort_order)<=actorRank) throw Object.assign(new Error("You can only rename ranks below your own."),{status:403});
      if(name.length<2||name.length>32) throw Object.assign(new Error("Rank name must be 2–32 characters."),{status:400});
      await db.prepare("UPDATE role_permissions SET display_name=? WHERE role=?").bind(name,role).run();
      await appendAudit(db,{account_id:"role:"+role,name:role,callsign:""},"Renamed rank to "+name,actor.name);
      return json({ok:true,role,display_name:name});
    }
    const roleDelete=route.match(/^\/api\/role-permissions\/([^/]+)$/);
    if(roleDelete&&method==="DELETE") {
      const actor=session.account; requireRankPermission(actor,"rank_delete"); const role=decodeURIComponent(roleDelete[1]);
      const rank=actor.role==="admin"?1:Number((await db.prepare("SELECT sort_order FROM role_permissions WHERE role=?").bind(actor.role).first())?.sort_order)||2;
      const target=await db.prepare("SELECT sort_order FROM role_permissions WHERE role=?").bind(role).first();
      if(!target||["admin","commander","leader","member"].includes(role)) throw Object.assign(new Error("Only custom roles can be deleted."),{status:400});
      if(Number(target.sort_order)<=rank) throw Object.assign(new Error("You cannot delete your rank or a higher rank."),{status:403});
      const assigned=await db.prepare("SELECT COUNT(*) AS count FROM accounts WHERE role=?").bind(role).first();
      if(Number(assigned?.count)>0) throw Object.assign(new Error("Move all accounts out of this role before deleting it."),{status:409});
      await db.prepare("DELETE FROM role_permissions WHERE role=?").bind(role).run();
      await appendAudit(db,{account_id:"role:"+role,name:role,callsign:""},"Deleted role",actor.name);
      return json({ok:true,role});
    }
    if(route==="/api/role-permissions"&&method==="POST") {
      const actor=session.account, role=String(data.role||"").toLowerCase();
      const existingRole=await db.prepare("SELECT role FROM role_permissions WHERE role=?").bind(role).first();
      if(existingRole) requireRoleProfileManager(actor); else requireRankPermission(actor,"rank_add");
      if(existingRole) await assertOutranks(db,actor,role);
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
      clampNotificationKeys(permissions);
      permissions.training_view=TRAINING_VIEW_PERMISSIONS.every(key=>permissions[key]===true);
      const now=new Date().toISOString();
      const beforeSnapshot={permissions:await rolePermissions(db,role),scopes:await roleScopes(db,role)};
      await db.prepare(`INSERT INTO role_permissions(role,permissions_json,updated_at,updated_by) VALUES(?,?,?,?)
        ON CONFLICT(role) DO UPDATE SET permissions_json=excluded.permissions_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
        .bind(role,JSON.stringify(permissions),now,actor.name).run();
      if(data.scopes&&typeof data.scopes==="object") {
        const nextScopes=sanitizeScopes(data.scopes);
        if(actor.role!=="admin") {
          const currentScopes=await roleScopes(db,role);
          for(const scope of Object.keys(SCOPE_BASE_PERMISSIONS)) {
            if(SCOPE_BASE_PERMISSIONS[scope].some(key=>effective[key]===true)) continue;
            if(currentScopes[scope]) nextScopes[scope]=currentScopes[scope]; else delete nextScopes[scope];
          }
        }
        await db.prepare("UPDATE role_permissions SET scopes_json=? WHERE role=?").bind(JSON.stringify(nextScopes),role).run();
      }
      await db.prepare("INSERT INTO role_permission_history(role,changed_at,changed_by,before_json,after_json) VALUES(?,?,?,?,?)").bind(role,now,String(actor.name||""),JSON.stringify(beforeSnapshot),JSON.stringify({permissions:await rolePermissions(db,role),scopes:await roleScopes(db,role)})).run();
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
      const recent=(await db.prepare("SELECT n.id,n.kind,n.title,n.message,n.callsign,n.target_rank,n.created_at,CASE WHEN n.id<=COALESCE(m.read_through_id,0) OR r.notification_id IS NOT NULL THEN 1 ELSE 0 END AS is_read FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.account_id=? LEFT JOIN account_notification_marks m ON m.account_id=? LEFT JOIN notification_hidden h ON h.notification_id=n.id AND h.account_id=? LEFT JOIN notification_preferences p ON p.account_id=? AND p.kind=n.kind WHERE n.id>COALESCE(m.hidden_through_id,0) AND h.notification_id IS NULL AND COALESCE(p.enabled, CASE WHEN n.kind IN ('eligible','inactive','overdue','request') THEN 1 ELSE 0 END)=1 ORDER BY n.id DESC LIMIT 250").bind(user.account_id,user.account_id,user.account_id,user.account_id).all()).results||[];
      const viewableNotif=await viewRanks(db,user);
      let visibleItems=recent.filter(item=>notificationVisible(item,user));
      if(viewableNotif){
        const rankByCallsign=new Map(((await db.prepare("SELECT callsign,rank FROM members").all()).results||[]).map(row=>[String(row.callsign||"").toUpperCase(),row.rank]));
        visibleItems=visibleItems.filter(item=>!item.callsign||viewableNotif.includes(rankByCallsign.get(String(item.callsign).toUpperCase())||""));
      }
      const items=visibleItems.slice(0,100);
      const response=json({items,unread_count:items.filter(item=>!Number(item.is_read)).length});
      // Keep the legacy notification sheet in sync without delaying the D1 response.
      if(env.LVFR_D1_AUTH_BRIDGE_SECRET) {
        const assertion=await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET);
        const {proxyToAppsScript}=await import("../[[path]].js");
        context.waitUntil((async()=>{try{const mirror=await proxyToAppsScript(context,route,url,assertion,{});if(!mirror.ok)console.error("Notification Sheet mirror failed:",await mirror.text());}catch(error){console.error("Notification Sheet mirror failed:",error);}})());
      }
      return response;
    }
    if(route==="/api/account/notification-preferences" && method==="GET") {
      const row=(await db.prepare("SELECT * FROM notification_preferences_wide WHERE account_id=?").bind(user.account_id).first())||{};
      const options=NOTIFICATION_PREFERENCE_KINDS.map(item=>{
        const stored=row[item.kind];
        return {kind:item.kind,label:item.label,allowed:notifAllowed(user,item),enabled:stored===null||stored===undefined?DEFAULT_ON_NOTIFICATION_KINDS.includes(item.kind):Number(stored)===1};
      });
      return json({options});
    }
    if(route==="/api/account/notification-preferences" && method==="POST") {
      // One write per save, whatever the number of kinds changed. Column names come from the fixed list above.
      const requested=data.preferences&&typeof data.preferences==="object"?data.preferences:{};
      const columns=[],values=[];
      for(const item of NOTIFICATION_PREFERENCE_KINDS) {
        if(!notifAllowed(user,item)||!Object.hasOwn(requested,item.kind)) continue;
        columns.push(item.kind); values.push(requested[item.kind]?1:0);
      }
      if(columns.length) {
        const now=new Date().toISOString();
        await db.prepare(`INSERT INTO notification_preferences_wide(account_id,${columns.join(",")},updated_at) VALUES(?,${columns.map(()=>"?").join(",")},?) ON CONFLICT(account_id) DO UPDATE SET ${columns.map(c=>`${c}=excluded.${c}`).join(",")},updated_at=excluded.updated_at`)
          .bind(user.account_id,...values,now).run();
      }
      return json({ok:true});
    }
    if(route==="/api/notifications/clear-mine" && method==="POST") {
      // Hides every notification for this account only; other people keep theirs.
      const now=new Date().toISOString();
      const newestId=Number((await db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM notifications").first())?.id||0);
      if(newestId>0) await db.prepare("INSERT INTO account_notification_marks(account_id,read_through_id,hidden_through_id,updated_at) VALUES(?,0,?,?) ON CONFLICT(account_id) DO UPDATE SET hidden_through_id=MAX(hidden_through_id,excluded.hidden_through_id),updated_at=excluded.updated_at").bind(user.account_id,newestId,now).run();
      return json({ok:true});
    }
    if(route==="/api/notifications/read" && method==="POST") {
      const requested=Array.isArray(data.ids)?[...new Set(data.ids.map(value=>Number(value)).filter(Number.isSafeInteger))]:[];
      const now=new Date().toISOString();
      // One write per request: everything up to the highest requested id (or up to the newest notification) is read.
      const throughId=requested.length?Math.max(...requested):Number((await db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM notifications").first())?.id||0);
      if(throughId>0) await db.prepare("INSERT INTO account_notification_marks(account_id,read_through_id,hidden_through_id,updated_at) VALUES(?,?,0,?) ON CONFLICT(account_id) DO UPDATE SET read_through_id=MAX(read_through_id,excluded.read_through_id),updated_at=excluded.updated_at").bind(user.account_id,throughId,now).run();
      if(env.LVFR_D1_AUTH_BRIDGE_SECRET) {
        const assertion=await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET);
        context.waitUntil(mirrorToSheetInBackground(context,"Notification read",route,url,assertion,data,user.account_id,{dedupe:true}));
      }
      return json({ok:true});
    }
    if(route==="/api/notifications/clear" && method==="POST") {
      const assertion=env.LVFR_D1_AUTH_BRIDGE_SECRET?await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET):"";
      const {proxyToAppsScript}=await import("../[[path]].js");
      // Clear the website first, so the result never depends on the Sheet being reachable.
      await db.batch([db.prepare("DELETE FROM notification_hidden"),db.prepare("DELETE FROM notification_reads"),db.prepare("DELETE FROM account_notification_marks"),db.prepare("DELETE FROM notifications")]);
      context.waitUntil((async()=>{
        try {
          const sheetMirror=await proxyToAppsScript(context,"/internal/notifications/clear",url,assertion,{});
          const mirrorResult=await sheetMirror.json().catch(()=>({}));
          if(!sheetMirror.ok||mirrorResult.ok!==true) console.error("Notification clear in Google Sheet failed:",mirrorResult.detail||mirrorResult.error||"mirror failed");
        } catch(error) { console.error("Notification clear in Google Sheet failed:",error); }
      })());
      return json({ok:true,cleared:true});
    }
    if(route==="/api/members-log/clear" && method==="POST") {
      requireRolePermission(user,user.permissions,"logs_delete_d1");
      const kind=String(data.log_type||"").trim().toLowerCase();
      const allowed=["promotion","callsign","termination","training","training_time","loi","exam","note","activity","instructor","do_not_promote","do_not_terminate"];
      if(!allowed.includes(kind)) throw new Error("Choose a valid log category.");
      if(kind==="training_time") await db.prepare("DELETE FROM training_hours_log").run();
      else await db.prepare("DELETE FROM operational_logs WHERE kind=?").bind(kind).run();
      return json({ok:true,kind});
    }
    if(route==="/api/logs/clean" && method==="POST") {
      const allowed=["promotion","callsign","termination","training","training_time","loi","exam","note","activity","instructor","account_audit","notifications","do_not_promote","do_not_terminate","discord_action"];
      // "d1": removes from D1 only. "full": removes from D1 and the Google Sheet.
      const scope=String(data.scope||"full").toLowerCase()==="d1"?"d1":"full";
      const selected=[...new Set((Array.isArray(data.items)?data.items:[]).map(value=>String(value||"").trim().toLowerCase()))];
      const kinds=selected.includes("all")?allowed:selected;
      if(!kinds.length||kinds.some(kind=>!allowed.includes(kind))) throw Object.assign(new Error("Choose valid log categories."),{status:400});
      // The Discord action log exists only in D1, so it is never sent to the Sheet.
      const sheetKinds=kinds.filter(kind=>kind!=="discord_action");
      if(scope==="full"&&sheetKinds.length) {
        const assertion=env.LVFR_D1_AUTH_BRIDGE_SECRET?await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET):"";
        const {proxyToAppsScript}=await import("../[[path]].js");
        const mirror=await proxyToAppsScript(context,"/internal/logs/clear",url,assertion,{items:sheetKinds});
        const mirrorResult=await mirror.json().catch(()=>({}));
        if(!mirror.ok||mirrorResult.ok!==true) throw Object.assign(new Error("Google Sheets cleanup failed: "+String(mirrorResult.detail||mirrorResult.error||"mirror failed")),{status:502});
      }
      const statements=[];
      for(const kind of kinds) {
        if(kind==="notifications") statements.push(db.prepare("DELETE FROM notification_hidden"),db.prepare("DELETE FROM notification_reads"),db.prepare("DELETE FROM account_notification_marks"),db.prepare("DELETE FROM notifications"));
        else if(kind==="account_audit") statements.push(db.prepare("DELETE FROM account_audit"));
        else if(kind==="training_time") statements.push(db.prepare("DELETE FROM training_hours_log"));
        else if(kind==="discord_action") statements.push(db.prepare("DELETE FROM discord_action_log"));
        else statements.push(db.prepare("DELETE FROM operational_logs WHERE kind=?").bind(kind));
      }
      if(statements.length) await db.batch(statements);
      return json({ok:true,items:kinds,scope});
    }
    const directLogKind={"/api/promotions":"promotion","/api/training-log":"training","/api/exam-log":"exam","/api/termination-log":"termination"}[route];
    if((route==="/api/members-log"||directLogKind) && method==="GET") {
      const kind=directLogKind||String(url.searchParams.get("log_type")||"promotion").toLowerCase();
      const allowed=["promotion","callsign","termination","training","training_time","loi","exam","note","activity","instructor","do_not_promote","do_not_terminate"];
      if(!allowed.includes(kind)) throw Object.assign(new Error("Invalid log type: "+kind),{status:400});
      if(kind==="training_time") {
        const rows={results:await filterRowsByViewRanks(db,user,(await db.prepare("SELECT id,log_date,callsign,member_name,action,previous_time,new_time,changed_by FROM training_hours_log ORDER BY id DESC LIMIT 200").all()).results||[])};
        return json(rows.results||[]);
      }
      const rows={results:await filterRowsByViewRanks(db,user,(await db.prepare("SELECT id,kind,log_date,callsign,member_name,action,details,changed_by,old_rank,new_rank,old_callsign,new_callsign FROM operational_logs WHERE kind=? ORDER BY id DESC LIMIT 200").bind(kind).all()).results||[])};
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
      const auditActor=await accountForToken(db,token);
      if(!auditActor||auditActor.status!=="approved") throw Object.assign(new Error("Sign in again."),{status:401});
      if(auditActor.role!=="admin"&&(await accountPermissions(db,auditActor)).logs_delete_d1!==true) throw Object.assign(new Error("You need the Delete logs from D1 permission."),{status:403});
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
      const member=await db.prepare("SELECT callsign,name,has_hert,has_basic_firefighting,has_advanced_firefighting FROM members WHERE upper(callsign)=upper(?)").bind(callsign).first();
      if(!member) throw new Error("Choose a current roster member.");
      const rawPercent=data.test_percent;
      const percent=rawPercent==null||String(rawPercent).trim()===""?null:Number(rawPercent);
      if(action==="add"&&type==="FORT"&&(!Number.isFinite(percent)||percent<0||percent>100)) throw new Error("FORT LOI % on test must be a number from 0 to 100.");
      if(action==="add"&&type==="HERT"&&Number(member.has_hert)) throw new Error("Already HERT certified");
      if(action==="add") await assertInstructorType(db,user,[type],"You must be a "+type+" instructor to add "+type+" LOI.");
      if(action==="add"&&type==="FORT"&&Number(member.has_basic_firefighting)&&Number(member.has_advanced_firefighting)) throw new Error("Already FORT certified");
      // Validate the passed training before the LOI row is removed, so a bad request changes nothing.
      let passedTrainings=[];
      if(action==="passed"&&type==="HERT") passedTrainings=["Hert"];
      else if(action==="passed") {
        passedTrainings=[...new Set((Array.isArray(data.trainings)?data.trainings:[]).map(item=>String(item)))];
        if(!passedTrainings.length) throw new Error("Select Basic FORT, Advanced FORT, or both.");
        if(passedTrainings.some(item=>!FORT_PASS_TRAININGS.includes(item))) throw new Error("Choose Basic or Advanced Firefighting.");
        if(passedTrainings.includes("Advanced Firefighting")&&!passedTrainings.includes("Basic Firefighting")&&Number(member.has_basic_firefighting||0)!==1) throw new Error("Advanced FORT can be added only after Basic FORT.");
      }
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
      await createLogNotification(db,"loi",{action:"LOI "+eventAction,details:type+(testPercent===null||testPercent===""?"":" ("+testPercent+"%)"),oldRank:"",newRank:"",callsign:member.callsign,newCallsign:"",name:member.name,eventKey:"loi:"+logDate+":"+member.callsign});
      // A passed LOI certifies the member in D1 at once. Trainings already held are left unchanged.
      const trainingAdded=[];
      for(const training of passedTrainings) {
        const oldMember=await db.prepare("SELECT * FROM members WHERE upper(callsign)=upper(?)").bind(member.callsign).first();
        const trainingData={callsign:member.callsign,training,remove:false};
        const trainingResult=await applyRosterMutationD1(db,"/api/training",trainingData,user);
        if(oldMember) await recordActionConfirmation(db,"/api/training",trainingData,oldMember,trainingResult,user);
        if(trainingResult.changed!==false) {
          trainingAdded.push(training);
          if(oldMember) await writeOperationalLog(db,oldMember,"/api/training",trainingData,trainingResult,user);
        }
      }
      const {proxyToAppsScript}=await import("../[[path]].js");
      const mirrorData={type,action,name:member.name,callsign:member.callsign,test_percent:testPercent,source_row:previous?.source_row||null,trainings:passedTrainings,changed_by:String(user.name||"")};
      const sheetAssertion=env.LVFR_D1_AUTH_BRIDGE_SECRET?await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET):"";
      const logAssertion=env.LVFR_D1_AUTH_BRIDGE_SECRET?await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET):"";
      // The Sheet mirror runs after the response: D1 is already committed.
      const loiMirrorTask=(async()=>{
        try {
          const mirror=await proxyToAppsScript(context,"/internal/loi",url,sheetAssertion,mirrorData);
          if(!mirror.ok) console.error("LOI Sheet mirror failed:",String(await mirror.text()).slice(0,500));
          else if(action==="add") {
            const synced=await mirror.json().catch(()=>({}));
            if(Number(synced.row)>0) await db.prepare("UPDATE loi_entries SET source_row=? WHERE id=?").bind(Number(synced.row),entryId).run();
          }
        } catch(error) { console.error("LOI Sheet mirror failed:",error); }
        try {
          const loiLogData={kind:"loi",log_date:logDate,callsign:member.callsign,member_name:member.name,action:eventAction,details,changed_by:String(user.name||"")};
          const mirror=await proxyToAppsScript(context,"/internal/logs/mirror",url,logAssertion,loiLogData);
          if(!mirror.ok) {
            const mirrorText=String(await mirror.text()).slice(0,500);
            console.error("LOI log Sheet mirror failed:",mirrorText);
            await enqueueMirror(db,{label:"LOI log",route:"/internal/logs/mirror",method:request.method,query:url.search,actorId:user.account_id,data:loiLogData,error:mirrorText});
          }
        } catch(error) { console.error("LOI log Sheet mirror failed:",error); }
      })();
      context.waitUntil(loiMirrorTask);
      return json({ok:true,changed:true,background:true,id:entryId,row:entryId,type,name:member.name,callsign:member.callsign,test_percent:testPercent,action:eventAction,trainings:trainingAdded,training_added:trainingAdded.length>0});
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
      if(action==="add") await assertInstructorType(db,user,["HERT","FORT"],"You must be a HERT or FORT instructor to add Training Hours.");
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
      await createLogNotification(db,"training_time",{action:"Training Hours "+(logAction==="Time Changed"?"time changed":logAction.toLowerCase()),details:newTime?"Time: "+newTime+(previousTime&&action!=="add"?" (was "+previousTime+")":""):"Removed",oldRank:"",newRank:"",callsign:member.callsign,newCallsign:"",name:member.name,eventKey:"training_time:"+savedId+":"+timestamp});
      const bridgeAssertion=env.LVFR_D1_AUTH_BRIDGE_SECRET?await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET):"";
      const {proxyToAppsScript}=await import("../[[path]].js");
      const sheetLog={kind:"training_time",log_date:timestamp,callsign:member.callsign,member_name:member.name,action:logAction,details:JSON.stringify({previous_time:previousTime,new_time:newTime}),changed_by:user.name};
      const mirrorPayload={action,callsign:member.callsign,id:savedId,source_row:existing?.source_row,time:newTime,previous_time:previousTime,date:action==="add"?trainingDate:existing.training_date,mirror_id:String(savedId)+":"+timestamp,log_record:sheetLog};
      const sheetAlreadyLinked=Boolean(existing?.source_row);
      // The website answers as soon as D1 has committed. The Sheet mirror runs
      // after the response; a transient Apps Script failure is retried, and the
      // mirror_id guarantees a retry never writes the Sheet row twice.
      const mirrorTask=(async()=>{
        let lastError=null;
        for(let attempt=1;attempt<=3;attempt++){
          try {
            const sheetMirror=await proxyToAppsScript(context,"/internal/training-hours/mirror",url,bridgeAssertion,mirrorPayload);
            const mirrorResult=await sheetMirror.json().catch(()=>({}));
            if(!sheetMirror.ok||mirrorResult.ok!==true) {
              const responseDetail=mirrorResult.detail||mirrorResult.error||JSON.stringify(mirrorResult);
              throw new Error("Apps Script Sheet1 mirror was not confirmed (HTTP "+sheetMirror.status+"): "+String(responseDetail||"empty response").slice(0,400));
            }
            if(mirrorResult.row&&!sheetAlreadyLinked) {
              const sheetRow=Number(mirrorResult.row);
              // A Sheet-to-D1 import can claim this row between the Apps Script
              // write and this acknowledgement. Attach it only if no other D1
              // record owns it; otherwise collapse the placeholder into that record.
              await db.prepare("UPDATE training_hours SET source_row=? WHERE id=? AND source_row IS NULL AND NOT EXISTS (SELECT 1 FROM training_hours WHERE source_row=? AND id<>?)")
                .bind(sheetRow,savedId,sheetRow,savedId).run();
              const saved=await db.prepare("SELECT id,source_row,callsign,training_date,time FROM training_hours WHERE id=?").bind(savedId).first();
              if(!(saved&&Number(saved.source_row)===sheetRow)) {
                const imported=await db.prepare("SELECT id,callsign,training_date,time FROM training_hours WHERE source_row=?").bind(sheetRow).first();
                if(!imported||imported.callsign!==member.callsign||imported.training_date!==trainingDate||imported.time!==time) {
                  throw new Error("The Training Hours Sheet row was claimed by a different D1 record; refresh the row mapping.");
                }
                await db.prepare("DELETE FROM training_hours WHERE id=? AND source_row IS NULL").bind(savedId).run();
              }
            }
            return;
          } catch(error) {
            lastError=error;
            if(attempt<3) await new Promise(resolve=>setTimeout(resolve,1000*attempt));
          }
        }
        console.error("Training Hours Sheet mirror failed after retries:",String(lastError?.message||lastError).slice(0,500));
      })();
      context.waitUntil(mirrorTask);
      return json({ok:true,changed:true,id:savedId,message:"Training Hours record updated."});
    }
    if(route==="/api/members/version" && method==="GET") {
      // Small fingerprint of the roster. The browser compares it before
      // downloading and re-rendering the full member list.
      const packed=await db.prepare("SELECT group_concat(line,char(10)) AS packed FROM (SELECT callsign||'|'||name||'|'||rank||'|'||date||'|'||rank_assigned_date||'|'||days_in_rank||'|'||notes||'|'||has_basic_firefighting||has_advanced_firefighting||has_supervisor_exam||has_hert||'|'||activity||'|'||instructor_type||'|'||do_not_promote AS line FROM members ORDER BY callsign)").first();
      const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(packed?.packed||"")));
      const version=[...new Uint8Array(digest)].slice(0,12).map(b=>b.toString(16).padStart(2,"0")).join("");
      return json({version});
    }
    if(route==="/api/members" && method==="GET") {
      const viewableMembers=await viewRanks(db,user);
      const memberRows=await readMembers(db,url.searchParams.get("search")||"",env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET));
      return json(viewableMembers?memberRows.filter(row=>viewableMembers.includes(row.rank)):memberRows);
    }
    if(route==="/api/sync-status" && method==="GET") {
      await ensureRosterSyncStateTable(db);
      const snapshot=await db.prepare("SELECT COUNT(*) AS members,COALESCE((SELECT synced_at FROM roster_sync_state WHERE id=1),(SELECT MAX(synced_at) FROM members),'') AS synced_at FROM members").first();
      return json({synced_at:snapshot?.synced_at||null,members:Number(snapshot?.members||0),sync_running:false,sync_last_source:"",sync_last_success:snapshot?.synced_at||null,sync_error:null,auto_sync_enabled:false,auto_sync_interval_seconds:0,google_write:{running:false,pending:0,last_error:null,last_success:snapshot?.synced_at||null},archive:{enabled:true,status:"idle",pending:0,last_error:null,last_success:snapshot?.synced_at||null}});
    }
    if(route==="/api/config" && method==="GET") {
      await ensureCallsignSlotsTable(db);
      const slots=await db.prepare("SELECT rank,callsign,sheet_row AS row FROM callsign_slots ORDER BY CASE WHEN sheet_row IS NULL THEN 1 ELSE 0 END,sheet_row,callsign").all();
      const available={}; for(const x of slots.results||[]) if(!available[x.rank]) available[x.rank]=x.callsign;
      return json({ranks:["Commissioners","Chief","County Command","Division Commander","Captain","Lieutenant","Lead Paramedic","Paramedic","AEMT","EMT","Probationary","Senior Volunteer","Volunteer","Probationary Volunteer","EMR","EMR/Volunteer","Liaison"],available_callsigns:available,trainings:["Basic Firefighting","Advanced Firefighting","Hert"],activities:["Active","Semi Active","Inactive","Can Be Terminated"],exams:["Supervisor Exam"]});
    }
    if(route==="/api/eligible" && method==="GET") {
      const viewableEligible=await viewRanks(db,user);
      const rows=(await readMembers(db,"",env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET))).filter(row=>!viewableEligible||viewableEligible.includes(row.rank));
      const admin=["admin","commander"].includes(user.role);
      return json(rows.reduce((eligibleRows,row)=>{
        if(["Probationary","Probie","Probationary Volunteer","Probie Volunteer"].includes(row.rank)) return eligibleRows;
        const eligibility=rankEligibility(row);
        if(!eligibility.eligible || (!admin && (row.rank!=="EMT" || eligibility.next_rank!=="AEMT"))) return eligibleRows;
        eligibleRows.push({...row,eligible:true,next_rank:eligibility.next_rank,eligibility_reason:eligibility.reason});
        return eligibleRows;
      },[]));
    }
    const viewableInactive=(route==="/api/inactive"||route==="/api/training-overdue")&&method==="GET"?await viewRanks(db,user):null;
    if(route==="/api/inactive" && method==="GET") return json((await readMembers(db,"",env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET))).filter(row=>(!viewableInactive||viewableInactive.includes(row.rank))&&row.activity==="Can Be Terminated"&&!row.do_not_terminate).map(({callsign,name,rank})=>({callsign,name,rank})));
    if(route==="/api/training-overdue" && method==="GET") return json((await readMembers(db,"",env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET))).filter(row=>(!viewableInactive||viewableInactive.includes(row.rank))&&!row.do_not_terminate&&row.rank==="EMT"&&Number(row.days_in_rank||0)>=21&&(!row.has_basic_firefighting||!row.has_advanced_firefighting)).map(({callsign,name,days_in_rank,has_basic_firefighting,has_advanced_firefighting})=>({callsign,name,days_in_rank,has_basic_firefighting,has_advanced_firefighting})));
    if(route==="/api/do-not-terminate" && method==="GET") return json(await doNotListRows(db,env,user,"do_not_terminate","do_not_terminate"));
    if(route==="/api/do-not-promote" && method==="GET") return json(await doNotListRows(db,env,user,"do_not_promote","do_not_promote"));
    if(route==="/api/instructors" && method==="GET") return json((await readMembers(db,"",env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET))).flatMap(row=>String(row.instructor_type||"").toUpperCase().split(/\s*\/\s*/).filter(type=>(type==="HERT"&&user.permissions.hert_instructor_view)||(type==="FORT"&&user.permissions.fort_instructor_view)).map(type=>({name:row.name,type,date:""}))));
    if(route==="/api/account/discord-id/start" && method==="POST") return json(await startDiscordIdChange(context,db,env,request,user,data));
    if(route==="/api/account/discord-id/confirm" && method==="POST") return json(await confirmDiscordIdChange(context,db,env,request,user,data));
    if(route==="/api/account/discord-id" && method==="POST") throw Object.assign(new Error("Changing the Discord ID now needs a verification code. Use Account Settings and follow the steps."),{status:400});
    const memberRoute=route.match(/^\/api\/member\/([^/]+)$/);
    if(route==="/api/account/profile" && method==="GET") {
      const member=await resolveAccountMember(db,env,user);
      if(!member) return json({detail:"Member not found."},404);
      const memberCallsign=String(member.callsign||"").trim().toUpperCase();
      // Only return the Discord ID linked to the member's own callsign.
      // Include pending_callsign so a callsign change in progress does not temporarily hide the ID.
      const discordLink=await db.prepare("SELECT discord_user_id FROM discord_member_links WHERE callsign=? OR pending_callsign=? LIMIT 1").bind(memberCallsign,memberCallsign).first();
      member.discord_user_id=discordLink?.discord_user_id ? String(discordLink.discord_user_id) : "";
      const eligible=rankEligibility(member);
      member.trainings=[...(member.has_basic_firefighting?["basic_firefighting"]:[]),...(member.has_advanced_firefighting?["advanced_firefighting"]:[])];
      member.exams=member.has_supervisor_exam?["supervisor_exam"]:[]; member.hert=member.has_hert; member.eligible=eligible.eligible;
      member.eligibility_reason=eligible.reason; member.next_rank=eligible.next_rank; member.instructor_type=(["admin","commander"].includes(user.role) || /^(E|C|DIV|B|CHIEF|COM)-/.test(user.callsign))?member.instructor_type:""; member.instructor_date="";
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
      return json({...result,message:String(result.message||"Full sync completed from Google Sheets")});
    }
    const instructorWrite=route.match(/^\/api\/member\/([^/]+)\/instructor$/);
    if(method==="POST" && (MEMBER_WRITE_ROUTES.has(route)||instructorWrite)) {
      if(!env.LVFR_D1_AUTH_BRIDGE_SECRET) return json({detail:"D1 to Sheets mirroring is not configured: set the LVFR_D1_AUTH_BRIDGE_SECRET Worker secret and the matching Apps Script property."},503);
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
      if(route==="/api/terminate") {
        // A linked member needs an explicit Discord choice before anything is changed.
        const choice=String(mutationData.discord_action||"");
        const linked=await db.prepare("SELECT 1 AS found FROM discord_member_links WHERE callsign=?").bind(String(mutationData.callsign||"").toUpperCase()).first();
        if(linked&&!["kick","remove_roles","none"].includes(choice)) return json({detail:{message:"Choose what to do in Discord: kick, remove roles only, or clear the nickname only.",discord_choice_required:true}},409);
      }
      const result=await applyRosterMutationD1(db,route,mutationData,user);
      // A check only (dry run): nothing is written to D1, the logs or the Sheet.
      if(mutationData.dry_run) return json({...result,changed:false});
      if(result.changed!==false && oldMember) await writeOperationalLog(db,oldMember,route,mutationData,result,user);
      if(oldMember) await recordActionConfirmation(db,route,mutationData,oldMember,result,user);
      if(route==="/api/training" && result.changed!==false && oldMember) {
        const callsignForOps=normalizeDiscordCallsign(oldMember.callsign);
        const qualifies=Boolean(result.training_qualifies);
        context.waitUntil((async () => {
          try {
            const opsResult=await applyDiscordOpsRole(db, env, callsignForOps, qualifies);
            if(opsResult.outcome!=="not_linked" && opsResult.outcome!=="no change")
              await writeDiscordLog(db, user, qualifies?"Ops role added":"Ops role removed", callsignForOps, oldMember.name, opsResult.discord_user_id, "done", opsResult.outcome);
          } catch(error) {
            const message=String(error?.message||error).slice(0,400);
            console.error("Discord ops role update failed:", { callsign: callsignForOps, error: message });
            const link=await db.prepare("SELECT discord_user_id FROM discord_member_links WHERE callsign=?").bind(callsignForOps).first().catch(()=>null);
            if(link) await writeDiscordLog(db, user, qualifies?"Ops role added":"Ops role removed", callsignForOps, oldMember.name, link.discord_user_id, "failed", message).catch(()=>{});
          }
        })());
      }
      if(result.changed!==false && oldMember && ["/api/promote","/api/force-promote","/api/demote","/api/change-rank","/api/change-callsign"].includes(route)) {
        try {
          result.discord_sync = await queueDiscordRosterChange(db, context, env, oldMember, result);
          if(result.discord_sync === "pending") result.discord_sync_message = "Roster saved. Discord synchronization is running in the background.";
          else if(result.discord_sync === "not_linked") result.discord_sync_message = "Roster saved. No Discord mapping exists yet; run Sync Discord Members in Operation Command.";
          else if(result.discord_sync === "left_server") result.discord_sync_message = "Roster saved. This member is no longer in the Discord server, so Discord was not changed.";
        } catch(error) {
          console.error("Could not queue Discord synchronization:", String(error?.message || error).slice(0,400));
          result.discord_sync = "unavailable";
          result.discord_sync_message = "Roster saved, but Discord synchronization could not be queued. Check the Discord integration migration and configuration.";
        }
      }
      // Sheets can be out of sync with D1 (for example after a manual edit or
      // a prior background write failure). Always mirror instructor changes,
      // even when D1 already has the requested instructor state. Wait for the
      // Sheet write so the UI can report a failed cleanup instead of silently
      // claiming the instructor was removed.
      if(instructorWrite) {
        const assertion=await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET);
        context.waitUntil(mirrorToSheetInBackground(context,"Instructor",route,url,assertion,mutationData,user.account_id));
      } else if(route==="/api/terminate") {
        // The member no longer exists on the roster; drop their Discord link so the callsign can be reused safely.
        result.discord_termination=await discordTerminationAction(db,env,user,mutationData.callsign,String(mutationData.discord_action||""),oldMember?.name||"");
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
      } else if(route==="/api/training") {
        const assertion=await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET);
        context.waitUntil(mirrorToSheetInBackground(context,"Training",route,url,assertion,mutationData,user.account_id));
      } else if(result.changed!==false) {
        const assertion=await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET);
        // D1 is already committed, so reply at once and mirror to the Sheet in the background.
        context.waitUntil(mirrorToSheetInBackground(context,"Sheet write",route,url,assertion,mutationData,user.account_id));
      }
      return json(result);
    }
    // Only the heartbeat writes presence, and only when the stored value is older
    // than 100 s. Writing on every request (the members view polls every 3 s)
    // consumed D1 rows for no benefit.
    if (route==="/api/presence" && method==="POST") {
      await db.prepare("INSERT INTO account_presence(account_id,last_seen) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET last_seen=excluded.last_seen WHERE account_presence.last_seen < excluded.last_seen - ?").bind(user.account_id,nowSeconds(),PRESENCE_WRITE_GAP_SECONDS).run();
      return json({ok:true});
    }
    if (route==="/api/presence/summary" && method==="GET") { const r=await db.prepare("SELECT a.name,a.callsign FROM account_presence p JOIN accounts a ON a.account_id=p.account_id WHERE a.status='approved' AND p.last_seen>? ORDER BY lower(a.name)").bind(nowSeconds()-PRESENCE_ONLINE_SECONDS).all(); const online=(r.results||[]).map(x=>({name:x.name,callsign:x.callsign})); return json({online_count:online.length,online}); }
    if (route==="/api/leaders" && method==="GET") { const admin=await requireAdmin(db,token); return json(await leaders(db,admin)); }
    if (route==="/api/leaders/audit" && method==="GET") { await requireAdmin(db,token); const r=await db.prepare("SELECT id,created_at,account_id,name,callsign,action,actor_name,actor_name AS by FROM account_audit ORDER BY id DESC LIMIT 200").all(); return json(r.results||[]); }
    const passwordReset=route.match(/^\/api\/leaders\/([^/]+)\/reset-password$/);
    if(passwordReset && method==="POST") {
      // A Commander or Operation account sets a temporary password for a member who is locked out.
      const admin=await requireAdmin(db,token), targetId=decodeURIComponent(passwordReset[1]);
      const target=await db.prepare("SELECT account_id,name,name_key,callsign,role,status FROM accounts WHERE account_id=?").bind(targetId).first();
      if(!target||["removed","denied"].includes(target.status)) throw Object.assign(new Error("Account was not found."),{status:404});
      if(target.account_id===admin.account_id) throw new Error("Change your own password from Account settings.");
      if(admin.role==="commander"&&["admin","commander"].includes(target.role)) throw Object.assign(new Error("Only Operation can manage Operation or Commander accounts."),{status:403});
      const temporary=temporaryPassword(), salt=b64url(crypto.getRandomValues(new Uint8Array(16))), hash=await passwordHash(temporary,salt), now=new Date().toISOString();
      await db.batch([
        db.prepare("UPDATE accounts SET password_salt=?,password_hash=?,password_hash_version='pbkdf2-sha256-100000',updated_at=? WHERE account_id=?").bind(salt,hash,now,target.account_id),
        // Every open session of that account ends, and the sign-in lockout for its name is cleared.
        db.prepare("DELETE FROM auth_sessions WHERE account_id=?").bind(target.account_id),
        db.prepare("DELETE FROM auth_login_attempts WHERE login_key=?").bind(await sha256(target.name_key)),
        db.prepare("INSERT INTO account_audit(created_at,account_id,name,callsign,action,actor_name) VALUES(?,?,?,?,?,?)").bind(now,target.account_id,target.name,target.callsign,"reset_password",admin.name)
      ]);
      if(env.LVFR_D1_AUTH_BRIDGE_SECRET) {
        const assertion=await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET);
        context.waitUntil(mirrorToSheetInBackground(context,"Account audit","/internal/logs/mirror",url,assertion,{kind:"account_audit",account_id:target.account_id,name:target.name,callsign:target.callsign,action:"reset_password",actor_name:admin.name},user.account_id));
      }
      // The temporary password is shown once here and is stored only as a salted hash.
      return json({ok:true,account_id:target.account_id,name:target.name,callsign:target.callsign,temporary_password:temporary});
    }
    const action=route.match(/^\/api\/leaders\/([^/]+)\/(allow|deny|admin|commander|demote|member|leader|deactivate|reactivate)$/);
    if(action && method==="POST") {
      if(!env.LVFR_D1_AUTH_BRIDGE_SECRET) return json({detail:"Account Sheet mirroring is not configured: set LVFR_D1_AUTH_BRIDGE_SECRET in the Worker and Apps Script."},503);
      const admin=action[2]==="admin"||action[2]==="commander"?await requireOperation(db,token):await requireAdmin(db,token), target=await db.prepare("SELECT account_id,name,callsign,role FROM accounts WHERE account_id=?").bind(decodeURIComponent(action[1])).first();
      if(admin.role==="commander"&&target&&["admin","commander"].includes(target.role)) throw Object.assign(new Error("Only Operation can manage Operation or Commander accounts."),{status:403});
      const result=await accountAction(db,decodeURIComponent(action[1]),action[2],admin);
      if(env.LVFR_D1_AUTH_BRIDGE_SECRET) {
        const {proxyToAppsScript}=await import("../[[path]].js");
        const mirror=await proxyToAppsScript(context,"/internal/accounts/mirror",url,"",result.sheet_account);
        if(!mirror.ok) {
          const mirrorText=String(await mirror.text()).slice(0,500);
          const queued=await enqueueMirror(db,{label:"Account",route:"/internal/accounts/mirror",method:request.method,query:url.search,actorId:"",data:result.sheet_account,error:mirrorText});
          return json({detail:"D1 account change was saved, but the Accounts Sheet could not be updated: "+mirrorText+(queued?" It was queued and will be retried automatically.":"")},502);
        }
      }
      if(target&&env.LVFR_D1_AUTH_BRIDGE_SECRET) {
        const assertion=await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET), {proxyToAppsScript}=await import("../[[path]].js");
        const auditData={kind:"account_audit",account_id:target.account_id,name:target.name,callsign:target.callsign,action:action[2],actor_name:admin.name};
        const mirror=await proxyToAppsScript(context,"/internal/logs/mirror",url,assertion,auditData);
        if(!mirror.ok) {
          const mirrorText=String(await mirror.text()).slice(0,500);
          console.error("Account change audit Sheet mirror failed:",mirrorText);
          await enqueueMirror(db,{label:"Account audit",route:"/internal/logs/mirror",method:request.method,query:url.search,actorId:user.account_id,data:auditData,error:mirrorText});
        }
      }
      return json(result);
    }
    const deletion=route.match(/^\/api\/leaders\/([^/]+)$/);
    if(deletion && method==="DELETE") {
      if(!env.LVFR_D1_AUTH_BRIDGE_SECRET) return json({detail:"Account Sheet mirroring is not configured: set LVFR_D1_AUTH_BRIDGE_SECRET in the Worker and Apps Script."},503);
      const admin=await requireAdmin(db,token), id=decodeURIComponent(deletion[1]);
      const target=await db.prepare("SELECT account_id,name,callsign FROM accounts WHERE account_id=?").bind(id).first();
      const result=await accountAction(db,id,"delete",admin);
      if(env.LVFR_D1_AUTH_BRIDGE_SECRET) {
        const {proxyToAppsScript}=await import("../[[path]].js");
        const mirror=await proxyToAppsScript(context,"/internal/accounts/mirror",url,"",result.sheet_account);
        if(!mirror.ok) {
          const mirrorText=String(await mirror.text()).slice(0,500);
          const queued=await enqueueMirror(db,{label:"Account",route:"/internal/accounts/mirror",method:request.method,query:url.search,actorId:"",data:result.sheet_account,error:mirrorText});
          return json({detail:"D1 account deletion was saved, but the Accounts Sheet could not be updated: "+mirrorText+(queued?" It was queued and will be retried automatically.":"")},502);
        }
      }
      if(target&&env.LVFR_D1_AUTH_BRIDGE_SECRET) {
        const assertion=await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET), {proxyToAppsScript}=await import("../[[path]].js");
        const mirror=await proxyToAppsScript(context,"/internal/logs/mirror",url,assertion,{kind:"account_audit",account_id:target.account_id,name:target.name,callsign:target.callsign,action:"delete",actor_name:admin.name});
        if(!mirror.ok) console.error("Account deletion audit Sheet mirror failed:",await mirror.text());
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

// Members on a Do Not list, with who added them and when (latest ADDED entry in the operational log).
async function doNotListRows(db, env, user, kind, flag) {
  const members = (await readMembers(db, "", env, await signedClaims(user, env.LVFR_D1_AUTH_BRIDGE_SECRET))).filter(row => row[flag]);
  const logRows = (await db.prepare("SELECT callsign, log_date, changed_by FROM operational_logs WHERE kind=? AND action='ADDED' ORDER BY log_date DESC, rowid DESC").bind(kind).all()).results || [];
  const latest = new Map();
  for (const row of logRows) {
    const key = String(row.callsign || "").toUpperCase();
    if (!latest.has(key)) latest.set(key, row);
  }
  return members.map(({ callsign, name, rank }) => {
    const hit = latest.get(String(callsign || "").toUpperCase());
    return { callsign, name, rank, added_at: hit?.log_date || "", added_by: hit?.changed_by || "" };
  });
}
