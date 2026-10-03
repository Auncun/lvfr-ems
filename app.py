import base64
import asyncio
import contextvars
import datetime
import hashlib
import hmac
import importlib
import json
import logging
import os
import re
import secrets
import time
import unicodedata
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from dotenv import load_dotenv

import backend_logic as L

from pathlib import Path
from threading import Thread, Lock, Timer

logger = logging.getLogger("lvfr_ems")


# ============================================================
# APP SETUP
# ============================================================

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
load_dotenv(BASE_DIR / "env")

CURRENT_USER = contextvars.ContextVar("current_user", default=None)
SESSION_COOKIE = "lvfr_ems_session"
SESSION_MAX_AGE = 12 * 60 * 60
SESSION_STAY_AGE = 30 * 24 * 60 * 60
PASSWORD_ITERATIONS = 450_000
MAX_PASSWORD_LENGTH = 128
COOKIE_SECURE_SETTING = os.getenv("COOKIE_SECURE", "auto").strip().lower()
AUTH_RATE_LIMIT_LOCK = Lock()
AUTH_RATE_LIMITS = defaultdict(deque)
ACCOUNT_CACHE_TTL = 300
ACCOUNT_CACHE_ERROR_TTL = 30
ACCOUNT_CACHE = {"at": 0.0, "rows": [], "error_retry_at": 0.0}
ACCOUNT_CACHE_LOCK = Lock()
ACCOUNT_CACHE_REFRESHING = False
LEADER_OVERVIEW_CACHE = {"at": 0.0, "data": None}
LEADER_OVERVIEW_LOCK = Lock()
LEADER_OVERVIEW_REFRESHING = False
INSTRUCTOR_DIRECTORY_CACHE = {"at": 0.0, "data": {}, "loaded": False}
INSTRUCTOR_DIRECTORY_LOCK = Lock()
INSTRUCTOR_DIRECTORY_REFRESHING = False
PRESENCE_ONLINE_SECONDS = 90
MEMBER_EVENT_SUBSCRIBERS = {}
MEMBER_EVENT_LOCK = Lock()
MEMBER_CHANGE_PATHS = {
    "/api/sync",
    "/api/training",
    "/api/exam",
    "/api/activity",
    "/api/note",
    "/api/date",
    "/api/terminate",
    "/api/promote",
    "/api/force-promote",
    "/api/demote",
    "/api/change-rank",
    "/api/change-callsign",
    "/api/watch-command",
}


def _publish_member_update():
    _publish_event(
        "members-updated",
        {"updated_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds")},
    )


def _publish_event(event_name, payload, account_id=None):
    encoded = json.dumps(payload)
    with MEMBER_EVENT_LOCK:
        subscribers = list(MEMBER_EVENT_SUBSCRIBERS.items())
    for subscriber, details in subscribers:
        if account_id and details["account_id"] != str(account_id):
            continue

        def enqueue(target=subscriber, event=event_name, data=encoded):
            while target.full():
                try:
                    target.get_nowait()
                except asyncio.QueueEmpty:
                    break
            try:
                target.put_nowait((event, data))
            except asyncio.QueueFull:
                pass

        details["loop"].call_soon_threadsafe(enqueue)


def _publish_update_failure(account_id, callsign, error, reverted):
    _publish_event(
        "update-failed",
        {
            "callsign": str(callsign or ""),
            "reason": str(error or "Google Sheets rejected the update")[:400],
            "reverted": bool(reverted),
        },
        account_id=account_id,
    )


def _cached_instructor_directory():
    global INSTRUCTOR_DIRECTORY_REFRESHING
    with INSTRUCTOR_DIRECTORY_LOCK:
        if time.monotonic() - INSTRUCTOR_DIRECTORY_CACHE["at"] >= 300:
            if INSTRUCTOR_DIRECTORY_CACHE["loaded"]:
                if not INSTRUCTOR_DIRECTORY_REFRESHING:
                    INSTRUCTOR_DIRECTORY_REFRESHING = True
                    baseline = INSTRUCTOR_DIRECTORY_CACHE["at"]
                    Thread(
                        target=_refresh_instructor_directory_in_background,
                        args=(baseline,),
                        daemon=True,
                    ).start()
                return INSTRUCTOR_DIRECTORY_CACHE["data"]
            try:
                directory = L.get_instructor_directory()
            except Exception:
                # Avoid retrying a failed Sheets request on every member-list
                # request. Keep the last known directory and retry after 30s.
                INSTRUCTOR_DIRECTORY_CACHE["at"] = time.monotonic() - 270
                raise
            INSTRUCTOR_DIRECTORY_CACHE.update(
                at=time.monotonic(), data=directory, loaded=True
            )
        return INSTRUCTOR_DIRECTORY_CACHE["data"]


def _refresh_instructor_directory_in_background(baseline):
    global INSTRUCTOR_DIRECTORY_REFRESHING
    try:
        directory = L.get_instructor_directory()
        with INSTRUCTOR_DIRECTORY_LOCK:
            if INSTRUCTOR_DIRECTORY_CACHE["at"] == baseline:
                INSTRUCTOR_DIRECTORY_CACHE.update(at=time.monotonic(), data=directory, loaded=True)
    except Exception as e:
        logger.info(f"[LVFR EMS] Background instructor refresh failed: {e}")
        with INSTRUCTOR_DIRECTORY_LOCK:
            if INSTRUCTOR_DIRECTORY_CACHE["at"] == baseline:
                INSTRUCTOR_DIRECTORY_CACHE["at"] = time.monotonic() - 270
    finally:
        with INSTRUCTOR_DIRECTORY_LOCK:
            INSTRUCTOR_DIRECTORY_REFRESHING = False


def _update_cached_instructor(name, instructor_type, assigned):
    name = str(name or "").strip()
    key = _instructor_name_key(name)
    with INSTRUCTOR_DIRECTORY_LOCK:
        directory = dict(INSTRUCTOR_DIRECTORY_CACHE["data"])
        current = directory.get(key, {"name": name, "type": "", "date": ""})
        types = [value.strip() for value in str(current.get("type") or "").split("/") if value.strip()]
        if assigned and instructor_type not in types:
            types.append(instructor_type)
        elif not assigned:
            types = [value for value in types if value != instructor_type]

        if types:
            directory[key] = {
                "name": name,
                "type": " / ".join(value for value in ("HERT", "FORT") if value in types),
                "date": (datetime.date.today().isoformat() if assigned and instructor_type == "FORT"
                         else current.get("date", "") if "FORT" in types else ""),
            }
        else:
            directory.pop(key, None)

        INSTRUCTOR_DIRECTORY_CACHE.update(
            at=time.monotonic(),
            data=directory,
            loaded=True,
        )
SIGNUP_JOB_STATUS = {}
SIGNUP_JOB_LOCK = Lock()

@asynccontextmanager
async def lifespan(application):
    await run_in_threadpool(_startup)
    try:
        yield
    finally:
        pass


app = FastAPI(title="LVFR EMS Operations", lifespan=lifespan)

app.mount(
    "/static",
    StaticFiles(
        directory=str(STATIC_DIR)
    ),
    name="static"
)


@app.get("/service-worker.js", include_in_schema=False)
def pwa_service_worker():
    return FileResponse(
        STATIC_DIR / "service-worker.js",
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"},
    )


@app.get("/pwa-icon.svg", include_in_schema=False)
def pwa_icon():
    return FileResponse(STATIC_DIR / "pwa-icon.svg", media_type="image/svg+xml")


def _b64encode(value):
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _session_secret():
    value = os.getenv("APP_SESSION_SECRET", "")
    if len(value) < 32:
        return None
    return value.encode("utf-8")


def _encode_session(user, stay_logged_in=False):
    key = _session_secret()
    if not key:
        raise ValueError("APP_SESSION_SECRET must be configured (32+ characters)")
    max_age = SESSION_STAY_AGE if stay_logged_in else SESSION_MAX_AGE
    payload = json.dumps(
        {**user, "expires_at": int(time.time()) + max_age},
        separators=(",", ":")
    ).encode("utf-8")
    encoded = _b64encode(payload)
    signature = hmac.new(key, encoded.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded}.{_b64encode(signature)}"


def _decode_session(request):
    token = request.cookies.get(SESSION_COOKIE, "")
    key = _session_secret()
    if not token or not key or "." not in token:
        return None
    try:
        encoded, signed = token.split(".", 1)
        expected = hmac.new(key, encoded.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64decode(signed)):
            return None
        payload = json.loads(_b64decode(encoded))
        if int(payload.get("expires_at", 0)) < int(time.time()):
            return None
        return payload if payload.get("account_id") and payload.get("name") else None
    except Exception:
        return None


def _password_version(account):
    password_hash = str(account.get("password_hash") or "")
    return hashlib.sha256(password_hash.encode("utf-8")).hexdigest()


def _name_key(value):
    normalized = unicodedata.normalize("NFKC", " ".join(str(value or "").split()))
    return normalized.casefold()


def current_actor():
    user = CURRENT_USER.get()
    if not user:
        return "Unknown user"
    return str(user.get("name") or "Unknown user")


def _member_names_by_callsign(callsigns):
    wanted = {str(callsign or "").strip().upper() for callsign in callsigns}
    wanted.discard("")
    if not wanted:
        return {}
    con = L.db()
    try:
        rows = con.execute("SELECT callsign, name FROM Members").fetchall()
        return {
            str(row["callsign"] or "").strip().upper(): str(row["name"] or "").strip()
            for row in rows
            if str(row["callsign"] or "").strip().upper() in wanted and str(row["name"] or "").strip()
        }
    finally:
        con.close()


def _member_name_for_callsign(callsign, fallback=""):
    key = str(callsign or "").strip().upper()
    if not key:
        return str(fallback or "")
    con = L.db()
    try:
        row = con.execute(
            "SELECT name FROM Members WHERE UPPER(TRIM(callsign))=? LIMIT 1", (key,)
        ).fetchone()
        return str(row["name"] or "").strip() if row and str(row["name"] or "").strip() else str(fallback or "")
    finally:
        con.close()


def _enforce_auth_rate_limit(scope, key, limit, window_seconds):
    now = time.monotonic()
    bucket_key = (scope, _name_key(key or "unknown"))
    with AUTH_RATE_LIMIT_LOCK:
        bucket = AUTH_RATE_LIMITS[bucket_key]
        while bucket and now - bucket[0] >= window_seconds:
            bucket.popleft()
        if len(bucket) >= limit:
            retry_after = max(1, int(window_seconds - (now - bucket[0])))
            raise HTTPException(
                status_code=429,
                detail=f"Too many {scope} attempts. Try again in {retry_after} seconds.",
                headers={"Retry-After": str(retry_after)},
            )
        bucket.append(now)
        if len(AUTH_RATE_LIMITS) > 5000:
            for old_key in list(AUTH_RATE_LIMITS):
                old_bucket = AUTH_RATE_LIMITS[old_key]
                while old_bucket and now - old_bucket[0] >= max(window_seconds, 3600):
                    old_bucket.popleft()
                if not old_bucket:
                    AUTH_RATE_LIMITS.pop(old_key, None)


def _client_ip(request):
    return request.client.host if request.client else "unknown"


def _load_accounts(force=False):
    global ACCOUNT_CACHE_REFRESHING
    with ACCOUNT_CACHE_LOCK:
        now = time.monotonic()
        if not force and now - ACCOUNT_CACHE["at"] < ACCOUNT_CACHE_TTL:
            return ACCOUNT_CACHE["rows"]
        if not force and now < ACCOUNT_CACHE.get("error_retry_at", 0.0):
            return ACCOUNT_CACHE["rows"]
        if not force and ACCOUNT_CACHE["rows"]:
            if not ACCOUNT_CACHE_REFRESHING:
                ACCOUNT_CACHE_REFRESHING = True
                baseline = ACCOUNT_CACHE["at"]
                Thread(
                    target=_refresh_accounts_in_background,
                    args=(baseline,),
                    daemon=True,
                ).start()
            return ACCOUNT_CACHE["rows"]
        # Keep the refresh inside the lock so concurrent requests do not all
        # make the same slow Google Sheets request after the cache expires.
        try:
            rows = L.get_account_records()
        except Exception:
            retry_at = time.monotonic() + ACCOUNT_CACHE_ERROR_TTL
            ACCOUNT_CACHE.update(at=retry_at - ACCOUNT_CACHE_TTL, error_retry_at=retry_at)
            raise
        now = time.monotonic()
        ACCOUNT_CACHE.update(at=now, rows=rows, error_retry_at=0.0)
        return ACCOUNT_CACHE["rows"]


def _refresh_accounts_in_background(baseline):
    global ACCOUNT_CACHE_REFRESHING
    try:
        rows = L.get_account_records()
        with ACCOUNT_CACHE_LOCK:
            if ACCOUNT_CACHE["at"] == baseline:
                ACCOUNT_CACHE.update(at=time.monotonic(), rows=rows)
    except Exception as e:
        logger.info(f"[LVFR EMS] Background account refresh failed: {e}")
        with ACCOUNT_CACHE_LOCK:
            if ACCOUNT_CACHE["at"] == baseline:
                retry_at = time.monotonic() + ACCOUNT_CACHE_ERROR_TTL
                ACCOUNT_CACHE.update(at=retry_at - ACCOUNT_CACHE_TTL, error_retry_at=retry_at)
    finally:
        with ACCOUNT_CACHE_LOCK:
            ACCOUNT_CACHE_REFRESHING = False


def _account_for_id(account_id, force=False):
    return next((r for r in _load_accounts(force) if r["account_id"] == str(account_id)), None)


def _account_by_name(name, force=False):
    key = _name_key(name)
    return next((r for r in _load_accounts(force) if _name_key(r["name"]) == key), None)


def _password_digest(password, salt):
    # Prefer a dedicated password pepper; fall back to the session secret.
    pepper = os.getenv("ACCOUNT_PASSWORD_PEPPER", "").strip()
    if len(pepper) < 32:
        pepper = os.getenv("APP_SESSION_SECRET", "").strip()
    if len(pepper) < 32:
        raise HTTPException(
            status_code=503,
            detail="Account password storage is not configured. Set ACCOUNT_PASSWORD_PEPPER or APP_SESSION_SECRET in the local env file to a secret of at least 32 characters.",
        )
    material = str(password).encode("utf-8") + b"\x00" + pepper.encode("utf-8")
    return hashlib.pbkdf2_hmac("sha256", material, bytes.fromhex(salt), PASSWORD_ITERATIONS).hex()


def _password_fields(password):
    salt = secrets.token_bytes(16).hex()
    return salt, _password_digest(password, salt)


def _clean_callsign(value):
    value = str(value or "").strip().upper()
    if not value or len(value) > 48:
        raise HTTPException(status_code=400, detail="Choose a valid Callsign from the roster")
    member = L.member_info_for_callsign(value)
    if not member or not member.get("name"):
        raise HTTPException(status_code=400, detail="That Callsign was not found in the member roster")
    return value


def _refresh_account_cache():
    with ACCOUNT_CACHE_LOCK:
        ACCOUNT_CACHE.update(at=0.0, rows=[], error_retry_at=0.0)


def _require_leaders_admin():
    return require_role("admin")


def require_role(role):
    user = CURRENT_USER.get() or {}
    user_role = str(user.get("role") or "").strip().lower()
    allowed = (
        (role == "admin" and (bool(user.get("is_admin")) or user_role in {"admin", "commander"}))
        or (role == "command" and _current_user_is_command())
        or (role == "leader" and bool(user) and (
            user_role in {"admin", "commander"}
            or (user_role == "leader" and _callsign_prefix(user.get("callsign")) in LEADER_CALLSIGN_PREFIXES)
        ))
        or (role == "watch_command" and user_role in {"leader", "member", "admin", "commander"})
    )
    if not allowed:
        raise HTTPException(status_code=403, detail=f"This action requires the {role} role")
    return user


COMMAND_CALLSIGN_PREFIXES = {"E", "C", "DIV", "B", "CHIEF", "COM"}
LEADER_CALLSIGN_PREFIXES = COMMAND_CALLSIGN_PREFIXES | {"L"}


