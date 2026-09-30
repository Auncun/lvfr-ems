
import os
import sqlite3
import datetime
import logging
import threading
import unicodedata

from dotenv import load_dotenv
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

logger = logging.getLogger("lvfr_ems.backend")


# ============================================================
# ENVIRONMENT
# ============================================================

load_dotenv(os.path.join(os.path.dirname(__file__), "env"))

DB_NAME = os.getenv(
    "DB_NAME",
    "fire_department.db"
)

GOOGLE_CREDENTIALS = os.getenv(
    "GOOGLE_CREDENTIALS",
    "lvfr-ems-bot.json"
)

GOOGLE_SHEET_ID = os.getenv("GOOGLE_SHEET_ID", "").strip()

GOOGLE_SHEET_ID2 = os.getenv("GOOGLE_SHEET_ID2", "").strip()

GOOGLE_SHEET_NAME = "Ranks🎖️"
HERT_SHEET_NAME = "HERT Certified"

SHEET_IDS_CACHE = {}
ARCHIVE_SHEET_IDS_CACHE = {}
ARCHIVE_TABS_READY = False
_GOOGLE_SERVICE_LOCAL = threading.local()
ARCHIVE_HEADERS = {
    "Logs": [
        "Timestamp", "Event", "Member", "Callsign", "Old Callsign",
        "New Callsign", "Old Rank", "New Rank", "Details",
        "Performed By", "Actor Callsign"
    ],
    "Leaders": [
        "Snapshot At", "Discord User ID", "Username", "Display Name",
        "Status", "Role", "Linked At", "Requested At", "Approved At",
        "Approved By", "Commander Changed At", "Commander Changed By", "Archive Event"
    ],
    "Accounts": [
        "Account ID", "Name", "Callsign", "Password Salt", "Password Hash",
        "Status", "Role", "Created At", "Activated At", "Approved By",
        "Commander Changed At", "Commander Changed By"
    ],
    "Account Audit": ["Timestamp", "Account ID", "Name", "Callsign", "Action", "By"]
}
ARCHIVE_COLUMN_WIDTHS = {
    "Logs": [175, 155, 190, 100, 120, 120, 175, 175, 320, 220, 175],
    "Leaders": [175, 175, 190, 200, 110, 100, 175, 175, 175, 220, 175, 220, 180],
    "Accounts": [210, 220, 175, 260, 360, 110, 100, 175, 175, 220, 175, 220],
    "Account Audit": [175, 210, 220, 175, 180, 220]
}


# ============================================================
# RANKS
# ============================================================

RANK_PREFIXES = {
    "Commissioners": "COM",
    "Chief": "CHIEF",
    "County Command": "B",
    "Division Commander": "DIV",
    "Captain": "C",
    "Lieutenant": "E",
    "Lead Paramedic": "L",
    "Paramedic": "M",
    "AEMT": "A",
    "Advanced EMT": "A",
    "EMT": "R",
    "Probationary": "P",
    "Senior Volunteer": "S",
    "Volunteer": "V",
    "Probationary Volunteer": "V",
    "EMR": "P",
    "EMR/Volunteer": "P",
}


RANK_ORDER = {
    "Commissioners": 1,
    "Chief": 2,
    "County Command": 3,
    "Division Commander": 4,
    "Captain": 5,
    "Lieutenant": 6,
    "Lead Paramedic": 7,
    "Paramedic": 8,
    "AEMT": 9,
    "Advanced EMT": 9,
    "EMT": 10,
    "Probationary": 11,
    "Senior Volunteer": 12,
    "Volunteer": 13,
    "Probationary Volunteer": 14,
    "EMR": 15,
    "EMR/Volunteer": 16,
}


RANK_CHOICES = [
    "Commissioners",
    "Chief",
    "County Command",
    "Division Commander",
    "Captain",
    "Lieutenant",
    "Lead Paramedic",
    "Paramedic",
    "AEMT",
    "EMT",
    "Probationary",
    "Senior Volunteer",
    "Volunteer",
    "Probationary Volunteer",
    "EMR",
    "EMR/Volunteer",
]


# ============================================================
# PROMOTION REQUIREMENTS
# ============================================================

RANK_REQUIREMENTS = {
    "EMT": {
        "days": 7,
        "trainings": [],
        "exams": [],
        "from": [
            "EMR",
            "Probationary",
        ],
    },

    "AEMT": {
        "days": 14,
        "trainings": [
            "basic_firefighting",
        ],
        "exams": [],
        "from": [
            "EMT",
        ],
    },

    "Paramedic": {
        "days": 21,
        "trainings": [
            "basic_firefighting",
            "advanced_firefighting",
        ],
        "exams": [
            "supervisor_exam",
        ],
        "from": [
            "AEMT",
            "Advanced EMT",
        ],
    },

    "Volunteer": {
        "days": 7,
        "trainings": [],
        "exams": [],
        "from": [
            "EMR/Volunteer",
            "Probationary Volunteer",
        ],
    },

    "Senior Volunteer": {
        "days": 14,
        "trainings": [],
        "exams": [],
        "from": [
            "Volunteer",
        ],
    },
}


# ============================================================
# GOOGLE SHEET SECTION HEADERS
# ============================================================

RANK_MAP = {
    "commissioners": "Commissioners",
    "commissioner": "Commissioners",
    "chief": "Chief",
    "county command": "County Command",
    "commander": "Division Commander",
    "division commander": "Division Commander",
    "captain": "Captain",
    "lieutenant": "Lieutenant",
    "lead paramedic": "Lead Paramedic",
    "paramedic": "Paramedic",
    "advanced emt": "AEMT",
    "aemt": "AEMT",
    "emt": "EMT",
    "probationary": "Probationary",
    "senior volunteer": "Senior Volunteer",
    "volunteer": "Volunteer",
    "probationary volunteer": "Probationary Volunteer",
    "emr": "EMR",
    "emr/volunteer": "EMR/Volunteer",
}


# ============================================================
# SPECIAL CALLSIGN GROUPS
# ============================================================

PROBATIONARY_VOLUNTEER_NUMBERS = {
    1, 2, 3, 4, 5, 6, 7, 8, 9,
    14,
    21, 22, 23, 24, 25,
    26, 27, 28, 29,
    36, 37, 38, 39, 40,
}


# ============================================================
# DATABASE
# ============================================================

