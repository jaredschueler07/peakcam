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

---

# Run log, feeds, and signed webhooks — 2026-10-18 (Sprint 7)

Branch `feat/alert-feeds-cam-history`. Migration `023_alert_runs_destinations.sql`
applied to production through the Supabase MCP on 2026-10-18 (two new tables,
deny-all RLS, nothing existing altered).

## What changed

| Piece | Where | Notes |
| --- | --- | --- |
| Run log | `powder_alert_runs` + `lib/alerts/run-log.ts` | One row per `/api/alerts/trigger` call, opened before the queries, closed on every exit. `finished_at IS NULL` = the run crashed. The response now carries `run: {id, logged, startedAt, finishedAt}`. |
| PostHog event | `powder_alert_run` | Server-side capture by plain `fetch` to `NEXT_PUBLIC_POSTHOG_HOST/capture/`, counts only. Skipped when `NEXT_PUBLIC_POSTHOG_KEY` is unset. |
| Public resort feed | `GET /resorts/<slug>/powder.xml` | Atom. One entry per UTC day with ≥ 6″ new snow in 24 h (the **feed** threshold, not the 8″ alert default), plus one per logged forecast storm. `revalidate = 900`, `Access-Control-Allow-Origin: *`, `X-Attribution`. Entry ids `tag:peakcam.io,2026:powder:<slug>:<date>` and `…:<slug>:forecast:<stormStart>`. |
| Subscriber feed | `GET /alerts/feed/<manage_token>` | Atom at the subscriber's own thresholds; `?format=ics` is a calendar of forecast storm windows (all-day events, UID `powder-<slug>-<start>@peakcam.io`). `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`. The token is the manage capability — treat the URL like the manage link. |
| Webhooks | `alert_destinations` + `lib/alerts/webhooks.ts`, `fanout.ts`, `destinations.ts` | Standard Webhooks signing; see contract below. Registered from `/alerts/manage` ("Add webhook URL"), secret shown once. |
| Manage API | `POST /api/alerts/manage` `{token, action:"add_webhook", url}` → 201 `{destination, secret}`; `{token, action:"test_webhook", destination_id}` → one signed `powder.test`; `DELETE /api/alerts/manage?token=&destination=<id>`. `GET` now includes `destinations` (no secrets) and `feeds`. | Loopback `http://` targets are rejected unless the server runs with `ALERT_WEBHOOK_ALLOW_LOOPBACK=1` (local e2e only). At most 5 webhooks per subscriber. |

## Webhook contract

Request: `POST <your url>`, `content-type: application/json`, `user-agent: PeakCam-Webhooks/1.0`.