def _callsign_prefix(callsign):
    match = re.match(r"^([A-Z]+)-\d+\b", str(callsign or "").strip().upper())
    return match.group(1) if match else ""


def _current_user_is_command():
    user = CURRENT_USER.get() or {}
    if user.get("is_admin"):
        return True
    return _callsign_prefix(user.get("callsign")) in COMMAND_CALLSIGN_PREFIXES


def _account_payload(row):
    return {key: row.get(key, "") for key in ("account_id", "name", "callsign", "password_salt", "password_hash", "status", "role", "created_at", "activated_at", "approved_by", "admin_changed_at", "admin_changed_by")}


def _write_account(row):
    if not L.update_account_record(row["account_id"], _account_payload(row)):
        raise HTTPException(status_code=404, detail="Account not found")
    _refresh_account_cache()


def _record_account_event(row, action, by=None):
    L.append_account_audit(row.get("account_id"), row.get("name"), row.get("callsign"), action, by or current_actor())


def _public_account(row, member_name=None):
    display_name = str(member_name or row.get("name") or "")
    return {
        "account_id": row["account_id"], "callsign": row.get("callsign", ""), "username": row["name"],
        "display_name": display_name, "status": row["status"],
        "is_admin": row["role"] in {"admin", "commander"}, "role": row["role"], "linked_at": row["created_at"],
        "requested_at": row["created_at"], "approved_at": row["activated_at"],
        "approved_by": row["approved_by"], "admin_changed_at": row["admin_changed_at"],
        "admin_changed_by": row["admin_changed_by"],
    }


def _apply_account_change_locally(row, action, actor, update_accounts=True):
    if update_accounts:
        with ACCOUNT_CACHE_LOCK:
            accounts = [dict(row) if item["account_id"] == row["account_id"] else item
                        for item in ACCOUNT_CACHE["rows"]]
            if not any(item["account_id"] == row["account_id"] for item in accounts):
                accounts.append(dict(row))
            ACCOUNT_CACHE.update(at=time.monotonic(), rows=accounts)
    with LEADER_OVERVIEW_LOCK:
        overview = LEADER_OVERVIEW_CACHE.get("data")
        if overview is not None:
            for key in ("approved", "pending", "deactivated"):
                overview[key] = [item for item in overview.get(key, []) if item["account_id"] != row["account_id"]]
            if row["status"] in {"approved", "pending", "deactivated"}:
                overview[row["status"]].append(_public_account(row))
            member_name = _member_name_for_callsign(row.get("callsign"), row.get("name"))
            audit = {
                "created_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
                "account_id": row["account_id"], "name": member_name,
                "callsign": row.get("callsign", ""), "action": action, "actor_name": actor,
            }
            overview["audit"] = [audit, *overview.get("audit", [])][:200]
            LEADER_OVERVIEW_CACHE["at"] = time.monotonic()


def _persist_account_change(row, action, actor):
    try:
        if not L.update_account_record_and_audit(row["account_id"], _account_payload(row), action, actor):
            raise RuntimeError("Account record was not found in Google Sheets")
    except Exception:
        _refresh_account_cache()
        with LEADER_OVERVIEW_LOCK:
            LEADER_OVERVIEW_CACHE.update(at=0.0, data=None)
        raise


def _persist_account_change_then_apply(row, action, actor):
    _persist_account_change(row, action, actor)
    # Keep the account pending in the authentication cache until the Sheets
    # confirms the write. Only then can the user sign in.
    _apply_account_change_locally(row, action, actor)


def _queue_account_activation(row, action, actor):
    if not L.GOOGLE_SHEET_ID2:
        raise RuntimeError("GOOGLE_SHEET_ID2 is required for account storage")
    previous = next((dict(item) for item in _load_accounts() if item["account_id"] == row["account_id"]), None)
    # Update the admin overview immediately, but leave authentication pending.
    _apply_account_change_locally(row, action, actor, update_accounts=False)
    user = CURRENT_USER.get() or {}
    queue_archive_job(
        _persist_account_change_then_apply, dict(row), action, actor,
        on_failure=(lambda: _apply_account_change_locally(previous, "Activation reverted", actor)) if previous else None,
        account_id=user.get("account_id", ""), failure_message="Could not save account activation",
        required=True,
    )


def _queue_account_change(row, action, actor=None):
    if not L.GOOGLE_SHEET_ID2:
        raise RuntimeError("GOOGLE_SHEET_ID2 is required for account storage")
    actor = actor or current_actor()
    previous = next((dict(item) for item in _load_accounts() if item["account_id"] == row["account_id"]), None)
    _apply_account_change_locally(row, action, actor)
    user = CURRENT_USER.get() or {}
    queue_archive_job(
        _persist_account_change, dict(row), action, actor,
        on_failure=(lambda: _apply_account_change_locally(previous, "Account change reverted", actor)) if previous else None,
        account_id=user.get("account_id", ""), failure_message="Could not save account changes",
        required=True,
    )


def _persist_account_deletion(row, actor, audit_action="Account Deleted"):
    try:
        if not L.delete_account_record_and_audit(row["account_id"], row, actor, audit_action):
            raise RuntimeError("Account record was not found in Google Sheets")
    except Exception:
        _refresh_account_cache()
        with LEADER_OVERVIEW_LOCK:
            LEADER_OVERVIEW_CACHE.update(at=0.0, data=None)
        raise


def _queue_account_deletion(row, actor=None, audit_action="Account Deleted"):
    if not L.GOOGLE_SHEET_ID2:
        raise RuntimeError("GOOGLE_SHEET_ID2 is required for account storage")
    actor = actor or current_actor()
    previous = dict(row)
    with ACCOUNT_CACHE_LOCK:
        ACCOUNT_CACHE.update(
            at=time.monotonic(),
            rows=[item for item in ACCOUNT_CACHE["rows"] if item["account_id"] != row["account_id"]],
        )
    with LEADER_OVERVIEW_LOCK:
        overview = LEADER_OVERVIEW_CACHE.get("data")
        if overview is not None:
            for key in ("approved", "pending", "deactivated"):
                overview[key] = [item for item in overview.get(key, []) if item["account_id"] != row["account_id"]]
            overview.setdefault("audit", []).insert(0, {
                "created_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
                "account_id": row["account_id"], "name": row["name"],
                "callsign": row.get("callsign", ""), "action": audit_action, "actor_name": actor,
            })
            overview["audit"] = overview["audit"][:200]
            LEADER_OVERVIEW_CACHE["at"] = time.monotonic()
    user = CURRENT_USER.get() or {}
    queue_archive_job(
        _persist_account_deletion, dict(row), actor, audit_action,
        on_failure=lambda: _apply_account_change_locally(previous, "Account deletion reverted", actor),
        account_id=user.get("account_id", ""), failure_message="Could not delete account",
        required=True,
    )


@app.middleware("http")
async def account_auth_guard(request: Request, call_next):
    path = request.url.path
    if path.startswith("/static/") or path.startswith("/auth/signup-status/") or path in {
        "/login", "/auth/login", "/auth/signup", "/auth/logout",
        "/verification-pending", "/service-worker.js", "/pwa-icon.svg"
    }:
        return await call_next(request)

    user = _decode_session(request)
    if not user:
        if path.startswith("/api/"):
            return JSONResponse(
                {"detail": "Sign in to continue"},
                status_code=401
            )
        return RedirectResponse("/login", status_code=303)

    try:
        account = await run_in_threadpool(_account_for_id, user.get("account_id"))
    except Exception as e:
        logger.info(f"[LVFR EMS] Account directory lookup failed for an active session: {e}")
        return JSONResponse({"detail": "Account service unavailable"}, status_code=503)
    if not account or account["status"] != "approved":
        if path.startswith("/api/"):
            response = JSONResponse({"detail": "Your account is waiting for activation"}, status_code=403)
        else:
            response = RedirectResponse("/verification-pending", status_code=303)
        response.delete_cookie(SESSION_COOKIE)
        return response

    expected_pw_version = str(user.get("pw_version") or "")
    actual_pw_version = (
        _password_version(account)
        if account.get("password_hash")
        else expected_pw_version
    )
    if not expected_pw_version or not hmac.compare_digest(expected_pw_version, actual_pw_version):
        if path.startswith("/api/"):
            response = JSONResponse(
                {"detail": "Your session expired after a password change. Sign in again."},
                status_code=401,
            )
        else:
            response = RedirectResponse("/login", status_code=303)
        response.delete_cookie(SESSION_COOKIE)
        return response

    callsign = account.get("callsign", "")
    display_name = _member_name_for_callsign(callsign, account["name"])
    account_role = str(account.get("role") or "leader").strip().lower()
    user = {**user, "name": display_name, "callsign": callsign, "role": account_role, "is_admin": account_role in {"admin", "commander"}}
    if account_role == "member":
        member_page_paths = {"/", "/portal", "/watch-command", "/auth/me"}
        is_watch_api = (
            path == "/api/watch-command"
            or path.startswith("/api/watch-command/")
            or path == "/api/account/password"
            or path == "/api/presence"
            or path == "/api/presence/summary"
        )
        if path not in member_page_paths and not is_watch_api:
            if path.startswith("/api/"):
                return JSONResponse({"detail": "Members can only use Watch Command."}, status_code=403)
            return RedirectResponse("/watch-command", status_code=303)
        if path == "/":
            return RedirectResponse("/watch-command", status_code=303)
    # A regular Supervisor may only use the two explicitly permitted member actions.
    # Keep account self-service and notification acknowledgements available.
    if (
        request.method in {"POST", "PUT", "PATCH", "DELETE"}
        and path.startswith("/api/")
        and not user["is_admin"]
        and path not in {
            "/api/promote",
            "/api/change-callsign",
            "/api/account/password",
            "/api/notifications/read",
            "/api/sync",
            "/api/sync/auto",
            "/api/presence",
        }
        and path != "/api/watch-command"
        and not path.startswith("/api/watch-command/")
    ):
        return JSONResponse(
            {"detail": "Supervisors may only promote EMT members to AEMT or change a callsign within the same rank."},
            status_code=403,
        )
    token = CURRENT_USER.set(user)
    try:
        response = await call_next(request)
        if (
            request.method in {"POST", "PUT", "PATCH", "DELETE"}
            and request.url.path in MEMBER_CHANGE_PATHS
            and response.status_code < 400
        ):
            _publish_member_update()
        if (
            path.startswith("/api/")
            and request.method in {"POST", "PUT", "PATCH", "DELETE"}
            and path != "/api/presence"
            and response.status_code < 400
        ):
            action = path.removeprefix("/api/").replace("-", " ").replace("/", " ").title()
            try:
                await run_in_threadpool(
                    L.log_admin_action,
                    user.get("callsign", ""),
                    current_actor(),
                    action,
                    path,
                )
            except Exception as e:
                logger.info(f"[LVFR EMS] Audit log write failed: {e}")
        return response
    finally:
        CURRENT_USER.reset(token)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
        "base-uri 'self'; frame-ancestors 'none'",
    )
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    return response


@app.get("/api/events")
async def app_events(request: Request):
    user = CURRENT_USER.get() or {}
    account_id = str(user.get("account_id") or "")

    async def event_stream():
        subscriber = asyncio.Queue(maxsize=10)
        details = {"account_id": account_id, "loop": asyncio.get_running_loop()}
        reconnect_at = time.monotonic() + 25
        with MEMBER_EVENT_LOCK:
            MEMBER_EVENT_SUBSCRIBERS[subscriber] = details
        try:
            yield ": connected\n\n"
            while time.monotonic() < reconnect_at and not await request.is_disconnected():
                try:
                    event_name, payload = await asyncio.wait_for(subscriber.get(), timeout=10)
                    yield f"event: {event_name}\ndata: {payload}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            with MEMBER_EVENT_LOCK:
                MEMBER_EVENT_SUBSCRIBERS.pop(subscriber, None)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/login", response_class=HTMLResponse)
def login(request: Request):
    if _decode_session(request):
        return RedirectResponse("/portal", status_code=303)
    login_file = STATIC_DIR / "login.html"
    if login_file.exists():
        return login_file.read_text(encoding="utf-8")
    return HTMLResponse("<a href='/login'>Sign in</a>")


@app.get("/portal", response_class=HTMLResponse)
def portal():
    portal_file = STATIC_DIR / "portal.html"
    if portal_file.exists():
        page = portal_file.read_text(encoding="utf-8")
        current_user = CURRENT_USER.get() or {}
        is_commander = bool(current_user.get("is_admin")) or current_user.get("role") in {"admin", "commander"}
        if is_commander:
            page = page.replace(
                'id="administrationCard" href="/administration" hidden',
                'id="administrationCard" href="/administration"',
            )
        if (CURRENT_USER.get() or {}).get("role") != "member":
            page = page.replace('id="emsCard" href="/" hidden', 'id="emsCard" href="/"')
        return page
    return HTMLResponse("<a href='/'>LVFR EMS Operations</a>")


@app.get("/administration", response_class=HTMLResponse)
def administration():
    require_role("admin")
    page = STATIC_DIR / "administration.html"
    if page.exists():
        return page.read_text(encoding="utf-8")
    return HTMLResponse("<a href='/portal'>Back to application selection</a>", status_code=404)


@app.get("/watch-command", response_class=HTMLResponse)
def watch_command():
    user = require_role("watch_command")
    page = STATIC_DIR / "watch_command.html"
    if page.exists():
        content = page.read_text(encoding="utf-8")
        if user.get("role") != "member":
            content = content.replace('id="emsNavLink" href="/" hidden', 'id="emsNavLink" href="/"')
        return content
    return HTMLResponse("<a href='/portal'>Back to application selection</a>")


class WatchCommandInput(BaseModel):
    draft_id: str = ""
    finalized: bool = True
    watch_date: str = ""
    watch_commander: str = ""
    roll_call: str = ""
    start_time: str = ""
    end_time: str = ""
    red_sector: str = ""
    green_sector: str = ""
    blue_sector: str = ""
    specialised_units: str = ""
    notes: str = ""
    significant_call: str = ""
    coverage_gaps: str = ""
    watch_transition: str = ""
    safety_concerns: str = ""
    active_unit: str = ""
    active_ems: str = ""
    active_merged: bool = False


@app.get("/api/watch-command/current-user")
def watch_command_current_user():
    user = require_role("watch_command")
    callsign = str(user.get("callsign") or "").strip().upper()
    member = L.member_info_for_callsign(callsign) if callsign else None
    return {
        "callsign": callsign,
        "name": str((member or {}).get("name") or user.get("name") or "").strip(),
    }


@app.get("/api/watch-command/members")
def watch_command_members():
    require_role("watch_command")
    return [
        {
            "callsign": str(member.get("callsign") or "").strip().upper(),
            "name": str(member.get("name") or "").strip(),
            "rank": str(member.get("rank") or "").strip(),
        }
        for member in L.list_members("")
        if str(member.get("callsign") or "").strip()
        and str(member.get("name") or "").strip()
    ]


@app.get("/api/watch-command/member/{callsign}")
def watch_command_member(callsign: str):
    require_role("watch_command")
    normalized_callsign = str(callsign or "").strip().upper()
    member = L.member_info_for_callsign(normalized_callsign)
    if not member or not member["name"]:
        raise HTTPException(status_code=404, detail="Callsign was not found on the synced roster.")
    return {"callsign": normalized_callsign, **member}


def _attach_linked_accounts_to_watch_logs(logs, accounts):
    account_by_callsign = {
        str(account.get("callsign") or "").strip().upper(): account
        for account in accounts
        if str(account.get("callsign") or "").strip()
        and account.get("status") not in {"removed", "denied"}
    }
    role_labels = {"member": "Member", "leader": "Supervisor", "admin": "Commander", "commander": "Commander"}
    for log in logs:
        callsigns = dict.fromkeys(
            match.group(1).upper()
            for match in re.finditer(r"\b([A-Z]+-\d+)\b", str(log.get("roll_call") or ""), re.IGNORECASE)
        )
        log["linked_accounts"] = [
            {
                "callsign": callsign,
                "account_name": str(account_by_callsign[callsign].get("name") or ""),
                "role": role_labels.get(str(account_by_callsign[callsign].get("role") or "").lower(), "Supervisor"),
            }
            for callsign in callsigns
            if callsign in account_by_callsign
        ]
    return logs