def db():
    con = sqlite3.connect(DB_NAME, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA busy_timeout = 30000")

    return con


def init_db():
    con = db()
    con.execute("PRAGMA journal_mode = WAL")

    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS Members(
            discord_id INTEGER,
            name TEXT NOT NULL,
            callsign TEXT PRIMARY KEY,
            rank TEXT NOT NULL,
            rank_assigned_date DATE NOT NULL,
            days_in_rank INTEGER DEFAULT 0,
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS Trainings(
            callsign TEXT,
            training_name TEXT,
            PRIMARY KEY(callsign, training_name),
            FOREIGN KEY(callsign)
                REFERENCES Members(callsign)
                ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS Exams(
            callsign TEXT,
            exam_name TEXT,
            PRIMARY KEY(callsign, exam_name),
            FOREIGN KEY(callsign)
                REFERENCES Members(callsign)
                ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS Promotions(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            callsign TEXT,
            old_rank TEXT,
            new_rank TEXT,
            old_callsign TEXT,
            new_callsign TEXT,
            promoted_by TEXT,
            promo_date DATE,
            operation_type TEXT NOT NULL DEFAULT 'RANK_CHANGE'
        );

        CREATE TABLE IF NOT EXISTS TrainingLog(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            callsign TEXT,
            member_name TEXT,
            training_name TEXT,
            action TEXT NOT NULL,
            changed_by TEXT,
            log_date TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ExamLog(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            callsign TEXT,
            member_name TEXT,
            exam_name TEXT,
            action TEXT NOT NULL,
            changed_by TEXT,
            log_date TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS TerminationLog(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            callsign TEXT,
            member_name TEXT,
            rank TEXT,
            terminated_by TEXT,
            reason TEXT,
            termination_date TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS NoteLog(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            callsign TEXT,
            member_name TEXT,
            action TEXT NOT NULL,
            note TEXT,
            changed_by TEXT,
            log_date TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS SheetCache(
            callsign TEXT PRIMARY KEY,
            activity TEXT NOT NULL DEFAULT 'Active',
            sheet_row INTEGER
        );

        CREATE TABLE IF NOT EXISTS HERTCache(
            member_name TEXT PRIMARY KEY,
            certified INTEGER NOT NULL DEFAULT 0,
            synced_at TEXT
        );

        CREATE TABLE IF NOT EXISTS SyncState(
            id INTEGER PRIMARY KEY CHECK (id=1),
            synced_at TEXT
        );

        CREATE TABLE IF NOT EXISTS AdminActionLog(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_user_id TEXT NOT NULL,
            actor_name TEXT NOT NULL,
            action TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ActivityStatusLog(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            callsign TEXT NOT NULL,
            member_name TEXT NOT NULL,
            old_status TEXT NOT NULL,
            new_status TEXT NOT NULL,
            discord_user_id TEXT NOT NULL,
            changed_by TEXT NOT NULL,
            changed_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS InstructorLog(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            callsign TEXT NOT NULL,
            member_name TEXT NOT NULL,
            instructor_type TEXT NOT NULL,
            action TEXT NOT NULL,
            changed_by TEXT NOT NULL,
            log_date TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS DiscordLeaders(
            discord_user_id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            display_name TEXT NOT NULL,
            linked_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'approved',
            requested_at TEXT,
            approved_at TEXT,
            is_admin INTEGER NOT NULL DEFAULT 0,
            approved_by TEXT,
            admin_changed_at TEXT,
            admin_changed_by TEXT
        );

        CREATE TABLE IF NOT EXISTS DiscordLeaderAuditLog(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_user_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            action TEXT NOT NULL,
            actor_discord_user_id TEXT NOT NULL,
            actor_name TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS BackgroundJobs(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_ref TEXT NOT NULL,
            args_json TEXT NOT NULL,
            archive INTEGER NOT NULL DEFAULT 0,
            account_id TEXT NOT NULL DEFAULT '',
            callsign TEXT NOT NULL DEFAULT '',
            failure_message TEXT NOT NULL DEFAULT '',
            archive_after_ref TEXT,
            archive_after_args_json TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS Notifications(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            notification_key TEXT NOT NULL UNIQUE,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            callsign TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS NotificationReads(
            account_id TEXT NOT NULL,
            notification_id INTEGER NOT NULL,
            read_at TEXT NOT NULL,
            PRIMARY KEY(account_id, notification_id),
            FOREIGN KEY(notification_id) REFERENCES Notifications(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS EligibilityNotificationState(
            callsign TEXT PRIMARY KEY,
            next_rank TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS NotificationMeta(
            meta_key TEXT PRIMARY KEY,
            meta_value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS WatchCommandLogs(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            draft_id TEXT UNIQUE,
            finalized INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            watch_date TEXT NOT NULL,
            watch_commander TEXT NOT NULL,
            roll_call TEXT NOT NULL DEFAULT '',
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            red_sector TEXT NOT NULL DEFAULT '',
            green_sector TEXT NOT NULL DEFAULT '',
            blue_sector TEXT NOT NULL DEFAULT '',
            specialised_units TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            significant_call TEXT NOT NULL DEFAULT '',
            coverage_gaps TEXT NOT NULL DEFAULT '',
            watch_transition TEXT NOT NULL DEFAULT '',
            safety_concerns TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL DEFAULT ''
        );
        """
    )

    watch_log_columns = {
        row["name"] for row in con.execute("PRAGMA table_info(WatchCommandLogs)")
    }
    if "draft_id" not in watch_log_columns:
        con.execute("ALTER TABLE WatchCommandLogs ADD COLUMN draft_id TEXT")
        con.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_logs_draft_id ON WatchCommandLogs(draft_id)")
    if "finalized" not in watch_log_columns:
        con.execute("ALTER TABLE WatchCommandLogs ADD COLUMN finalized INTEGER NOT NULL DEFAULT 1")

    leader_columns = {
        row["name"] for row in con.execute("PRAGMA table_info(DiscordLeaders)")
    }
    if "status" not in leader_columns:
        con.execute(
            "ALTER TABLE DiscordLeaders ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'"
        )
    if "requested_at" not in leader_columns:
        con.execute("ALTER TABLE DiscordLeaders ADD COLUMN requested_at TEXT")
    if "approved_at" not in leader_columns:
        con.execute("ALTER TABLE DiscordLeaders ADD COLUMN approved_at TEXT")
    if "is_admin" not in leader_columns:
        con.execute("ALTER TABLE DiscordLeaders ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
    if "approved_by" not in leader_columns:
        con.execute("ALTER TABLE DiscordLeaders ADD COLUMN approved_by TEXT")
    if "admin_changed_at" not in leader_columns:
        con.execute("ALTER TABLE DiscordLeaders ADD COLUMN admin_changed_at TEXT")
    if "admin_changed_by" not in leader_columns:
        con.execute("ALTER TABLE DiscordLeaders ADD COLUMN admin_changed_by TEXT")

    promotion_columns = {
        row["name"] for row in con.execute("PRAGMA table_info(Promotions)")
    }
    if "operation_type" not in promotion_columns:
        con.execute(
            "ALTER TABLE Promotions ADD COLUMN operation_type TEXT NOT NULL DEFAULT 'RANK_CHANGE'"
        )
    con.execute(
        """
        UPDATE DiscordLeaders
        SET approved_at=linked_at
        WHERE status='approved' AND approved_at IS NULL
        """
    )

    con.commit()
    con.close()


def log_admin_action(discord_user_id, actor_name, action, endpoint):
    con = db()
    try:
        con.execute(
            """
            INSERT INTO AdminActionLog(
                discord_user_id, actor_name, action, endpoint, created_at
            ) VALUES(?,?,?,?,?)
            """,
            (
                str(discord_user_id),
                actor_name,
                action,
                endpoint,
                datetime.datetime.now().isoformat(timespec="seconds")
            )
        )
        con.commit()
    finally:
        con.close()


def record_discord_login(discord_user_id, username, display_name, is_admin=False):
    """Record a first link or refresh a single pending/approved directory entry."""
    discord_user_id = str(discord_user_id)
    username = str(username)
    display_name = str(display_name or username)
    now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    con = db()
    try:
        row = con.execute(
            "SELECT status, linked_at, approved_at FROM DiscordLeaders WHERE discord_user_id=?",
            (discord_user_id,)
        ).fetchone()

        if not row:
            status = "approved" if is_admin else "pending"
            con.execute(
                """
                INSERT INTO DiscordLeaders(
                    discord_user_id, username, display_name, linked_at,
                    status, requested_at, approved_at, is_admin
                ) VALUES(?,?,?,?,?,?,?,?)
                """,
                (
                    discord_user_id, username, display_name, now, status,
                    None if is_admin else now, now if is_admin else None,
                    1 if is_admin else 0
                )
            )
        elif is_admin:
            con.execute(
                """
                UPDATE DiscordLeaders
                SET username=?, display_name=?,
                    linked_at=CASE WHEN linked_at='' THEN ? ELSE linked_at END,
                    status='approved', approved_at=COALESCE(approved_at, ?),
                    is_admin=1
                WHERE discord_user_id=?
                """,
                (username, display_name, now, now, discord_user_id)
            )
        elif row["status"] == "denied":
            # A denied user has to authenticate again to create a fresh request.
            con.execute(
                """
                UPDATE DiscordLeaders
                SET username=?, display_name=?,
                    linked_at=CASE WHEN linked_at='' THEN ? ELSE linked_at END,
                    status='pending', requested_at=?, approved_at=NULL
                WHERE discord_user_id=?
                """,
                (username, display_name, now, now, discord_user_id)
            )
        else:
            con.execute(
                """
                UPDATE DiscordLeaders
                SET username=?, display_name=?,
                    linked_at=CASE WHEN linked_at='' THEN ? ELSE linked_at END
                WHERE discord_user_id=?
                """,
                (username, display_name, now, discord_user_id)
            )
        con.commit()
        return "approved" if is_admin else ("pending" if not row or row["status"] in {"pending", "denied"} else row["status"])
    finally:
        con.close()


def update_discord_leader_profile(discord_user_id, username, display_name, linked_at=None):
    con = db()
    try:
        con.execute(
            """
            UPDATE DiscordLeaders
            SET username=?, display_name=?,
                linked_at=CASE WHEN linked_at='' AND ? IS NOT NULL THEN ? ELSE linked_at END
            WHERE discord_user_id=?
            """,
            (
                str(username), str(display_name or username), linked_at,
                linked_at, str(discord_user_id)
            )
        )
        con.commit()
    finally:
        con.close()


def is_discord_leader_approved(discord_user_id):
    con = db()
    try:
        row = con.execute(
            "SELECT status FROM DiscordLeaders WHERE discord_user_id=?",
            (str(discord_user_id),)
        ).fetchone()
        return bool(row and row["status"] == "approved")
    finally:
        con.close()


def is_discord_leader_admin(discord_user_id):
    con = db()
    try:
        row = con.execute(
            "SELECT is_admin FROM DiscordLeaders WHERE discord_user_id=? AND status='approved'",
            (str(discord_user_id),)
        ).fetchone()
        return bool(row and row["is_admin"])
    finally:
        con.close()


def get_discord_leaders():
    con = db()
    try:
        rows = [dict(row) for row in con.execute(
            """
            SELECT discord_user_id, username, display_name, linked_at,
                   requested_at, approved_at, status, is_admin,
                   approved_by, admin_changed_at, admin_changed_by
            FROM DiscordLeaders
            WHERE status IN ('approved', 'pending')
            ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,
                     COALESCE(requested_at, approved_at, linked_at) DESC
            """
        )]
        return {
            "approved": [row for row in rows if row["status"] == "approved"],
            "pending": [row for row in rows if row["status"] == "pending"]
        }
    finally:
        con.close()


def add_approved_discord_leader(discord_user_id, approved_by=""):
    now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    con = db()
    try:
        existed = con.execute(
            "SELECT 1 FROM DiscordLeaders WHERE discord_user_id=?",
            (str(discord_user_id),)
        ).fetchone() is not None
        con.execute(
            """
            INSERT INTO DiscordLeaders(
                discord_user_id, username, display_name, linked_at,
                status, requested_at, approved_at, approved_by
            ) VALUES(?, 'Not linked yet', 'Not linked yet', '', 'approved', NULL, ?, ?)
            ON CONFLICT(discord_user_id) DO UPDATE SET
                status='approved',
                approved_at=COALESCE(DiscordLeaders.approved_at, excluded.approved_at),
                approved_by=COALESCE(DiscordLeaders.approved_by, excluded.approved_by),
                username=CASE WHEN DiscordLeaders.username='' THEN excluded.username ELSE DiscordLeaders.username END,
                display_name=CASE WHEN DiscordLeaders.display_name='' THEN excluded.display_name ELSE DiscordLeaders.display_name END
            """,
            (str(discord_user_id), now, str(approved_by))
        )
        con.commit()
        return not existed
    finally:
        con.close()


def approve_discord_leader(discord_user_id, approved_by=""):
    now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    con = db()
    try:
        cursor = con.execute(
            """
            UPDATE DiscordLeaders
            SET status='approved', approved_at=?, approved_by=?,
                username=CASE WHEN username='' THEN 'Not linked yet' ELSE username END,
                display_name=CASE WHEN display_name='' THEN 'Not linked yet' ELSE display_name END
            WHERE discord_user_id=? AND status='pending'
            """,
            (now, str(approved_by), str(discord_user_id))
        )
        con.commit()
        return cursor.rowcount > 0
    finally:
        con.close()


def set_discord_leader_admin(discord_user_id, is_admin, changed_by=""):
    now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    con = db()
    try:
        cursor = con.execute(
            """UPDATE DiscordLeaders
               SET is_admin=?, admin_changed_at=?, admin_changed_by=?
               WHERE discord_user_id=? AND status='approved'""",
            (1 if is_admin else 0, now, str(changed_by), str(discord_user_id))
        )
        con.commit()
        return cursor.rowcount > 0
    finally:
        con.close()


def log_discord_leader_event(discord_user_id, action, actor_discord_user_id, actor_name, display_name=None):
    con = db()
    try:
        if display_name is None:
            row = con.execute(
                "SELECT display_name FROM DiscordLeaders WHERE discord_user_id=?",
                (str(discord_user_id),)
            ).fetchone()
            display_name = row["display_name"] if row else str(discord_user_id)
        con.execute(
            """INSERT INTO DiscordLeaderAuditLog(
                   discord_user_id, display_name, action,
                   actor_discord_user_id, actor_name, created_at
               ) VALUES(?,?,?,?,?,?)""",
            (
                str(discord_user_id), str(display_name), str(action),
                str(actor_discord_user_id), str(actor_name),
                datetime.datetime.now().astimezone().isoformat(timespec="seconds")
            )
        )
        con.commit()
    finally:
        con.close()


def get_discord_leader_audit(limit=200):
    con = db()
    try:
        return [dict(row) for row in con.execute(
            """SELECT discord_user_id, display_name, action,
                      actor_discord_user_id, actor_name, created_at
               FROM DiscordLeaderAuditLog ORDER BY id DESC LIMIT ?""",
            (max(1, min(int(limit), 500)),)
        )]
    finally:
        con.close()


def deny_discord_leader(discord_user_id):
    con = db()
    try:
        cursor = con.execute(
            "UPDATE DiscordLeaders SET status='denied' WHERE discord_user_id=? AND status='pending'",
            (str(discord_user_id),)
        )
        con.commit()
        return cursor.rowcount > 0
    finally:
        con.close()


def remove_approved_discord_leader(discord_user_id):
    con = db()
    try:
        cursor = con.execute(
            "DELETE FROM DiscordLeaders WHERE discord_user_id=? AND status='approved'",
            (str(discord_user_id),)
        )
        con.commit()
        return cursor.rowcount > 0
    finally:
        con.close()


# ============================================================
# GOOGLE SHEETS CONNECTION
# ============================================================

def get_google_sheets_service():
    service = getattr(_GOOGLE_SERVICE_LOCAL, "service", None)
    if service is not None:
        return service

    scopes = [
        "https://www.googleapis.com/auth/spreadsheets"
    ]

    creds = Credentials.from_service_account_file(
        GOOGLE_CREDENTIALS,
        scopes=scopes
    )

    service = build(
        "sheets",
        "v4",
        credentials=creds,
        cache_discovery=False,
    )
    _GOOGLE_SERVICE_LOCAL.service = service
    return service


def validate_configuration():
    if not GOOGLE_SHEET_ID:
        raise RuntimeError("GOOGLE_SHEET_ID must be set in the local env file")


def _ensure_archive_tabs(service):
    global ARCHIVE_TABS_READY
    if not GOOGLE_SHEET_ID2:
        return {}

    if ARCHIVE_TABS_READY and all(title in ARCHIVE_SHEET_IDS_CACHE for title in ARCHIVE_HEADERS):
        return ARCHIVE_SHEET_IDS_CACHE

    if all(title in ARCHIVE_SHEET_IDS_CACHE for title in ARCHIVE_HEADERS):
        return ARCHIVE_SHEET_IDS_CACHE

    metadata = service.spreadsheets().get(
        spreadsheetId=GOOGLE_SHEET_ID2,
        fields="sheets(properties(sheetId,title,gridProperties(rowCount)),basicFilter,bandedRanges(bandedRangeId))"
    ).execute()
    sheet_metadata = {
        sheet["properties"]["title"]: sheet
        for sheet in metadata.get("sheets", [])
    }
    existing = {
        title: sheet["properties"]["sheetId"]
        for title, sheet in sheet_metadata.items()
    }
    missing = [title for title in ARCHIVE_HEADERS if title not in existing]
    if missing:
        service.spreadsheets().batchUpdate(
            spreadsheetId=GOOGLE_SHEET_ID2,
            body={
                "requests": [
                    {"addSheet": {"properties": {"title": title}}}
                    for title in missing
                ]
            }
        ).execute()
        metadata = service.spreadsheets().get(
            spreadsheetId=GOOGLE_SHEET_ID2,
            fields="sheets(properties(sheetId,title,gridProperties(rowCount)),basicFilter,bandedRanges(bandedRangeId))"
        ).execute()
        sheet_metadata = {
            sheet["properties"]["title"]: sheet
            for sheet in metadata.get("sheets", [])
        }
        existing = {
            title: sheet["properties"]["sheetId"]
            for title, sheet in sheet_metadata.items()
        }

    header_ranges = [
        f"'{title}'!A1:{chr(64 + len(headers))}1"
        for title, headers in ARCHIVE_HEADERS.items()
    ]
    header_response = service.spreadsheets().values().batchGet(
        spreadsheetId=GOOGLE_SHEET_ID2,
        ranges=header_ranges,
    ).execute().get("valueRanges", [])
    old_headers_by_title = {}
    for (title, _), value_range in zip(ARCHIVE_HEADERS.items(), header_response):
        rows = value_range.get("values", [])
        old_headers_by_title[title] = rows[0] if rows else []

    requests = []
    for title, headers in ARCHIVE_HEADERS.items():
        old_headers = old_headers_by_title.get(title, [])
        if title == "Accounts" and len(old_headers) > 2 and old_headers[2] == "Discord ID":
            legacy_accounts = service.spreadsheets().values().get(
                spreadsheetId=GOOGLE_SHEET_ID2, range="'Accounts'!A2:B"
            ).execute().get("values", [])
            con = db()
            try:
                members = con.execute("SELECT callsign, name FROM Members").fetchall()
            finally:
                con.close()
            by_name = {}
            for member in members:
                key = " ".join(str(member["name"] or "").split()).casefold()
                if key:
                    by_name.setdefault(key, []).append(str(member["callsign"] or "").strip().upper())
            linked_callsigns = []
            for account in legacy_accounts:
                key = " ".join(str(account[1] if len(account) > 1 else "").split()).casefold()
                matches = by_name.get(key, [])
                linked_callsigns.append([matches[0] if len(matches) == 1 else ""])
            if linked_callsigns:
                requests.append({
                    "updateCells": {
                        "range": {
                            "sheetId": existing["Accounts"],
                            "startRowIndex": 1,
                            "endRowIndex": 1 + len(linked_callsigns),
                            "startColumnIndex": 2,
                            "endColumnIndex": 3,
                        },
                        "rows": [{"values": [{"userEnteredValue": {"stringValue": str(row[0])}}]} for row in linked_callsigns],
                        "fields": "userEnteredValue",
                    }
                })
        if title == "Account Audit" and len(old_headers) > 3 and old_headers[3] == "Discord ID":
            requests.append({
                "repeatCell": {
                    "range": {"sheetId": existing[title], "startRowIndex": 1,
                              "endRowIndex": int(sheet_metadata[title].get("properties", {}).get("gridProperties", {}).get("rowCount", 1000)),
                              "startColumnIndex": 3, "endColumnIndex": 4},
                    "cell": {}, "fields": "userEnteredValue",
                }
            })
        if title == "Logs" and len(old_headers) > 10 and old_headers[10] == "Discord User ID":
            requests.append({
                "repeatCell": {
                    "range": {"sheetId": existing[title], "startRowIndex": 1,
                              "endRowIndex": int(sheet_metadata[title].get("properties", {}).get("gridProperties", {}).get("rowCount", 1000)),
                              "startColumnIndex": 10, "endColumnIndex": 11},
                    "cell": {}, "fields": "userEnteredValue",
                }
            })
        if old_headers != headers:
            requests.append({
                "updateCells": {
                    "range": {"sheetId": existing[title], "startRowIndex": 0,
                              "endRowIndex": 1, "startColumnIndex": 0,
                              "endColumnIndex": len(headers)},
                    "rows": [{"values": [
                        {"userEnteredValue": {"stringValue": str(header)}} for header in headers
                    ]}],
                    "fields": "userEnteredValue",
                }
            })

        sheet_id = existing[title]
        column_count = len(headers)
        requests.extend([
            {
                "updateSheetProperties": {
                    "properties": {
                        "sheetId": sheet_id,
                        "gridProperties": {"frozenRowCount": 1}
                    },
                    "fields": "gridProperties.frozenRowCount"
                }
            },
            {
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 0,
                        "endRowIndex": 1,
                        "startColumnIndex": 0,
                        "endColumnIndex": column_count
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "backgroundColor": {"red": 0.10, "green": 0.20, "blue": 0.34},
                            "textFormat": {
                                "foregroundColor": {"red": 1, "green": 1, "blue": 1},
                                "bold": True,
                                "fontSize": 10
                            },
                            "horizontalAlignment": "CENTER",
                            "verticalAlignment": "MIDDLE",
                            "wrapStrategy": "WRAP"
                        }
                    },
                    "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)"
                }
            },
            {
                "updateDimensionProperties": {
                    "range": {
                        "sheetId": sheet_id,
                        "dimension": "ROWS",
                        "startIndex": 0,
                        "endIndex": 1
                    },
                    "properties": {"pixelSize": 38},
                    "fields": "pixelSize"
                }
            },
            {
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 1,
                        "startColumnIndex": 0,
                        "endColumnIndex": column_count
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "verticalAlignment": "TOP",
                            "wrapStrategy": "CLIP"
                        }
                    },
                    "fields": "userEnteredFormat(verticalAlignment,wrapStrategy)"
                }
            }
        ])

        for index, width in enumerate(ARCHIVE_COLUMN_WIDTHS[title]):
            requests.append({
                "updateDimensionProperties": {
                    "range": {
                        "sheetId": sheet_id,
                        "dimension": "COLUMNS",
                        "startIndex": index,
                        "endIndex": index + 1
                    },
                    "properties": {"pixelSize": width},
                    "fields": "pixelSize"
                }
            })

        sheet_info = sheet_metadata.get(title, {})
        if not sheet_info.get("basicFilter"):
            requests.append({
                "setBasicFilter": {
                    "filter": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": 0,
                            "startColumnIndex": 0,
                            "endColumnIndex": column_count
                        }
                    }
                }
            })
        if not sheet_info.get("bandedRanges"):
            requests.append({
                "addBanding": {
                    "bandedRange": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": 0,
                            "startColumnIndex": 0,
                            "endColumnIndex": column_count
                        },
                        "rowProperties": {
                            "headerColor": {"red": 0.10, "green": 0.20, "blue": 0.34},
                            "firstBandColor": {"red": 1, "green": 1, "blue": 1},
                            "secondBandColor": {"red": 0.91, "green": 0.94, "blue": 0.97}
                        }
                    }
                }
            })

    if requests:
        service.spreadsheets().batchUpdate(
            spreadsheetId=GOOGLE_SHEET_ID2,
            body={"requests": requests}
        ).execute()

    ARCHIVE_SHEET_IDS_CACHE.update(existing)
    ARCHIVE_TABS_READY = True
    return existing


def get_account_records():
    """Read the account registry stored in the private Sheet 2 Accounts tab."""
    if not GOOGLE_SHEET_ID2:
        raise RuntimeError("GOOGLE_SHEET_ID2 is required for account storage")
    service = get_google_sheets_service()
    _ensure_archive_tabs(service)
    return _account_records_with_service(service)


def _account_records_with_service(service):
    rows = service.spreadsheets().values().get(
        spreadsheetId=GOOGLE_SHEET_ID2,
        range="'Accounts'!A2:L"
    ).execute().get("values", [])
    keys = [
        "account_id", "name", "callsign", "password_salt", "password_hash",
        "status", "role", "created_at", "activated_at", "approved_by",
        "admin_changed_at", "admin_changed_by"
    ]
    return [
        {**dict(zip(keys, list(row) + [""] * (len(keys) - len(row)))), "sheet_row": index + 2}
        for index, row in enumerate(rows)
        if row and row[0]
    ]


def _account_audit_name(name, callsign):
    callsign = str(callsign or "").strip().upper()
    if not callsign:
        return str(name or "")
    con = db()
    try:
        member = con.execute(
            "SELECT name FROM Members WHERE UPPER(TRIM(callsign))=? LIMIT 1", (callsign,)
        ).fetchone()
        return str(member["name"] or "").strip() if member and str(member["name"] or "").strip() else str(name or "")
    finally:
        con.close()


def append_account_record(record):
    if not GOOGLE_SHEET_ID2:
        raise RuntimeError("GOOGLE_SHEET_ID2 is required for account storage")
    service = get_google_sheets_service()
    _ensure_archive_tabs(service)
    values = [[
        str(record.get(key) or "") for key in (
            "account_id", "name", "callsign", "password_salt", "password_hash",
            "status", "role", "created_at", "activated_at", "approved_by",
            "admin_changed_at", "admin_changed_by"
        )
    ]]
    service.spreadsheets().values().append(
        spreadsheetId=GOOGLE_SHEET_ID2,
        range="'Accounts'!A:L",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": values}
    ).execute()
    return True


def append_account_record_and_audit(record, performed_by):
    """Write a new account and its audit entry in one Sheets API request."""
    if not GOOGLE_SHEET_ID2:
        raise RuntimeError("GOOGLE_SHEET_ID2 is required for account storage")
    service = get_google_sheets_service()
    sheet_ids = _ensure_archive_tabs(service)
    account_keys = (
        "account_id", "name", "callsign", "password_salt", "password_hash",
        "status", "role", "created_at", "activated_at", "approved_by",
        "admin_changed_at", "admin_changed_by"
    )
    account_values = [str(record.get(key) or "") for key in account_keys]
    audit_values = [
        datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        str(record.get("account_id") or ""),
        _account_audit_name(record.get("name"), record.get("callsign")),
        str(record.get("callsign") or ""), "Signup request", str(performed_by or "")
    ]
    def append_cells(sheet_id, values):
        return {"appendCells": {
            "sheetId": sheet_id,
            "rows": [{"values": [{"userEnteredValue": {"stringValue": value}} for value in values]}],
            "fields": "userEnteredValue"
        }}
    service.spreadsheets().batchUpdate(
        spreadsheetId=GOOGLE_SHEET_ID2,
        body={"requests": [
            append_cells(sheet_ids["Accounts"], account_values),
            append_cells(sheet_ids["Account Audit"], audit_values),
        ]}
    ).execute()
    return True


def update_account_record(account_id, record):
    if not GOOGLE_SHEET_ID2:
        raise RuntimeError("GOOGLE_SHEET_ID2 is required for account storage")
    service = get_google_sheets_service()
    _ensure_archive_tabs(service)
    accounts = _account_records_with_service(service)
    current = next((row for row in accounts if row["account_id"] == str(account_id)), None)
    if not current:
        return False
    values = [[
        str(record.get(key) or "") for key in (
            "account_id", "name", "callsign", "password_salt", "password_hash",
            "status", "role", "created_at", "activated_at", "approved_by",
            "admin_changed_at", "admin_changed_by"
        )
    ]]
    service.spreadsheets().values().update(
        spreadsheetId=GOOGLE_SHEET_ID2,
        range=f"'Accounts'!A{current['sheet_row']}:L{current['sheet_row']}",
        valueInputOption="RAW",
        body={"values": values}
    ).execute()
    return True


def update_account_record_and_audit(account_id, record, action, performed_by):
    """Update an account and append its audit entry atomically in Sheets."""
    if not GOOGLE_SHEET_ID2:
        raise RuntimeError("GOOGLE_SHEET_ID2 is required for account storage")
    service = get_google_sheets_service()
    sheet_ids = _ensure_archive_tabs(service)
    current = next((row for row in _account_records_with_service(service) if row["account_id"] == str(account_id)), None)
    if not current:
        return False
    keys = (
        "account_id", "name", "callsign", "password_salt", "password_hash",
        "status", "role", "created_at", "activated_at", "approved_by",
        "admin_changed_at", "admin_changed_by",
    )
    account_values = [{"userEnteredValue": {"stringValue": str(record.get(key) or "")}} for key in keys]
    audit_values = [
        datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        str(record.get("account_id") or ""),
        _account_audit_name(record.get("name"), record.get("callsign")),
        str(record.get("callsign") or ""), str(action or ""), str(performed_by or ""),
    ]
    service.spreadsheets().batchUpdate(
        spreadsheetId=GOOGLE_SHEET_ID2,
        body={"requests": [
            {"updateCells": {
                "range": {"sheetId": sheet_ids["Accounts"],
                          "startRowIndex": current["sheet_row"] - 1,
                          "endRowIndex": current["sheet_row"],
                          "startColumnIndex": 0, "endColumnIndex": len(keys)},
                "rows": [{"values": account_values}], "fields": "userEnteredValue",
            }},
            {"appendCells": {
                "sheetId": sheet_ids["Account Audit"],
                "rows": [{"values": [{"userEnteredValue": {"stringValue": value}} for value in audit_values]}],
                "fields": "userEnteredValue",
            }},
        ]},
    ).execute()
    return True


def delete_account_record(account_id):
    """Permanently delete one account row from the Sheet 2 Accounts tab."""
    if not GOOGLE_SHEET_ID2:
        raise RuntimeError("GOOGLE_SHEET_ID2 is required for account storage")
    service = get_google_sheets_service()
    sheet_ids = _ensure_archive_tabs(service)
    accounts = _account_records_with_service(service)
    current = next((row for row in accounts if row["account_id"] == str(account_id)), None)
    if not current:
        return False
    service.spreadsheets().batchUpdate(
        spreadsheetId=GOOGLE_SHEET_ID2,
        body={"requests": [{"deleteDimension": {"range": {
            "sheetId": sheet_ids["Accounts"],
            "dimension": "ROWS",
            "startIndex": current["sheet_row"] - 1,
            "endIndex": current["sheet_row"]
        }}}]}
    ).execute()
    return True


def delete_account_record_and_audit(account_id, record, performed_by):
    """Delete an account and append its audit entry atomically in Sheets."""
    if not GOOGLE_SHEET_ID2:
        raise RuntimeError("GOOGLE_SHEET_ID2 is required for account storage")
    service = get_google_sheets_service()
    sheet_ids = _ensure_archive_tabs(service)
    current = next((row for row in get_account_records() if row["account_id"] == str(account_id)), None)
    if not current:
        return False
    audit_values = [
        datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        str(record.get("account_id") or ""),
        _account_audit_name(record.get("name"), record.get("callsign")),
        str(record.get("callsign") or ""), "Account Deleted", str(performed_by or ""),
    ]
    service.spreadsheets().batchUpdate(
        spreadsheetId=GOOGLE_SHEET_ID2,
        body={"requests": [
            {"appendCells": {
                "sheetId": sheet_ids["Account Audit"],
                "rows": [{"values": [{"userEnteredValue": {"stringValue": value}} for value in audit_values]}],
                "fields": "userEnteredValue",
            }},
            {"deleteDimension": {"range": {
                "sheetId": sheet_ids["Accounts"], "dimension": "ROWS",
                "startIndex": current["sheet_row"] - 1, "endIndex": current["sheet_row"],
            }}},
        ]},
    ).execute()
    return True


def append_account_audit(account_id, name, callsign, action, performed_by):
    if not GOOGLE_SHEET_ID2:
        raise RuntimeError("GOOGLE_SHEET_ID2 is required for account storage")
    service = get_google_sheets_service()
    _ensure_archive_tabs(service)
    values = [[
        datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        str(account_id or ""), _account_audit_name(name, callsign), str(callsign or ""),
        str(action or ""), str(performed_by or "")
    ]]
    service.spreadsheets().values().append(
        spreadsheetId=GOOGLE_SHEET_ID2,
        range="'Account Audit'!A:F",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": values}
    ).execute()
    return True


def get_account_audit(limit=200):
    if not GOOGLE_SHEET_ID2:
        raise RuntimeError("GOOGLE_SHEET_ID2 is required for account storage")
    service = get_google_sheets_service()
    _ensure_archive_tabs(service)
    keys = ["created_at", "account_id", "name", "callsign", "action", "actor_name"]
    rows = _get_latest_sheet_value_rows(
        service, GOOGLE_SHEET_ID2, "Account Audit", "F", limit
    )
    return [dict(zip(keys, list(row) + [""] * (len(keys) - len(row)))) for row in reversed(rows)]


def get_account_overview(audit_limit=200):
    """Fetch all accounts while keeping only the latest audit entries in memory."""
    if not GOOGLE_SHEET_ID2:
        raise RuntimeError("GOOGLE_SHEET_ID2 is required for account storage")
    service = get_google_sheets_service()
    _ensure_archive_tabs(service)
    response = service.spreadsheets().values().batchGet(
        spreadsheetId=GOOGLE_SHEET_ID2,
        ranges=["'Accounts'!A2:L", "'Account Audit'!A2:F"],
    ).execute().get("valueRanges", [])
    account_rows = response[0].get("values", []) if len(response) > 0 else []
    audit_rows = response[1].get("values", []) if len(response) > 1 else []
    account_keys = [
        "account_id", "name", "callsign", "password_salt", "password_hash",
        "status", "role", "created_at", "activated_at", "approved_by",
        "admin_changed_at", "admin_changed_by"
    ]
    accounts = [
        {**dict(zip(account_keys, list(row) + [""] * (len(account_keys) - len(row)))), "sheet_row": index + 2}
        for index, row in enumerate(account_rows) if row and row[0]
    ]
    audit_keys = ["created_at", "account_id", "name", "callsign", "action", "actor_name"]
    audit = [
        dict(zip(audit_keys, list(row) + [""] * (len(audit_keys) - len(row))))
        for row in reversed(audit_rows[-audit_limit:])
    ]
    return accounts, audit


def append_log_to_archive(
    event, callsign="", member_name="", details="", performed_by="",
    actor_callsign="", old_callsign="", new_callsign="", old_rank="", new_rank=""
):
    if not GOOGLE_SHEET_ID2:
        return False

    service = get_google_sheets_service()
    _ensure_archive_tabs(service)
    row = [
        datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        str(event or ""), str(member_name or ""), str(callsign or ""),
        str(old_callsign or ""), str(new_callsign or ""), str(old_rank or ""),
        str(new_rank or ""), str(details or ""), str(performed_by or ""),
        str(actor_callsign or "")
    ]
    service.spreadsheets().values().append(
        spreadsheetId=GOOGLE_SHEET_ID2,
        range="'Logs'!A:K",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": [row]}
    ).execute()
    return True


def get_all_discord_leader_records():
    con = db()
    try:
        return [dict(row) for row in con.execute(
            """SELECT discord_user_id, username, display_name, status, is_admin,
                      linked_at, requested_at, approved_at, approved_by,
                      admin_changed_at, admin_changed_by
               FROM DiscordLeaders ORDER BY linked_at, discord_user_id"""
        )]
    finally:
        con.close()


def append_leader_snapshot(discord_user_id, archive_event="Updated", display_name=None):
    if not GOOGLE_SHEET_ID2:
        return False

    service = get_google_sheets_service()
    _ensure_archive_tabs(service)
    con = db()
    try:
        row = con.execute(
            """SELECT discord_user_id, username, display_name, status, is_admin,
                      linked_at, requested_at, approved_at, approved_by,
                      admin_changed_at, admin_changed_by
               FROM DiscordLeaders WHERE discord_user_id=?""",
            (str(discord_user_id),)
        ).fetchone()
        record = dict(row) if row else None
    finally:
        con.close()

    if record:
        row_values = [
            str(record.get("discord_user_id") or ""),
            str(record.get("username") or ""),
            str(record.get("display_name") or ""),
            str(record.get("status") or ""),
            "Commander" if record.get("is_admin") else "Leader",
            str(record.get("linked_at") or ""),
            str(record.get("requested_at") or ""),
            str(record.get("approved_at") or ""),
            str(record.get("approved_by") or ""),
            str(record.get("admin_changed_at") or ""),
            str(record.get("admin_changed_by") or "")
        ]
    else:
        row_values = [str(discord_user_id), "", str(display_name or ""), "Removed", "", "", "", "", "", "", ""]

    values = [[
        datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        *row_values,
        str(archive_event)
    ]]
    service.spreadsheets().values().append(
        spreadsheetId=GOOGLE_SHEET_ID2,
        range="'Leaders'!A:M",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": values}
    ).execute()
    return True


def sync_leader_directory_to_archive():
    """Seed the archive once; never replace its append-only history."""
    if not GOOGLE_SHEET_ID2:
        return False
    service = get_google_sheets_service()
    _ensure_archive_tabs(service)
    existing = service.spreadsheets().values().get(
        spreadsheetId=GOOGLE_SHEET_ID2,
        range="'Leaders'!A2:A2"
    ).execute().get("values", [])
    if existing:
        return False
    records = get_all_discord_leader_records()
    if records:
        timestamp = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
        values = []
        for record in records:
            values.append([
                timestamp,
                str(record.get("discord_user_id") or ""),
                str(record.get("username") or ""),
                str(record.get("display_name") or ""),
                str(record.get("status") or ""),
                "Commander" if record.get("is_admin") else "Leader",
                str(record.get("linked_at") or ""),
                str(record.get("requested_at") or ""),
                str(record.get("approved_at") or ""),
                str(record.get("approved_by") or ""),
                str(record.get("admin_changed_at") or ""),
                str(record.get("admin_changed_by") or ""),
                "Initial Snapshot"
            ])
        service.spreadsheets().values().append(
            spreadsheetId=GOOGLE_SHEET_ID2,
            range="'Leaders'!A:M",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": values}
        ).execute()
    return True


def sync_logs_to_archive():
    """Copy existing local audit history once; future events are appended live."""
    if not GOOGLE_SHEET_ID2:
        return False
    service = get_google_sheets_service()
    _ensure_archive_tabs(service)
    existing = service.spreadsheets().values().get(
        spreadsheetId=GOOGLE_SHEET_ID2,
        range="'Logs'!A2:A2"
    ).execute().get("values", [])
    if existing:
        return False

    con = db()
    try:
        queries = [
            ("""SELECT log_date AS timestamp, action AS event, member_name,
                       callsign, '' AS old_callsign, '' AS new_callsign,
                       '' AS old_rank, '' AS new_rank, training_name AS details,
                       changed_by AS performed_by, '' AS discord_user_id
                FROM TrainingLog""",),
            ("""SELECT log_date AS timestamp, action AS event, member_name,
                       callsign, '' AS old_callsign, '' AS new_callsign,
                       '' AS old_rank, '' AS new_rank, exam_name AS details,
                       changed_by AS performed_by, '' AS discord_user_id
                FROM ExamLog""",),
            ("""SELECT log_date AS timestamp, action AS event, member_name,
                       callsign, '' AS old_callsign, '' AS new_callsign,
                       '' AS old_rank, '' AS new_rank, note AS details,
                       changed_by AS performed_by, '' AS discord_user_id
                FROM NoteLog""",),
            ("""SELECT termination_date AS timestamp, 'Terminated' AS event,
                       member_name, callsign, '' AS old_callsign, '' AS new_callsign,
                       rank AS old_rank, '' AS new_rank, reason AS details,
                       terminated_by AS performed_by, '' AS discord_user_id
                FROM TerminationLog""",),
            ("""SELECT promo_date AS timestamp, operation_type AS event, '' AS member_name,
                       COALESCE(new_callsign, callsign, old_callsign) AS callsign,
                       old_callsign, new_callsign, old_rank, new_rank,
                       '' AS details, promoted_by AS performed_by,
                       '' AS discord_user_id
                FROM Promotions""",),
            ("""SELECT changed_at AS timestamp, 'Activity Changed' AS event,
                       member_name, callsign, '' AS old_callsign, '' AS new_callsign,
                       '' AS old_rank, '' AS new_rank,
                       old_status || ' -> ' || new_status AS details,
                       changed_by AS performed_by,
                       discord_user_id
                FROM ActivityStatusLog""",),
            ("""SELECT created_at AS timestamp, action AS event, actor_name AS member_name,
                       '' AS callsign, '' AS old_callsign, '' AS new_callsign,
                       '' AS old_rank, '' AS new_rank, endpoint AS details,
                       actor_name AS performed_by, discord_user_id
                FROM AdminActionLog""",),
            ("""SELECT created_at AS timestamp, action AS event, display_name AS member_name,
                       '' AS callsign, '' AS old_callsign, '' AS new_callsign,
                       '' AS old_rank, '' AS new_rank, 'Discord leader access' AS details,
                       actor_name AS performed_by, actor_discord_user_id AS discord_user_id
                FROM DiscordLeaderAuditLog""",)
        ]
        rows = []
        for (query,) in queries:
            rows.extend(con.execute(query).fetchall())
    finally:
        con.close()

    rows.sort(key=lambda row: str(row["timestamp"] or ""))
    if rows:
        values = [[str(value or "") for value in row] for row in rows]
        service.spreadsheets().values().append(
            spreadsheetId=GOOGLE_SHEET_ID2,
            range="'Logs'!A:K",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": values}
        ).execute()
    return True


def _iter_sheet_value_rows(service, spreadsheet_id, sheet_name, end_column, start_row=2, batch_size=500):
    while True:
        end_row = start_row + batch_size - 1
        values = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"'{sheet_name}'!A{start_row}:{end_column}{end_row}"
        ).execute().get("values", [])
        yield from values
        if len(values) < batch_size:
            return
        start_row = end_row + 1


def _get_latest_sheet_value_rows(service, spreadsheet_id, sheet_name, end_column, limit):
    if limit <= 0:
        return []

    rows = []
    for row in _iter_sheet_value_rows(service, spreadsheet_id, sheet_name, end_column):
        rows.append(row)
        if len(rows) > limit:
            rows.pop(0)
    return rows


def restore_logs_from_archive():
    """Restore archived member log rows when starting with an empty local DB."""
    if not GOOGLE_SHEET_ID2:
        return 0

    con = db()
    try:
        local_logs = sum(
            con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in (
                "Promotions", "TrainingLog", "ExamLog", "NoteLog",
                "TerminationLog", "ActivityStatusLog"
            )
        )
        if local_logs:
            return 0
    finally:
        con.close()

    service = get_google_sheets_service()
    _ensure_archive_tabs(service)

    con = db()
    try:
        local_logs = sum(
            con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in (
                "Promotions", "TrainingLog", "ExamLog", "NoteLog",
                "TerminationLog", "ActivityStatusLog"
            )
        )
        if local_logs:
            return 0

        con.execute("BEGIN")
        restored = 0
        for archived in _iter_sheet_value_rows(
            service, GOOGLE_SHEET_ID2, "Logs", "K"
        ):
            row = list(archived) + [""] * (11 - len(archived))
            timestamp, event, member, callsign, old_cs, new_cs, old_rank, new_rank, details, actor, actor_id = row[:11]
            event_lower = str(event).strip().lower()
            timestamp = timestamp or datetime.datetime.now().astimezone().isoformat(timespec="seconds")
            callsign = str(callsign or "").strip().upper()
            old_cs = str(old_cs or "").strip().upper()
            new_cs = str(new_cs or "").strip().upper()

            detail_key = str(details or "").strip().casefold()
            if event_lower in {"add", "remove", "edit", "delete"} and detail_key in {
                "basic firefighting", "advanced firefighting", "hert"
            }:
                action = "REMOVE" if event_lower == "remove" else "ADD"
                con.execute(
                    """INSERT INTO TrainingLog(callsign, member_name, training_name, action, changed_by, log_date)
                       VALUES(?,?,?,?,?,?)""",
                    (callsign, member, details, action, actor, timestamp)
                )
            elif event_lower in {"add", "remove", "edit", "delete"} and detail_key == "supervisor exam":
                action = "REMOVE" if event_lower == "remove" else "ADD"
                con.execute(
                    """INSERT INTO ExamLog(callsign, member_name, exam_name, action, changed_by, log_date)
                       VALUES(?,?,?,?,?,?)""",
                    (callsign, member, details, action, actor, timestamp)
                )
            elif event_lower in {"add", "remove", "edit", "delete"}:
                con.execute(
                    """INSERT INTO NoteLog(callsign, member_name, action, note, changed_by, log_date)
                       VALUES(?,?,?,?,?,?)""",
                    (callsign, member, event.upper(), details, actor, timestamp)
                )
            elif event_lower.startswith("training "):
                action = "REMOVE" if "removed" in event_lower else "ADD"
                con.execute(
                    """INSERT INTO TrainingLog(callsign, member_name, training_name, action, changed_by, log_date)
                       VALUES(?,?,?,?,?,?)""",
                    (callsign, member, details, action, actor, timestamp)
                )
            elif event_lower.startswith("exam "):
                action = "REMOVE" if "removed" in event_lower else "ADD"
                con.execute(
                    """INSERT INTO ExamLog(callsign, member_name, exam_name, action, changed_by, log_date)
                       VALUES(?,?,?,?,?,?)""",
                    (callsign, member, details, action, actor, timestamp)
                )
            elif event_lower.startswith("note "):
                action = event.strip()[5:].upper()
                con.execute(
                    """INSERT INTO NoteLog(callsign, member_name, action, note, changed_by, log_date)
                       VALUES(?,?,?,?,?,?)""",
                    (callsign, member, action, details, actor, timestamp)
                )
            elif event_lower == "terminated":
                con.execute(
                    """INSERT INTO TerminationLog(callsign, member_name, rank, terminated_by, reason, termination_date)
                       VALUES(?,?,?,?,?,?)""",
                    (callsign, member, old_rank, actor, details, timestamp)
                )
            elif event_lower == "activity changed":
                old_status, separator, new_status = str(details).partition(" -> ")
                if separator:
                    con.execute(
                        """INSERT INTO ActivityStatusLog(
                               callsign, member_name, old_status, new_status,
                               discord_user_id, changed_by, changed_at
                           ) VALUES(?,?,?,?,?,?,?)""",
                        (callsign, member, old_status, new_status, actor_id, actor, timestamp)
                    )
            elif old_rank or new_rank or old_cs or new_cs or event_lower in {
                "promotion", "demotion", "normal", "force", "rank change", "callsign change"
            }:
                operation_type = str(event or "RANK_CHANGE").strip().upper().replace(" ", "_")
                con.execute(
                    """INSERT INTO Promotions(
                           callsign, old_rank, new_rank, old_callsign, new_callsign,
                           promoted_by, promo_date, operation_type
                       ) VALUES(?,?,?,?,?,?,?,?)""",
                    (new_cs or callsign or old_cs, old_rank, new_rank, old_cs, new_cs,
                     actor, timestamp, operation_type)
                )
            else:
                continue
            restored += 1

        con.commit()
        return restored
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def restore_leaders_from_archive():
    """Restore the latest archived Leader snapshot into a fresh local DB."""
    if not GOOGLE_SHEET_ID2:
        return 0
    service = get_google_sheets_service()
    _ensure_archive_tabs(service)
    values = service.spreadsheets().values().get(
        spreadsheetId=GOOGLE_SHEET_ID2,
        range="'Leaders'!A2:M"
    ).execute().get("values", [])
    if not values:
        return 0

    latest = {}
    for archived in values:
        row = list(archived) + [""] * (13 - len(archived))
        snapshot_at, user_id, username, display_name, status, role, linked_at, requested_at, approved_at, approved_by, admin_changed_at, admin_changed_by, archive_event = row[:13]
        user_id = str(user_id or "").strip()
        if user_id:
            latest[user_id] = {
                "snapshot_at": snapshot_at,
                "username": username,
                "display_name": display_name,
                "status": str(status or "").strip().lower(),
                "role": role,
                "linked_at": linked_at,
                "requested_at": requested_at,
                "approved_at": approved_at,
                "approved_by": approved_by,
                "admin_changed_at": admin_changed_at,
                "admin_changed_by": admin_changed_by,
                "archive_event": archive_event
            }

    con = db()
    try:
        if con.execute("SELECT 1 FROM DiscordLeaders LIMIT 1").fetchone():
            return 0
        restored = 0
        con.execute("BEGIN")
        for user_id, record in latest.items():
            if record["archive_event"] == "Removed" or record["status"] == "removed":
                continue
            status = record["status"] if record["status"] in {"approved", "pending", "denied"} else "pending"
            is_admin = int(record["role"].strip().lower() == "admin" and status == "approved")
            con.execute(
                """INSERT OR REPLACE INTO DiscordLeaders(
                       discord_user_id, username, display_name, linked_at, status,
                       requested_at, approved_at, is_admin, approved_by,
                       admin_changed_at, admin_changed_by
                   ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (user_id, record["username"] or user_id,
                 record["display_name"] or record["username"] or user_id,
                 record["linked_at"] or record["snapshot_at"] or "",
                 status, record["requested_at"] or None, record["approved_at"] or None,
                 is_admin, record["approved_by"] or None,
                 record["admin_changed_at"] or None, record["admin_changed_by"] or None)
            )
            restored += 1
        con.commit()
        return restored
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def get_sheet_id_by_name(service, sheet_name):
    if sheet_name in SHEET_IDS_CACHE:
        return SHEET_IDS_CACHE[sheet_name]

    meta = service.spreadsheets().get(
        spreadsheetId=GOOGLE_SHEET_ID
    ).execute()

    for sheet in meta.get("sheets", []):
        properties = sheet.get("properties", {})

        if properties.get("title") == sheet_name:
            sheet_id = properties.get("sheetId")

            SHEET_IDS_CACHE[sheet_name] = sheet_id

            return sheet_id

    return None


# ============================================================
# GOOGLE CELL HELPERS
# ============================================================

def get_cell_value(cell):
    if not cell:
        return None

    effective_value = cell.get(
        "effectiveValue",
        {}
    )

    if "stringValue" in effective_value:
        return effective_value["stringValue"]

    if "numberValue" in effective_value:
        return effective_value["numberValue"]

    if "boolValue" in effective_value:
        return effective_value["boolValue"]

    return None


def _extract_rgb_color(color):
    if not color:
        return None

    try:
        r = float(color.get("red", 0))
        g = float(color.get("green", 0))
        b = float(color.get("blue", 0))
        alpha = float(color.get("alpha", 1))

        if alpha <= 0:
            return None

        return r, g, b

    except (
        TypeError,
        ValueError
    ):
        return None


def get_cell_rgb(cell):
    if not cell:
        return None

    effective_format = cell.get(
        "effectiveFormat",
        {}
    )

    color = effective_format.get(
        "backgroundColor"
    )

    rgb = _extract_rgb_color(color)

    if rgb is not None:
        return rgb

    color_style = effective_format.get(
        "backgroundColorStyle",
        {}
    )

    rgb = _extract_rgb_color(
        color_style.get("rgbColor")
    )

    if rgb is not None:
        return rgb

    user_format = cell.get(
        "userEnteredFormat",
        {}
    )

    color = user_format.get(
        "backgroundColor"
    )

    rgb = _extract_rgb_color(color)

    if rgb is not None:
        return rgb

    color_style = user_format.get(
        "backgroundColorStyle",
        {}
    )

    rgb = _extract_rgb_color(
        color_style.get("rgbColor")
    )

    if rgb is not None:
        return rgb

    return None


def is_google_cell_colored(cell):
    """
    Any visible non-white / non-black color
    is considered completed.
    """

    rgb = get_cell_rgb(cell)

    if rgb is None:
        return False

    r, g, b = rgb

    if (
        abs(r - 1) < 0.000001
        and abs(g - 1) < 0.000001
        and abs(b - 1) < 0.000001
    ):
        return False

    if (
        abs(r) < 0.000001
        and abs(g) < 0.000001
        and abs(b) < 0.000001
    ):
        return False

    return True


# ============================================================
# ACTIVITY COLOR
# ============================================================

def parse_activity_color(cell):
    rgb = get_cell_rgb(cell)

    if rgb is None:
        return "Active"

    r, g, b = rgb

    if r > 0.90 and g > 0.90 and b > 0.90:
        return "Active"

    if r >= 0.90 and g <= 0.10 and b <= 0.10:
        return "Can Be Terminated"

    if r > 0.80 and g > 0.65 and b < 0.35:
        return "Semi Active"

    if r > 0.80 and 0.30 <= g < 0.65 and b < 0.25:
        return "Inactive"

    return "Active"


# ============================================================
# GOOGLE SHEET READ
# ============================================================

def get_google_sheet_data():
    """Fetch the member and HERT ranges together for a single local import."""
    request_options = {
        "spreadsheetId": GOOGLE_SHEET_ID,
        "ranges": [
            f"'{GOOGLE_SHEET_NAME}'!A2:M450",
            f"'{HERT_SHEET_NAME}'!B2:D450",
        ],
        "includeGridData": True,
        "fields": (
            "sheets(properties(title),data(rowData(values("
            "effectiveValue,userEnteredValue,effectiveFormat,userEnteredFormat))))"
        ),
    }
    service = get_google_sheets_service()
    try:
        return service.spreadsheets().get(**request_options).execute(num_retries=3)
    except OSError:
        # A dropped Windows socket can leave httplib2's pooled connection unusable.
        # Rebuild the client once, then let the Google client retry transient failures.
        logger.warning("Google Sheets connection dropped during sync; retrying with a fresh client.")
        _GOOGLE_SERVICE_LOCAL.service = None
        service = get_google_sheets_service()
        return service.spreadsheets().get(**request_options).execute(num_retries=3)


def get_instructor_directory():
    """Read HERT and FORT instructor designations from the source sheet colors."""
    service = get_google_sheets_service()
    result = service.spreadsheets().get(
        spreadsheetId=GOOGLE_SHEET_ID,
        ranges=[
            f"'{HERT_SHEET_NAME}'!B2:F450",
            "'FIREFIGHTER CERT'!A2:D450",
        ],
        includeGridData=True,
        fields=(
            "sheets(properties(title),data(rowData(values("
            "effectiveValue,formattedValue,effectiveFormat,userEnteredFormat))))"
        ),
    ).execute()

    instructors = {}
    for sheet in result.get("sheets", []):
        title = sheet.get("properties", {}).get("title")
        rows = sheet.get("data", [{}])[0].get("rowData", [])
        for row in rows:
            cells = row.get("values", [])
            if title == HERT_SHEET_NAME:
                name_cell = cells[0] if len(cells) > 0 else None  # Column B
                instructor_cell = cells[4] if len(cells) > 4 else None  # Column F
                instructor_type = "HERT"
                date = ""
            elif title == "FIREFIGHTER CERT":
                name_cell = cells[0] if len(cells) > 0 else None  # Column A
                instructor_cell = cells[1] if len(cells) > 1 else None  # Column B
                instructor_type = "FORT"
                date_cell = cells[3] if len(cells) > 3 else None  # Column D
                date = (date_cell or {}).get("formattedValue", "")
            else:
                continue

            name = get_cell_value(name_cell)
            if not name or not str(name).strip() or not _is_green_instructor_cell(instructor_cell):
                continue
            key = unicodedata.normalize("NFKC", " ".join(str(name).split())).casefold()
            record = {"name": str(name).strip(), "type": instructor_type, "date": str(date or "")}
            existing = instructors.get(key)
            if existing and existing["type"] != instructor_type:
                existing["type"] = "HERT / FORT"
                existing["date"] = record["date"] or existing["date"]
            else:
                instructors[key] = record
    return instructors


def _is_green_instructor_cell(cell):
    rgb = get_cell_rgb(cell)
    return bool(rgb and rgb[1] >= 0.75 and rgb[0] <= 0.20 and rgb[2] <= 0.20)


def set_instructor_status(member_name, instructor_type, assigned):
    instructor_type = str(instructor_type or "").strip().upper()
    if instructor_type not in {"HERT", "FORT"}:
        raise ValueError("Instructor type must be HERT or FORT")

    sheet_name = HERT_SHEET_NAME if instructor_type == "HERT" else "FIREFIGHTER CERT"
    name_column = "B" if instructor_type == "HERT" else "A"
    status_column = 5 if instructor_type == "HERT" else 1
    first_row = 2
    last_row = 1000
    target_range = f"'{sheet_name}'!{name_column}{first_row}:{name_column}{last_row}"
    service = get_google_sheets_service()
    values = service.spreadsheets().values().get(
        spreadsheetId=GOOGLE_SHEET_ID,
        range=target_range,
    ).execute().get("values", [])
    target = unicodedata.normalize("NFKC", " ".join(str(member_name or "").split())).casefold()
    row_number = next(
        (index for index, row in enumerate(values, start=2)
         if row and unicodedata.normalize("NFKC", " ".join(str(row[0] or "").split())).casefold() == target),
        None,
    )
    if row_number is None:
        if not assigned:
            return False
        # A member may not have a row on the relevant certification sheet yet.
        # Add the name to the first empty name cell so the admin assignment can
        # be represented without overwriting another member's certification.
        row_number = next(
            (index for index, row in enumerate(values, start=first_row)
             if not row or not str(row[0] or "").strip()),
            None,
        )
        if row_number is None and len(values) < last_row - first_row + 1:
            row_number = first_row + len(values)
        if row_number is None:
            raise ValueError(f"No empty name row was found in {sheet_name} (rows {first_row}-{last_row})")
        new_member_row = True
    else:
        new_member_row = False

    status_letter = "F" if instructor_type == "HERT" else "B"
    cell = get_google_cell(service, sheet_name, f"{status_letter}{row_number}")
    already_assigned = _is_green_instructor_cell(cell)
    if already_assigned == bool(assigned) and not new_member_row:
        return False

    color = (0, 1, 0) if assigned else (1, 1, 1)
    operations = []
    if new_member_row:
        operations.append((row_number, 1 if instructor_type == "HERT" else 0, str(member_name).strip(), None))
    operations.append((row_number, status_column, None, color))
    if instructor_type == "FORT":
        operations.append((row_number, 3, datetime.date.today().isoformat() if assigned else "", None))
    update_sheet_cells(service, sheet_name, operations)
    return True


def log_instructor_change(callsign, member_name, instructor_type, action, changed_by):
    con = db()
    try:
        cursor = con.execute(
            """INSERT INTO InstructorLog(
                   callsign, member_name, instructor_type, action, changed_by, log_date
               ) VALUES(?,?,?,?,?,?)""",
            (callsign, member_name, instructor_type, action, changed_by,
             datetime.datetime.now().astimezone().isoformat(timespec="seconds")),
        )
        con.commit()
        return cursor.lastrowid
    finally:
        con.close()


# ============================================================
# FIND ROW
# ============================================================

def find_row_by_callsign(
    service,
    callsign,
    sheet_name=GOOGLE_SHEET_NAME
):
    target = str(callsign or "").strip().upper()
    if not target:
        return None

    # The import stores Google row numbers locally. Use them for background
    # writes so routine edits do not trigger another sheet read.
    if sheet_name == GOOGLE_SHEET_NAME:
        con = db()
        try:
            cached = con.execute(
                "SELECT sheet_row FROM SheetCache WHERE UPPER(TRIM(callsign))=?",
                (target,),
            ).fetchone()
            if cached and cached["sheet_row"] is not None:
                return int(cached["sheet_row"])
        finally:
            con.close()

    result = service.spreadsheets().values().get(
        spreadsheetId=GOOGLE_SHEET_ID,
        range=f"'{sheet_name}'!B2:B450"
    ).execute()

    for i, row in enumerate(
        result.get("values", []),
        start=2
    ):
        if not row:
            continue

        value = str(
            row[0]
        ).strip().upper()

        if value == target:
            return i

    return None


# ============================================================
# GET CALLSIGN INFO
# ============================================================

def get_google_callsign_info(callsign):
    target = str(
        callsign or ""
    ).strip().upper()

    if not target:
        return None

    con = db()
    try:
        cached = con.execute(
            """
            SELECT m.callsign, m.name, s.sheet_row
            FROM Members m
            LEFT JOIN SheetCache s ON UPPER(TRIM(s.callsign))=UPPER(TRIM(m.callsign))
            WHERE UPPER(TRIM(m.callsign))=?
            LIMIT 1
            """,
            (target,),
        ).fetchone()
        if cached and cached["sheet_row"] is not None:
            return {
                "callsign": str(cached["callsign"]).strip(),
                "name": str(cached["name"] or "").strip(),
                "row": int(cached["sheet_row"]),
            }
    finally:
        con.close()

    service = get_google_sheets_service()
    result = service.spreadsheets().values().get(
        spreadsheetId=GOOGLE_SHEET_ID,
        range=f"'{GOOGLE_SHEET_NAME}'!B2:C450"
    ).execute()

    for index, row in enumerate(
        result.get("values", []),
        start=2
    ):
        callsign_value = (
            str(row[0]).strip()
            if len(row) > 0 and row[0] is not None
            else ""
        )

        name_value = (
            str(row[1]).strip()
            if len(row) > 1 and row[1] is not None
            else ""
        )

        if callsign_value.upper() == target:
            return {
                "callsign": callsign_value,
                "name": name_value,
                "row": index,
            }

    return None


# ============================================================
# GET EXACT GOOGLE CELL
# ============================================================

def get_google_cell(
    service,
    sheet_name,
    cell_range
):
    """
    Read one exact Google Sheets cell including
    formatting information.
    """

    result = service.spreadsheets().get(
        spreadsheetId=GOOGLE_SHEET_ID,
        ranges=[
            f"'{sheet_name}'!{cell_range}"
        ],
        includeGridData=True
    ).execute()

    sheets = result.get(
        "sheets",
        []
    )

    if not sheets:
        return None

    row_data = (
        sheets[0]
        .get("data", [{}])[0]
        .get("rowData", [])
    )

    if not row_data:
        return None

    values = row_data[0].get(
        "values",
        []
    )

    if not values:
        return None

    return values[0]


# ============================================================
# UPDATE SINGLE GOOGLE CELL
# ============================================================

def update_sheet_cell(
    service,
    sheet_name,
    row_number,
    col_index,
    bg_color=None,
    value=None
):
    sheet_id = get_sheet_id_by_name(
        service,
        sheet_name
    )

    if sheet_id is None:
        raise ValueError(
            f"Sheet not found: {sheet_name}"
        )

    requests = []

    if bg_color is not None:
        requests.append(
            {
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": row_number - 1,
                        "endRowIndex": row_number,
                        "startColumnIndex": col_index,
                        "endColumnIndex": col_index + 1,
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "backgroundColor": {
                                "red": bg_color[0],
                                "green": bg_color[1],
                                "blue": bg_color[2],
                            }
                        }
                    },
                    "fields":
                        "userEnteredFormat.backgroundColor"
                }
            }
        )

    if value is not None:
        requests.append(
            {
                "updateCells": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": row_number - 1,
                        "endRowIndex": row_number,
                        "startColumnIndex": col_index,
                        "endColumnIndex": col_index + 1,
                    },
                    "rows": [
                        {
                            "values": [
                                {
                                    "userEnteredValue": {
                                        "stringValue": str(value)
                                    }
                                }
                            ]
                        }
                    ],
                    "fields":
                        "userEnteredValue"
                }
            }
        )

    if requests:
        service.spreadsheets().batchUpdate(
            spreadsheetId=GOOGLE_SHEET_ID,
            body={
                "requests": requests
            }
        ).execute()


# ============================================================
# HERT CACHE
# ============================================================

def update_hert_cache(
    member_name,
    certified
):
    if not member_name:
        return

    member_name_clean = str(
        member_name
    ).strip()

    if not member_name_clean:
        return

    cache_key = member_name_clean.lower()

    con = db()

    try:
        con.execute(
            """
            INSERT INTO HERTCache(
                member_name,
                certified,
                synced_at
            )
            VALUES(?,?,?)

            ON CONFLICT(member_name)
            DO UPDATE SET
                certified=excluded.certified,
                synced_at=excluded.synced_at
            """,
            (
                cache_key,
                1 if certified else 0,
                datetime.datetime.now().isoformat(
                    timespec="seconds"
                )
            )
        )

        con.commit()

    finally:
        con.close()


# ============================================================
# HERT
# ============================================================

def get_hert_certified_status(member_name):
    """
    Return HERT certification status.

    Google Sheets is the source of truth.

    If Google Sheets is temporarily unavailable,
    use the latest successful value stored in HERTCache.

    This prevents /api/member/{callsign} from returning
    HTTP 500 when Google Sheets has a temporary
    network timeout such as WinError 10060.
    """

    if not member_name or not str(member_name).strip():
        return False

    member_name_clean = str(
        member_name
    ).strip()

    cache_key = member_name_clean.lower()

    # ========================================================
    # TRY GOOGLE SHEETS FIRST
    # ========================================================

    try:

        service = get_google_sheets_service()

        result = service.spreadsheets().get(
            spreadsheetId=GOOGLE_SHEET_ID,
            ranges=[
                f"'{HERT_SHEET_NAME}'!B2:D450"
            ],
            includeGridData=True
        ).execute()

        sheets = result.get(
            "sheets",
            []
        )

        if not sheets:
            raise ValueError(
                f"Sheet '{HERT_SHEET_NAME}' returned no data"
            )

        rows = (
            sheets[0]
            .get("data", [{}])[0]
            .get("rowData", [])
        )

        target = cache_key

        certified = False

        for row in rows:

            values = row.get(
                "values",
                []
            )

            name = (
                get_cell_value(values[0])
                if len(values) > 0
                else None
            )

            if (
                name
                and str(name).strip().lower() == target
            ):

                d_cell = (
                    values[2]
                    if len(values) > 2
                    else None
                )

                # A member can appear more than once after sheet edits.
                # Treat the member as certified if any matching row is green.
                certified = certified or is_google_cell_colored(d_cell)

        # ====================================================
        # UPDATE CACHE AFTER SUCCESSFUL GOOGLE READ
        # ====================================================

        update_hert_cache(
            member_name_clean,
            certified
        )

        return certified

    # ========================================================
    # GOOGLE SHEETS FAILED
    # ========================================================

    except Exception as google_error:

        logger.info(
            "[LVFR EMS] Google Sheets unavailable while "
            "checking HERT certification."
        )

        logger.info(
            f"[LVFR EMS] Google HERT error: {google_error}"
        )

        # ====================================================
        # FALLBACK TO SQLITE CACHE
        # ====================================================

        try:

            con = db()

            row = con.execute(
                """
                SELECT certified
                FROM HERTCache
                WHERE member_name=?
                """,
                (
                    cache_key,
                )
            ).fetchone()

            con.close()

            if row:

                certified = bool(
                    row["certified"]
                )

                logger.info(
                    "[LVFR EMS] Using HERT cache for "
                    f"{member_name_clean}: "
                    f"{certified}"
                )

                return certified

            logger.info(
                "[LVFR EMS] No HERT cache exists for "
                f"{member_name_clean}"
            )

            return False

        except Exception as cache_error:

            logger.info(
                "[LVFR EMS] HERT cache fallback failed: "
                f"{cache_error}"
            )

            return False


def add_hert_certification(member_name):
    """
    HERT rules:

    1. If member name already exists and D is colored:
       -> Already certified
       -> Do nothing.

    2. If member name already exists but D is not colored:
       -> Color D pure green (#00FF00)
       -> Do not add duplicate name.

    3. If member name does not exist:
       -> Find first empty B cell.
       -> Add member name.
       -> Color D pure green (#00FF00).
    """

    if not member_name or not str(member_name).strip():
        return False, "not_found"

    member_name_clean = str(
        member_name
    ).strip()

    service = get_google_sheets_service()

    result = service.spreadsheets().get(
        spreadsheetId=GOOGLE_SHEET_ID,
        ranges=[
            f"'{HERT_SHEET_NAME}'!B2:D450"
        ],
        includeGridData=True
    ).execute()

    sheets = result.get(
        "sheets",
        []
    )

    if not sheets:
        return False, "sheet_not_found"

    rows = (
        sheets[0]
        .get("data", [{}])[0]
        .get("rowData", [])
    )

    first_empty = None
    target = member_name_clean.lower()

    for i, row in enumerate(rows, start=2):
        values = row.get(
            "values",
            []
        )

        name = (
            get_cell_value(values[0])
            if len(values) > 0
            else None
        )

        # ====================================================
        # NAME ALREADY EXISTS
        # ====================================================

        if (
            name
            and str(name).strip().lower() == target
        ):
            d_cell = (
                values[2]
                if len(values) > 2
                else None
            )

            # Already certified.
            if is_google_cell_colored(d_cell):

                update_hert_cache(
                    member_name_clean,
                    True
                )

                return True, "already_certified"

            # Name exists but certification color is missing.
            update_sheet_cells(service, HERT_SHEET_NAME, [(i, 3, None, (0, 1, 0))])

            update_hert_cache(
                member_name_clean,
                True
            )

            return True, "added"

        # ====================================================
        # REMEMBER FIRST EMPTY B
        # ====================================================

        if first_empty is None and not name:
            first_empty = i

    # ========================================================
    # MEMBER DOES NOT EXIST
    # ========================================================

    if first_empty is not None:

        update_sheet_cells(service, HERT_SHEET_NAME, [
            (first_empty, 1, member_name_clean, None),
            (first_empty, 3, None, (0, 1, 0)),
        ])

        update_hert_cache(
            member_name_clean,
            True
        )

        return True, "added"

    return False, "no_empty_row"


def remove_hert_certification(member_name):
    if not member_name or not str(member_name).strip():
        return False, "not_found"

    member_name_clean = str(
        member_name
    ).strip()

    service = get_google_sheets_service()

    result = service.spreadsheets().get(
        spreadsheetId=GOOGLE_SHEET_ID,
        ranges=[
            f"'{HERT_SHEET_NAME}'!B2:D450"
        ],
        includeGridData=True
    ).execute()

    sheets = result.get(
        "sheets",
        []
    )

    if not sheets:
        return False, "sheet_not_found"

    rows = (
        sheets[0]
        .get("data", [{}])[0]
        .get("rowData", [])
    )

    target = member_name_clean.lower()

    matches = []
    for i, row in enumerate(
        rows,
        start=2
    ):
        values = row.get(
            "values",
            []
        )

        name = (
            get_cell_value(values[0])
            if len(values) > 0
            else None
        )

        if not name:
            continue

        if str(name).strip().lower() != target:
            continue
        d_cell = values[2] if len(values) > 2 else None
        matches.append((i, is_google_cell_colored(d_cell)))

    if matches:
        was_certified = any(colored for _, colored in matches)
        if was_certified:
            update_sheet_cells(service, HERT_SHEET_NAME, [
                operation
                for row_index, _ in matches
                for operation in (
                    (row_index, 1, "", None),
                    (row_index, 3, None, (1, 1, 1)),
                )
            ])

        update_hert_cache(member_name_clean, False)
        return True, "removed" if was_certified else "already_removed"

    update_hert_cache(
        member_name_clean,
        False
    )

    return False, "not_found"


# ============================================================
# AUDIT LOG HELPERS
# ============================================================

def log_training_change(
    callsign,
    member_name,
    training_name,
    action,
    changed_by="Web Commander"
):
    con = db()

    try:
        con.execute(
            """
            INSERT INTO TrainingLog(
                callsign,
                member_name,
                training_name,
                action,
                changed_by,
                log_date
            )
            VALUES(?,?,?,?,?,?)
            """,
            (
                callsign.upper(),
                member_name,
                training_name,
                action,
                changed_by or "Web Commander",
                datetime.datetime.now().isoformat(
                    timespec="seconds"
                )
            )
        )

        con.commit()

    finally:
        con.close()


def log_exam_change(
    callsign,
    member_name,
    exam_name,
    action,
    changed_by="Web Commander"
):
    con = db()

    try:
        con.execute(
            """
            INSERT INTO ExamLog(
                callsign,
                member_name,
                exam_name,
                action,
                changed_by,
                log_date
            )
            VALUES(?,?,?,?,?,?)
            """,
            (
                callsign.upper(),
                member_name,
                exam_name,
                action,
                changed_by or "Web Commander",
                datetime.datetime.now().isoformat(
                    timespec="seconds"
                )
            )
        )

        con.commit()

    finally:
        con.close()


def log_note_change(
    callsign,
    member_name,
    action,
    note="",
    changed_by="Web Commander"
):
    con = db()

    try:
        con.execute(
            """
            INSERT INTO NoteLog(
                callsign,
                member_name,
                action,
                note,
                changed_by,
                log_date
            )
            VALUES(?,?,?,?,?,?)
            """,
            (
                callsign.upper(),
                member_name,
                action,
                note or "",
                changed_by or "Web Commander",
                datetime.datetime.now().isoformat(
                    timespec="seconds"
                )
            )
        )

        con.commit()

    finally:
        con.close()


# ============================================================
# TERMINATION LOG
# ============================================================


def log_termination(
    callsign,
    member_name,
    rank,
    terminated_by="Web Commander",
    reason=""
):
    con = db()

    try:
        con.execute(
            """
            INSERT INTO TerminationLog(
                callsign,
                member_name,
                rank,
                terminated_by,
                reason,
                termination_date
            )
            VALUES(?,?,?,?,?,?)
            """,
            (
                callsign.upper(),
                member_name,
                rank,
                terminated_by or "Web Commander",
                reason or "",
                datetime.datetime.now().isoformat(
                    timespec="seconds"
                )
            )
        )

        con.commit()

    finally:
        con.close()


# ============================================================
# TRAININGS / EXAMS GOOGLE COLOR
# ============================================================

def set_google_training_color(
    callsign,
    column_letter,
    remove=False
):
    service = get_google_sheets_service()

    row = find_row_by_callsign(
        service,
        callsign
    )

    if not row:
        return False

    colors = {
        "F": (0, 1, 1),
        "G": (0.6, 0, 1),
        "H": (0.6, 0, 0),
    }

    letter = column_letter.upper()

    if letter not in colors:
        return False

    col = ord(letter) - 65

    update_sheet_cell(
        service,
        GOOGLE_SHEET_NAME,
        row,
        col,
        bg_color=(
            1,
            1,
            1
        )
        if remove
        else colors[letter]
    )

    return True


def update_sheet_cells(service, sheet_name, operations):
    """Apply a set of cell value/format edits in one atomic Sheets request."""
    sheet_id = get_sheet_id_by_name(service, sheet_name)
    if sheet_id is None:
        raise ValueError(f"Sheet not found: {sheet_name}")
    requests = []
    for row_number, col_index, value, bg_color in operations:
        cell_range = {
            "sheetId": sheet_id,
            "startRowIndex": row_number - 1,
            "endRowIndex": row_number,
            "startColumnIndex": col_index,
            "endColumnIndex": col_index + 1,
        }
        if value is not None:
            requests.append({
                "updateCells": {
                    "range": cell_range,
                    "rows": [{"values": [{"userEnteredValue": {"stringValue": str(value)}}]}],
                    "fields": "userEnteredValue",
                }
            })
        if bg_color is not None:
            requests.append({
                "repeatCell": {
                    "range": cell_range,
                    "cell": {"userEnteredFormat": {"backgroundColor": {
                        "red": bg_color[0], "green": bg_color[1], "blue": bg_color[2],
                    }}},
                    "fields": "userEnteredFormat.backgroundColor",
                }
            })
    if requests:
        service.spreadsheets().batchUpdate(
            spreadsheetId=GOOGLE_SHEET_ID, body={"requests": requests}
        ).execute()
    return True


# ============================================================
# ACTIVITY CACHE
# ============================================================

def get_member_activity_status(callsign):
    con = db()

    row = con.execute(
        """
        SELECT activity
        FROM SheetCache
        WHERE callsign=?
        """,
        (
            callsign.upper(),
        )
    ).fetchone()

    con.close()

    return (
        row["activity"]
        if row
        else "Active"
    )


def set_google_activity_status(
    callsign,
    activity_type
):
    colors = {
        "Active": (1, 1, 1),
        "Semi Active": (1, 1, 0.2),
        "Inactive": (1, 0.5, 0),
        "Can Be Terminated": (1, 0, 0),
    }

    if activity_type not in colors:
        return False

    service = get_google_sheets_service()

    row = find_row_by_callsign(
        service,
        callsign
    )

    if not row:
        return False

    update_sheet_cell(
        service,
        GOOGLE_SHEET_NAME,
        row,
        8,
        bg_color=colors[activity_type]
    )

    con = db()

    con.execute(
        """
        INSERT INTO SheetCache(
            callsign,
            activity,
            sheet_row
        )
        VALUES(?,?,?)

        ON CONFLICT(callsign)
        DO UPDATE SET
            activity=excluded.activity,
            sheet_row=excluded.sheet_row
        """,
        (
            callsign.upper(),
            activity_type,
            row,
        )
    )

    con.commit()
    con.close()

    return True


# ============================================================
# CAN BE TERMINATED
# ============================================================

def get_terminated_members_from_sheet():
    """Read the local cache; never fetch Google data in a request handler."""
    return get_inactive_members()


def can_be_terminated_members():
    return get_terminated_members_from_sheet()


# ============================================================
# NOTES / DATE
# ============================================================

def update_google_sheet_note(
    callsign,
    note_text
):
    service = get_google_sheets_service()

    row = find_row_by_callsign(
        service,
        callsign
    )

    if not row:
        return False

    update_sheet_cell(
        service,
        GOOGLE_SHEET_NAME,
        row,
        10,
        value=note_text
    )

    return True


def update_google_sheet_date(
    callsign,
    date_str
):
    service = get_google_sheets_service()

    row = find_row_by_callsign(
        service,
        callsign
    )

    if not row:
        return False

    update_sheet_cell(
        service,
        GOOGLE_SHEET_NAME,
        row,
        3,
        value=date_str
    )

    return True


# ============================================================
# TERMINATION IN GOOGLE SHEETS
# ============================================================

def terminate_member_in_google_sheets(
    callsign,
    member_name
):
    service = get_google_sheets_service()

    row = find_row_by_callsign(
        service,
        callsign
    )

    if row:

        sheet_id = get_sheet_id_by_name(
            service,
            GOOGLE_SHEET_NAME
        )

        requests = [
            {
                "updateCells": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": row - 1,
                        "endRowIndex": row,
                        "startColumnIndex": 1,
                        "endColumnIndex": 2,
                    },
                    "rows": [{"values": [{"userEnteredValue": {"stringValue": str(callsign)}}]}],
                    "fields": "userEnteredValue",
                }
            },
            {
                "updateCells": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": row - 1,
                        "endRowIndex": row,
                        "startColumnIndex": 2,
                        "endColumnIndex": 9,
                    },
                    "rows": [
                        {
                            "values": [
                                {}
                                for _ in range(7)
                            ]
                        }
                    ],
                    "fields":
                        "userEnteredValue,"
                        "userEnteredFormat.backgroundColor",
                }
            },

            {
                "updateCells": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": row - 1,
                        "endRowIndex": row,
                        "startColumnIndex": 10,
                        "endColumnIndex": 13,
                    },
                    "rows": [
                        {
                            "values": [
                                {}
                                for _ in range(3)
                            ]
                        }
                    ],
                    "fields":
                        "userEnteredValue,"
                        "userEnteredFormat.backgroundColor",
                }
            }
        ]

        service.spreadsheets().batchUpdate(
            spreadsheetId=GOOGLE_SHEET_ID,
            body={
                "requests": requests
            }
        ).execute()

    # ========================================================
    # REMOVE HERT
    # ========================================================

    result = service.spreadsheets().get(
        spreadsheetId=GOOGLE_SHEET_ID,
        ranges=[
            f"'{HERT_SHEET_NAME}'!B2:D450"
        ],
        includeGridData=True
    ).execute()

    rows = (
        result["sheets"][0]
        .get("data", [{}])[0]
        .get("rowData", [])
    )

    target = member_name.strip().lower()

    for i, row_data in enumerate(
        rows,
        start=2
    ):
        values = row_data.get(
            "values",
            []
        )

        name = (
            get_cell_value(values[0])
            if values
            else None
        )

        if (
            name
            and str(name).strip().lower() == target
        ):

            update_sheet_cell(
                service,
                HERT_SHEET_NAME,
                i,
                1,
                value=""
            )

            update_sheet_cell(
                service,
                HERT_SHEET_NAME,
                i,
                3,
                bg_color=(1, 1, 1)
            )

            update_hert_cache(
                member_name,
                False
            )

            break

    return True


# ============================================================
# RANK DETECTION
# ============================================================

def detect_rank_from_callsign(callsign):
    if not callsign:
        return None

    c = str(
        callsign
    ).upper().strip()

    if c.startswith("COM-"):
        return "Commissioners"

    if c.startswith("CHIEF-"):
        return "Chief"

    if c.startswith("B-"):
        return "County Command"

    if c.startswith("DIV-"):
        return "Division Commander"

    if c.startswith("C-"):
        return "Captain"

    if c.startswith("E-"):
        return "Lieutenant"

    if c.startswith("L-"):
        return "Lead Paramedic"

    if c.startswith("M-"):
        return "Paramedic"

    if c.startswith("A-"):
        return "AEMT"

    if c.startswith("R-"):
        return "EMT"

    if c.startswith("P-"):
        return "Probationary"

    if c.startswith("S-"):
        return "Senior Volunteer"

    if c.startswith("V-"):
        try:
            number = int(
                c.split("-", 1)[1]
            )
        except (
            ValueError,
            IndexError
        ):
            return "Volunteer"

        if number in PROBATIONARY_VOLUNTEER_NUMBERS:
            return "Probationary Volunteer"

        return "Volunteer"

    return None


# ============================================================
# CALLSIGN MATCHING
# ============================================================

def callsign_matches_rank(
    callsign,
    rank_name
):
    callsign = str(
        callsign or ""
    ).strip().upper()

    rank_name = str(
        rank_name or ""
    ).strip()

    if not callsign or not rank_name:
        return False

    if rank_name == "Advanced EMT":
        rank_name = "AEMT"

    detected = detect_rank_from_callsign(
        callsign
    )

    return detected == rank_name


# ============================================================
# GOOGLE SHEET IMPORT / SYNC
# ============================================================

def import_google_sheet_data():
    # Startup import reads the remote ranges once and stores results in SQLite.
    # Manual sync invokes this same refresh path explicitly.
    data = get_google_sheet_data()

    hert_certifications = None
    try:
        hert_sheet = next(
            (sheet for sheet in data.get("sheets", [])
             if sheet.get("properties", {}).get("title") == HERT_SHEET_NAME),
            None,
        )
        if hert_sheet is None:
            raise ValueError(f"Sheet '{HERT_SHEET_NAME}' returned no data")

        hert_certifications = {}
        hert_rows = hert_sheet.get("data", [{}])[0].get("rowData", [])
        for row_data in hert_rows:
            cells = row_data.get("values", [])
            member_name = get_cell_value(cells[0]) if cells else None
            if not member_name or not str(member_name).strip():
                continue
            key = str(member_name).strip().lower()
            d_cell = cells[2] if len(cells) > 2 else None
            hert_certifications[key] = (
                hert_certifications.get(key, False)
                or is_google_cell_colored(d_cell)
            )
    except Exception as e:
        logger.info(f"[LVFR EMS] HERT cache sync skipped: {e}")

    sheets = [sheet for sheet in data.get("sheets", [])
              if sheet.get("properties", {}).get("title") == GOOGLE_SHEET_NAME]

    if not sheets:
        raise ValueError(
            f"Sheet '{GOOGLE_SHEET_NAME}' returned no data"
        )

    rows = (
        sheets[0]
        .get("data", [{}])[0]
        .get("rowData", [])
    )

    con = db()
    cur = con.cursor()

    current_rank = "Probationary"

    today = datetime.date.today()

    imported_members = 0
    imported_exams = 0
    imported_trainings = 0

    seen_callsigns = set()

    for row_number, row_data in enumerate(
        rows,
        start=2
    ):

        values = row_data.get(
            "values",
            []
        )

        if len(values) < 13:
            values += [
                {}
                for _ in range(
                    13 - len(values)
                )
            ]

        callsign_val = get_cell_value(
            values[1]
        )

        name_val = get_cell_value(
            values[2]
        )

        date_val = get_cell_value(
            values[3]
        )

        tig_val = get_cell_value(
            values[4]
        )

        note_val = get_cell_value(
            values[10]
        )

        callsign = (
            str(callsign_val).strip()
            if callsign_val is not None
            else None
        )

        name = (
            str(name_val).strip()
            if name_val is not None
            else None
        )

        # ====================================================
        # RANK HEADER
        # ====================================================

        if callsign and not name:

            clean_header = callsign.lower().strip()

            if clean_header in RANK_MAP:
                current_rank = RANK_MAP[
                    clean_header
                ]

            continue

        if not callsign and name:

            clean_header = name.lower().strip()

            if clean_header in RANK_MAP:
                current_rank = RANK_MAP[
                    clean_header
                ]

            continue

        if not callsign or not name:
            continue

        callsign_id = callsign.upper()

        # ====================================================
        # RANK
        # ====================================================

        resolved_rank = (
            detect_rank_from_callsign(callsign_id)
            or current_rank
            or "Probationary"
        )

        # ====================================================
        # DATE
        # ====================================================

        assigned_date = today

        if isinstance(
            date_val,
            (int, float)
        ):

            try:
                assigned_date = (
                    datetime.datetime(
                        1899,
                        12,
                        30
                    )
                    + datetime.timedelta(
                        days=float(date_val)
                    )
                ).date()

            except Exception:
                pass

        elif date_val is not None:

            date_text = str(
                date_val
            ).strip()

            for date_format in (
                "%Y-%m-%d",
                "%d/%m/%Y",
                "%m/%d/%Y",
            ):

                try:
                    assigned_date = (
                        datetime.datetime.strptime(
                            date_text[:10],
                            date_format
                        ).date()
                    )

                    break

                except ValueError:
                    pass

        # ====================================================
        # DAYS
        # ====================================================

        days_in_rank = (
            today - assigned_date
        ).days

        if days_in_rank < 0:
            days_in_rank = 0

        if tig_val is not None:

            try:
                tig_int = int(
                    float(tig_val)
                )

                if tig_int >= 0:
                    days_in_rank = tig_int

            except (
                ValueError,
                TypeError
            ):
                pass

        # ====================================================
        # NOTES
        # ====================================================

        notes = (
            str(note_val).strip()
            if (
                note_val is not None
                and str(note_val).strip()
            )
            else None
        )

        # ====================================================
        # MEMBER
        # ====================================================

        cur.execute(
            """
            INSERT INTO Members(
                discord_id,
                name,
                callsign,
                rank,
                rank_assigned_date,
                days_in_rank,
                notes
            )
            VALUES(?,?,?,?,?,?,?)

            ON CONFLICT(callsign)
            DO UPDATE SET
                name=excluded.name,
                rank=excluded.rank,
                rank_assigned_date=excluded.rank_assigned_date,
                days_in_rank=excluded.days_in_rank,
                notes=excluded.notes
            """,
            (
                0,
                name,
                callsign_id,
                resolved_rank,
                assigned_date.isoformat(),
                days_in_rank,
                notes,
            )
        )

        seen_callsigns.add(
            callsign_id
        )

        # ====================================================
        # ACTIVITY
        # ====================================================

        activity = parse_activity_color(
            values[8]
        )

        cur.execute(
            """
            INSERT INTO SheetCache(
                callsign,
                activity,
                sheet_row
            )
            VALUES(?,?,?)

            ON CONFLICT(callsign)
            DO UPDATE SET
                activity=excluded.activity,
                sheet_row=COALESCE(excluded.sheet_row, SheetCache.sheet_row)
            """,
            (
                callsign_id,
                activity,
                row_number,
            )
        )

        # ====================================================
        # EXAM
        # ====================================================

        cur.execute(
            """
            DELETE FROM Exams
            WHERE callsign=?
            AND exam_name='supervisor_exam'
            """,
            (callsign_id,)
        )

        # ====================================================
        # TRAININGS
        # ====================================================

        cur.execute(
            """
            DELETE FROM Trainings
            WHERE callsign=?
            AND training_name IN(
                'basic_firefighting',
                'advanced_firefighting'
            )
            """,
            (callsign_id,)
        )

        # ====================================================
        # F = SUPERVISOR EXAM
        # ====================================================

        if is_google_cell_colored(
            values[5]
        ):

            cur.execute(
                """
                INSERT OR IGNORE INTO Exams(
                    callsign,
                    exam_name
                )
                VALUES(?,?)
                """,
                (
                    callsign_id,
                    "supervisor_exam"
                )
            )

            imported_exams += 1

        # ====================================================
        # G = BASIC FIREFIGHTING
        # ====================================================

        if is_google_cell_colored(
            values[6]
        ):

            cur.execute(
                """
                INSERT OR IGNORE INTO Trainings(
                    callsign,
                    training_name
                )
                VALUES(?,?)
                """,
                (
                    callsign_id,
                    "basic_firefighting"
                )
            )

            imported_trainings += 1

        # ====================================================
        # H = ADVANCED FIREFIGHTING
        # ====================================================

        if is_google_cell_colored(
            values[7]
        ):

            cur.execute(
                """
                INSERT OR IGNORE INTO Trainings(
                    callsign,
                    training_name
                )
                VALUES(?,?)
                """,
                (
                    callsign_id,
                    "advanced_firefighting"
                )
            )

            imported_trainings += 1

        imported_members += 1

    # ========================================================
    # REMOVE OLD ACTIVITY CACHE
    # ========================================================

    if seen_callsigns:

        placeholders = ",".join(
            "?"
            for _ in seen_callsigns
        )

        cur.execute(
            f"""
            DELETE FROM SheetCache
            WHERE callsign NOT IN(
                {placeholders}
            )
            """,
            tuple(seen_callsigns)
        )

    else:
        cur.execute(
            "DELETE FROM SheetCache"
        )

    # Keep list filters aligned with the HERT sheet. A failed HERT request
    # leaves the last known cache intact; a successful read replaces it.
    if hert_certifications is not None:
        cur.execute("DELETE FROM HERTCache")
        hert_synced_at = datetime.datetime.now().isoformat(timespec="seconds")
        for member_name, certified in hert_certifications.items():
            cur.execute(
                """
                INSERT INTO HERTCache(member_name, certified, synced_at)
                VALUES(?,?,?)
                """,
                (member_name, 1 if certified else 0, hert_synced_at)
            )

    # ========================================================
    # SYNC TIME
    # ========================================================

    synced_at = (
        datetime.datetime.now()
        .isoformat(
            timespec="seconds"
        )
    )

    cur.execute(
        """
        INSERT INTO SyncState(
            id,
            synced_at
        )
        VALUES(1,?)

        ON CONFLICT(id)
        DO UPDATE SET
            synced_at=excluded.synced_at
        """,
        (synced_at,)
    )

    con.commit()
    con.close()

    return {
        "members": imported_members,
        "trainings": imported_trainings,
        "exams": imported_exams,
        "hert_members": len(hert_certifications or {}),
        "synced_at": synced_at,
    }


# ============================================================
# CALLSIGN ALLOCATION
# ============================================================

def get_next_available_callsign(rank_name):
    if rank_name == "Advanced EMT":
        rank_name = "AEMT"

    if rank_name not in RANK_PREFIXES:
        raise ValueError(
            f"Unknown rank: {rank_name}"
        )

    prefix = RANK_PREFIXES[
        rank_name
    ]

    con = db()
    try:
        rows = con.execute(
            "SELECT callsign, name FROM Members"
        ).fetchall()
    finally:
        con.close()

    candidates = []

    for row in rows:
        callsign = str(row["callsign"] or "").strip()
        name = str(row["name"] or "").strip()

        if not callsign:
            continue

        normalized = callsign.upper()

        if not normalized.startswith(
            prefix.upper() + "-"
        ):
            continue

        if not callsign_matches_rank(
            normalized,
            rank_name
        ):
            continue

        if name:
            continue

        try:
            number = int(
                normalized.split("-", 1)[1]
            )
        except (
            ValueError,
            IndexError
        ):
            continue

        candidates.append(
            (
                number,
                normalized
            )
        )

    candidates.sort(
        key=lambda x: x[0]
    )

    if candidates:
        return candidates[0][1]

    raise ValueError(
        f"No existing empty callsign available for rank {rank_name}"
    )


# ============================================================
# ELIGIBILITY
# ============================================================

def check_eligibility_with_conn(
    cur,
    callsign
):
    row = cur.execute(
        """
        SELECT *
        FROM Members
        WHERE callsign=?
        """,
        (
            callsign.upper(),
        )
    ).fetchone()

    if not row:
        return (
            False,
            "Member not found",
            None
        )

    current_rank = str(
        row["rank"]
    ).strip()

    if current_rank in (
        "Probationary",
        "Probie",
        "Probationary Volunteer",
        "Probie Volunteer"
    ):
        return (
            False,
            "This rank is never eligible for promotion",
            None
        )

    next_rank = None

    for rank, requirements in (
        RANK_REQUIREMENTS.items()
    ):
        if current_rank in requirements["from"]:
            next_rank = rank
            break

    if not next_rank:
        return (
            False,
            "No automatic promotion available",
            None
        )

    requirements = RANK_REQUIREMENTS[
        next_rank
    ]

    missing = []

    days = int(
        row["days_in_rank"] or 0
    )

    if days < requirements["days"]:
        missing.append(
            f"{requirements['days'] - days} more day(s)"
        )

    got_trainings = {
        item["training_name"]
        for item in cur.execute(
            """
            SELECT training_name
            FROM Trainings
            WHERE callsign=?
            """,
            (
                callsign.upper(),
            )
        )
    }

    got_exams = {
        item["exam_name"]
        for item in cur.execute(
            """
            SELECT exam_name
            FROM Exams
            WHERE callsign=?
            """,
            (
                callsign.upper(),
            )
        )
    }

    for training in requirements["trainings"]:
        if training not in got_trainings:
            missing.append(training)

    for exam in requirements["exams"]:
        if exam not in got_exams:
            missing.append(exam)

    if not missing:
        return (
            True,
            "Eligible for Promotion",
            next_rank
        )

    return (
        False,
        ", ".join(missing),
        next_rank
    )


def check_eligibility(callsign):
    con = db()

    result = check_eligibility_with_conn(
        con.cursor(),
        callsign
    )

    con.close()

    return result


# ============================================================
# PROMOTION / RANK CHANGE DATABASE
# ============================================================

def perform_rank_change(
    old_callsign,
    new_rank,
    promoted_by,
    promotion_type="NORMAL",
    target_callsign=None
):
    con = db()
    cur = con.cursor()

    old_cs = old_callsign.upper()

    row = cur.execute(
        """
        SELECT *
        FROM Members
        WHERE callsign=?
        """,
        (old_cs,)
    ).fetchone()

    if not row:
        con.close()
        raise ValueError(
            "Member not found"
        )

    new_cs = (
        target_callsign.upper()
        if target_callsign
        else get_next_available_callsign(new_rank)
    )

    if new_cs == old_cs:
        con.close()
        raise ValueError(
            "New callsign must be different from current callsign"
        )

    trainings = cur.execute(
        """
        SELECT training_name
        FROM Trainings
        WHERE callsign=?
        """,
        (old_cs,)
    ).fetchall()

    exams = cur.execute(
        """
        SELECT exam_name
        FROM Exams
        WHERE callsign=?
        """,
        (old_cs,)
    ).fetchall()

    target = cur.execute(
        """
        SELECT name
        FROM Members
        WHERE callsign=?
        """,
        (new_cs,)
    ).fetchone()

    if target and target["name"]:
        con.close()
        raise ValueError(
            "Target callsign is occupied"
        )

    today = datetime.date.today().isoformat()

    # ========================================================
    # CREATE / UPDATE TARGET MEMBER
    # ========================================================

    cur.execute(
        """
        INSERT OR IGNORE INTO Members(
            callsign,
            name,
            rank,
            rank_assigned_date,
            days_in_rank,
            notes,
            discord_id
        )
        VALUES(?,?,?,?,?,?,?)
        """,
        (
            new_cs,
            row["name"],
            new_rank,
            today,
            0,
            row["notes"],
            row["discord_id"],
        )
    )

    cur.execute(
        """
        UPDATE Members
        SET
            name=?,
            rank=?,
            rank_assigned_date=?,
            days_in_rank=0,
            notes=?,
            discord_id=?
        WHERE callsign=?
        """,
        (
            row["name"],
            new_rank,
            today,
            row["notes"],
            row["discord_id"],
            new_cs,
        )
    )

    # ========================================================
    # CLEAR TARGET TRAININGS / EXAMS
    # ========================================================

    cur.execute(
        """
        DELETE FROM Trainings
        WHERE callsign=?
        """,
        (new_cs,)
    )

    cur.execute(
        """
        DELETE FROM Exams
        WHERE callsign=?
        """,
        (new_cs,)
    )

    # ========================================================
    # COPY TRAININGS
    # ========================================================

    for training in trainings:
        cur.execute(
            """
            INSERT OR IGNORE INTO Trainings(
                callsign,
                training_name
            )
            VALUES(?,?)
            """,
            (
                new_cs,
                training["training_name"]
            )
        )

    # ========================================================
    # COPY EXAMS
    # ========================================================

    for exam in exams:
        cur.execute(
            """
            INSERT OR IGNORE INTO Exams(
                callsign,
                exam_name
            )
            VALUES(?,?)
            """,
            (
                new_cs,
                exam["exam_name"]
            )
        )

    # ========================================================
    # EMPTY OLD CALLSIGN
    # ========================================================

    cur.execute(
        """
        UPDATE Members
        SET
            name='',
            days_in_rank=0,
            notes=NULL
        WHERE callsign=?
        """,
        (old_cs,)
    )

    # ========================================================
    # REMOVE OLD TRAININGS / EXAMS
    # ========================================================

    cur.execute(
        """
        DELETE FROM Trainings
        WHERE callsign=?
        """,
        (old_cs,)
    )

    cur.execute(
        """
        DELETE FROM Exams
        WHERE callsign=?
        """,
        (old_cs,)
    )

    # ========================================================
    # ACTIVITY CACHE
    # ========================================================

    old_activity = cur.execute(
        """
        SELECT activity
        FROM SheetCache
        WHERE callsign=?
        """,
        (old_cs,)
    ).fetchone()

    cur.execute(
        """
        DELETE FROM SheetCache
        WHERE callsign=?
        """,
        (old_cs,)
    )

    if old_activity:
        cur.execute(
            """
            INSERT INTO SheetCache(
                callsign,
                activity,
                sheet_row
            )
            VALUES(?,?,NULL)

            ON CONFLICT(callsign)
            DO UPDATE SET
                activity=excluded.activity
            """,
            (
                new_cs,
                old_activity["activity"]
            )
        )

    # ========================================================
    # PROMOTION HISTORY
    # ========================================================

    cur.execute(
        """
        INSERT INTO Promotions(
            callsign,
            old_rank,
            new_rank,
            old_callsign,
            new_callsign,
            promoted_by,
            promo_date,
            operation_type
        )
        VALUES(?,?,?,?,?,?,?,?)
        """,
        (
            new_cs,
            row["rank"],
            new_rank,
            old_cs,
            new_cs,
            promoted_by,
            today,
            promotion_type,
        )
    )

    con.commit()
    con.close()

    return new_cs


# ============================================================
# TERMINATION DATABASE
# ============================================================

def perform_termination(
    callsign,
    terminated_by="Web Commander",
    reason=""
):
    callsign = callsign.upper()

    con = db()
    cur = con.cursor()

    member = cur.execute(
        """
        SELECT name, rank
        FROM Members
        WHERE callsign=?
        """,
        (callsign,)
    ).fetchone()

    if not member:
        con.close()
        raise ValueError(
            "Member not found"
        )

    log_name = member["name"] or ""
    log_rank = member["rank"] or ""

    cur.execute(
        """
        UPDATE Members
        SET
            name='',
            rank=rank,
            rank_assigned_date=?,
            days_in_rank=0,
            notes=NULL
        WHERE callsign=?
        """,
        (
            datetime.date.today().isoformat(),
            callsign
        )
    )

    cur.execute(
        """
        DELETE FROM Trainings
        WHERE callsign=?
        """,
        (callsign,)
    )

    cur.execute(
        """
        DELETE FROM Exams
        WHERE callsign=?
        """,
        (callsign,)
    )

    cur.execute(
        """
        DELETE FROM SheetCache
        WHERE callsign=?
        """,
        (callsign,)
    )

    con.commit()
    con.close()

    log_termination(
        callsign,
        log_name,
        log_rank,
        terminated_by,
        reason
    )


# ============================================================
# GOOGLE TRAINING COLOR CLEAR
# ============================================================

def clear_google_training_colors(
    service,
    row_number
):
    sheet_id = get_sheet_id_by_name(
        service,
        GOOGLE_SHEET_NAME
    )

    if sheet_id is None:
        raise ValueError(
            f"Sheet not found: {GOOGLE_SHEET_NAME}"
        )

    service.spreadsheets().batchUpdate(
        spreadsheetId=GOOGLE_SHEET_ID,
        body={
            "requests": [
                {
                    "repeatCell": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": row_number - 1,
                            "endRowIndex": row_number,
                            "startColumnIndex": 5,
                            "endColumnIndex": 8,
                        },
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": {
                                    "red": 1,
                                    "green": 1,
                                    "blue": 1
                                }
                            }
                        },
                        "fields":
                            "userEnteredFormat.backgroundColor"
                    }
                }
            ]
        }
    ).execute()

    return True


# ============================================================
# COPY PROMOTION FORMATTING
# ============================================================

def copy_promotion_colors(
    service,
    old_row,
    new_row
):
    if old_row == new_row:
        return True

    sheet_id = get_sheet_id_by_name(
        service,
        GOOGLE_SHEET_NAME
    )

    if sheet_id is None:
        raise ValueError(
            f"Sheet not found: {GOOGLE_SHEET_NAME}"
        )

    service.spreadsheets().batchUpdate(
        spreadsheetId=GOOGLE_SHEET_ID,
        body={
            "requests": [
                {
                    "copyPaste": {
                        "source": {
                            "sheetId": sheet_id,
                            "startRowIndex": old_row - 1,
                            "endRowIndex": old_row,
                            "startColumnIndex": 5,
                            "endColumnIndex": 9,
                        },
                        "destination": {
                            "sheetId": sheet_id,
                            "startRowIndex": new_row - 1,
                            "endRowIndex": new_row,
                            "startColumnIndex": 5,
                            "endColumnIndex": 9,
                        },
                        "pasteType": "PASTE_FORMAT"
                    }
                }
            ]
        }
    ).execute()

    return True


# ============================================================
# PROMOTION -> GOOGLE SHEETS
# ============================================================

def sync_promotion_to_google_sheet(
    old_callsign,
    new_callsign,
    name,
    new_rank
):
    service = get_google_sheets_service()

    old_callsign = str(
        old_callsign
    ).strip().upper()

    new_callsign = str(
        new_callsign
    ).strip().upper()

    old_info = get_google_callsign_info(
        old_callsign
    )

    if old_info is None:
        raise ValueError(
            f"Old callsign {old_callsign} does not exist in Google Sheet"
        )

    old_row = old_info["row"]

    new_info = get_google_callsign_info(
        new_callsign
    )

    if new_info is None:
        raise ValueError(
            f"Callsign {new_callsign} does not exist in Google Sheet"
        )

    new_row = new_info["row"]

    if new_info["name"].strip():
        raise ValueError(
            f"Callsign {new_callsign} is already assigned"
        )

    if old_row == new_row:
        raise ValueError(
            "Old and new callsign point to the same Google Sheet row"
        )

    data = service.spreadsheets().values().get(
        spreadsheetId=GOOGLE_SHEET_ID,
        range=(
            f"'{GOOGLE_SHEET_NAME}'!"
            f"B{old_row}:M{old_row}"
        )
    ).execute().get(
        "values",
        []
    )

    old_values = (
        data[0]
        if data
        else []
    )

    old_values = (
        old_values + [""] * 12
    )[:12]

    b_to_i = old_values[0:8]

    b_to_i[0] = new_callsign
    b_to_i[1] = name

    normalized_rank = str(new_rank or "").strip().casefold()
    new_rank_order = next(
        (
            order for rank, order in RANK_ORDER.items()
            if rank.casefold() == normalized_rank
        ),
        None
    )
    lead_paramedic_order = RANK_ORDER["Lead Paramedic"]

    if new_rank_order is not None and new_rank_order <= lead_paramedic_order:
        # Leadership ranks do not use the promotion date or days-in-rank columns.
        b_to_i[2] = ""
        b_to_i[3] = ""
    else:
        b_to_i[2] = datetime.date.today().strftime("%m/%d/%Y")
        b_to_i[3] = f"=TODAY()-D{new_row}"

    k_to_m = old_values[9:12]

    sheet_id = get_sheet_id_by_name(
        service,
        GOOGLE_SHEET_NAME
    )
    def cell_value(value):
        value = str(value or "")
        if value.startswith("="):
            return {"formulaValue": value}
        return {"stringValue": value}

    requests = [
        {
            "copyPaste": {
                "source": {"sheetId": sheet_id, "startRowIndex": old_row - 1,
                           "endRowIndex": old_row, "startColumnIndex": 5, "endColumnIndex": 9},
                "destination": {"sheetId": sheet_id, "startRowIndex": new_row - 1,
                                "endRowIndex": new_row, "startColumnIndex": 5, "endColumnIndex": 9},
                "pasteType": "PASTE_FORMAT",
            }
        },
        {
            "updateCells": {
                "range": {"sheetId": sheet_id, "startRowIndex": new_row - 1,
                          "endRowIndex": new_row, "startColumnIndex": 1, "endColumnIndex": 8},
                "rows": [{"values": [{"userEnteredValue": cell_value(value)} for value in b_to_i]}],
                "fields": "userEnteredValue",
            }
        },
        {
            "updateCells": {
                "range": {"sheetId": sheet_id, "startRowIndex": new_row - 1,
                          "endRowIndex": new_row, "startColumnIndex": 10, "endColumnIndex": 13},
                "rows": [{"values": [{"userEnteredValue": cell_value(value)} for value in k_to_m]}],
                "fields": "userEnteredValue",
            }
        },
    ]
    for start_column, end_column in ((2, 9), (10, 13)):
        requests.append({
            "updateCells": {
                "range": {"sheetId": sheet_id, "startRowIndex": old_row - 1,
                          "endRowIndex": old_row, "startColumnIndex": start_column,
                          "endColumnIndex": end_column},
                "rows": [{"values": [{} for _ in range(end_column - start_column)]}],
                "fields": "userEnteredValue,userEnteredFormat.backgroundColor",
            }
        })
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_id, "startRowIndex": old_row - 1,
                      "endRowIndex": old_row, "startColumnIndex": 8, "endColumnIndex": 9},
            "cell": {"userEnteredFormat": {"backgroundColor": {"red": 1, "green": 1, "blue": 1}}},
            "fields": "userEnteredFormat.backgroundColor",
        }
    })
    requests.append({
        "updateCells": {
            "range": {"sheetId": sheet_id, "startRowIndex": old_row - 1,
                      "endRowIndex": old_row, "startColumnIndex": 1, "endColumnIndex": 2},
            "rows": [{"values": [{"userEnteredValue": {"stringValue": old_callsign}}]}],
            "fields": "userEnteredValue",
        }
    })
    service.spreadsheets().batchUpdate(
        spreadsheetId=GOOGLE_SHEET_ID, body={"requests": requests}
    ).execute()

    return True


