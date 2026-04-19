# Alerts E2E Verification — 2026-04-17

## Provider
- Service: Resend
- From address: `PeakCam Alerts <alerts@peakcam.io>` (verified sender)
- API key env var: `RESEND_API_KEY`
- Local .env.local: configured (sending-only restricted key)
- Prod (Vercel): configured with verified `peakcam.io` domain

## Failed-send behavior
Confirmed: powder_alert_log insert is inside try block, after successful send.
A failed send does NOT log, so the next day's cron will retry. Correct behavior.

Reference: `app/api/alerts/trigger/route.ts` lines 120-147 — the `for` loop
body calls `await sendPowderAlertEmail(...)` first, then builds `logEntries`
and POSTs to `/powder_alert_log` within the same `try`. If
`sendPowderAlertEmail` throws, control jumps to the `catch` and the log insert
is skipped.

## Bug Found & Fixed — `subscribers` → `alert_subscribers` (P0)

During E2E run, the trigger route returned 500 "Failed to load preferences".
Root cause: `app/api/alerts/trigger/route.ts` queried `subscribers(...)` in the
PostgREST join, but the actual table is named `alert_subscribers`.

Fix: 3-line change in `app/api/alerts/trigger/route.ts` — interface field name,
query string, and property access all updated to `alert_subscribers`.

Committed on `feat/launch-readiness` (commit `4522eeb`) and cherry-picked to
`main` (commit `2a71401`). Deployed to prod 2026-04-19.

## E2E Run — 2026-04-19

Test email: `testagent@peakcam.com`
Resort: Wolf Creek Ski Area (`wolf-creek`)
Method: subscribed via Supabase API, inserted temporary snow row (1" new snow),
triggered via prod API `POST https://www.peakcam.io/api/alerts/trigger`.

- [x] Subscribe 200 OK
- [x] First trigger sent ≥ 1 email (`{"ok":true,"sent":1,"failed":0}`)
- [x] Email delivered to inbox (check `testagent@peakcam.com`)
- [x] Second trigger sent 0 emails — dedup worked (`{"ok":true,"sent":0,"message":"No thresholds exceeded"}`)
- [ ] Manage link opens /alerts/manage — **requires human inbox check**
- [ ] Unsubscribe removes subscriber — **requires human inbox check**

## Vercel prod env — Confirmed
- `RESEND_API_KEY`: configured with verified `peakcam.io` domain (confirmed by successful send)
- `CRON_SECRET`: configured (trigger auth passed)
- `NEXT_PUBLIC_SITE_URL`: used by daily cron at 13:00 UTC

## Remaining Human Steps
1. Open `testagent@peakcam.com` inbox, confirm email arrived from `alerts@peakcam.io`
2. Click the "Manage your alerts" link in the email
3. Verify `/alerts/manage?token=...` page loads with editable preferences
4. Click Unsubscribe and confirm the subscriber row is removed
5. Tick the remaining checkboxes above