@app.get("/api/watch-command")
def list_watch_command_logs():
    require_role("watch_command")
    con = L.db()
    try:
        logs = [dict(row) for row in con.execute(
            "SELECT * FROM WatchCommandLogs ORDER BY id DESC LIMIT 100"
        )]
    finally:
        con.close()
    try:
        accounts = _load_accounts()
    except Exception as e:
        logger.info(f"[LVFR EMS] Could not load linked account details for Watch Command view: {e}")
        accounts = []
    return _attach_linked_accounts_to_watch_logs(logs, accounts)


@app.post("/api/watch-command")
def create_watch_command_log(data: WatchCommandInput):
    user = require_role("watch_command")
    record = {key: str(value or "").strip() for key, value in data.dict().items()}
    draft_id = record.pop("draft_id")
    finalized = bool(data.finalized)
    record.pop("finalized")
    if draft_id:
        try:
            uuid.UUID(draft_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid watch draft identifier.")
    if not record["watch_date"]:
        raise HTTPException(status_code=400, detail="Select the watch date.")
    try:
        datetime.date.fromisoformat(record["watch_date"])
    except ValueError:
        raise HTTPException(status_code=400, detail="Enter a valid watch date.")
    if not record["watch_commander"]:
        raise HTTPException(status_code=400, detail="Enter the Watch Commander.")
    if len(record["watch_commander"]) > 120:
        raise HTTPException(status_code=400, detail="Watch Commander must be 120 characters or fewer.")
    if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", record["start_time"]):
        raise HTTPException(status_code=400, detail="Enter a start time in 24-hour HH:MM format (CET).")
    if finalized and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", record["end_time"]):
        raise HTTPException(status_code=400, detail="An end time is added automatically when you end the watch.")
    if record["end_time"] and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", record["end_time"]):
        raise HTTPException(status_code=400, detail="End time must use 24-hour HH:MM format (CET).")
    for key, value in record.items():
        if len(value) > 5000:
            raise HTTPException(status_code=400, detail="Each field must be 5,000 characters or fewer.")

    columns = (
        "watch_date", "watch_commander", "roll_call", "start_time", "end_time",
        "red_sector", "green_sector", "blue_sector", "specialised_units", "notes",
        "significant_call", "coverage_gaps", "watch_transition", "safety_concerns",
        "active_unit", "active_ems", "active_merged",
    )
    values = [int(data.active_merged) if key == "active_merged" else record[key] for key in columns]
    actor = current_actor()
    con = L.db()
    try:
        existing = con.execute(
            "SELECT id, created_by FROM WatchCommandLogs WHERE draft_id=?",
            (draft_id,),
        ).fetchone() if draft_id else None
        if existing and existing["created_by"] != actor and not user.get("is_admin"):
            raise HTTPException(status_code=403, detail="This watch log belongs to another user.")
        if existing:
            con.execute(
                f"""UPDATE WatchCommandLogs SET finalized=?, {', '.join(f'{column}=?' for column in columns)}
                    WHERE id=?""",
                [1 if finalized else 0, *values, existing["id"]],
            )
            log_id = existing["id"]
        else:
            cursor = con.execute(
                f"""INSERT INTO WatchCommandLogs(
                        draft_id, finalized, created_at, {', '.join(columns)}, created_by
                    ) VALUES ({', '.join('?' for _ in range(len(columns) + 4))})""",
                [draft_id or None, 1 if finalized else 0,
                 datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
                 *values, actor],
            )
            log_id = cursor.lastrowid
        con.commit()
        saved = con.execute("SELECT * FROM WatchCommandLogs WHERE id=?", (log_id,)).fetchone()
        return dict(saved)
    finally:
        con.close()


@app.get("/verification-pending", response_class=HTMLResponse)
def verification_pending():
    pending_file = STATIC_DIR / "verification_pending.html"
    if pending_file.exists():
        return pending_file.read_text(encoding="utf-8")
    return HTMLResponse("Your account is waiting for activation.", status_code=403)


class LoginInput(BaseModel):
    name: str = Field(min_length=1, max_length=48)
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)
    stay_logged_in: bool = False

class SignupInput(BaseModel):
    # Keep missing values out of FastAPI's generic "Field required" response;
    # signup validates them below and can return a clear, field-specific error.
    name: str = Field(default="", max_length=48)
    password: str = Field(default="", max_length=MAX_PASSWORD_LENGTH)
    callsign: str = Field(default="", max_length=48)

class PasswordChangeInput(BaseModel):
    current_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)
    new_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)

def _clean_name(value):
    name = " ".join(str(value or "").split())
    if not 2 <= len(name) <= 48: raise HTTPException(400, "Name must be between 2 and 48 characters")
    return name

def _set_cookie(response, request, token, stay):
    if COOKIE_SECURE_SETTING in {"1", "true", "yes", "on"}:
        secure = True
    elif COOKIE_SECURE_SETTING in {"0", "false", "no", "off"}:
        secure = False
    else:
        secure = request.url.scheme == "https"
    response.set_cookie(SESSION_COOKIE, token, max_age=30*86400 if stay else None, httponly=True, secure=secure, samesite="lax")

@app.post("/auth/signup")
def signup(data: SignupInput, request: Request):
    name = _clean_name(data.name)
    _enforce_auth_rate_limit("signup", _client_ip(request), 5, 3600)
    _enforce_auth_rate_limit("signup", name, 3, 3600)
    if len(data.password) > MAX_PASSWORD_LENGTH:
        raise HTTPException(400, "Password must be 128 characters or fewer")
    if not data.callsign.strip():
        raise HTTPException(400, "Choose your Callsign")
    callsign = _clean_callsign(data.callsign)
    if len(data.password) < 5: raise HTTPException(400, "Password must contain at least 5 characters")
    if _name_key(name) == _name_key(callsign):
        raise HTTPException(409, "The account name cannot match a member Callsign")
    con = L.db()
    try:
        conflicts_with_callsign = con.execute(
            "SELECT 1 FROM Members WHERE UPPER(TRIM(callsign))=? LIMIT 1", (name.upper(),)
        ).fetchone()
    finally:
        con.close()
    if conflicts_with_callsign:
        raise HTTPException(409, "The account name cannot match a member Callsign")
    try:
        # Hash before persisting the background task so plaintext passwords
        # never enter the durable BackgroundJobs queue. Defer all Google
        # Sheets reads and writes until after the user receives a request ID.
        salt = secrets.token_bytes(16).hex()
        digest = _password_digest(data.password, salt)
        request_id = str(uuid.uuid4())
        with SIGNUP_JOB_LOCK:
            SIGNUP_JOB_STATUS[request_id] = {"status": "saving", "error": ""}
            if len(SIGNUP_JOB_STATUS) > 200:
                SIGNUP_JOB_STATUS.pop(next(iter(SIGNUP_JOB_STATUS)))
        queue_archive_job(
            _save_signup_request, request_id, name, callsign, salt, digest,
            on_failure=lambda: _mark_signup_failed(request_id, "The request could not be saved. Please return to sign up and try again."),
            failure_message="Could not save signup request", required=True,
        )
        return {"ok": True, "status": "saving", "request_id": request_id}
    except HTTPException: raise
    except Exception as e:
        logger.info(f"[LVFR EMS] Account signup storage failed: {e}"); raise HTTPException(503, "Account storage is temporarily unavailable")

def _mark_signup_failed(request_id, message):
    with SIGNUP_JOB_LOCK:
        SIGNUP_JOB_STATUS[request_id] = {"status": "failed", "error": message}


def _save_signup_request(request_id, name, callsign, salt, digest):
    try:
        rows = L.get_account_records()
        same = next((row for row in rows if str(row.get("callsign", "")).upper() == callsign), None)
        duplicate = next((row for row in rows if _name_key(row.get("name")) == _name_key(name) and row.get("status") != "removed"), None)
        if duplicate and (not same or duplicate["account_id"] != same["account_id"]):
            _mark_signup_failed(request_id, "That name is already in use.")
            return
        if same and same["status"] not in {"denied", "removed"} and same.get("callsign") == callsign:
            _mark_signup_failed(request_id, "An account is already linked to that Callsign.")
            return
        now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
        row = {
            "account_id": same["account_id"] if same else str(uuid.uuid4()),
            "name": name, "callsign": callsign, "password_salt": salt,
            "password_hash": digest, "status": "pending", "role": "member",
            "created_at": now, "activated_at": "", "approved_by": "",
            "admin_changed_at": "", "admin_changed_by": "",
        }
        if same:
            if not L.update_account_record_and_audit(row["account_id"], _account_payload(row), "Signup request", name):
                raise RuntimeError("The previous account record could not be found")
        else:
            L.append_account_record_and_audit(row, name)
        with ACCOUNT_CACHE_LOCK:
            ACCOUNT_CACHE.update(at=time.monotonic(), rows=[dict(item) for item in rows])
        _apply_account_change_locally(row, "Signup request", name)
        with SIGNUP_JOB_LOCK:
            SIGNUP_JOB_STATUS[request_id] = {"status": "saved", "error": ""}
    except Exception as e:
        logger.info(f"[LVFR EMS] Background signup save failed: {e}")
        _refresh_account_cache()
        with LEADER_OVERVIEW_LOCK:
            LEADER_OVERVIEW_CACHE.update(at=0.0, data=None)
        _mark_signup_failed(request_id, "The request could not be saved. Please return to sign up and try again.")
        raise


@app.get("/auth/signup-status/{request_id}")
def signup_status(request_id: str):
    try:
        uuid.UUID(request_id)
    except ValueError:
        raise HTTPException(404, "Signup request not found")
    with SIGNUP_JOB_LOCK:
        status = SIGNUP_JOB_STATUS.get(request_id)
    if not status:
        raise HTTPException(404, "Signup status is no longer available")
    return status

@app.post("/auth/login")
def account_login(data: LoginInput, request: Request):
    try:
        identifier = str(data.name or "").strip()
        _enforce_auth_rate_limit("login", _client_ip(request), 10, 60)
        _enforce_auth_rate_limit("login", identifier, 5, 300)
        if len(data.password) > MAX_PASSWORD_LENGTH:
            raise HTTPException(400, "Password must be 128 characters or fewer")
        accounts = _load_accounts()
        row = next((r for r in accounts if _name_key(r.get("name")) == _name_key(identifier)), None)
        if not row:
            row = next((r for r in accounts if str(r.get("callsign", "")).casefold() == identifier.casefold()), None)
        if not row or not hmac.compare_digest(str(row.get("password_hash") or "invalid"), _password_digest(data.password, row.get("password_salt") or "00"*16)):
            raise HTTPException(401, "Name or password is incorrect")
        if row["status"] == "pending": raise HTTPException(403, "Your account is waiting for activation")
        if row["status"] != "approved": raise HTTPException(403, "This account is not active. Contact a Commander.")
        try:
            _run_google_sheet_sync("login")
        except Exception as sync_error:
            logger.info(f"[LVFR EMS] Google Sheet login sync failed: {sync_error}")
        token = _encode_session({
            "account_id": row["account_id"],
            "callsign": row.get("callsign", ""),
            "name": row["name"],
            "pw_version": _password_version(row),
        }, data.stay_logged_in)
        role = str(row.get("role") or "leader").lower()
        callsign = str(row.get("callsign") or "")
        command = _callsign_prefix(callsign) in COMMAND_CALLSIGN_PREFIXES or role in {"admin", "commander"}
        user = {
            "id": row["account_id"], "account_id": row["account_id"],
            "name": row["name"], "display_name": row["name"], "callsign": callsign,
            "role": role, "status": "approved", "is_admin": role in {"admin", "commander"},
            "is_command": command, "instructor_type": "",
        }
        response = JSONResponse({"ok": True, "user": user})
        _set_cookie(response, request, token, data.stay_logged_in)
        return response
    except HTTPException: raise
    except Exception as e:
        logger.info(f"[LVFR EMS] Account login storage failed: {e}"); raise HTTPException(503, "Account storage is temporarily unavailable")

@app.get("/auth/me")
def account_me():
    u = CURRENT_USER.get() or {}
    is_admin = bool(u.get("is_admin")) or u.get("role") in {"admin", "commander"}
    try:
        instructor = _cached_instructor_directory().get(
            _instructor_name_key(u.get("name")), {}
        )
    except Exception as e:
        logger.info(f"[LVFR EMS] Instructor profile lookup failed: {e}")
        instructor = {}
    return {
        "id": u.get("account_id", ""),
        "account_id": u.get("account_id", ""),
        "callsign": u.get("callsign", ""),
        "name": u.get("name", ""),
        "display_name": u.get("name", ""),
        "is_admin": is_admin,
        "role": str(u.get("role") or "leader"),
        "status": "approved",
        "is_command": _current_user_is_command(),
        "instructor_type": "HERT / FORT" if is_admin else instructor.get("type", ""),
    }


@app.post("/api/presence")
def update_presence():
    user = require_role("watch_command")
    account_id = str(user.get("account_id") or "")
    if not account_id:
        raise HTTPException(401, "Sign in again")
    now = time.time()
    con = L.db()
    try:
        con.execute("CREATE TABLE IF NOT EXISTS AccountPresence (account_id TEXT PRIMARY KEY, last_seen REAL NOT NULL)")
        con.execute("INSERT INTO AccountPresence(account_id,last_seen) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET last_seen=excluded.last_seen", (account_id, now))
        con.execute("DELETE FROM AccountPresence WHERE last_seen < ?", (now - PRESENCE_ONLINE_SECONDS,))
        con.commit()
    finally:
        con.close()
    return {"ok": True}


@app.get("/api/presence/summary")
def presence_summary():
    require_role("watch_command")
    now = time.time()
    con = L.db()
    try:
        con.execute("CREATE TABLE IF NOT EXISTS AccountPresence (account_id TEXT PRIMARY KEY, last_seen REAL NOT NULL)")
        count = con.execute(
            "SELECT COUNT(*) FROM AccountPresence WHERE last_seen >= ?",
            (now - PRESENCE_ONLINE_SECONDS,),
        ).fetchone()[0]
    finally:
        con.close()
    return {"online_count": int(count or 0)}


def _leader_overview_with_presence(overview):
    now = time.time()
    con = L.db()
    try:
        con.execute("CREATE TABLE IF NOT EXISTS AccountPresence (account_id TEXT PRIMARY KEY, last_seen REAL NOT NULL)")
        rows = con.execute("SELECT account_id,last_seen FROM AccountPresence WHERE last_seen >= ?", (now - PRESENCE_ONLINE_SECONDS,)).fetchall()
        last_seen = {str(row["account_id"]): float(row["last_seen"]) for row in rows}
        con.commit()
    finally:
        con.close()
    online_count = 0
    result = dict(overview)
    for group in ("approved", "deactivated"):
        result[group] = []
        for row in overview.get(group, []):
            seen = last_seen.get(str(row.get("account_id") or ""))
            online = group == "approved" and seen is not None and now - seen < PRESENCE_ONLINE_SECONDS
            online_count += int(online)
            result[group].append({**row, "online": online})
    result["online_count"] = online_count
    return result


def _require_instructor_type(instructor_type):
    user = CURRENT_USER.get() or {}
    if user.get("is_admin"):
        return
    try:
        instructor = _cached_instructor_directory().get(
            _instructor_name_key(user.get("name")), {}
        )
    except Exception as e:
        logger.info(f"[LVFR EMS] Instructor permission lookup failed: {e}")
        raise HTTPException(503, "Instructor permissions are temporarily unavailable")
    allowed_types = {
        value.strip().upper()
        for value in str(instructor.get("type") or "").split("/")
        if value.strip()
    }
    if instructor_type not in allowed_types:
        raise HTTPException(
            status_code=403,
            detail=f"Only a {instructor_type} Instructor can add or delete this training",
        )

