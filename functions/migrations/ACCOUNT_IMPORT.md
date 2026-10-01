# D1 cutover with fresh registration

This path makes every user register again with a new password. It does not
copy the Google Sheets `Accounts`, `Account Audit`, or `Auth Sessions` data.
Keep those tabs unchanged as a rollback/reference copy until the new login and
Commander workflows have been verified.

## Before switching

1. Confirm the Cloudflare Pages project has the D1 binding `LVFR_DB` pointing
   to the database where `0001_accounts.sql` was executed.
2. In the Cloudflare D1 console, execute all of `functions/migrations/0002_auth_runtime.sql`.
   It adds login throttling and online-presence tables.
3. In Apps Script, open **Project Settings → Script properties** and add:
   - `LVFR_D1_WORKER_SECRET`
   - `LVFR_D1_AUTH_BRIDGE_SECRET`
   Use two different random secrets, each at least 32 characters. Never put
   their values in source code or send them in chat.
4. Deploy the updated `apps-script/Code.gs` as a **new version** of the existing
   web app, executing as the owner. Keep its `/exec` URL.
5. In Cloudflare Pages **Settings → Variables and Secrets**, set:
   - `GAS_WEB_APP_URL`: the deployed Apps Script `/exec` URL
   - `LVFR_D1_WORKER_SECRET`: the exact value from Apps Script
   - `LVFR_D1_AUTH_BRIDGE_SECRET`: the exact value from Apps Script
   - `LVFR_D1_BOOTSTRAP_SECRET`: a third random secret, at least 32 characters
   - `D1_AUTH_MODE`: `enabled`
   Ensure these are set for the production environment (and preview too only if
   you intend to test using the preview deployment). Save and redeploy Pages.

Registration stays closed until the first Commander is created. With D1 mode
enabled, the `/auth/bootstrap-commander` endpoint is usable only with the
bootstrap secret and only while the D1 accounts table is empty. The provided
name must exactly match a member on the current roster. From PowerShell, set
the secret in a temporary environment variable without putting it in this
repository, then send one request (replace the URL and roster name):

```powershell
$env:LVFR_BOOTSTRAP = Read-Host "Paste the bootstrap secret"
$securePassword = Read-Host "Choose a new password (4–20 letters or numbers)" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try { $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
$body = @{ name = "Your exact roster name"; password = $plainPassword } | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri "https://YOUR-PAGES-DOMAIN/auth/bootstrap-commander" `
  -Headers @{ "X-LVFR-Bootstrap-Secret" = $env:LVFR_BOOTSTRAP } `
  -ContentType "application/json" -Body $body
Remove-Variable plainPassword, body, securePassword
Remove-Item Env:LVFR_BOOTSTRAP
```

After the endpoint reports success, remove the `LVFR_D1_BOOTSTRAP_SECRET`
Pages secret and redeploy Pages.

The initial Commander is created as an approved admin. The bootstrap route
cannot create another account after the first account exists. After removing
the secret, sign in through the PWA and verify `/auth/me`, the Commander
account list, approval of a test account, and roster access. Delete the test
account after the check. Existing users must sign up again; their new requests
start pending and must be approved. Restore leader/admin roles manually as
needed.

## Rollback

To return to the existing Apps Script Accounts authentication, set
`D1_AUTH_MODE` to anything other than `enabled` (or remove it) and redeploy
Pages. The Google Sheets accounts were not modified. Accounts registered only
in D1 will not be available to the old sign-in path.

Do not run `scripts/accounts_csv_to_d1.py` for this fresh-registration path;
that utility is only for importing existing credentials.