# ============================================================
# MEMBER PROFILE
# ============================================================

def member_name_for_callsign(callsign):
    member = member_info_for_callsign(callsign)
    return member["name"] if member else None


def member_info_for_callsign(callsign):
    con = db()
    try:
        row = con.execute(
            "SELECT name, rank FROM Members WHERE callsign=?",
            (str(callsign or "").strip().upper(),),
        ).fetchone()
        if not row:
            return None
        return {
            "name": str(row["name"] or "").strip(),
            "rank": str(row["rank"] or "").strip(),
        }
    finally:
        con.close()


def member_profile(callsign):
    import time

    started = time.perf_counter()

    callsign = callsign.upper()

    con = db()
    logger.debug(f"[PERF] db() = {time.perf_counter() - started:.4f}s")

    cur = con.cursor()

    row = cur.execute(
        """
        SELECT *
        FROM Members
        WHERE callsign=?
        """,
        (callsign,)
    ).fetchone()

    logger.debug(f"[PERF] member query = {time.perf_counter() - started:.4f}s")

    if not row:
        con.close()
        return None

    trainings = [
        item["training_name"]
        for item in cur.execute(
            """
            SELECT training_name
            FROM Trainings
            WHERE callsign=?
            """,
            (callsign,)
        )
    ]

    logger.debug(f"[PERF] trainings = {time.perf_counter() - started:.4f}s")

    exams = [
        item["exam_name"]
        for item in cur.execute(
            """
            SELECT exam_name
            FROM Exams
            WHERE callsign=?
            """,
            (callsign,)
        )
    ]

    logger.debug(f"[PERF] exams = {time.perf_counter() - started:.4f}s")

    eligible, reason, next_rank = check_eligibility_with_conn(
        cur,
        callsign
    )

    logger.debug(f"[PERF] eligibility = {time.perf_counter() - started:.4f}s")

    hert = False

    if row["name"]:
        hert_row = cur.execute(
            """
            SELECT certified
            FROM HERTCache
            WHERE member_name=?
            LIMIT 1
            """,
            (
                str(row["name"]).strip().lower(),
            )
        ).fetchone()

        if hert_row:
            hert = int(hert_row["certified"]) == 1

    logger.debug(f"[PERF] HERT = {time.perf_counter() - started:.4f}s")

    activity = ""

    activity_row = cur.execute(
        """
        SELECT activity
        FROM SheetCache
        WHERE callsign=?
        LIMIT 1
        """,
        (callsign,)
    ).fetchone()

    if activity_row:
        activity = str(
            activity_row["activity"] or ""
        ).strip()

    logger.debug(f"[PERF] activity = {time.perf_counter() - started:.4f}s")

    result = {
        **dict(row),
        "trainings": trainings,
        "exams": exams,
        "hert": hert,
        "activity": activity,
        "eligible": eligible,
        "eligibility_reason": reason,
        "next_rank": next_rank,
    }

    con.close()

    logger.info(
        f"[PERF] TOTAL member_profile({callsign}) = "
        f"{time.perf_counter() - started:.4f}s"
    )

    return result