@app.post("/api/account/password")
def change_password(data: PasswordChangeInput):
    if len(data.current_password) > MAX_PASSWORD_LENGTH or len(data.new_password) > MAX_PASSWORD_LENGTH:
        raise HTTPException(400, "Passwords must be 128 characters or fewer")
    if len(data.new_password) < 5: raise HTTPException(400, "New password must contain at least 5 characters")
    u = CURRENT_USER.get() or {}; row = _account_for_id(u.get("account_id"))
    if not row or not hmac.compare_digest(row["password_hash"], _password_digest(data.current_password, row["password_salt"])): raise HTTPException(400, "Current password is incorrect")
    row["password_salt"] = secrets.token_bytes(16).hex(); row["password_hash"] = _password_digest(data.new_password, row["password_salt"])
    _queue_account_change(row, "Password changed"); return {"ok": True, "status": "saving"}


def _public_leader_overview(rows, audit):
    member_names = _member_names_by_callsign(
        [row.get("callsign") for row in rows]
        + [entry.get("callsign") for entry in audit]
    )
    for entry in audit:
        callsign = str(entry.get("callsign") or "").strip().upper()
        if callsign in member_names:
            entry["name"] = member_names[callsign]
    return {
        "approved": [_public_account(row, member_names.get(str(row.get("callsign") or "").strip().upper())) for row in rows if row["status"] == "approved"],
        "pending": [_public_account(row, member_names.get(str(row.get("callsign") or "").strip().upper())) for row in rows if row["status"] == "pending"],
        "deactivated": [_public_account(row, member_names.get(str(row.get("callsign") or "").strip().upper())) for row in rows if row["status"] == "deactivated"],
        "audit": audit,
    }


def _refresh_leader_overview_in_background(baseline):
    global LEADER_OVERVIEW_REFRESHING
    try:
        rows, audit = L.get_account_overview()
        with LEADER_OVERVIEW_LOCK:
            if LEADER_OVERVIEW_CACHE.get("data") is not None and LEADER_OVERVIEW_CACHE["at"] == baseline:
                LEADER_OVERVIEW_CACHE.update(
                    at=time.monotonic(), data=_public_leader_overview(rows, audit)
                )
    except Exception as e:
        logger.info(f"[LVFR EMS] Background Supervisors refresh failed: {e}")
        with LEADER_OVERVIEW_LOCK:
            if LEADER_OVERVIEW_CACHE.get("data") is not None and LEADER_OVERVIEW_CACHE["at"] == baseline:
                LEADER_OVERVIEW_CACHE["at"] = time.monotonic() - 270
    finally:
        with LEADER_OVERVIEW_LOCK:
            LEADER_OVERVIEW_REFRESHING = False

@app.get("/api/leaders")
def get_accounts_for_admin():
    global LEADER_OVERVIEW_REFRESHING
    _require_leaders_admin()
    with LEADER_OVERVIEW_LOCK:
        cached = LEADER_OVERVIEW_CACHE.get("data")
        if cached is not None:
            if time.monotonic() - LEADER_OVERVIEW_CACHE["at"] >= 300 and not LEADER_OVERVIEW_REFRESHING:
                LEADER_OVERVIEW_REFRESHING = True
                baseline = LEADER_OVERVIEW_CACHE["at"]
                Thread(
                    target=_refresh_leader_overview_in_background,
                    args=(baseline,),
                    daemon=True,
                ).start()
            return _leader_overview_with_presence(cached)
    try:
        rows, audit = L.get_account_overview()
    except Exception as e:
        logger.info(f"[LVFR EMS] Account overview read failed: {e}")
        raise HTTPException(503, "Account list is temporarily unavailable")
    with ACCOUNT_CACHE_LOCK:
        ACCOUNT_CACHE.update(at=time.monotonic(), rows=rows)
    result = _public_leader_overview(rows, audit)
    with LEADER_OVERVIEW_LOCK:
        LEADER_OVERVIEW_CACHE.update(at=time.monotonic(), data=result)
    return _leader_overview_with_presence(result)


@app.get("/api/instructors")
def get_instructors_for_admin():
    _require_leaders_admin()
    try:
        directory = _cached_instructor_directory()
    except Exception as e:
        logger.info(f"[LVFR EMS] Instructor directory read failed: {e}")
        raise HTTPException(503, "Instructor list is temporarily unavailable")
    return [
        {"name": info["name"], "type": info["type"], "date": info["date"]}
        for info in directory.values()
    ]

@app.get("/api/leaders/audit")
def account_audit():
    _require_leaders_admin()
    try:
        audit = L.get_account_audit()
        member_names = _member_names_by_callsign(entry.get("callsign") for entry in audit)
        for entry in audit:
            callsign = str(entry.get("callsign") or "").strip().upper()
            if callsign in member_names:
                entry["name"] = member_names[callsign]
        return audit
    except Exception as e: logger.info(f"[LVFR EMS] Account audit read failed: {e}"); raise HTTPException(503,"Account history unavailable")

def _target_account(account_id):
    row=next((r for r in _load_accounts() if r["account_id"]==str(account_id)),None)
    if not row: raise HTTPException(404,"Account not found")
    return row

@app.post("/api/leaders/{account_id}/allow")
def allow_account(account_id:str):
    _require_leaders_admin(); r=_target_account(account_id)
    if r["status"]!="pending": raise HTTPException(409,"Account is not pending")
    updated = dict(r)
    updated.update(status="approved",role="member",activated_at=datetime.datetime.now().astimezone().isoformat(timespec="seconds"),approved_by=current_actor())
    actor = current_actor()
    _queue_account_activation(updated, "Activated", actor)
    return {"ok":True, "status":"queued"}

@app.post("/api/leaders/{account_id}/deny")
def deny_account(account_id:str):
    _require_leaders_admin(); r=_target_account(account_id)
    if r["status"]!="pending": raise HTTPException(409,"Account is not pending")
    _queue_account_deletion(r, current_actor(), "Denied"); return {"ok":True, "status":"saving"}

@app.post("/api/leaders/{account_id}/admin")
def promote_account(account_id:str):
    _require_leaders_admin(); r=_target_account(account_id)
    if r["status"]!="approved": raise HTTPException(409,"Activate the account first")
    r.update(role="admin",admin_changed_at=datetime.datetime.now().astimezone().isoformat(timespec="seconds"),admin_changed_by=current_actor())
    _queue_account_change(r, "Promoted to Commander"); return {"ok":True, "status":"saving"}

@app.post("/api/leaders/{account_id}/demote")
def demote_account(account_id:str):
    _require_leaders_admin(); r=_target_account(account_id)
    if (CURRENT_USER.get() or {}).get("account_id")==r["account_id"]: raise HTTPException(400,"You cannot demote yourself")
    r.update(role="leader",admin_changed_at=datetime.datetime.now().astimezone().isoformat(timespec="seconds"),admin_changed_by=current_actor())
    _queue_account_change(r, "Removed Commander access"); return {"ok":True, "status":"saving"}

@app.post("/api/leaders/{account_id}/member")
def make_member_account(account_id: str):
    _require_leaders_admin()
    row = _target_account(account_id)
    if row["status"] != "approved": raise HTTPException(409, "Activate the account first")
    if row["role"] == "admin": raise HTTPException(409, "Remove Commander access before changing this role")
    if (CURRENT_USER.get() or {}).get("account_id") == row["account_id"]:
        raise HTTPException(400, "You cannot restrict your own account")
    row.update(role="member", admin_changed_at=datetime.datetime.now().astimezone().isoformat(timespec="seconds"), admin_changed_by=current_actor())
    _queue_account_change(row, "Changed role to Member")
    return {"ok": True, "status": "saving"}

@app.post("/api/leaders/{account_id}/leader")
def make_leader_account(account_id: str):
    _require_leaders_admin()
    row = _target_account(account_id)
    if row["status"] != "approved": raise HTTPException(409, "Activate the account first")
    if row["role"] != "member": raise HTTPException(409, "Account is not a Member")
    row.update(role="leader", admin_changed_at=datetime.datetime.now().astimezone().isoformat(timespec="seconds"), admin_changed_by=current_actor())
    _queue_account_change(row, "Changed role to Supervisor")
    return {"ok": True, "status": "saving"}

@app.post("/api/leaders/{account_id}/deactivate")
def deactivate_account(account_id: str):
    _require_leaders_admin(); r = _target_account(account_id)
    if r["status"] != "approved": raise HTTPException(409, "Only active accounts can be deactivated")
    if r["role"] == "admin": raise HTTPException(409, "Remove Commander access before deactivating this account")
    if (CURRENT_USER.get() or {}).get("account_id") == r["account_id"]:
        raise HTTPException(400, "You cannot deactivate your own account")
    r["status"] = "deactivated"
    _queue_account_change(r, "Account Deactivated")
    return {"ok": True, "status": "saving"}

@app.post("/api/leaders/{account_id}/reactivate")
def reactivate_account(account_id: str):
    _require_leaders_admin(); r = _target_account(account_id)
    if r["status"] != "deactivated": raise HTTPException(409, "Account is not deactivated")
    updated = dict(r)
    updated.update(status="approved", approved_by=current_actor(), activated_at=datetime.datetime.now().astimezone().isoformat(timespec="seconds"))
    actor = current_actor()
    _queue_account_activation(updated, "Account Reactivated", actor)
    return {"ok": True, "status": "queued"}

@app.delete("/api/leaders/{account_id}")
def remove_account(account_id:str):
    _require_leaders_admin(); r=_target_account(account_id)
    if (CURRENT_USER.get() or {}).get("account_id")==r["account_id"]: raise HTTPException(400,"You cannot remove yourself")
    if r["role"] == "admin": raise HTTPException(409,"Remove Commander access before deleting the account")
    _queue_account_deletion(r)
    return {"ok":True, "status":"saving"}

@app.post("/auth/logout")
def account_logout():
    response=RedirectResponse("/login",status_code=303); response.delete_cookie(SESSION_COOKIE); return response
# ============================================================
# CONSTANTS
# ============================================================

IGNORED_CALLSIGNS = {
    "B-01",
}

COMMISSIONER_CALLSIGNS = {
    "COM-1",
    "COM-2",
}


# ============================================================
# RANK ORDER
# ============================================================

RANK_LEVELS = {
    "Probationary Volunteer": 1,
    "Probie Volunteer": 1,

    "Volunteer": 2,

    "Senior Volunteer": 3,

    "Probationary": 1,
    "Probie": 1,

    "EMR": 1,

    "EMT": 4,

    "AEMT": 5,
    "Advanced EMT": 5,

    "Paramedic": 6,

    "Lead Paramedic": 7,

    "Lieutenant": 8,

    "Captain": 9,

    "Division Commander": 10,

    "County Command": 11,

    "Chief": 12,

    "Commissioners": 13,
}


# ============================================================
# REQUEST MODEL
# ============================================================

class Action(BaseModel):
    callsign: str = ""
    new_rank: str = ""
    new_callsign: str = ""
    promoted_by: str = "Web Commander"

    activity: str = ""
    action: str = ""
    note: str = ""
    date_str: str = ""

    training: str = ""
    remove: bool = False
    force: bool = False


class InstructorAction(BaseModel):
    instructor_type: str = ""
    assigned: bool = True


class NotificationReadInput(BaseModel):
    ids: list[int] = []


# ============================================================
# BACKGROUND SYNC CONTROL
# ============================================================

SYNC_LOCK = Lock()
GOOGLE_JOB_LOCK = Lock()
GOOGLE_JOB_QUEUE = deque()
GOOGLE_JOB_RUNNING = False
GOOGLE_WRITE_STATE = {
    "running": False,
    "pending": 0,
    "last_success": None,
    "last_error": None,
    "last_attempt": None,
}
ARCHIVE_STATE = {
    "running": False,
    "pending": 0,
    "last_success": None,
    "last_error": None,
    "last_attempt": None,
}

SYNC_STATE = {
    "running": False,
    "pending": False,
    "last_error": None,
    "last_success": None,
    "last_source": "",
    "auto_enabled": False,
}


def _queue_google_job(
    job, args, archive=False, on_failure=None, account_id="", callsign="",
    failure_message="The update could not be saved", archive_after=None,
    job_id=None, attempts=0, recovered=False,
):
    global GOOGLE_JOB_RUNNING
    task_ref = f"{job.__module__}:{job.__name__}"
    after_ref = f"{archive_after[0].__module__}:{archive_after[0].__name__}" if archive_after else None
    args_json = json.dumps(args, ensure_ascii=False, default=str)
    after_args_json = json.dumps(archive_after[1], ensure_ascii=False, default=str) if archive_after else None
    if job_id is None:
        con = L.db()
        try:
            cursor = con.execute(
                """INSERT INTO BackgroundJobs(
                       task_ref,args_json,archive,account_id,callsign,failure_message,
                       archive_after_ref,archive_after_args_json,created_at
                   ) VALUES(?,?,?,?,?,?,?,?,?)""",
                (task_ref, args_json, int(archive), str(account_id or ""),
                 str(callsign or ""), str(failure_message or ""), after_ref,
                 after_args_json, datetime.datetime.now().astimezone().isoformat(timespec="seconds")),
            )
            job_id = cursor.lastrowid
            con.commit()
        finally:
            con.close()
    with GOOGLE_JOB_LOCK:
        GOOGLE_JOB_QUEUE.append((
            job, args, archive, on_failure, str(account_id or ""),
            str(callsign or ""), str(failure_message or "The update could not be saved"),
            job_id, int(attempts), archive_after, bool(recovered),
        ))
        if archive:
            ARCHIVE_STATE["pending"] += 1
        else:
            GOOGLE_WRITE_STATE["pending"] += 1
        if GOOGLE_JOB_RUNNING:
            return
        GOOGLE_JOB_RUNNING = True
    Thread(target=_google_job_worker, daemon=True).start()


def queue_google_job(job, *args, on_failure=None, callsign="", failure_message="The update could not be saved", archive_after=None):
    """Persist a locally-applied change to Google Sheets in the background."""
    user = CURRENT_USER.get() or {}
    _queue_google_job(
        job, args, on_failure=on_failure,
        account_id=user.get("account_id", ""), callsign=callsign,
        failure_message=failure_message, archive_after=archive_after,
    )


def _restore_training_state(callsign, training_name, was_present, member_name="", log_id=None, expected_present=None):
    if training_name == "Hert":
        con = L.db()
        try:
            row = con.execute(
                "SELECT certified FROM HERTCache WHERE lower(trim(member_name))=lower(trim(?)) LIMIT 1",
                (member_name,),
            ).fetchone()
            current = bool(row and int(row["certified"]) == 1)
        finally:
            con.close()
        if expected_present is not None and current != expected_present:
            return False
        L.update_hert_cache(member_name, was_present)
        if log_id:
            con = L.db()
            try:
                con.execute("DELETE FROM TrainingLog WHERE id=?", (log_id,))
                con.commit()
            finally:
                con.close()
        return True
    con = L.db()
    try:
        row = con.execute(
            "SELECT 1 FROM Trainings WHERE callsign=? AND training_name=? LIMIT 1",
            (callsign, training_name),
        ).fetchone()
        if expected_present is not None and bool(row) != expected_present:
            return False
        if was_present:
            con.execute(
                "INSERT OR IGNORE INTO Trainings(callsign, training_name) VALUES(?,?)",
                (callsign, training_name),
            )
        else:
            con.execute(
                "DELETE FROM Trainings WHERE callsign=? AND training_name=?",
                (callsign, training_name),
            )
        if log_id:
            con.execute("DELETE FROM TrainingLog WHERE id=?", (log_id,))
        con.commit()
        return True
    finally:
        con.close()


def _restore_exam_state(callsign, was_present, log_id=None, expected_present=None):
    con = L.db()
    try:
        row = con.execute(
            "SELECT 1 FROM Exams WHERE callsign=? AND exam_name='supervisor_exam' LIMIT 1",
            (callsign,),
        ).fetchone()
        if expected_present is not None and bool(row) != expected_present:
            return False
        if was_present:
            con.execute(
                "INSERT OR IGNORE INTO Exams(callsign, exam_name) VALUES(?, 'supervisor_exam')",
                (callsign,),
            )
        else:
            con.execute(
                "DELETE FROM Exams WHERE callsign=? AND exam_name='supervisor_exam'",
                (callsign,),
            )
        if log_id:
            con.execute("DELETE FROM ExamLog WHERE id=?", (log_id,))
        con.commit()
        return True
    finally:
        con.close()


