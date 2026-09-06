# Auth email rollout record (2026-09-06)

Live configuration applied on 2026-09-06 (America/Chicago) using the owner's authenticated Supabase, Resend and Vercel sessions. No credentials are recorded here; the pre-change configuration backup lives outside the repository.

## Applied

- **Supabase auth config** (`owsxnogvufankayfwczl`): six branded templates from `supabase/email-templates/templates.json` installed with their subjects (confirmation, magic link as code-only, recovery, invite, email change, reauthentication). Response payloads were hash-compared against the committed sources. `password_min_length` raised 6 → 8; `password_hibp_enabled` false → true. Existing passwords, sessions, users, redirect allowlist, CAPTCHA, session limits and notification settings were not changed. Before this change custom SMTP was off (Supabase default sender) and every template/subject was the Supabase default.
- **Resend**: domain `auth.peakcam.io` created in region us-east-1 with return-path `send`, receiving disabled, no tracking subdomain (click/open tracking off). Snow alerts remain on `send.peakcam.io`.
- **Vercel DNS (`peakcam.io`)**: `resend._domainkey.auth` TXT (DKIM, value verified against Resend's payload by SHA-256), `send.auth` MX 10 `feedback-smtp.us-east-1.amazonses.com`, `send.auth` TXT `v=spf1 include:amazonses.com ~all`, and `_dmarc` TXT `v=DMARC1; p=none; adkim=r; aspf=r`. DMARC is monitor-only and has no `rua` yet: the only legitimate senders found were Resend on `send.peakcam.io` and now `auth.peakcam.io`; the apex has no MX or SPF. Add a real reporting destination before tightening the policy.
- **Vercel env**: `NEXT_PUBLIC_AUTH_EMAIL_CODE_ENABLED=true` (Production). Deployed by the commit that adds this file.

## SMTP and remaining steps

See the end of this file for the SMTP status at the time of the deploy commit. Inbox placement is not verified until real test messages are inspected (Authentication-Results headers for SPF/DKIM/DMARC alignment) in designated Gmail and Outlook inboxes with the owner's explicit permission.

Rollback: disable custom SMTP in the Supabase dashboard, restore the default subjects/templates from the private backup, set `password_min_length` back to 6 only if required, remove the Vercel env var and redeploy. Do not reset accounts, passwords or sessions.

## Status at this commit

- Resend verified `auth.peakcam.io` (DKIM, return-path MX and SPF all verified) at about 00:50 CDT.
- A new Resend API key `peakcam-supabase-auth-smtp` (sending access, scoped to `auth.peakcam.io` only) was created and entered directly into Supabase; it was never written to disk, the repo, or logs. The existing send-only alerts key and the older full-access `peakcam` key were left untouched.
- Supabase custom SMTP is ON: host `smtp.resend.com`, port 465, username `resend`, sender `PeakCam <login@auth.peakcam.io>`, minimum interval per user 60 s. Supabase raised the email rate limit from 2/h (default-sender cap) to 30/h automatically.
- Production deploy of `32b9981` was READY with `NEXT_PUBLIC_AUTH_EMAIL_CODE_ENABLED=true`, so the sign-in UI now offers an email code.

Not yet done: real delivery tests to designated inboxes with header inspection (SPF/DKIM/DMARC alignment) and a `rua` destination for DMARC reports. Inbox placement is unverified.
