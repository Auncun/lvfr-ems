const enc = new TextEncoder();
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
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
function bearer(request) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}
async function accountForToken(db, token) {
  if (!token) return null;
  return db.prepare(`SELECT a.account_id, a.name, a.callsign, a.status, a.role
    FROM auth_sessions s JOIN accounts a ON a.account_id=s.account_id
    WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token), nowSeconds()).first();
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
async function appendAudit(db, account, action, actor) {
  await db.prepare(`INSERT INTO account_audit(created_at,account_id,name,callsign,action,actor_name)
    VALUES(?,?,?,?,?,?)`).bind(new Date().toISOString(), account.account_id, account.name, account.callsign, action, actor || "").run();
}
async function publicUser(account) {
  return { account_id: account.account_id, id: account.account_id, name: account.name, callsign: account.callsign,
    role: account.role, status: account.status, is_admin: ["admin", "commander"].includes(account.role),
    is_command: ["admin", "commander"].includes(account.role) || /^(E|C|DIV|B|CHIEF|COM)-/.test(account.callsign), instructor_type: "" };
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
  return { token, user: await publicUser(account) };
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
    case "leader": if(status!=="approved" || role!=="member") throw new Error("Only an approved Member can become a Leader."); role="leader"; changedAt=now; changedBy=actor.name; break;
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
    const token=bearer(request), authRoute=route.startsWith("/auth/");
    if (route==="/api/health" && method==="GET") return json({ok:true,backend:"Cloudflare D1",auth_store:"D1"});
    if (route==="/auth/signup" && method==="POST") return json(await signup(db,env,data));
    if (route==="/auth/login" && method==="POST") return json(await login(db,data));
    if (route==="/auth/logout" && method==="POST") { if(token) await db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").bind(await sha256(token)).run(); return json({ok:true}); }
    if (route==="/auth/me" && method==="GET") { const a=await accountForToken(db,token); if(!a) return json({detail:"Your session expired. Sign in again."},401); return json(await publicUser(a)); }
    if (route==="/auth/bootstrap-commander" && method==="POST") return json(await bootstrapCommander(db,env,request,data));
    const user=await accountForToken(db,token);
    if(!user || user.status!=="approved") return json({detail:"Sign in again."},401);
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
    return await proxyToAppsScript(context,route,url,assertion,data);
  } catch(error) { console.error("D1 API request failed:",error); return json({detail:error.message||"Request failed."},error.status||400); }
}