def _restore_activity_state(callsign, old_activity, log_id=None, expected_activity=None):
    con = L.db()
    try:
        row = con.execute("SELECT activity FROM SheetCache WHERE callsign=?", (callsign,)).fetchone()
        current = str(row["activity"] or "Active") if row else "Active"
        if expected_activity is not None and current != expected_activity:
            return False
        con.execute(
            "UPDATE SheetCache SET activity=? WHERE callsign=?",
            (old_activity, callsign),
        )
        if log_id:
            con.execute("DELETE FROM ActivityStatusLog WHERE id=?", (log_id,))
        con.commit()
        return True
    finally:
        con.close()


def _restore_note_state(callsign, old_note, log_id=None, expected_note=None):
    con = L.db()
    try:
        row = con.execute("SELECT notes FROM Members WHERE callsign=?", (callsign,)).fetchone()
        current = str(row["notes"] or "") if row else None
        if expected_note is not None and current != expected_note:
            return False
        con.execute("UPDATE Members SET notes=? WHERE callsign=?", (old_note, callsign))
        if log_id:
            con.execute("DELETE FROM NoteLog WHERE id=?", (log_id,))
        con.commit()
        return True
    finally:
        con.close()


def _restore_rank_date_state(callsign, old_date, expected_date=None):
    old_date = str(old_date or "")
    try:
        parsed = datetime.date.fromisoformat(old_date)
        days_in_rank = max(0, (datetime.date.today() - parsed).days)
    except ValueError:
        days_in_rank = 0
    con = L.db()
    try:
        row = con.execute("SELECT rank_assigned_date FROM Members WHERE callsign=?", (callsign,)).fetchone()
        current = str(row["rank_assigned_date"] or "") if row else None
        if expected_date:
            try:
                expected_date = datetime.datetime.strptime(expected_date, "%m/%d/%Y").date().isoformat()
            except ValueError:
                pass
        if expected_date is not None and current != expected_date:
            return False
        con.execute(
            "UPDATE Members SET rank_assigned_date=?, days_in_rank=? WHERE callsign=?",
            (old_date, days_in_rank, callsign),
        )
        con.commit()
        return True
    finally:
        con.close()


def _latest_member_log_id(table, callsign):
    if table not in {"TrainingLog", "ExamLog", "NoteLog", "TerminationLog"}:
        return None
    con = L.db()
    try:
        row = con.execute(
            f"SELECT MAX(id) FROM {table} WHERE callsign=?",
            (callsign,),
        ).fetchone()
        return row[0] if row else None
    finally:
        con.close()


def _snapshot_member_rows(callsigns):
    callsigns = sorted({normalize_callsign(value) for value in callsigns if value})
    if not callsigns:
        return {"members": {}, "trainings": [], "exams": [], "sheet_cache": []}
    placeholders = ",".join("?" for _ in callsigns)
    con = L.db()
    try:
        members = {
            row["callsign"]: dict(row)
            for row in con.execute(
                f"SELECT * FROM Members WHERE callsign IN ({placeholders})", callsigns
            ).fetchall()
        }
        trainings = [dict(row) for row in con.execute(
            f"SELECT * FROM Trainings WHERE callsign IN ({placeholders}) ORDER BY callsign,training_name",
            callsigns,
        ).fetchall()]
        exams = [dict(row) for row in con.execute(
            f"SELECT * FROM Exams WHERE callsign IN ({placeholders}) ORDER BY callsign,exam_name",
            callsigns,
        ).fetchall()]
        sheet_cache = [dict(row) for row in con.execute(
            f"SELECT * FROM SheetCache WHERE callsign IN ({placeholders}) ORDER BY callsign",
            callsigns,
        ).fetchall()]
        return {"members": members, "trainings": trainings, "exams": exams, "sheet_cache": sheet_cache}
    finally:
        con.close()


def _restore_member_rows(before, expected, promotion_log_id=None, termination_log_id=None):
    callsigns = sorted(set(before["members"]) | set(expected["members"]))
    if _snapshot_member_rows(callsigns) != expected:
        return False
    placeholders = ",".join("?" for _ in callsigns)
    con = L.db()
    try:
        con.execute("BEGIN")
        if callsigns:
            con.execute(f"DELETE FROM Trainings WHERE callsign IN ({placeholders})", callsigns)
            con.execute(f"DELETE FROM Exams WHERE callsign IN ({placeholders})", callsigns)
            con.execute(f"DELETE FROM SheetCache WHERE callsign IN ({placeholders})", callsigns)
            con.execute(f"DELETE FROM Members WHERE callsign IN ({placeholders})", callsigns)
        for row in before["members"].values():
            columns = list(row)
            con.execute(
                f"INSERT INTO Members({','.join(columns)}) VALUES({','.join('?' for _ in columns)})",
                [row[column] for column in columns],
            )
        for table, key in (("Trainings", "training_name"), ("Exams", "exam_name"), ("SheetCache", None)):
            for row in before[table.lower() if table != "SheetCache" else "sheet_cache"]:
                columns = list(row)
                con.execute(
                    f"INSERT INTO {table}({','.join(columns)}) VALUES({','.join('?' for _ in columns)})",
                    [row[column] for column in columns],
                )
        if promotion_log_id:
            con.execute("DELETE FROM Promotions WHERE id=?", (promotion_log_id,))
        if termination_log_id:
            con.execute("DELETE FROM TerminationLog WHERE id=?", (termination_log_id,))
        con.commit()
        return True
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def _resolve_job(task_ref):
    module_name, separator, function_name = str(task_ref or "").partition(":")
    if not separator or module_name not in {"app", "backend_logic"} or not function_name.isidentifier():
        raise ValueError(f"Unsupported background task: {task_ref}")
    module = importlib.import_module(module_name)
    function = getattr(module, function_name, None)
    if not callable(function):
        raise ValueError(f"Background task is unavailable: {task_ref}")
    return function


def _restore_pending_google_jobs():
    con = L.db()
    try:
        rows = con.execute("SELECT * FROM BackgroundJobs ORDER BY id").fetchall()
    finally:
        con.close()
    for row in rows:
        try:
            job = _resolve_job(row["task_ref"])
            args = tuple(json.loads(row["args_json"] or "[]"))
            archive_after = None
            if row["archive_after_ref"]:
                archive_after = (
                    _resolve_job(row["archive_after_ref"]),
                    tuple(json.loads(row["archive_after_args_json"] or "[]")),
                )
            _queue_google_job(
                job, args, archive=bool(row["archive"]), account_id=row["account_id"],
                callsign=row["callsign"], failure_message=row["failure_message"],
                archive_after=archive_after, job_id=row["id"],
                attempts=row["attempts"], recovered=True,
            )
        except Exception as e:
            logger.info(f"[LVFR EMS] Could not restore background job {row['id']}: {e}")


def _reconcile_accounts_from_sheet():
    try:
        rows, audit = L.get_account_overview()
        with ACCOUNT_CACHE_LOCK:
            ACCOUNT_CACHE.update(at=time.monotonic(), rows=rows)
        with LEADER_OVERVIEW_LOCK:
            LEADER_OVERVIEW_CACHE.update(at=time.monotonic(), data=_public_leader_overview(rows, audit))
        return True
    except Exception as e:
        logger.info(f"[LVFR EMS] Could not reconcile account cache after a failed queued write: {e}")
        return False


def queue_archive_job(job, *args, on_failure=None, account_id="", callsign="", failure_message="The background archive update failed", required=False):
    """Persist an archive entry in the background without reloading the primary sheet."""
    if not L.GOOGLE_SHEET_ID2:
        if required:
            raise RuntimeError("GOOGLE_SHEET_ID2 is required for this account operation")
        return False
    _queue_google_job(
        job, args, archive=True, on_failure=on_failure,
        account_id=account_id, callsign=callsign,
        failure_message=failure_message,
    )
    return True


def _google_job_worker():
    global GOOGLE_JOB_RUNNING
    while True:
        with GOOGLE_JOB_LOCK:
            if not GOOGLE_JOB_QUEUE:
                GOOGLE_JOB_RUNNING = False
                return
            (job, args, archive, on_failure, account_id,
             callsign, failure_message, job_id, attempts,
             archive_after, recovered) = GOOGLE_JOB_QUEUE.popleft()
            if archive:
                ARCHIVE_STATE["pending"] = max(0, ARCHIVE_STATE["pending"] - 1)
                ARCHIVE_STATE["running"] = True
                ARCHIVE_STATE["last_attempt"] = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
            else:
                GOOGLE_WRITE_STATE["pending"] = max(0, GOOGLE_WRITE_STATE["pending"] - 1)
                GOOGLE_WRITE_STATE["running"] = True
                GOOGLE_WRITE_STATE["last_attempt"] = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
        try:
            result = job(*args)
            if result is False and not archive:
                raise RuntimeError("Google Sheets did not apply the queued update")
            if recovered and not archive:
                L.import_google_sheet_data()
            elif recovered and archive and account_id:
                _reconcile_accounts_from_sheet()
            con = L.db()
            try:
                con.execute("DELETE FROM BackgroundJobs WHERE id=?", (job_id,))
                child_job_id = None
                if archive_after:
                    after_job, after_args = archive_after
                    child = con.execute(
                        """INSERT INTO BackgroundJobs(task_ref,args_json,archive,created_at)
                           VALUES(?,?,1,?)""",
                        (f"{after_job.__module__}:{after_job.__name__}",
                         json.dumps(after_args, ensure_ascii=False, default=str),
                         datetime.datetime.now().astimezone().isoformat(timespec="seconds")),
                    )
                    child_job_id = child.lastrowid
                con.commit()
            finally:
                con.close()
            if archive_after and child_job_id:
                after_job, after_args = archive_after
                _queue_google_job(after_job, after_args, archive=True, job_id=child_job_id)
            completed_at = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
            if archive:
                with GOOGLE_JOB_LOCK:
                    ARCHIVE_STATE["running"] = False
                    ARCHIVE_STATE["last_success"] = completed_at
                    ARCHIVE_STATE["last_error"] = None
            else:
                with GOOGLE_JOB_LOCK:
                    GOOGLE_WRITE_STATE["running"] = False
                    GOOGLE_WRITE_STATE["last_success"] = completed_at
                    GOOGLE_WRITE_STATE["last_error"] = None
        except Exception as e:
            logger.info(f"[LVFR EMS] Background Google update failed: {e}")
            attempts += 1
            if attempts < 5:
                con = L.db()
                try:
                    con.execute("UPDATE BackgroundJobs SET attempts=?,last_error=? WHERE id=?", (attempts, str(e)[:1500], job_id))
                    con.commit()
                finally:
                    con.close()
                with GOOGLE_JOB_LOCK:
                    if archive:
                        ARCHIVE_STATE["running"] = False
                        ARCHIVE_STATE["pending"] += 1
                        ARCHIVE_STATE["last_error"] = str(e)[:1500]
                    else:
                        GOOGLE_WRITE_STATE["running"] = False
                        GOOGLE_WRITE_STATE["pending"] += 1
                        GOOGLE_WRITE_STATE["last_error"] = str(e)[:1500]
                    GOOGLE_JOB_QUEUE.appendleft((job, args, archive, on_failure, account_id, callsign, failure_message, job_id, attempts, archive_after, recovered))
                retry_timer = Timer(min(2 ** attempts, 16), _google_job_worker)
                retry_timer.daemon = True
                retry_timer.start()
                return

            reverted = False
            try:
                if on_failure:
                    reverted = bool(on_failure())
                elif recovered and not archive:
                    L.import_google_sheet_data()
                    reverted = True
                elif archive and account_id:
                    reverted = _reconcile_accounts_from_sheet()
                if reverted and not archive:
                    _publish_member_update()
            except Exception as rollback_error:
                logger.info(f"[LVFR EMS] Member update rollback/reconcile failed: {rollback_error}")
            if account_id:
                _publish_update_failure(account_id, callsign, f"{failure_message}: {e}", reverted)
            con = L.db()
            try:
                con.execute("DELETE FROM BackgroundJobs WHERE id=?", (job_id,))
                con.commit()
            finally:
                con.close()
            with GOOGLE_JOB_LOCK:
                if archive:
                    ARCHIVE_STATE["running"] = False
                    ARCHIVE_STATE["last_error"] = str(e)[:1500]
                else:
                    GOOGLE_WRITE_STATE["running"] = False
                    GOOGLE_WRITE_STATE["last_error"] = str(e)[:1500]


def queue_archive_log(
    event, callsign="", member_name="", details="", performed_by=None,
    actor_callsign=None, old_callsign="", new_callsign="", old_rank="", new_rank=""
):
    user = CURRENT_USER.get() or {}
    actor_name = performed_by or current_actor()
    actor_id = actor_callsign if actor_callsign is not None else user.get("callsign", "")
    queue_archive_job(
        L.append_log_to_archive,
        event, callsign, member_name, details, actor_name, actor_id,
        old_callsign, new_callsign, old_rank, new_rank
    )


def _sync_hert_certification(member_name, certified):
    result = (
        L.add_hert_certification(member_name)
        if certified
        else L.remove_hert_certification(member_name)
    )
    if not result or not result[0]:
        raise RuntimeError(f"HERT sheet update failed: {result}")


def _persist_instructor_assignment(member_name, instructor_type, assigned):
    # A no-op means Sheets already matched the optimistic local state.
    L.set_instructor_status(member_name, instructor_type, assigned)
    return True


def _rollback_instructor_assignment(member_name, instructor_type, assigned, log_id):
    current = _cached_instructor_directory().get(_instructor_name_key(member_name), {})
    current_types = {
        value.strip().upper()
        for value in str(current.get("type") or "").split("/")
        if value.strip()
    }
    if (instructor_type in current_types) != bool(assigned):
        return False
    _update_cached_instructor(member_name, instructor_type, not assigned)
    if log_id:
        con = L.db()
        try:
            con.execute("DELETE FROM InstructorLog WHERE id=?", (log_id,))
            con.commit()
        finally:
            con.close()
    return True


# ============================================================
# INTERNAL HELPERS
# ============================================================

def _instructor_name_key(name):
    normalized = unicodedata.normalize("NFKC", " ".join(str(name or "").split()))
    return normalized.casefold()

def normalize_callsign(callsign: str) -> str:

    return str(
        callsign or ""
    ).strip().upper()


def normalize_rank(rank: str) -> str:

    return str(
        rank or ""
    ).strip().lower()


def is_ignored_callsign(callsign: str) -> bool:

    return (
        normalize_callsign(callsign)
        in IGNORED_CALLSIGNS
    )


def require_member(callsign: str):

    cs = normalize_callsign(
        callsign
    )

    if not cs:

        raise ValueError(
            "Callsign is required"
        )

    if is_ignored_callsign(cs):

        raise ValueError(
            f"{cs} is ignored by the web system"
        )

    profile = L.member_profile(
        cs
    )

    if not profile:

        raise ValueError(
            f"Member not found: {cs}"
        )

    return profile


def get_rank_level(rank: str):

    normalized = normalize_rank(
        rank
    )

    for rank_name, level in RANK_LEVELS.items():

        if normalize_rank(rank_name) == normalized:

            return level

    return None


def validate_force_promotion_rank(
    current_rank: str,
    new_rank: str
):

    current_level = get_rank_level(
        current_rank
    )

    new_level = get_rank_level(
        new_rank
    )

    if current_level is None or new_level is None:

        raise ValueError(
            "Invalid rank"
        )

    if current_level == new_level:

        raise ValueError(
            "He is already in this rank"
        )

    if new_level < current_level:

        raise ValueError(
            "You can't promote to a lower rank"
        )


def validate_demotion_rank(
    current_rank: str,
    new_rank: str
):

    current_level = get_rank_level(
        current_rank
    )

    new_level = get_rank_level(
        new_rank
    )

    if current_level is None or new_level is None:

        raise ValueError(
            "Invalid rank"
        )

    if current_level == new_level:

        raise ValueError(
            "He is already in this rank"
        )

    if new_level > current_level:

        raise ValueError(
            "You can't demote to a higher rank"
        )