Headers (Standard Webhooks, https://www.standardwebhooks.com):

```
webhook-id:        msg_<24 hex>          same id on every retry of one event
webhook-timestamp: <unix seconds>        re-stamped on each attempt
webhook-signature: v1,<base64(HMAC-SHA256(secret_bytes, "<id>.<timestamp>.<raw body>"))>
```

`secret_bytes` = base64-decode of the part after `whsec_`. Reject timestamps more
than 5 minutes off. Any Standard Webhooks library verifies this unchanged.

Body, `powder.alert`:

```json
{
  "type": "powder.alert",
  "resort": { "slug": "alta", "name": "Alta Ski Area", "url": "https://www.peakcam.io/resorts/alta" },
  "inches": 11,
  "kind": "measured",
  "measuredAt": "2026-12-01T12:30:00.000Z",
  "url": "https://www.peakcam.io/resorts/alta",
  "threshold": 8,
  "stormStartDate": "2026-12-03", "forecastDays": 3, "leadDays": 2
}
```

`kind` is `measured` (a snow report crossed the threshold; `measuredAt` is the
report time) or `forecast` (`inches` is the storm total; the last three fields are
present only then). The test button sends `{"type":"powder.test", …}`.

Delivery: three attempts per event (waits of 1 s then 5 s, 5 s timeout each,
within a 45 s budget inside the function's 60 s `maxDuration`), 2xx = delivered,
redirects are not followed. The destination's `failures` counter moves once per
run: reset on a fully delivered run, +1 otherwise, and `disabled_at` is set at
the tenth consecutive failed run (remove and re-add to re-enable). Receivers
needing exactly-once should key on `resort.slug + measuredAt`: an alert whose
email failed is not logged and is re-sent the next day under a new `webhook-id`.

## How to verify

1. **Migration**: `select count(*) from powder_alert_runs; select count(*) from alert_destinations;` both answer (0 rows is fine).
2. **Run log** (S10 step 3): `curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" https://www.peakcam.io/api/alerts/trigger | jq .run` → `{id, logged: true, …}`; then `select id, started_at, finished_at, subscribers, alerts_sent, webhooks_sent, errors from powder_alert_runs order by started_at desc limit 3;` shows that row closed, and PostHog shows one `powder_alert_run` event with the same counts.
3. **Public feed**: `curl -s https://www.peakcam.io/resorts/alta/powder.xml | xmllint --noout -` (no output = well-formed); paste the URL into https://validator.w3.org/feed/. `curl -I` shows `Content-Type: application/atom+xml`, `Cache-Control: public, s-maxage=900, stale-while-revalidate=3600`, `Access-Control-Allow-Origin: *`.
4. **Subscriber feed**: open `/alerts/manage?token=…`, copy the Atom URL from "Your feeds", `curl -s <url> | xmllint --noout -`; the iCal URL into a calendar app or `curl -s '<url>' | head` shows `BEGIN:VCALENDAR`.
5. **Webhook e2e** (no email sent): run the app locally with loopback allowed and point the script at it.

   ```bash
   ALERT_WEBHOOK_ALLOW_LOOPBACK=1 PORT=3300 npm start &
   SITE_URL=http://127.0.0.1:3300 node scripts/alert-e2e-test.mjs --webhook --token <manage_token>
   ```

   Expected: `signature: VALID`, `payload type: powder.test`, `RESULT: PASS`. The script registers a webhook on a local listener, requests a test delivery, verifies the signature with its own HMAC code, and removes the webhook. Add `--trigger` to also run the cron (emails real subscribers if thresholds are exceeded).

## Recipes: pointing an agent at the alerts

Every recipe below receives the same signed `powder.alert` POST; only the receiving
side differs. Register the receiving URL on `/alerts/manage`, store the secret it
shows once, and verify `webhook-signature` before acting. (The tool-specific
commands are the ones named in the execution plan; confirm the flags against each
tool's current docs before relying on them.)

**Hermes** (the Mini hub, dashboard :9119): subscribe a Hermes webhook and hand
the secret to its verifier.

```bash
hermes webhook subscribe --name peakcam-powder \
  --secret "$PEAKCAM_WEBHOOK_SECRET" \
  --on powder.alert "notify 'Powder: {{resort.name}} {{inches}}\" ({{kind}}) {{url}}'"
# Hermes prints the public URL it listens on; paste that URL into /alerts/manage.
```

**Claude Code routine `/fire`**: a routine that wakes on the webhook and runs a
prompt with the payload as context.

```bash
/fire create peakcam-powder \
  --trigger webhook --verify standard-webhooks --secret-env PEAKCAM_WEBHOOK_SECRET \
  --prompt "A PeakCam powder alert arrived: {{body}}. Check the resort's cams at {{body.url}} and tell me if it's worth the drive tomorrow."
# /fire prints the routine's webhook URL; register it on /alerts/manage.
```

**OpenClaw `/hooks/wake`**: OpenClaw exposes a wake endpoint; put a thin verifier in
front of it (it does not speak Standard Webhooks itself).

```js
// receiver.mjs — verify, then forward to OpenClaw
import { createHmac, timingSafeEqual } from "node:crypto";
const secret = Buffer.from(process.env.PEAKCAM_WEBHOOK_SECRET.replace(/^whsec_/, ""), "base64");
export async function handle(req, rawBody) {
  const id = req.headers["webhook-id"], ts = req.headers["webhook-timestamp"];
  const expected = createHmac("sha256", secret).update(`${id}.${ts}.${rawBody}`).digest();
  const ok = (req.headers["webhook-signature"] ?? "").split(" ").some((s) => {
    const [v, sig] = s.split(","); if (v !== "v1") return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return 401;
  const alert = JSON.parse(rawBody);
  await fetch(`${process.env.OPENCLAW_URL}/hooks/wake`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENCLAW_TOKEN}` },
    body: JSON.stringify({ reason: "peakcam.powder", text: `${alert.inches}" ${alert.kind} at ${alert.resort.name}: ${alert.url}` }),
  });
  return 204;
}
```

**Grok Bot routine**: Grok routines poll rather than receive, so give the routine
the feed instead of the webhook — the public resort feed needs no token.

```
Routine: every morning at 6:00, read https://www.peakcam.io/resorts/alta/powder.xml
(and the other resorts I follow). If an entry is newer than yesterday's run,
summarize it in one line with the resort link and ping me.
```

For a routine that should see *my* thresholds, use the subscriber Atom URL from
`/alerts/manage` instead; it carries the manage token, so keep that routine private.