# ============================================================
# MEMBER SEARCH
# ============================================================

def list_members(search=""):
    con = db()

    try:
        search = (
            search.strip()
            if search
            else ""
        )

        order_sql = """
            CASE LOWER(TRIM(m.rank))
                WHEN 'commissioners' THEN 1
                WHEN 'chief' THEN 2
                WHEN 'county command' THEN 3
                WHEN 'division commander' THEN 4
                WHEN 'captain' THEN 5
                WHEN 'lieutenant' THEN 6
                WHEN 'lead paramedic' THEN 7
                WHEN 'paramedic' THEN 8
                WHEN 'aemt' THEN 9
                WHEN 'advanced emt' THEN 9
                WHEN 'emt' THEN 10
                WHEN 'probationary' THEN 11
                WHEN 'senior volunteer' THEN 12
                WHEN 'volunteer' THEN 13
                WHEN 'probationary volunteer' THEN 14
                WHEN 'emr' THEN 15
                WHEN 'emr/volunteer' THEN 16
                ELSE 99
            END,
            m.callsign
        """

        if search:
            q = f"%{search.lower()}%"

            rows = con.execute(
                f"""
                SELECT
                    m.*,
                    COALESCE(
                        s.activity,
                        'Active'
                    ) AS activity,
                    COALESCE((
                        SELECT h.certified
                        FROM HERTCache h
                        WHERE lower(trim(h.member_name)) = lower(trim(m.name))
                        LIMIT 1
                    ), 0) AS has_hert,
                    EXISTS(
                        SELECT 1
                        FROM Trainings t
                        WHERE t.callsign=m.callsign
                          AND t.training_name='basic_firefighting'
                    ) AS has_basic_firefighting,
                    EXISTS(
                        SELECT 1
                        FROM Trainings t
                        WHERE t.callsign=m.callsign
                          AND t.training_name='advanced_firefighting'
                    ) AS has_advanced_firefighting,
                    EXISTS(
                        SELECT 1
                        FROM Exams e
                        WHERE e.callsign=m.callsign
                          AND e.exam_name='supervisor_exam'
                    ) AS has_supervisor_exam
                FROM Members m
                LEFT JOIN SheetCache s
                    ON s.callsign=m.callsign
                WHERE
                    m.name<>''
                    AND (
                        LOWER(m.name) LIKE ?
                        OR LOWER(m.callsign) LIKE ?
                        OR LOWER(m.rank) LIKE ?
                    )
                ORDER BY
                    {order_sql}
                """,
                (
                    q,
                    q,
                    q
                )
            ).fetchall()

        else:
            rows = con.execute(
                f"""
                SELECT
                    m.*,
                    COALESCE(
                        s.activity,
                        'Active'
                    ) AS activity,
                    COALESCE((
                        SELECT h.certified
                        FROM HERTCache h
                        WHERE lower(trim(h.member_name)) = lower(trim(m.name))
                        LIMIT 1
                    ), 0) AS has_hert,
                    EXISTS(
                        SELECT 1
                        FROM Trainings t
                        WHERE t.callsign=m.callsign
                          AND t.training_name='basic_firefighting'
                    ) AS has_basic_firefighting,
                    EXISTS(
                        SELECT 1
                        FROM Trainings t
                        WHERE t.callsign=m.callsign
                          AND t.training_name='advanced_firefighting'
                    ) AS has_advanced_firefighting,
                    EXISTS(
                        SELECT 1
                        FROM Exams e
                        WHERE e.callsign=m.callsign
                          AND e.exam_name='supervisor_exam'
                    ) AS has_supervisor_exam
                FROM Members m
                LEFT JOIN SheetCache s
                    ON s.callsign=m.callsign
                WHERE
                    m.name<>''
                ORDER BY
                    {order_sql}
                """
            ).fetchall()

        return [
            dict(row)
            for row in rows
        ]

    finally:
        con.close()


