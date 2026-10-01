#!/usr/bin/env python3
"""Convert private Google Sheets account exports into an idempotent D1 SQL import.

Usage:
  python scripts/accounts_csv_to_d1.py Accounts.csv accounts-import.sql \
      --audit Account-Audit.csv --sessions Auth-Sessions.csv

The generated file contains password salts/hashes and session token hashes.
Keep it private and remove it after the D1 import has been verified.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import re
from pathlib import Path


MARKER = "accounts-sheet-import-v1"


def normalized_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").strip().lower())


def sql_text(value: object) -> str:
    return "'" + str(value or "").replace("'", "''") + "'"


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if not reader.fieldnames:
            raise ValueError(f"{path} is missing a header row")
        headers = {normalized_header(name): name for name in reader.fieldnames}
        return list(headers), list(reader)


def value(row: dict[str, str], headers: dict[str, str], *aliases: str) -> str:
    for alias in aliases:
        column = headers.get(normalized_header(alias))
        if column is not None:
            return str(row.get(column) or "").strip()
    return ""


def headers_for(path: Path) -> tuple[dict[str, str], list[dict[str, str]]]:
    _, rows = read_csv(path)
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        names = next(csv.reader(source), [])
    return {normalized_header(name): name for name in names}, rows


def account_statements(path: Path) -> tuple[list[str], int]:
    headers, rows = headers_for(path)
    statements: list[str] = []
    count = 0
    for line, row in enumerate(rows, start=2):
        account_id = value(row, headers, "Account ID", "Account Id", "ID")
        if not account_id:
            continue
        name = value(row, headers, "Name", "Display Name")
        salt = value(row, headers, "Password Salt", "Salt")
        password_hash = value(row, headers, "Password Hash", "PasswordHash", "Hash")
        status = value(row, headers, "Status").lower() or "pending"
        role = value(row, headers, "Role").lower() or "member"
        if not name or not salt or not password_hash:
            raise ValueError(f"{path}:{line} is missing name, password salt, or password hash")
        if status not in {"pending", "approved", "deactivated", "denied", "removed"}:
            raise ValueError(f"{path}:{line} has unsupported status {status!r}")
        if role not in {"member", "leader", "admin", "commander"}:
            raise ValueError(f"{path}:{line} has unsupported role {role!r}")
        callsign = value(row, headers, "Callsign", "Call Sign").upper()
        created_at = value(row, headers, "Created At", "Requested At", "Linked At")
        activated_at = value(row, headers, "Activated At", "Approved At")
        approved_by = value(row, headers, "Approved By")
        admin_changed_at = value(row, headers, "Admin Changed At", "Role Changed At")
        admin_changed_by = value(row, headers, "Admin Changed By", "Role Changed By")
        hash_version = "gas-v3" if password_hash.startswith("v3$") else (
            "gas-v2" if password_hash.startswith("v2$") else "gas-legacy"
        )
        name_key = " ".join(name.split()).lower()
        now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        columns = (
            account_id, name, name_key, callsign, salt, password_hash, hash_version,
            status, role, created_at, activated_at, approved_by,
            admin_changed_at, admin_changed_by, now,
        )
        statements.append(
            "INSERT OR IGNORE INTO accounts "
            "(account_id,name,name_key,callsign,password_salt,password_hash,password_hash_version,"
            "status,role,created_at,activated_at,approved_by,admin_changed_at,admin_changed_by,updated_at) "
            f"SELECT {','.join(sql_text(item) for item in columns)} "
            f"WHERE NOT EXISTS (SELECT 1 FROM account_migration_state WHERE migration_key={sql_text(MARKER)});"
        )
        count += 1
    return statements, count


def audit_statements(path: Path | None) -> tuple[list[str], int]:
    if not path:
        return [], 0
    headers, rows = headers_for(path)
    statements: list[str] = []
    count = 0
    for source_row, row in enumerate(rows, start=2):
        created_at = value(row, headers, "Timestamp", "Created At", "Created At (UTC)")
        account_id = value(row, headers, "Account ID", "Account Id")
        action = value(row, headers, "Action", "Event")
        if not account_id or not action:
            continue
        columns = (
            created_at or dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            account_id, value(row, headers, "Name"), value(row, headers, "Callsign"),
            action, value(row, headers, "By", "Actor Name", "Performed By"),
        )
        statements.append(
            "INSERT OR IGNORE INTO account_audit (id,created_at,account_id,name,callsign,action,actor_name) "
            f"SELECT {source_row - 1},{','.join(sql_text(item) for item in columns)} "
            f"WHERE NOT EXISTS (SELECT 1 FROM account_migration_state WHERE migration_key={sql_text(MARKER)});"
        )
        count += 1
    return statements, count


def epoch_millis(value_text: str) -> int:
    parsed = dt.datetime.fromisoformat(value_text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return int(parsed.timestamp() * 1000)


def session_statements(path: Path | None) -> tuple[list[str], int]:
    if not path:
        return [], 0
    headers, rows = headers_for(path)
    statements: list[str] = []
    count = 0
    for line, row in enumerate(rows, start=2):
        token_hash = value(row, headers, "Token Hash", "Session Hash")
        account_id = value(row, headers, "Account ID", "Account Id")
        expires = value(row, headers, "Expires At", "Expiry", "Expiration")
        created = value(row, headers, "Created At")
        if not token_hash or not account_id:
            continue
        try:
            expires_ms = epoch_millis(expires)
            created_ms = epoch_millis(created)
        except (TypeError, ValueError) as error:
            raise ValueError(f"{path}:{line} has an invalid session date") from error
        if expires_ms <= int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000):
            continue
        columns = (token_hash, account_id, str(expires_ms), str(created_ms), "1")
        statements.append(
            "INSERT OR IGNORE INTO auth_sessions (token_hash,account_id,expires_at,created_at,remember_me) "
            f"SELECT {','.join(sql_text(item) for item in columns)} "
            f"WHERE NOT EXISTS (SELECT 1 FROM account_migration_state WHERE migration_key={sql_text(MARKER)}) "
            "AND EXISTS (SELECT 1 FROM accounts WHERE account_id=" + sql_text(account_id) + ");"
        )
        count += 1
    return statements, count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("accounts_csv", type=Path)
    parser.add_argument("output_sql", type=Path)
    parser.add_argument("--audit", type=Path)
    parser.add_argument("--sessions", type=Path)
    args = parser.parse_args()

    accounts, account_count = account_statements(args.accounts_csv)
    audit, audit_count = audit_statements(args.audit)
    sessions, session_count = session_statements(args.sessions)
    all_statements = [*accounts, *audit, *sessions]
    timestamp = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    all_statements.append(
        "INSERT OR IGNORE INTO account_migration_state (migration_key,value,updated_at) VALUES "
        f"({sql_text(MARKER)},{sql_text(str(account_count))},{sql_text(timestamp)});"
    )
    args.output_sql.write_text("\n".join(all_statements) + "\n", encoding="utf-8")
    print(f"Wrote {args.output_sql}: {account_count} accounts, {audit_count} audit rows, {session_count} sessions.")
    print("The SQL contains password hashes and session hashes. Keep it private and delete it after import.")


if __name__ == "__main__":
    main()