# ============================================================
# GOOGLE CALLSIGN VALIDATION
# ============================================================

def validate_existing_target_callsign(callsign: str):

    cs = normalize_callsign(
        callsign
    )

    if not cs:

        raise ValueError(
            "New callsign is required"
        )

    if cs in IGNORED_CALLSIGNS:

        raise ValueError(
            f"{cs} is ignored and cannot be assigned"
        )

    con = L.db()
    try:
        row = con.execute(
            "SELECT name FROM Members WHERE callsign=?",
            (cs,)
        ).fetchone()
    finally:
        con.close()

    if row is None:
        raise ValueError(f"Callsign {cs} is not in the local member list")

    if str(row["name"] or "").strip():

        raise ValueError(
            f"Callsign {cs} is already assigned to another member"
        )

    return cs


# ============================================================
# MOVE OPERATION
# ============================================================

def perform_move_operation(
    old_callsign,
    new_callsign,
    new_rank,
    promoted_by,
    operation_type
):

    old_cs = normalize_callsign(
        old_callsign
    )

    new_cs = normalize_callsign(
        new_callsign
    )

    profile = require_member(
        old_cs
    )

    if old_cs == new_cs:

        raise ValueError(
            "New callsign must be different from current callsign"
        )

    validate_existing_target_callsign(
        new_cs
    )


    before_state = _snapshot_member_rows([old_cs, new_cs])

    # --------------------------------------------------------
    # Local database update
    # --------------------------------------------------------

    L.perform_rank_change(
        old_cs,
        new_rank,
        promoted_by,
        operation_type,
        new_cs
    )

    expected_state = _snapshot_member_rows([old_cs, new_cs])
    con = L.db()
    try:
        promotion_row = con.execute(
            "SELECT MAX(id) FROM Promotions WHERE old_callsign=? AND new_callsign=?",
            (old_cs, new_cs),
        ).fetchone()
        promotion_log_id = promotion_row[0] if promotion_row else None
    finally:
        con.close()

    queue_google_job(
        L.sync_promotion_to_google_sheet,
        old_cs,
        new_cs,
        profile["name"],
        new_rank,
        on_failure=lambda: _restore_member_rows(
            before_state, expected_state, promotion_log_id=promotion_log_id
        ),
        callsign=old_cs,
        failure_message="Could not save the rank or callsign change",
        archive_after=member_move_followup(
            operation_type.replace("_", " ").title(), new_cs,
            profile["name"], f"{old_cs} -> {new_cs}", promoted_by,
            old_callsign=old_cs, new_callsign=new_cs,
            old_rank=profile["rank"], new_rank=new_rank,
        ),
    )

    return new_cs


def archive_log_followup(event, callsign="", member_name="", details="", performed_by=None,
                        old_callsign="", new_callsign="", old_rank="", new_rank=""):
    user = CURRENT_USER.get() or {}
    return (
        L.append_log_to_archive,
        (event, callsign, member_name, details, performed_by or current_actor(),
         user.get("callsign", ""), old_callsign, new_callsign, old_rank, new_rank),
    )


def member_move_followup(event, callsign="", member_name="", details="", performed_by=None,
                         old_callsign="", new_callsign="", old_rank="", new_rank=""):
    user = CURRENT_USER.get() or {}
    return (
        _persist_member_move_followup,
        (event, callsign, member_name, details, performed_by or current_actor(),
         user.get("callsign", ""), old_callsign, new_callsign, old_rank, new_rank),
    )


def _persist_member_move_followup(event, callsign, member_name, details, performed_by,
                                  actor_callsign, old_callsign, new_callsign, old_rank, new_rank):
    old_cs = str(old_callsign or "").strip().upper()
    new_cs = str(new_callsign or "").strip().upper()
    if old_cs and new_cs:
        account = next((row for row in L.get_account_records() if str(row.get("callsign") or "").strip().upper() == old_cs), None)
        if account:
            updated = dict(account)
            updated["callsign"] = new_cs
            action = f"Callsign updated after {event}"
            if not L.update_account_record_and_audit(updated["account_id"], _account_payload(updated), action, performed_by):
                raise RuntimeError("The linked account Callsign could not be updated")
            _apply_account_change_locally(updated, action, performed_by)
    return L.append_log_to_archive(
        event, callsign, member_name, details, performed_by, actor_callsign,
        old_callsign, new_callsign, old_rank, new_rank,
    )


# ============================================================
# STARTUP
# ============================================================

def _bootstrap_admin_account():
    rows = L.get_account_records()
    with ACCOUNT_CACHE_LOCK:
        ACCOUNT_CACHE.update(at=time.monotonic(), rows=rows)
    if any(row["status"] == "approved" and row["role"] == "admin" for row in rows):
        return
    name = os.getenv("BOOTSTRAP_ADMIN_NAME", "").strip()
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "")
    callsign = os.getenv("BOOTSTRAP_ADMIN_CALLSIGN", "").strip().upper()
    if callsign:
        callsign = _clean_callsign(callsign)
        existing = next((row for row in rows if row.get("callsign", "").upper() == callsign), None)
        if existing:
            now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
            existing.update(
                status="approved",
                role="admin",
                activated_at=existing.get("activated_at") or now,
                approved_by="Bootstrap configuration",
                admin_changed_at=now,
                admin_changed_by="Bootstrap configuration",
            )
            _write_account(existing)
            _record_account_event(existing, "Activated as Initial Commander", "Bootstrap configuration")
            logger.info("[LVFR EMS] Existing bootstrap account activated as Commander.")
            return
    if not (name and password and callsign):
        logger.info("[LVFR EMS] No admin account exists; set BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_PASSWORD and BOOTSTRAP_ADMIN_CALLSIGN in the local env file.")
        return
    name = _clean_name(name)
    if len(password) < 5:
        raise ValueError("BOOTSTRAP_ADMIN_PASSWORD must contain at least 5 characters")
    if any(row.get("callsign", "").upper() == callsign or _name_key(row["name"]) == _name_key(name) for row in rows):
        raise ValueError("Bootstrap Commander name or Callsign is already registered")
    salt = secrets.token_bytes(16).hex()
    row = {
        "account_id": str(uuid.uuid4()), "name": name, "callsign": callsign,
        "password_salt": salt, "password_hash": _password_digest(password, salt),
        "status": "approved", "role": "admin",
        "created_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "activated_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "approved_by": "Initial setup", "admin_changed_at": "", "admin_changed_by": ""
    }
    L.append_account_record(row)
    L.append_account_audit(row["account_id"], name, callsign, "Initial Commander Created", "System")
    _refresh_account_cache()
    logger.info("[LVFR EMS] Initial admin account created from local environment settings.")


def _startup():

    L.validate_configuration()

    L.init_db()

    try:
        _bootstrap_admin_account()
    except Exception as e:
        logger.info(f"[LVFR EMS] Account bootstrap unavailable: {e}")

    try:
        account_rows, account_audit = L.get_account_overview()
        with ACCOUNT_CACHE_LOCK:
            ACCOUNT_CACHE.update(at=time.monotonic(), rows=account_rows)
        overview = _public_leader_overview(account_rows, account_audit)
        with LEADER_OVERVIEW_LOCK:
            LEADER_OVERVIEW_CACHE.update(at=time.monotonic(), data=overview)
    except Exception as e:
        logger.info(f"[LVFR EMS] Account overview cache warm-up skipped: {e}")

    try:
        _cached_instructor_directory()
        logger.info("[LVFR EMS] Instructor directory cache warmed.")
    except Exception as e:
        logger.info(f"[LVFR EMS] Instructor directory startup warm-up skipped: {e}")

    try:
        restored_logs = L.restore_logs_from_archive()
        if restored_logs:
            logger.info(
                f"[LVFR EMS] Restored archive data: {restored_logs} log rows"
            )
    except Exception as e:
        logger.info(f"[LVFR EMS] Archive restore skipped: {e}")

    _restore_pending_google_jobs()
    queue_archive_job(L.sync_logs_to_archive)


# ============================================================
# MAIN PAGE
# ============================================================

@app.get(
    "/",
    response_class=HTMLResponse
)
def index():

    with open(
        STATIC_DIR / "index.html",
        "r",
        encoding="utf-8"
    ) as f:

        return f.read()


# ============================================================
# HEALTH
# ============================================================

@app.get("/api/health")
def health():

    return {
        "ok": True,
        "database": L.DB_NAME
    }


# ============================================================
# CONFIG
# ============================================================

@app.get("/api/config")
def config():

    return {
        "ranks": L.RANK_CHOICES,

        "trainings": [
            "Basic Firefighting",
            "Advanced Firefighting",
            "Hert"
        ],

        "activities": [
            "Active",
            "Semi Active",
            "Inactive",
            "Can Be Terminated"
        ],

        "exams": [
            "Supervisor Exam"
        ]
    }


# ============================================================
# MEMBERS
# ============================================================

@app.get("/api/members")
def members(
    search: str = ""
):

    members_list = L.list_members(
        search
    )

    try:
        instructor_directory = _cached_instructor_directory()
    except Exception as e:
        logger.info(f"[LVFR EMS] Instructor filter lookup failed: {e}")
        instructor_directory = {}

    filtered = []

    for member in members_list:

        cs = normalize_callsign(
            member.get(
                "callsign",
                ""
            )
        )

        if cs in IGNORED_CALLSIGNS:
            continue

        instructor = instructor_directory.get(
            _instructor_name_key(member.get("name")), {}
        )
        member["instructor_type"] = instructor.get("type", "")
        member["has_instructor"] = bool(member["instructor_type"])

        filtered.append(
            member
        )

    return filtered


# ============================================================
# MEMBER PROFILE
# ============================================================

@app.get("/api/member/{callsign}")
def member(
    callsign: str
):

    cs = normalize_callsign(
        callsign
    )

    if cs in IGNORED_CALLSIGNS:

        raise HTTPException(
            status_code=404,
            detail="Member not found"
        )

    x = L.member_profile(
        cs
    )

    if not x:

        raise HTTPException(
            status_code=404,
            detail="Member not found"
        )

    try:
        instructor = _cached_instructor_directory().get(
            _instructor_name_key(x.get("name")), {}
        )
        if _current_user_is_command():
            x["instructor_type"] = instructor.get("type", "")
            x["instructor_date"] = instructor.get("date", "")
        else:
            x["instructor_type"] = ""
            x["instructor_date"] = ""
    except Exception as e:
        logger.info(f"[LVFR EMS] Instructor profile lookup failed: {e}")
        x["instructor_type"] = ""
        x["instructor_date"] = ""

    return x


@app.post("/api/member/{callsign}/instructor")
def update_member_instructor(callsign: str, data: InstructorAction):
    _require_leaders_admin()
    cs = normalize_callsign(callsign)
    member_name = L.member_name_for_callsign(cs)
    if not member_name:
        raise HTTPException(status_code=404, detail="Member not found")
    instructor_type = str(data.instructor_type or "").strip().upper()
    if instructor_type not in {"HERT", "FORT"}:
        raise HTTPException(status_code=400, detail="Choose HERT or FORT")
    key = _instructor_name_key(member_name)
    current = _cached_instructor_directory().get(key, {})
    current_types = {
        value.strip().upper()
        for value in str(current.get("type") or "").split("/")
        if value.strip()
    }
    changed = (instructor_type in current_types) != bool(data.assigned)
    if changed:
        action = "Instructor Assigned" if data.assigned else "Instructor Removed"
        try:
            log_id = L.log_instructor_change(cs, member_name, instructor_type, action, current_actor())
            _update_cached_instructor(member_name, instructor_type, data.assigned)
            queue_google_job(
                _persist_instructor_assignment, member_name, instructor_type, data.assigned,
                on_failure=lambda: _rollback_instructor_assignment(
                    member_name, instructor_type, data.assigned, log_id
                ),
                callsign=cs,
                failure_message=f"Could not save {instructor_type} Instructor status",
            )
        except Exception as e:
            logger.info(f"[LVFR EMS] Instructor update enqueue failed for {cs}: {e}")
            _update_cached_instructor(member_name, instructor_type, not data.assigned)
            raise HTTPException(status_code=503, detail="Could not queue the instructor update")
    return {
        "ok": True,
        "changed": changed,
        "assigned": data.assigned,
        "instructor_type": instructor_type,
        "status": "queued" if changed else "unchanged",
    }


# ============================================================
# ELIGIBLE MEMBERS
# ============================================================

@app.get("/api/eligible")
def eligible():

    result = L.eligible_members()

    filtered = []

    for member in result:

        cs = normalize_callsign(
            member.get(
                "callsign",
                ""
            )
        )

        if cs in IGNORED_CALLSIGNS:
            continue

        rank = str(
            member.get(
                "rank",
                ""
            )
        ).strip()

        if rank in (
            "Probationary",
            "Probie",
            "Probationary Volunteer",
            "Probie Volunteer"
        ):

            continue

        filtered.append(
            member
        )

    return filtered


def _sync_eligibility_notifications():
    """Create one notification when a member newly becomes eligible."""
    eligible_rows = L.eligible_members()
    current = {}
    for member in eligible_rows:
        callsign = normalize_callsign(member.get("callsign", ""))
        if callsign and callsign not in IGNORED_CALLSIGNS:
            current[callsign] = {
                "next_rank": str(member.get("next_rank") or "Promotion"),
                "name": str(member.get("name") or callsign),
            }

    con = L.db()
    try:
        con.execute("BEGIN IMMEDIATE")
        seeded = con.execute(
            "SELECT 1 FROM NotificationMeta WHERE meta_key='eligibility_seeded'"
        ).fetchone()
        existing = {
            row["callsign"]: row["next_rank"]
            for row in con.execute("SELECT callsign,next_rank FROM EligibilityNotificationState")
        }
        now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")

        # Existing eligibilities at first run are the baseline; notify only on
        # transitions after the feature has been initialized.
        if not seeded:
            for callsign, data in current.items():
                con.execute(
                    "INSERT OR REPLACE INTO EligibilityNotificationState(callsign,next_rank) VALUES(?,?)",
                    (callsign, data["next_rank"]),
                )
            con.execute(
                "INSERT INTO NotificationMeta(meta_key,meta_value) VALUES('eligibility_seeded','1')"
            )
        else:
            for callsign, data in current.items():
                if existing.get(callsign) != data["next_rank"]:
                    con.execute(
                        """INSERT INTO Notifications(
                               notification_key,kind,title,message,callsign,target_rank,created_at
                           ) VALUES(?,?,?,?,?,?,?)""",
                        (
                            f"eligible:{callsign}:{uuid.uuid4()}", "eligible",
                            "New eligible promotion",
                            f"{data['name']} ({callsign}) is eligible for {data['next_rank']}.",
                            callsign, data["next_rank"], now,
                        ),
                    )
                con.execute(
                    "INSERT OR REPLACE INTO EligibilityNotificationState(callsign,next_rank) VALUES(?,?)",
                    (callsign, data["next_rank"]),
                )
            stale = set(existing) - set(current)
            if stale:
                placeholders = ",".join("?" for _ in stale)
                con.execute(
                    f"DELETE FROM EligibilityNotificationState WHERE callsign IN ({placeholders})",
                    tuple(stale),
                )
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def _sync_pending_request_notifications():
    try:
        pending = [row for row in _load_accounts() if row.get("status") == "pending"]
    except Exception as e:
        logger.info(f"[LVFR EMS] Pending request notifications unavailable: {e}")
        return
    if not pending:
        return
    now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    con = L.db()
    try:
        for row in pending:
            request_time = str(row.get("created_at") or "")
            account_id = str(row.get("account_id") or "")
            name = str(row.get("name") or "New account")
            con.execute(
                """INSERT OR IGNORE INTO Notifications(
                       notification_key,kind,title,message,callsign,target_rank,created_at
                   ) VALUES(?,?,?,?,?,?,?)""",
                (
                    f"request:{account_id}:{request_time}", "request",
                    "New account request", f"{name} requested an account.", "",
                    "", request_time or now,
                ),
            )
        con.commit()
    finally:
        con.close()