# ============================================================
# ELIGIBLE MEMBERS
# ============================================================

def eligible_members():
    con = db()
    cur = con.cursor()

    out = []

    rows = cur.execute(
        """
        SELECT *
        FROM Members
        WHERE
            name<>''
        ORDER BY
            CASE LOWER(TRIM(rank))
                WHEN 'commissioners' THEN 1
                WHEN 'chief' THEN 2
                WHEN 'county command' THEN 3
                WHEN 'division commander' THEN 4
                WHEN 'captain' THEN 5
                WHEN 'lieutenant' THEN 6
                WHEN 'lead paramedic' THEN 7
                WHEN 'paramedic' THEN 8
                WHEN 'aemt' THEN 9
                WHEN 'advanced emt' THEN 9
                WHEN 'emt' THEN 10
                WHEN 'probationary' THEN 11
                WHEN 'senior volunteer' THEN 12
                WHEN 'volunteer' THEN 13
                WHEN 'probationary volunteer' THEN 14
                WHEN 'emr' THEN 15
                WHEN 'emr/volunteer' THEN 16
                ELSE 99
            END,
            callsign
        """
    ).fetchall()

    for row in rows:

        rank = str(
            row["rank"]
        ).strip()

        if rank in (
            "Probationary",
            "Probie",
            "Probationary Volunteer",
            "Probie Volunteer"
        ):
            continue

        ok, reason, next_rank = (
            check_eligibility_with_conn(
                cur,
                row["callsign"]
            )
        )

        if not ok:
            continue

        out.append(
            {
                **dict(row),

                "next_rank": next_rank,

                "eligible": True,

                "eligibility_reason":
                    reason,
            }
        )

    con.close()

    return out


