# Alerts E2E Verification — 2026-04-17

## Provider
- Service: Resend
- From address: `PeakCam Alerts <alerts@peakcam.io>` (verified sender)
- API key env var: `RESEND_API_KEY`
- Local .env.local: configured
- Prod (Vercel): unverified (check dashboard) — `vercel` CLI is installed but the local checkout is not linked to a project (`vercel env ls production` returned "Your codebase isn't linked to a project on Vercel"). User should verify `RESEND_API_KEY` and `CRON_SECRET` are set in the Vercel production env via the dashboard.

## Failed-send behavior
Confirmed: powder_alert_log insert is inside try block, after successful send.
A failed send does NOT log, so the next day's cron will retry. Correct behavior.

Reference: `app/api/alerts/trigger/route.ts` lines 120-147 — the `for` loop
body calls `await sendPowderAlertEmail(...)` first, then builds `logEntries`
and POSTs to `/powder_alert_log` within the same `try`. If
`sendPowderAlertEmail` throws, control jumps to the `catch` and the log insert
is skipped.

## How to run the E2E test

Required env (in `.env.local` at the project root — main checkout, not worktree):
- `RESEND_API_KEY` (prod sender)
- `CRON_SECRET` (bearer token for /api/alerts/trigger)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Command:
```bash
node scripts/alert-e2e-test.mjs --email you+peakcamtest@your-domain.com --resort-slug <slug>
```

Tip: pick a resort with new_snow_24h ≥ 1 inch so the dedup path actually runs. Otherwise the script will warn that dedup was not exercised.

After the run, record outcomes in the checklist below:

- [ ] Subscribe 200 OK
- [ ] First trigger sent ≥ 1 email
- [ ] Email delivered to inbox
- [ ] Second trigger sent 0 emails (dedup)
- [ ] Manage link opens /alerts/manage
- [ ] Unsubscribe removes subscriber

## Vercel prod env — TODO for Task 1.3
The Vercel CLI wasn't linked in this worktree. Before running the E2E, confirm in the Vercel dashboard (Production):
- `RESEND_API_KEY` set
- `CRON_SECRET` set
- `NEXT_PUBLIC_SITE_URL` set (used by the daily cron)