def _sync_inactive_notifications():
    """Notify Command when a member newly enters Can Be Terminated."""
    current = {
        normalize_callsign(callsign): str(name or callsign)
        for callsign, name in L.get_inactive_members()
        if normalize_callsign(callsign) and normalize_callsign(callsign) not in IGNORED_CALLSIGNS
    }
    con = L.db()
    try:
        con.execute("BEGIN IMMEDIATE")
        seeded = con.execute(
            "SELECT 1 FROM NotificationMeta WHERE meta_key='inactive_seeded'"
        ).fetchone()
        existing = {row["callsign"] for row in con.execute("SELECT callsign FROM InactiveNotificationState")}
        now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
        if not seeded:
            con.executemany(
                "INSERT OR IGNORE INTO InactiveNotificationState(callsign) VALUES(?)",
                [(callsign,) for callsign in current],
            )
            con.execute("INSERT INTO NotificationMeta(meta_key,meta_value) VALUES('inactive_seeded','1')")
        else:
            for callsign in set(current) - existing:
                con.execute(
                    """INSERT INTO Notifications(notification_key,kind,title,message,callsign,target_rank,created_at)
                       VALUES(?,?,?,?,?,?,?)""",
                    (f"inactive:{callsign}:{uuid.uuid4()}", "inactive", "Can Be Terminated",
                     f"{current[callsign]} ({callsign}) is marked Can Be Terminated.", callsign, "", now),
                )
                con.execute("INSERT OR IGNORE INTO InactiveNotificationState(callsign) VALUES(?)", (callsign,))
            stale = existing - set(current)
            if stale:
                con.executemany("DELETE FROM InactiveNotificationState WHERE callsign=?", [(cs,) for cs in stale])
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


@app.get("/api/notifications")
def get_notifications():
    user = CURRENT_USER.get() or {}
    account_id = str(user.get("account_id") or "")
    is_admin = bool(user.get("is_admin"))
    is_command = is_admin or _current_user_is_command()
    try:
        _sync_eligibility_notifications()
    except Exception as e:
        logger.info(f"[LVFR EMS] Eligibility notifications unavailable: {e}")
    if is_admin:
        _sync_pending_request_notifications()
    if is_command:
        try:
            _sync_inactive_notifications()
        except Exception as e:
            logger.info(f"[LVFR EMS] Inactive notifications unavailable: {e}")

    con = L.db()
    try:
        if is_admin:
            kind_filter = "n.kind IN ('eligible','inactive','request')"
        elif is_command:
            kind_filter = "n.kind IN ('eligible','inactive')"
        else:
            kind_filter = "n.kind='eligible' AND n.target_rank IN ('AEMT','Senior Volunteer')"
        rows = [dict(row) for row in con.execute(
            f"""SELECT n.id,n.kind,n.title,n.message,n.callsign,n.created_at,
                       EXISTS(SELECT 1 FROM NotificationReads r
                              WHERE r.notification_id=n.id AND r.account_id=?) AS is_read
                FROM Notifications n WHERE {kind_filter}
                ORDER BY n.id DESC LIMIT 100""",
            (account_id,),
        )]
        unread_count = con.execute(
            f"""SELECT COUNT(*) FROM Notifications n WHERE {kind_filter}
                AND NOT EXISTS(SELECT 1 FROM NotificationReads r
                               WHERE r.notification_id=n.id AND r.account_id=?)""",
            (account_id,),
        ).fetchone()[0]
        return {"items": rows, "unread_count": unread_count}
    finally:
        con.close()


@app.post("/api/notifications/read")
def mark_notifications_read(data: NotificationReadInput):
    user = CURRENT_USER.get() or {}
    account_id = str(user.get("account_id") or "")
    is_admin = bool(user.get("is_admin"))
    is_command = is_admin or _current_user_is_command()
    if is_admin:
        kinds = "('eligible','inactive','request')"
        eligibility_filter = ""
    elif is_command:
        kinds = "('eligible','inactive')"
        eligibility_filter = ""
    else:
        kinds = "('eligible')"
        eligibility_filter = " AND target_rank IN ('AEMT','Senior Volunteer')"
    con = L.db()
    try:
        con.execute(
            f"""INSERT OR IGNORE INTO NotificationReads(account_id,notification_id,read_at)
                SELECT ?,id,? FROM Notifications WHERE kind IN {kinds}{eligibility_filter}
                AND (?=0 OR id IN ({','.join('?' for _ in data.ids) or 'NULL'}))""",
            (account_id, datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
             1 if data.ids else 0, *data.ids),
        )
        con.commit()
        return {"ok": True}
    finally:
        con.close()


# ============================================================
# INACTIVE / CAN BE TERMINATED
# ============================================================

@app.get("/api/inactive")
def inactive():

    require_role("command")

    result = L.get_inactive_members()

    return [
        {
            "callsign": c,
            "name": n
        }
        for c, n in result
        if normalize_callsign(c)
        not in IGNORED_CALLSIGNS
    ]


# ============================================================
# GOOGLE SHEET SYNC
# ============================================================

def _run_google_sheet_sync(source):
    with SYNC_LOCK:
        if SYNC_STATE["running"]:
            return None
        SYNC_STATE.update(running=True, pending=False, last_error=None, last_source=source)
    try:
        result = L.import_google_sheet_data()
        with SYNC_LOCK:
            SYNC_STATE["last_success"] = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
            SYNC_STATE["last_error"] = None
        return result
    except Exception as e:
        with SYNC_LOCK:
            SYNC_STATE["last_error"] = str(e)
        raise
    finally:
        with SYNC_LOCK:
            SYNC_STATE["running"] = False


@app.post("/api/sync")
def sync():
    require_role("command")
    try:
        result = _run_google_sheet_sync("manual")
        if result is None:
            raise HTTPException(409, "Google Sheet sync is already running")

        return {
            "ok": True,
            "message": "Google Sheet synchronized",
            "result": result,
            "synced_at": SYNC_STATE["last_success"]
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


class AutoSyncInput(BaseModel):
    enabled: bool


@app.post("/api/sync/auto")
def set_auto_sync(data: AutoSyncInput):
    require_role("command")
    with SYNC_LOCK:
        SYNC_STATE["auto_enabled"] = False
    return {"ok": True, "auto_enabled": False, "interval_seconds": 0}


# ============================================================
# SYNC STATUS
# ============================================================

@app.get("/api/sync-status")
def sync_status():

    con = L.db()

    try:

        row = con.execute(
            """
            SELECT synced_at
            FROM SyncState
            WHERE id=1
            """
        ).fetchone()

        count = con.execute(
            """
            SELECT COUNT(*)
            FROM Members
            WHERE name<>''
            """
        ).fetchone()[0]

        with SYNC_LOCK:

            running = SYNC_STATE["running"]
            pending = SYNC_STATE["pending"]
            last_error = SYNC_STATE["last_error"]

        with GOOGLE_JOB_LOCK:
            google_write_state = dict(GOOGLE_WRITE_STATE)
            archive_state = dict(ARCHIVE_STATE)

        archive_state["enabled"] = bool(L.GOOGLE_SHEET_ID2)
        if not archive_state["enabled"]:
            archive_state["status"] = "disabled"
        elif archive_state["running"]:
            archive_state["status"] = "running"
        elif archive_state["pending"]:
            archive_state["status"] = "queued"
        elif archive_state["last_error"]:
            archive_state["status"] = "error"
        elif archive_state["last_success"]:
            archive_state["status"] = "synced"
        else:
            archive_state["status"] = "waiting"

        return {
            "synced_at":
                row[0]
                if row
                else None,

            "members":
                count,

            "sync_running":
                running,

            "sync_pending":
                pending,

            "sync_error":
                last_error,

            "sync_last_success": SYNC_STATE["last_success"],
            "sync_last_source": SYNC_STATE["last_source"],
            "auto_sync_enabled": SYNC_STATE["auto_enabled"],
            "auto_sync_interval_seconds": 0,

            "google_write":
                google_write_state,

            "archive": archive_state
        }

    finally:

        con.close()


# ============================================================
# TRAINING
# ============================================================

@app.post("/api/training")
def training(
    a: Action
):

    try:

        profile = require_member(
            a.callsign
        )

        cs = normalize_callsign(
            a.callsign
        )

        training_name = str(
            a.training or ""
        ).strip()

        mapping = {
            "Basic Firefighting": "basic_firefighting",
            "Advanced Firefighting": "advanced_firefighting",
        }
        training_was_present = False
        local_training_name = ""

        if training_name in mapping:
            _require_instructor_type("FORT")

            db_training_name = mapping[
                training_name
            ]

            con = L.db()

            try:

                row = con.execute(
                    """
                    SELECT 1
                    FROM Trainings
                    WHERE callsign=?
                    AND training_name=?
                    LIMIT 1
                    """,
                    (
                        cs,
                        db_training_name
                    )
                ).fetchone()

            finally:

                con.close()

            training_exists = row is not None
            training_was_present = training_exists
            local_training_name = db_training_name

            if not a.remove and training_exists:

                return {
                    "ok": False,
                    "changed": False,
                    "result": (
                        False,
                        "already_completed"
                    ),
                    "status": "already_completed",
                    "message": "Already certified"
                }

            if a.remove and not training_exists:

                return {
                    "ok": False,
                    "changed": False,
                    "result": (
                        False,
                        "already_removed"
                    ),
                    "status": "already_removed",
                    "message": "Training already removed"
                }

        elif training_name == "Hert":
            _require_instructor_type("HERT")
            con = L.db()
            try:
                hert_row = con.execute(
                    "SELECT certified FROM HERTCache WHERE lower(trim(member_name))=lower(trim(?)) LIMIT 1",
                    (profile.get("name", ""),),
                ).fetchone()
                training_was_present = bool(hert_row and int(hert_row["certified"]) == 1)
            finally:
                con.close()
            local_training_name = "Hert"
            # State is updated locally; the Google Sheets write is queued below.
            pass

        else:

            raise ValueError(
                f"Unknown training: {training_name}"
            )

        result = L.training_change(
            cs,
            training_name,
            a.remove,
            current_actor(),
            sync_google=False
        )

        ok, status = result

        messages = {
            "added": "Training added",
            "removed": "Training removed",
            "training_not_exist": "Training doesn't exist",
            "already_completed": "Already certified",
            "already_certified": "Already certified",
            "already_removed": "Training already removed",
            "not_found": "Member not found",
            "callsign_not_found": "Callsign not found",
            "no_empty_row": "No empty HERT row available",
        }

        message = messages.get(
            status,
            status
        )

        changed = (
            ok is True
            and status in (
                "added",
                "removed"
            )
        )

        if changed:
            training_log_id = _latest_member_log_id("TrainingLog", cs)
            archive_after = archive_log_followup(
                "Training Removed" if a.remove else "Training Added",
                cs, profile.get("name", ""), training_name,
            )
            if training_name == "Hert":
                queue_google_job(
                    _sync_hert_certification,
                    profile["name"],
                    not a.remove,
                    on_failure=lambda: _restore_training_state(
                        cs, local_training_name, training_was_present,
                        profile.get("name", ""), training_log_id,
                        expected_present=not a.remove,
                    ),
                    callsign=cs,
                    failure_message="Could not save HERT certification",
                    archive_after=archive_after,
                )
            else:
                column = {
                    "Basic Firefighting": "G",
                    "Advanced Firefighting": "H",
                }[training_name]
                queue_google_job(
                    L.set_google_training_color,
                    cs,
                    column,
                    a.remove,
                    on_failure=lambda: _restore_training_state(
                        cs, local_training_name, training_was_present,
                        log_id=training_log_id, expected_present=not a.remove,
                    ),
                    callsign=cs,
                    failure_message="Could not save FORT training",
                    archive_after=archive_after,
                )

        return {
            "ok": ok,
            "changed": changed,
            "result": result,
            "status": status,
            "message": message
        }

    except HTTPException:
        raise
    except Exception as e:

        raise HTTPException(
            status_code=400,
            detail=str(e)
        )


# ============================================================
# EXAM
# ============================================================

@app.post("/api/exam")
def exam(
    a: Action
):

    try:

        require_role("command")

        profile = require_member(
            a.callsign
        )

        cs = normalize_callsign(
            a.callsign
        )

        con = L.db()

        try:

            row = con.execute(
                """
                SELECT 1
                FROM Exams
                WHERE callsign=?
                AND exam_name='supervisor_exam'
                LIMIT 1
                """,
                (cs,)
            ).fetchone()

        finally:

            con.close()

        exam_exists = row is not None

        if not a.remove and exam_exists:

            return {
                "ok": False,
                "changed": False,
                "result": (
                    False,
                    "already_passed"
                ),
                "status": "already_passed",
                "message": "Already passed the exam"
            }

        if a.remove and not exam_exists:

            return {
                "ok": False,
                "changed": False,
                "result": (
                    False,
                    "already_removed"
                ),
                "status": "already_removed",
                "message": "Exam already removed"
            }

        result = L.exam_change(
            cs,
            a.remove,
            current_actor(),
            sync_google=False
        )

        ok, status = result

        messages = {
            "added": "Exam added",
            "removed": "Exam removed",
            "exam_not_exist": "Exam doesn't exist",
            "already_passed": "Already passed the exam",
            "already_removed": "Exam already removed",
            "callsign_not_found": "Callsign not found",
        }

        message = messages.get(
            status,
            status
        )

        changed = (
            ok is True
            and status in (
                "added",
                "removed"
            )
        )

        if changed:
            exam_log_id = _latest_member_log_id("ExamLog", cs)
            queue_google_job(
                L.set_google_training_color,
                cs,
                "F",
                a.remove,
                on_failure=lambda: _restore_exam_state(
                    cs, exam_exists, exam_log_id, expected_present=not a.remove
                ),
                callsign=cs,
                failure_message="Could not save Supervisor Exam status",
                archive_after=archive_log_followup(
                    "Exam Removed" if a.remove else "Exam Added",
                    cs, profile.get("name", ""), "Supervisor Exam",
                ),
            )

        return {
            "ok": ok,
            "changed": changed,
            "result": result,
            "status": status,
            "message": message
        }

    except HTTPException:
        raise
    except Exception as e:

        raise HTTPException(
            status_code=400,
            detail=str(e)
        )


# ============================================================
# ACTIVITY
# ============================================================

@app.post("/api/activity")
def activity(
    a: Action
):

    try:

        cs = normalize_callsign(
            a.callsign
        )

        if not cs:

            raise ValueError(
                "Callsign is required"
            )

        if is_ignored_callsign(cs):

            raise ValueError(
                f"{cs} is ignored by the web system"
            )

        activity_name = str(
            a.activity or ""
        ).strip()

        allowed = {
            "Active",
            "Semi Active",
            "Inactive",
            "Can Be Terminated"
        }

        if activity_name not in allowed:

            raise ValueError(
                "Invalid activity status"
            )

        con = L.db()

        try:

            member_row = con.execute(
                """
                SELECT name
                FROM Members
                WHERE callsign=?
                """,
                (cs,)
            ).fetchone()

            if not member_row:

                raise ValueError(
                    f"Member not found: {cs}"
                )

            cache_row = con.execute(
                """
                SELECT activity
                FROM SheetCache
                WHERE callsign=?
                """,
                (cs,)
            ).fetchone()

        finally:

            con.close()

        member_name = str(
            member_row["name"] or ""
        ).strip()

        current_activity = ""

        if cache_row:

            current_activity = str(
                cache_row["activity"] or "Active"
            ).strip() or "Active"
        else:
            current_activity = "Active"

        if current_activity == activity_name:

            return {
                "ok": False,
                "changed": False,
                "status": "already_current",
                "message": f"Already {activity_name}"
            }

        account_user = CURRENT_USER.get() or {}
        changed_by = current_actor()
        changed_at = datetime.datetime.now().isoformat(timespec="seconds")

        con = L.db()
        try:
            con.execute(
                """
                INSERT INTO SheetCache(callsign, activity, sheet_row)
                VALUES(?,?,NULL)
                ON CONFLICT(callsign) DO UPDATE SET
                    activity=excluded.activity,
                    sheet_row=COALESCE(excluded.sheet_row, SheetCache.sheet_row)
                """,
                (cs, activity_name)
            )
            activity_log_cursor = con.execute(
                """
                INSERT INTO ActivityStatusLog(
                    callsign, member_name, old_status, new_status,
                    discord_user_id, changed_by, changed_at
                ) VALUES(?,?,?,?,?,?,?)
                """,
                (
                    cs,
                    member_name,
                    current_activity,
                    activity_name,
                    str(account_user.get("callsign", "")),
                    changed_by,
                    changed_at
                )
            )
            activity_log_id = activity_log_cursor.lastrowid
            con.commit()
        finally:
            con.close()

        queue_google_job(
            L.set_google_activity_status,
            cs,
            activity_name,
            on_failure=lambda: _restore_activity_state(
                cs, current_activity, activity_log_id, expected_activity=activity_name
            ),
            callsign=cs,
            failure_message="Could not save activity status",
            archive_after=archive_log_followup(
                "Activity Changed", cs, member_name,
                f"{current_activity} -> {activity_name}",
            ),
        )

        return {
            "ok": True,
            "changed": True,
            "status": "changed",
            "message": f"Activity changed to {activity_name}"
        }

    except Exception as e:

        raise HTTPException(
            status_code=400,
            detail=str(e)
        )


# ============================================================
# NOTES
# ============================================================

@app.post("/api/note")
def note(
    a: Action
):
    require_role("leader")

    try:

        profile = require_member(
            a.callsign
        )

        result = L.note_edit(
            normalize_callsign(
                a.callsign
            ),
            a.action,
            a.note,
            changed_by=current_actor(),
            sync_google=False
        )

        callsign = normalize_callsign(a.callsign)
        con = L.db()
        try:
            note_log = con.execute(
                "SELECT MAX(id) FROM NoteLog WHERE callsign=? AND changed_by=?",
                (callsign, current_actor()),
            ).fetchone()
            note_log_id = note_log[0] if note_log else None
        finally:
            con.close()

        queue_google_job(
            L.update_google_sheet_note,
            callsign,
            result,
            on_failure=lambda: _restore_note_state(
                callsign, profile.get("notes"), note_log_id,
                expected_note=str(result or ""),
            ),
            callsign=callsign,
            failure_message="Could not save member note",
            archive_after=archive_log_followup(
                f"Note {a.action}", callsign, profile.get("name", ""),
                "Deleted" if str(a.action).lower() == "delete" else result,
            ),
        )

        return {
            "ok": True,
            "note": result
        }

    except Exception as e:

        raise HTTPException(
            status_code=400,
            detail=str(e)
        )


# ============================================================
# DATE
# ============================================================

@app.post("/api/date")
def date(
    a: Action
):

    try:

        profile = require_member(
            a.callsign
        )

        callsign = normalize_callsign(a.callsign)
        previous_date = str(profile.get("rank_assigned_date") or "")

        L.change_date(
            callsign,
            a.date_str,
            sync_google=False
        )

        queue_google_job(
            L.update_google_sheet_date,
            callsign,
            a.date_str,
            on_failure=lambda: _restore_rank_date_state(
                callsign, previous_date, expected_date=a.date_str
            ),
            callsign=callsign,
            failure_message="Could not save the rank date",
            archive_after=archive_log_followup(
                "Rank Date Changed", callsign, profile.get("name", ""), a.date_str,
            ),
        )

        return {
            "ok": True
        }

    except Exception as e:

        raise HTTPException(
            status_code=400,
            detail=str(e)
        )


# ============================================================
# TERMINATE
# ============================================================

@app.post("/api/terminate")
def terminate(
    a: Action
):
    require_role("admin")

    try:

        profile = require_member(
            a.callsign
        )

        callsign = normalize_callsign(a.callsign)
        before_state = _snapshot_member_rows([callsign])

        L.perform_termination(
            callsign,
            current_actor(),
            a.note
        )
        expected_state = _snapshot_member_rows([callsign])
        termination_log_id = _latest_member_log_id("TerminationLog", callsign)

        queue_google_job(
            L.terminate_member_in_google_sheets,
            callsign,
            profile["name"],
            on_failure=lambda: _restore_member_rows(
                before_state, expected_state, termination_log_id=termination_log_id
            ),
            callsign=callsign,
            failure_message="Could not save the member termination",
            archive_after=archive_log_followup(
                "Terminated", callsign, profile.get("name", ""), a.note,
                old_rank=profile.get("rank", ""),
            ),
        )

        return {
            "ok": True
        }

    except Exception as e:

        raise HTTPException(
            status_code=400,
            detail=str(e)
        )


# ============================================================
# NORMAL PROMOTION
# ============================================================

@app.post("/api/promote")
def promote(
    a: Action
):

    user = CURRENT_USER.get() or {}
    if not user.get("is_admin"):
        try:
            member = require_member(normalize_callsign(a.callsign))
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))
        if str(member.get("rank") or "").strip().casefold() != "emt":
            raise HTTPException(status_code=403, detail="Supervisors may only promote EMT members to AEMT.")

    try:

        old = normalize_callsign(
            a.callsign
        )

        profile = require_member(
            old
        )

        ok, reason, next_rank = (
            L.check_eligibility(
                old
            )
        )

        if not ok:

            raise ValueError(
                reason
            )

        if not user.get("is_admin") and str(next_rank or "").strip().casefold() != "aemt":
            raise HTTPException(status_code=403, detail="Supervisors may only promote EMT members to AEMT.")

        if profile["rank"] in (
            "Probationary",
            "Probie",
            "Probationary Volunteer",
            "Probie Volunteer"
        ):

            raise ValueError(
                "This rank is never eligible for promotion"
            )

        new = L.get_next_available_callsign(
            next_rank
        )

        validate_existing_target_callsign(
            new
        )

        perform_move_operation(
            old,
            new,
            next_rank,
            current_actor(),
            "NORMAL"
        )

        return {
            "ok": True,
            "new_callsign": new,
            "new_rank": next_rank
        }

    except HTTPException:
        raise
    except Exception as e:

        raise HTTPException(
            status_code=400,
            detail=str(e)
        )


