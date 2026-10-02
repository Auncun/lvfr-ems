const enc = new TextEncoder();
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const nowSeconds = () => Math.floor(Date.now() / 1000);
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
  const claims = { sub: account.account_id, name: account.name, callsign: account.callsign, status: account.status, role: account.role, exp: nowSeconds() + 90 };
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
  return db.prepare(`SELECT a.account_id, a.name, a.callsign, a.status, a.role
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
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload.ok !== "boolean") throw new Error("Apps Script roster lookup failed.");
  if (!payload.ok) throw new Error(payload.error || "Apps Script request failed.");
  return payload.data;
}
async function rosterIdentity(env, name) {
  const member = await gasCall(env, "/auth/roster-lookup", "POST", { name });
  if (!member || !member.name || !member.callsign) throw new Error("Name was not found on the LVFR roster.");
  return member;
}
async function syncMembersFromAppsScript(db, env, token = "", forceFresh = false) {
  // A manual/after-write refresh must bypass the Apps Script roster cache.
  // Its /api/sync endpoint invalidates that cache before reading Sheets.
  const snapshot = forceFresh
    ? await gasCall(env, "/api/sync", "POST", {}, token)
    : await gasCall(env, "/api/members", "GET", {}, token);
  const members = Array.isArray(snapshot) ? snapshot : snapshot && snapshot.members;

  if (!Array.isArray(members)) {
    throw new Error("Apps Script returned an invalid roster.");
  }

  const syncedAt = new Date().toISOString();

  return await replaceMembers(db, members, syncedAt);
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
function memberFromRow(row) {
  const assigned=String(row.rank_assigned_date||row.date||"");
  const us=assigned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const assignedTime=us?Date.UTC(Number(us[3]),Number(us[1])-1,Number(us[2])):Date.parse(assigned);
  const days=Number.isFinite(assignedTime)?Math.max(0,Math.floor((Date.now()-assignedTime)/86400000)):Number(row.days_in_rank||0);
  return { ...row, row: row.sheet_row, has_basic_firefighting: !!row.has_basic_firefighting,
    has_advanced_firefighting: !!row.has_advanced_firefighting, has_supervisor_exam: !!row.has_supervisor_exam,
    has_hert: !!row.has_hert, do_not_promote: !!row.do_not_promote, days_in_rank: days };
}
async function readMembers(db, search = "", env = null, token = "") {
  const current=await db.prepare("SELECT COUNT(*) AS n FROM members").first();
  if(!Number(current?.n||0) && env) await syncMembersFromAppsScript(db,env,token);
  const q = String(search || "").trim().toLowerCase();
  const result = q
    ? await db.prepare("SELECT * FROM members WHERE lower(callsign) LIKE ? OR lower(name) LIKE ? OR lower(rank) LIKE ? ORDER BY rank,name").bind(`%${q}%`,`%${q}%`,`%${q}%`).all()
    : await db.prepare("SELECT * FROM members ORDER BY rank,name").all();
  const rankOrder=["Commissioners","Chief","County Command","Division Commander","Captain","Lieutenant","Lead Paramedic","Paramedic","AEMT","EMT","Probationary","Senior Volunteer","Volunteer","Probationary Volunteer","EMR","EMR/Volunteer"];
  return (result.results || []).map(memberFromRow).sort((a,b)=>(rankOrder.indexOf(a.rank)<0?999:rankOrder.indexOf(a.rank))-(rankOrder.indexOf(b.rank)<0?999:rankOrder.indexOf(b.rank)) || a.callsign.localeCompare(b.callsign));
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
  return { account_id: account.account_id, id: account.account_id, name: account.name, callsign: account.callsign,
    role: account.role, status: account.status, is_admin: ["admin", "commander"].includes(account.role),
    is_command: ["admin", "commander"].includes(account.role) || /^(E|C|DIV|B|CHIEF|COM)-/.test(account.callsign),
    instructor_type: String(member?.instructor_type || "") };
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
  if (!setup) throw Object.assign(new Error("New registration is temporarily closed until the first Commander account is set up."), { status: 503 });
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
  if (state || Number(count.n) !== 0) throw Object.assign(new Error("Commander bootstrap is closed because account setup has already started."), { status: 409 });
  const identity = await rosterIdentity(env, data.name);
  const id = crypto.randomUUID(), now = new Date().toISOString(), salt = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await passwordHash(data.password, salt);
  try {
    await db.batch([
      db.prepare("INSERT INTO account_migration_state(migration_key,value,updated_at) VALUES('initial_commander_created',?,?)").bind(id, now),
      db.prepare(`INSERT INTO accounts(account_id,name,name_key,callsign,password_salt,password_hash,password_hash_version,status,role,created_at,activated_at,approved_by,updated_at)
        VALUES(?,?,?,?,?,?,'pbkdf2-sha256-100000','approved','admin',?,?,?,?)`).bind(id, identity.name, nameKey(identity.name), identity.callsign, salt, hash, now, now, "Initial D1 setup", now),
      db.prepare("INSERT INTO account_audit(created_at,account_id,name,callsign,action,actor_name) VALUES(?,?,?,?,?,?)").bind(now,id,identity.name,identity.callsign,"Initial Commander Created",identity.name)
    ]);
  } catch (error) {
    if (/unique|constraint/i.test(String(error))) throw Object.assign(new Error("Bootstrap already completed or account name is already in use."), { status: 409 });
    throw error;
  }
  return { ok:true, status:"approved", callsign:identity.callsign, message:"Initial Commander account created. Remove LVFR_D1_BOOTSTRAP_SECRET now." };
}
async function requireAdmin(db, token) {
  const account = await accountForToken(db, token);
  if (!account || account.status !== "approved") throw Object.assign(new Error("Sign in again."), { status: 401 });
  if (!["admin", "commander"].includes(account.role)) throw Object.assign(new Error("Only Commanders can perform this action."), { status: 403 });
  return account;
}
async function leaders(db, actor) {
  const rows = await db.prepare("SELECT account_id,name,callsign,status,role,created_at,activated_at,approved_by,admin_changed_at,admin_changed_by FROM accounts WHERE status NOT IN ('removed','denied') ORDER BY created_at DESC").all();
  const audit = await db.prepare("SELECT id,created_at,account_id,name,callsign,action,actor_name,actor_name AS by FROM account_audit ORDER BY id DESC LIMIT 200").all();
  const online = await db.prepare("SELECT account_id,last_seen FROM account_presence WHERE last_seen>?").bind(nowSeconds() - 90).all();
  const on = new Set((online.results || []).map(x => x.account_id));
  const accounts = (rows.results || []).map(row => ({ ...row, id: row.account_id, display_name: row.name, requested_at: row.created_at, linked_at: row.created_at, approved_at: row.activated_at, is_admin: ["admin", "commander"].includes(row.role), online: row.status === "approved" && on.has(row.account_id) }));
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
    case "demote": if (!["admin","commander"].includes(role)) throw new Error("Account is not a Commander."); role="leader"; changedAt=now; changedBy=actor.name; break;
    case "member": if(status!=="approved" || ["admin","commander"].includes(role)) throw new Error("Remove Commander access first."); role="member"; changedAt=now; changedBy=actor.name; break;
    case "leader": if(status!=="approved" || role!=="member") throw new Error("Only an approved Member can become a Supervisor."); role="leader"; changedAt=now; changedBy=actor.name; break;
    case "deactivate": if(status!=="approved" || ["admin","commander"].includes(role)) throw new Error("Remove Commander access first."); status="deactivated"; changedAt=now; changedBy=actor.name; break;
    case "reactivate": if(status!=="deactivated") throw new Error("Account is not deactivated."); status="approved"; activated=now; approvedBy=actor.name; break;
    case "delete": if(["admin","commander"].includes(role)) throw new Error("Remove Commander access before deleting the account."); status="removed"; break;
    default: throw new Error("Unknown account action.");
  }
  await db.batch([
    db.prepare("UPDATE accounts SET status=?,role=?,activated_at=?,approved_by=?,admin_changed_at=?,admin_changed_by=?,updated_at=? WHERE account_id=?").bind(status,role,activated,approvedBy,changedAt,changedBy,now,id),
    db.prepare("INSERT INTO account_audit(created_at,account_id,name,callsign,action,actor_name) VALUES(?,?,?,?,?,?)").bind(now,id,target.name,target.callsign,action,actor.name),
    ...(["deny","delete","deactivate"].includes(action) ? [db.prepare("DELETE FROM auth_sessions WHERE account_id=?").bind(id)] : [])
  ]);
  return { ok:true, status:"saving" };
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
      return json(await replaceMembers(db,data.members));
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
    if(route==="/api/members" && method==="GET") {
      if(!["admin","commander","leader"].includes(user.role)) throw Object.assign(new Error("Only a Supervisor or Commander can view the roster."),{status:403});
      return json(await readMembers(db,url.searchParams.get("search")||"",env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET)));
    }
    if(route==="/api/members/version" && method==="GET") {
      if(!["admin","commander","leader"].includes(user.role)) throw Object.assign(new Error("Only a Supervisor or Commander can view roster status."),{status:403});
      const version=await db.prepare("SELECT COUNT(*) AS count, COALESCE(MAX(synced_at),'') AS synced_at FROM members").first();
      return json({version:`${version?.count||0}:${version?.synced_at||""}`});
    }
    if(route==="/api/eligible" && method==="GET") {
      if(!["admin","commander","leader"].includes(user.role)) throw Object.assign(new Error("Only a Supervisor or Commander can view eligibility."),{status:403});
      const rows=await readMembers(db,"",env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET)); return json(rows.filter(row=>!['Probationary','Probie','Probationary Volunteer','Probie Volunteer'].includes(row.rank) && rankEligibility(row).eligible).map(row=>({...row,eligible:true,next_rank:rankEligibility(row).next_rank,eligibility_reason:rankEligibility(row).reason})));
    }
    if(route==="/api/inactive" && method==="GET") { await requireAdmin(db,token); return json((await readMembers(db,"",env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET))).filter(row=>row.activity==="Can Be Terminated").map(({callsign,name})=>({callsign,name}))); }
    if(route==="/api/do-not-promote" && method==="GET") { await requireAdmin(db,token); return json((await readMembers(db,"",env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET))).filter(row=>row.do_not_promote).map(({callsign,name})=>({callsign,name,added_at:"",added_by:""}))); }
    if(route==="/api/instructors" && method==="GET") { await requireAdmin(db,token); return json((await readMembers(db,"",env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET))).filter(row=>row.instructor_type).map(({name,instructor_type})=>({name,type:instructor_type,date:""}))); }
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
      if(!["admin","commander","leader"].includes(user.role)) throw Object.assign(new Error("Only a Supervisor or Commander can view member profiles."),{status:403});
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
      const result=await syncMembersFromAppsScript(db,env,await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET),true);
      return json({...result,message:"Roster synchronized from Google Sheets"});
    }
    await db.prepare("INSERT INTO account_presence(account_id,last_seen) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET last_seen=excluded.last_seen").bind(user.account_id,nowSeconds()).run();
    if (route==="/api/presence" && method==="POST") return json({ok:true});
    if (route==="/api/presence/summary" && method==="GET") { const r=await db.prepare("SELECT COUNT(*) AS online_count FROM account_presence p JOIN accounts a ON a.account_id=p.account_id WHERE a.status='approved' AND p.last_seen>?").bind(nowSeconds()-90).first(); return json({online_count:r.online_count}); }
    if (route==="/api/leaders" && method==="GET") { const admin=await requireAdmin(db,token); return json(await leaders(db,admin)); }
    if (route==="/api/leaders/audit" && method==="GET") { await requireAdmin(db,token); const r=await db.prepare("SELECT id,created_at,account_id,name,callsign,action,actor_name,actor_name AS by FROM account_audit ORDER BY id DESC LIMIT 200").all(); return json(r.results||[]); }
    const action=route.match(/^\/api\/leaders\/([^/]+)\/(allow|deny|admin|demote|member|leader|deactivate|reactivate)$/);
    if(action && method==="POST") { const admin=await requireAdmin(db,token); return json(await accountAction(db,decodeURIComponent(action[1]),action[2],admin)); }
    const deletion=route.match(/^\/api\/leaders\/([^/]+)$/);
    if(deletion && method==="DELETE") { const admin=await requireAdmin(db,token); return json(await accountAction(db,decodeURIComponent(deletion[1]),"delete",admin)); }
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
    if(method==="POST" && (MEMBER_WRITE_ROUTES.has(route) || /^\/api\/member\/[^/]+\/instructor$/.test(route)) && response.ok) {
      // Sheets is authoritative. Return its successful write immediately and
      // refresh the full D1 roster as a Pages background task so site actions
      // are not held open by a second Apps Script roster read and D1 batch.
      const refresh = (async () => {
        try {
          const freshAssertion=await signedClaims(user,env.LVFR_D1_AUTH_BRIDGE_SECRET);
          await syncMembersFromAppsScript(db,env,freshAssertion,true);
        } catch(error) {
          console.error("Roster was saved in Sheets but the background D1 refresh failed; use Sync now:",error);
        }
      })();
      context.waitUntil(refresh);
    }
    return response;
  } catch(error) { console.error("D1 API request failed:",error); return json({detail:error.message||"Request failed."},error.status||400); }
}
