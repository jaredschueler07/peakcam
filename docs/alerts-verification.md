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