# ============================================================
# FORCE PROMOTION
# ============================================================

@app.post("/api/force-promote")
def force_promote(
    a: Action
):
    require_role("admin")

    try:

        old = normalize_callsign(
            a.callsign
        )

        profile = require_member(
            old
        )

        if not a.new_rank:

            raise ValueError(
                "New rank is required"
            )

        validate_force_promotion_rank(
            profile["rank"],
            a.new_rank
        )

        new = L.get_next_available_callsign(
            a.new_rank
        )

        validate_existing_target_callsign(
            new
        )

        perform_move_operation(
            old,
            new,
            a.new_rank,
            current_actor(),
            "FORCE"
        )

        return {
            "ok": True,
            "new_callsign": new,
            "new_rank": a.new_rank
        }

    except Exception as e:

        raise HTTPException(
            status_code=400,
            detail=str(e)
        )


# ============================================================
# DEMOTION
# ============================================================

@app.post("/api/demote")
def demote(
    a: Action
):
    require_role("admin")

    try:

        old = normalize_callsign(
            a.callsign
        )

        profile = require_member(
            old
        )

        if not a.new_rank:

            raise ValueError(
                "New rank is required"
            )

        validate_demotion_rank(
            profile["rank"],
            a.new_rank
        )

        new = L.get_next_available_callsign(
            a.new_rank
        )

        validate_existing_target_callsign(
            new
        )

        perform_move_operation(
            old,
            new,
            a.new_rank,
            current_actor(),
            "DEMOTION"
        )

        return {
            "ok": True,
            "new_callsign": new,
            "new_rank": a.new_rank
        }

    except Exception as e:

        raise HTTPException(
            status_code=400,
            detail=str(e)
        )


# ============================================================
# CHANGE RANK
# ============================================================

@app.post("/api/change-rank")
def change_rank(
    a: Action
):
    require_role("admin")

    allowed = {
        (
            "AEMT",
            "Senior Volunteer"
        ),

        (
            "EMT",
            "Volunteer"
        ),

        (
            "Senior Volunteer",
            "AEMT"
        ),

        (
            "Volunteer",
            "EMT"
        )
    }

    try:

        old = normalize_callsign(
            a.callsign
        )

        profile = require_member(
            old
        )

        transition = (
            profile["rank"],
            a.new_rank
        )

        if transition not in allowed:

            raise ValueError(
                "Rank transition is not allowed"
            )

        new = L.get_next_available_callsign(
            a.new_rank
        )

        validate_existing_target_callsign(
            new
        )

        perform_move_operation(
            old,
            new,
            a.new_rank,
            current_actor(),
            "CHANGE_RANK"
        )

        return {
            "ok": True,
            "new_callsign": new,
            "new_rank": a.new_rank
        }

    except Exception as e:

        raise HTTPException(
            status_code=400,
            detail=str(e)
        )


# ============================================================
# CHANGE CALLSIGN
# ============================================================

@app.post("/api/change-callsign")
def change_callsign(
    a: Action
):

    user = CURRENT_USER.get() or {}
    if not user.get("is_admin") and a.force:
        raise HTTPException(status_code=403, detail="Supervisors cannot change a member's rank.")

    try:

        old = normalize_callsign(
            a.callsign
        )

        profile = require_member(
            old
        )

        new_cs = normalize_callsign(
            a.new_callsign
        )

        if not new_cs:

            raise ValueError(
                "New callsign is required"
            )

        if old == new_cs:

            raise ValueError(
                "New callsign must be different from current callsign"
            )

        validate_existing_target_callsign(
            new_cs
        )

        expected_rank = (
            L.detect_rank_from_callsign(
                new_cs
            )
        )

        if not user.get("is_admin") and (
            not expected_rank or not L.callsign_matches_rank(new_cs, profile["rank"])
        ):
            raise HTTPException(
                status_code=403,
                detail="Supervisors may only change a callsign while keeping the member's current rank.",
            )

        if (
            expected_rank
            and expected_rank != profile["rank"]
            and not a.force
        ):

            raise HTTPException(status_code=409, detail={
                "code": "rank_mismatch",
                "expected": expected_rank,
                "actual": profile["rank"],
                "message": "The callsign belongs to a different rank.",
            })

        final_rank = (
            profile["rank"]
            if not user.get("is_admin")
            else expected_rank or profile["rank"]
        )

        perform_move_operation(
            old,
            new_cs,
            final_rank,
            current_actor(),
            "CALLSIGN_CHANGE"
        )

        return {
            "ok": True,
            "new_callsign": new_cs,
            "rank": final_rank
        }

    except HTTPException:
        raise
    except Exception as e:

        raise HTTPException(
            status_code=400,
            detail=str(e)
        )


# ============================================================
# TERMINATION HISTORY
# ============================================================

@app.get("/api/termination-log")
def termination_log():

    user = CURRENT_USER.get() or {}
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only Commanders can view termination history.")

    con = L.db()

    try:

        return [
            dict(x)

            for x in con.execute(
                """
                SELECT *
                FROM TerminationLog
                ORDER BY id DESC
                LIMIT 200
                """
            )
        ]

    finally:

        con.close()


# ============================================================
# PROMOTION HISTORY
# ============================================================

@app.get("/api/promotions")
def promotions():

    con = L.db()

    try:

        rows = [
            dict(x)

            for x in con.execute(
                """
                SELECT *
                FROM Promotions
                ORDER BY id DESC
                LIMIT 200
                """
            )
        ]

        return rows

    finally:

        con.close()


# ============================================================
# TRAINING HISTORY
# ============================================================

@app.get("/api/training-log")
def training_log():

    con = L.db()

    try:

        rows = [
            dict(x)

            for x in con.execute(
                """
                SELECT *
                FROM TrainingLog
                ORDER BY id DESC
                LIMIT 200
                """
            )
        ]

        return rows

    finally:

        con.close()


# ============================================================
# EXAM HISTORY
# ============================================================

@app.get("/api/exam-log")
def exam_log():

    con = L.db()

    try:

        rows = [
            dict(x)

            for x in con.execute(
                """
                SELECT *
                FROM ExamLog
                ORDER BY id DESC
                LIMIT 200
                """
            )
        ]

        return rows

    finally:

        con.close()


# ============================================================
# UNIFIED MEMBERS LOG
# ============================================================

@app.get("/api/members-log")
def members_log(
    log_type: str = "promotion"
):

    started_at = time.perf_counter()
    con = L.db()

    try:

        log_type = str(
            log_type or "promotion"
        ).strip().lower()

        if log_type == "instructor":
            _require_leaders_admin()

        def finish(rows):
            logger.info(
                f"[PERF] members-log type={log_type} rows={len(rows)} "
                f"elapsed={(time.perf_counter() - started_at) * 1000:.1f}ms"
            )
            return rows

        # ====================================================
        # PROMOTION / DEMOTION
        # ====================================================

        if log_type == "promotion":

            rows = [
                dict(x)

                for x in con.execute(
                    """
                    SELECT p.*, COALESCE(m.name, '') AS member_name
                    FROM Promotions p
                    LEFT JOIN Members m
                      ON m.callsign = CASE
                          WHEN TRIM(COALESCE(p.new_callsign, '')) != ''
                          THEN p.new_callsign ELSE p.callsign END
                    ORDER BY p.id DESC
                    LIMIT 200
                    """
                )
            ]

            return finish(rows)

        if log_type == "callsign":
            rows = [
                dict(x)
                for x in con.execute(
                    """SELECT p.*, COALESCE(m.name, '') AS member_name
                       FROM Promotions p
                       LEFT JOIN Members m
                         ON m.callsign = CASE
                             WHEN TRIM(COALESCE(p.new_callsign, '')) != ''
                             THEN p.new_callsign ELSE p.callsign END
                       WHERE operation_type='CALLSIGN_CHANGE'
                          OR (
                              LOWER(TRIM(COALESCE(old_rank, ''))) = LOWER(TRIM(COALESCE(new_rank, '')))
                              AND TRIM(COALESCE(old_rank, '')) != ''
                              AND TRIM(COALESCE(old_callsign, '')) != ''
                              AND TRIM(COALESCE(new_callsign, '')) != ''
                              AND UPPER(TRIM(old_callsign)) != UPPER(TRIM(new_callsign))
                          )
                       ORDER BY p.id DESC LIMIT 200"""
                )
            ]
            return finish(rows)

        # ====================================================
        # TERMINATION
        # ====================================================

        if log_type == "termination":

            rows = [
                dict(x)

                for x in con.execute(
                    """
                    SELECT *
                    FROM TerminationLog
                    ORDER BY id DESC
                    LIMIT 200
                    """
                )
            ]

            return finish(rows)

        # ====================================================
        # TRAINING
        # ====================================================

        if log_type == "training":

            rows = [
                dict(x)

                for x in con.execute(
                    """
                    SELECT *
                    FROM TrainingLog
                    ORDER BY id DESC
                    LIMIT 200
                    """
                )
            ]

            return finish(rows)

        # ====================================================
        # EXAM
        # ====================================================

        if log_type == "exam":

            rows = [
                dict(x)

                for x in con.execute(
                    """
                    SELECT *
                    FROM ExamLog
                    ORDER BY id DESC
                    LIMIT 200
                    """
                )
            ]

            return finish(rows)

        # ====================================================
        # NOTE
        # ====================================================

        if log_type == "note":

            rows = [
                dict(x)

                for x in con.execute(
                    """
                    SELECT *
                    FROM NoteLog
                    ORDER BY id DESC
                    LIMIT 200
                    """
                )
            ]

            return finish(rows)

        if log_type == "activity":
            rows = [
                dict(x)
                for x in con.execute(
                    """
                    SELECT * FROM ActivityStatusLog
                    ORDER BY id DESC
                    LIMIT 500
                    """
                )
            ]
            return finish(rows)

        if log_type == "instructor":
            rows = [dict(x) for x in con.execute(
                "SELECT * FROM InstructorLog ORDER BY id DESC LIMIT 500"
            )]
            return finish(rows)

        # ====================================================
        # INVALID TYPE
        # ====================================================

        raise HTTPException(
            status_code=400,
            detail=f"Invalid log type: {log_type}"
        )

    finally:

        con.close()