# ============================================================
# NOTES
# ============================================================

def note_edit(
    callsign,
    action,
    note="",
    changed_by="Web Commander",
    sync_google=True
):
    callsign = callsign.upper()
    con = db()
    try:
        row = con.execute(
            "SELECT name, notes FROM Members WHERE callsign=?", (callsign,)
        ).fetchone()
        if not row:
            raise ValueError("Member not found")

        current = str(row["notes"] or "")
        has_note = bool(current.strip())
        entered_note = str(note or "").strip()
        if action == "Add":
            if has_note:
                raise ValueError("This member already has a note. Choose Edit or Delete.")
            if not entered_note:
                raise ValueError("Enter a note before adding it.")
            new_note = entered_note
        elif action == "Edit":
            if not has_note:
                raise ValueError("This member has no note to edit. Choose Add.")
            if not entered_note:
                raise ValueError("A note cannot be empty. Choose Delete to remove it.")
            new_note = entered_note
        elif action == "Delete":
            if not has_note:
                raise ValueError("This member has no note to delete.")
            new_note = ""
        else:
            raise ValueError("Invalid note action")

        if sync_google:
            update_google_sheet_note(callsign, new_note)
        con.execute("UPDATE Members SET notes=? WHERE callsign=?", (new_note, callsign))
        con.execute(
            """INSERT INTO NoteLog(callsign,member_name,action,note,changed_by,log_date)
               VALUES(?,?,?,?,?,?)""",
            (callsign, row["name"] or "", action.upper(), note or "",
             changed_by or "Web Commander", datetime.datetime.now().isoformat(timespec="seconds")),
        )
        con.commit()
        return new_note
    finally:
        con.close()

