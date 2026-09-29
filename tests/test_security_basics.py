import os
import asyncio
import unittest
from unittest.mock import MagicMock, patch

import app
from pydantic import ValidationError


class SessionAndIdentityTests(unittest.TestCase):
    def test_auth_guard_fails_closed_when_account_storage_is_unavailable(self):
        request = app.Request({
            "type": "http", "method": "GET", "path": "/api/members",
            "headers": [], "query_string": b"", "server": ("test", 80),
            "client": ("127.0.0.1", 12345), "scheme": "http",
        })
        async def call_next(_request):
            self.fail("The request must not continue after the account lookup fails")
        with patch.object(app, "_decode_session", return_value={"account_id": "acct-1", "name": "member"}), patch.object(
            app, "_account_for_id", side_effect=RuntimeError("Google Sheets offline")
        ):
            response = asyncio.run(app.account_auth_guard(request, call_next))
        self.assertEqual(response.status_code, 503)

    def test_rate_limiter_blocks_attempts_after_limit(self):
        key = ("test", "unique-rate-limit-key")
        with app.AUTH_RATE_LIMIT_LOCK:
            app.AUTH_RATE_LIMITS.pop(key, None)
        app._enforce_auth_rate_limit(*key, 1, 60)
        with self.assertRaises(app.HTTPException) as raised:
            app._enforce_auth_rate_limit(*key, 1, 60)
        self.assertEqual(raised.exception.status_code, 429)
        with app.AUTH_RATE_LIMIT_LOCK:
            app.AUTH_RATE_LIMITS.pop(key, None)

    def test_command_access_uses_linked_callsign_not_account_name(self):
        token = app.CURRENT_USER.set({"name": "Unrelated display", "callsign": "C-12", "role": "leader"})
        try:
            self.assertTrue(app._current_user_is_command())
        finally:
            app.CURRENT_USER.reset(token)

    def test_command_callsign_threshold_is_e_and_above(self):
        for callsign, expected in (("E-04", True), ("C-12", True), ("DIV-2", True), ("L-16", False), ("M-19", False)):
            with self.subTest(callsign=callsign):
                token = app.CURRENT_USER.set({"callsign": callsign, "role": "leader"})
                try:
                    self.assertEqual(app._current_user_is_command(), expected)
                finally:
                    app.CURRENT_USER.reset(token)

    def test_leader_role_requires_l_callsign_or_above(self):
        for callsign, expected in (("L-16", True), ("E-04", True), ("M-19", False)):
            with self.subTest(callsign=callsign):
                token = app.CURRENT_USER.set({"callsign": callsign, "role": "leader"})
                try:
                    if expected:
                        self.assertEqual(app.require_role("leader")["callsign"], callsign)
                    else:
                        with self.assertRaises(app.HTTPException) as raised:
                            app.require_role("leader")
                        self.assertEqual(raised.exception.status_code, 403)
                finally:
                    app.CURRENT_USER.reset(token)

    def test_sensitive_handlers_reject_leader_when_called_directly(self):
        token = app.CURRENT_USER.set({"account_id": "leader-1", "name": "Leader", "role": "leader"})
        try:
            for handler in (app.terminate, app.force_promote, app.demote, app.change_rank):
                with self.subTest(handler=handler.__name__), self.assertRaises(app.HTTPException) as raised:
                    handler(app.Action(callsign="L-16", new_rank="AEMT"))
                self.assertEqual(raised.exception.status_code, 403)
        finally:
            app.CURRENT_USER.reset(token)

    def test_login_and_signup_password_limits_are_explicit(self):
        with self.assertRaises(ValidationError):
            app.LoginInput(name="leader", password="x" * (app.MAX_PASSWORD_LENGTH + 1))
        with self.assertRaises(ValidationError):
            app.SignupInput(name="Leader", callsign="L-16", password="x" * (app.MAX_PASSWORD_LENGTH + 1))

    def test_linked_callsign_resolves_full_member_name_for_account_display(self):
        connection = MagicMock()
        connection.execute.return_value.fetchone.return_value = {"name": "Joseph Krupp"}
        with patch.object(app.L, "db", return_value=connection):
            display_name = app._member_name_for_callsign("l-16", "josephk")
        self.assertEqual(display_name, "Joseph Krupp")
        connection.close.assert_called_once()

    def test_public_account_keeps_login_name_but_uses_member_display_name(self):
        account = {
            "account_id": "acct-1", "name": "josephk", "callsign": "L-16",
            "status": "approved", "role": "leader", "created_at": "",
            "activated_at": "", "approved_by": "", "admin_changed_at": "",
            "admin_changed_by": "",
        }
        public = app._public_account(account, "Joseph Krupp")
        self.assertEqual(public["username"], "josephk")
        self.assertEqual(public["display_name"], "Joseph Krupp")

    def test_watch_view_lists_linked_account_name_and_role_by_callsign(self):
        logs = [{"roll_call": "L-16 Joseph Krupp\nM-10 David Santos"}]
        accounts = [
            {"callsign": "l-16", "name": "josephk", "role": "member", "status": "approved"},
            {"callsign": "M-10", "name": "david", "role": "admin", "status": "approved"},
            {"callsign": "R-1", "name": "removed", "role": "leader", "status": "denied"},
        ]
        result = app._attach_linked_accounts_to_watch_logs(logs, accounts)
        self.assertEqual(result[0]["linked_accounts"], [
            {"callsign": "L-16", "account_name": "josephk", "role": "Member"},
            {"callsign": "M-10", "account_name": "david", "role": "Commander"},
        ])

    def test_watch_log_endpoint_adds_linked_account_details_without_google_access(self):
        connection = MagicMock()
        connection.execute.return_value = [{"roll_call": "L-16 Joseph Krupp"}]
        user_token = app.CURRENT_USER.set({"role": "member", "callsign": "L-16"})
        try:
            with patch.object(app.L, "db", return_value=connection), patch.object(
                app, "_load_accounts", return_value=[
                    {"callsign": "L-16", "name": "josephk", "role": "member", "status": "approved"}
                ]
            ):
                logs = app.list_watch_command_logs()
        finally:
            app.CURRENT_USER.reset(user_token)
        self.assertEqual(logs[0]["linked_accounts"][0]["account_name"], "josephk")

    def test_accepting_a_pending_account_assigns_member_role(self):
        account = {"account_id": "acct-1", "status": "pending", "role": "leader"}
        accepted = {}
        user_token = app.CURRENT_USER.set({"account_id": "commander-1", "name": "Commander", "role": "admin", "is_admin": True})
        try:
            with patch.object(app, "_target_account", return_value=account), patch.object(
                app, "_queue_account_activation", side_effect=lambda row, action, actor: accepted.update(row)
            ):
                result = app.allow_account("acct-1")
        finally:
            app.CURRENT_USER.reset(user_token)
        self.assertEqual(result["status"], "queued")
        self.assertEqual(accepted["role"], "member")

    def test_google_sheet_sync_retries_transient_request_failures(self):
        service = MagicMock()
        request = service.spreadsheets.return_value.get.return_value
        with patch.object(app.L, "get_google_sheets_service", return_value=service):
            app.L.get_google_sheet_data()
        request.execute.assert_called_once_with(num_retries=3)

    def test_google_sheet_sync_rebuilds_client_after_dropped_socket(self):
        old_service = MagicMock()
        old_request = old_service.spreadsheets.return_value.get.return_value
        old_request.execute.side_effect = OSError(10053, "connection aborted")
        fresh_service = MagicMock()
        fresh_request = fresh_service.spreadsheets.return_value.get.return_value
        fresh_request.execute.return_value = {"sheets": []}
        with patch.object(
            app.L, "get_google_sheets_service", side_effect=[old_service, fresh_service]
        ) as get_service:
            result = app.L.get_google_sheet_data()
        self.assertEqual(result, {"sheets": []})
        self.assertEqual(get_service.call_count, 2)
        old_request.execute.assert_called_once_with(num_retries=3)
        fresh_request.execute.assert_called_once_with(num_retries=3)

    def test_session_round_trip(self):
        with patch.dict(os.environ, {"APP_SESSION_SECRET": "s" * 48}):
            token = app._encode_session({
                "account_id": "acct-1",
                "name": "Leader",
                "discord_id": "123",
                "pw_version": "version-a",
            })
            request = type("Request", (), {"cookies": {app.SESSION_COOKIE: token}})()
            decoded = app._decode_session(request)
        self.assertEqual(decoded["account_id"], "acct-1")
        self.assertEqual(decoded["pw_version"], "version-a")

    def test_session_signature_rejects_tampering(self):
        with patch.dict(os.environ, {"APP_SESSION_SECRET": "s" * 48}):
            token = app._encode_session({"account_id": "acct-1", "name": "Leader"})
            encoded, signature = token.split(".", 1)
            request = type("Request", (), {"cookies": {app.SESSION_COOKIE: encoded + "x." + signature}})()
            self.assertIsNone(app._decode_session(request))

    def test_nfkc_name_normalization_unifies_compatibility_characters(self):
        self.assertEqual(app._name_key("  Ａlice   Smith "), "alice smith")

    def test_password_version_changes_with_hash(self):
        self.assertNotEqual(
            app._password_version({"password_hash": "hash-a"}),
            app._password_version({"password_hash": "hash-b"}),
        )

    def test_rank_validation_rejects_downward_promotion(self):
        with self.assertRaises(ValueError):
            app.validate_force_promotion_rank("Paramedic", "EMT")

    def test_google_sheet_configuration_requires_explicit_id(self):
        with patch.object(app.L, "GOOGLE_SHEET_ID", ""):
            with self.assertRaises(RuntimeError):
                app.L.validate_configuration()


if __name__ == "__main__":
    unittest.main()