# ============================================================
# DATE
# ============================================================

def change_date(
    callsign,
    date_str,
    sync_google=True
):
    d = datetime.datetime.strptime(
        date_str,
        "%m/%d/%Y"
    ).date()

    if sync_google:
        update_google_sheet_date(callsign, date_str)

    con = db()
    try:
        con.execute(
            """UPDATE Members SET rank_assigned_date=?, days_in_rank=? WHERE callsign=?""",
            (d.isoformat(), max(0, (datetime.date.today() - d).days), callsign.upper()),
        )
        con.commit()
    finally:
        con.close()


# ============================================================
# TRAINING CHANGE
# ============================================================

def training_change(
    callsign,
    training,
    remove=False,
    changed_by="Web Commander",
    sync_google=True
):
    callsign = callsign.upper()

    mapping = {
        "Basic Firefighting": "basic_firefighting",
        "Advanced Firefighting": "advanced_firefighting",
    }

    # ========================================================
    # HERT
    # ========================================================

    if training == "Hert":

        profile = member_profile(callsign)

        if not profile:
            return False, "not_found"

        name = profile["name"]

        if not name:
            return False, "not_found"

        if not sync_google:
            cache_key = str(name).strip().lower()
            con = db()
            try:
                row = con.execute(
                    "SELECT certified FROM HERTCache WHERE lower(trim(member_name))=? LIMIT 1",
                    (cache_key,)
                ).fetchone()
            finally:
                con.close()

            is_certified = bool(row and int(row["certified"]) == 1)
            if remove and not is_certified:
                return True, "already_removed"
            if not remove and is_certified:
                return True, "already_certified"

            update_hert_cache(name, not remove)
            log_training_change(
                callsign,
                name,
                "Hert",
                "REMOVED" if remove else "ADDED",
                changed_by
            )
            return True, "removed" if remove else "added"

        if remove:

            result = remove_hert_certification(name)

            if (
                result
                and result[0]
                and result[1] == "removed"
            ):
                log_training_change(
                    callsign,
                    name,
                    "Hert",
                    "REMOVED",
                    changed_by
                )

            return result

        result = add_hert_certification(name)

        if (
            result
            and result[0]
            and result[1] == "added"
        ):
            log_training_change(
                callsign,
                name,
                "Hert",
                "ADDED",
                changed_by
            )

        return result

    # ========================================================
    # NORMAL TRAINING
    # ========================================================

    if training not in mapping:
        raise ValueError(
            f"Unknown training: {training}"
        )

    training_name = mapping[training]

    column = {
        "basic_firefighting": "G",
        "advanced_firefighting": "H",
    }[training_name]

    service = None
    row = None
    if sync_google:
        service = get_google_sheets_service()
        row = find_row_by_callsign(service, callsign)
        if not row:
            return False, "callsign_not_found"

    # ========================================================
    # REMOVE
    # ========================================================

    if remove:

        # ----------------------------------------------------
        # CHECK GOOGLE SHEET
        # ----------------------------------------------------

        google_completed = False
        if sync_google:
            cell = get_google_cell(service, GOOGLE_SHEET_NAME, f"{column}{row}")
            google_completed = is_google_cell_colored(cell)

        # ----------------------------------------------------
        # CHECK DATABASE
        # ----------------------------------------------------

        con = db()

        db_completed = con.execute(
            """
            SELECT 1
            FROM Trainings
            WHERE callsign=?
            AND training_name=?
            LIMIT 1
            """,
            (
                callsign,
                training_name
            )
        ).fetchone()

        con.close()

        # ----------------------------------------------------
        # TRAINING DOES NOT EXIST
        # ----------------------------------------------------

        if not google_completed and not db_completed:

            return True, "training_not_exist"

        # ----------------------------------------------------
        # REMOVE FROM GOOGLE SHEET
        # ----------------------------------------------------

        if sync_google:
            update_sheet_cell(service, GOOGLE_SHEET_NAME, row, ord(column) - 65, bg_color=(1, 1, 1))

        # ----------------------------------------------------
        # REMOVE FROM DATABASE
        # ----------------------------------------------------

        con = db()

        con.execute(
            """
            DELETE FROM Trainings
            WHERE callsign=?
            AND training_name=?
            """,
            (
                callsign,
                training_name
            )
        )

        con.commit()
        con.close()

        # ----------------------------------------------------
        # GET MEMBER NAME
        # ----------------------------------------------------

        profile = member_profile(callsign)

        member_name = (
            profile["name"]
            if profile
            else ""
        )

        # ----------------------------------------------------
        # LOG
        # ----------------------------------------------------

        log_training_change(
            callsign,
            member_name,
            training,
            "REMOVED",
            changed_by
        )

        return True, "removed"

    # ========================================================
    # CHECK GOOGLE SHEET
    # ========================================================

    google_completed = False
    if sync_google:
        cell = get_google_cell(service, GOOGLE_SHEET_NAME, f"{column}{row}")
        google_completed = is_google_cell_colored(cell)

    # ========================================================
    # CHECK DATABASE
    # ========================================================

    con = db()

    db_completed = con.execute(
        """
        SELECT 1
        FROM Trainings
        WHERE callsign=?
        AND training_name=?
        LIMIT 1
        """,
        (
            callsign,
            training_name
        )
    ).fetchone()

    con.close()

    # ========================================================
    # ALREADY COMPLETED
    # ========================================================

    if google_completed or db_completed:

        return True, "already_completed"

    # ========================================================
    # ADD COLOR TO GOOGLE SHEET
    # ========================================================

    colors = {
        "G": (0.6, 0, 1),
        "H": (0.6, 0, 0),
    }

    if sync_google:
        update_sheet_cell(service, GOOGLE_SHEET_NAME, row, ord(column) - 65, bg_color=colors[column])

    # ========================================================
    # DATABASE
    # ========================================================

    con = db()

    con.execute(
        """
        INSERT OR IGNORE INTO Trainings(
            callsign,
            training_name
        )
        VALUES(?,?)
        """,
        (
            callsign,
            training_name
        )
    )

    con.commit()
    con.close()

    # ========================================================
    # GET MEMBER NAME
    # ========================================================

    profile = member_profile(callsign)

    member_name = (
        profile["name"]
        if profile
        else ""
    )

    # ========================================================
    # LOG
    # ========================================================

    log_training_change(
        callsign,
        member_name,
        training,
        "ADDED",
        changed_by
    )

    return True, "added"


# ============================================================
# EXAM CHANGE
# ============================================================

def exam_change(
    callsign,
    remove=False,
    changed_by="Web Commander",
    sync_google=True
):
    callsign = callsign.upper()

    service = None
    row = None
    if sync_google:
        service = get_google_sheets_service()
        row = find_row_by_callsign(service, callsign)
        if not row:
            return False, "callsign_not_found"

    # ========================================================
    # REMOVE
    # ========================================================

    if remove:

        # ----------------------------------------------------
        # CHECK GOOGLE SHEET
        # ----------------------------------------------------

        google_passed = False
        if sync_google:
            cell = get_google_cell(service, GOOGLE_SHEET_NAME, f"F{row}")
            google_passed = is_google_cell_colored(cell)

        # ----------------------------------------------------
        # CHECK DATABASE
        # ----------------------------------------------------

        con = db()

        db_passed = con.execute(
            """
            SELECT 1
            FROM Exams
            WHERE callsign=?
            AND exam_name='supervisor_exam'
            LIMIT 1
            """,
            (callsign,)
        ).fetchone()

        con.close()

        # ----------------------------------------------------
        # EXAM DOES NOT EXIST
        # ----------------------------------------------------

        if not google_passed and not db_passed:

            return True, "exam_not_exist"

        # ----------------------------------------------------
        # REMOVE FROM GOOGLE SHEET
        # ----------------------------------------------------

        if sync_google:
            update_sheet_cell(service, GOOGLE_SHEET_NAME, row, 5, bg_color=(1, 1, 1))

        # ----------------------------------------------------
        # REMOVE FROM DATABASE
        # ----------------------------------------------------

        con = db()

        con.execute(
            """
            DELETE FROM Exams
            WHERE callsign=?
            AND exam_name='supervisor_exam'
            """,
            (callsign,)
        )

        con.commit()
        con.close()

        # ----------------------------------------------------
        # GET MEMBER NAME
        # ----------------------------------------------------

        profile = member_profile(callsign)

        member_name = (
            profile["name"]
            if profile
            else ""
        )

        # ----------------------------------------------------
        # LOG
        # ----------------------------------------------------

        log_exam_change(
            callsign,
            member_name,
            "Supervisor Exam",
            "REMOVED",
            changed_by
        )

        return True, "removed"

    # ========================================================
    # CHECK GOOGLE SHEET
    # ========================================================

    google_passed = False
    if sync_google:
        cell = get_google_cell(service, GOOGLE_SHEET_NAME, f"F{row}")
        google_passed = is_google_cell_colored(cell)

    # ========================================================
    # CHECK DATABASE
    # ========================================================

    con = db()

    db_passed = con.execute(
        """
        SELECT 1
        FROM Exams
        WHERE callsign=?
        AND exam_name='supervisor_exam'
        LIMIT 1
        """,
        (callsign,)
    ).fetchone()

    con.close()

    # ========================================================
    # ALREADY PASSED
    # ========================================================

    if google_passed or db_passed:

        return True, "already_passed"

    # ========================================================
    # COLOR F
    # ========================================================

    if sync_google:
        update_sheet_cell(service, GOOGLE_SHEET_NAME, row, 5, bg_color=(0, 1, 1))

    # ========================================================
    # DATABASE
    # ========================================================

    con = db()

    con.execute(
        """
        INSERT OR IGNORE INTO Exams(
            callsign,
            exam_name
        )
        VALUES(
            ?,
            'supervisor_exam'
        )
        """,
        (callsign,)
    )

    con.commit()
    con.close()

    # ========================================================
    # GET MEMBER NAME
    # ========================================================

    profile = member_profile(callsign)

    member_name = (
        profile["name"]
        if profile
        else ""
    )

    # ========================================================
    # LOG
    # ========================================================

    log_exam_change(
        callsign,
        member_name,
        "Supervisor Exam",
        "ADDED",
        changed_by
    )

    return True, "added"

def get_inactive_members():
    con = db()

    try:
        rows = con.execute(
            """
            SELECT
                m.callsign,
                m.name
            FROM Members m
            INNER JOIN SheetCache s
                ON UPPER(TRIM(s.callsign))
                 = UPPER(TRIM(m.callsign))
            WHERE TRIM(COALESCE(m.name, '')) <> ''
              AND TRIM(COALESCE(m.callsign, '')) <> ''
              AND TRIM(COALESCE(s.activity, '')) = 'Can Be Terminated'
            """
        ).fetchall()

        return [
            (
                str(row["callsign"]).strip().upper(),
                str(row["name"]).strip()
            )
            for row in rows
        ]

    finally:
        con.close()
