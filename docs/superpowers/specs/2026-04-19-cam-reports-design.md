# Cam Reports — Design Spec

**Date:** 2026-04-19
**Status:** Approved; ready for implementation plan
**Owner:** Jared
**Scope:** V1 — mini feature, single implementation plan

## Goal

Let users on the resort detail page flag a broken webcam and (optionally) suggest a working URL they know about. Reports feed a private admin queue so Jared can triage and update the `cams` table manually.

## Non-goals (V1)

- No public UI marker on cams that accumulate reports.
- No admin dashboard. Supabase UI + per-submission email is the read path.
- No auto-disable of cams after N reports. Admin toggles `cams.is_active` by hand.
- No crediting of signed-in reporters. Reports are anonymous.

## User flow

Every `CamPlayer` tile on `/resorts/[slug]` gets a small `⚑ Report` ghost pill in the top-right corner — same stamp language as the `LIVE` badge, but bark + cream so it reads secondary.

Tap opens a `Modal` with the form:

```
  REPORT THIS CAM · Alta — Top of Collins

  ○ Broken / won't load
  ○ Wrong view / wrong location
  ○ Something else

  ☐ Resort's own site link is also dead

  Know a working link? (optional)
  [ https://…                              ]

  [Cancel]                  [Send report]
```

Submit → toast "Thanks, we'll take a look", modal closes, the `⚑ Report` button for that cam disables for the rest of the session. Second attempt from the same session within 24h (even after a reload) surfaces the same "you've already reported this" disabled state.

## Data model

New table, mirrors the `condition_votes` / `user_conditions` split — server-trusted writes via service role, RLS denies everything else.

```sql
-- supabase/migrations/011_cam_reports.sql
create table if not exists cam_reports (
  id                   uuid primary key default gen_random_uuid(),
  cam_id               uuid not null references cams(id) on delete cascade,
  session_id           uuid not null,
  reason               text not null
                       check (reason in ('broken','wrong_view','other')),
  resort_link_dead     boolean not null default false,
  suggested_url        text,
  user_agent           text,
  ip_hash              text,
  resolved             boolean not null default false,
  resolved_at          timestamptz,
  admin_note           text,
  created_at           timestamptz not null default now()
);

create index cam_reports_cam_idx        on cam_reports (cam_id, created_at desc);
create index cam_reports_unresolved_idx on cam_reports (resolved) where resolved = false;
create index cam_reports_session_idx    on cam_reports (session_id, cam_id, created_at);

alter table cam_reports enable row level security;
-- No policies = default deny for anon + authenticated. Service role bypasses RLS.
```

Notes:

- **No `user_id`** in V1. A future migration can add a nullable column if we decide to credit signed-in reporters.
- **`ip_hash`** is `sha256(request_ip + daily_rotating_salt)` — lets us spot abuse patterns without persisting raw IPs. Daily rotation guarantees hashes don't persist long-term.
- **`suggested_url`** is free-form text, validated at the API boundary. Not rendered as a clickable link in email (copy-paste only) so accidental XSS / phishing exposure is zero.

## API

### `POST /api/cam-reports/submit`

File: `app/api/cam-reports/submit/route.ts`. Mirrors existing `user_conditions` / `alerts/subscribe` route shape.

Request body:

```ts
{
  cam_id: string,              // uuid
  session_id: string,          // uuid from peakcam_session
  reason: 'broken' | 'wrong_view' | 'other',
  resort_link_dead: boolean,
  suggested_url?: string | null
}
```

Validation (server):

- `cam_id` is a well-formed UUID and exists in `cams`. Not-found → `404`.
- `reason` in allowed set. Mismatch → `400`.
- `resort_link_dead` is a boolean. Mismatch → `400`.
- `suggested_url` (if present) — ≤ 500 chars, matches `^https?://` via `new URL()`, hostname is not `localhost` / `127.*` / `0.0.0.0` / `::1` / private RFC1918 space. Mismatch → `400`.
- `session_id` is a well-formed UUID. Mismatch → `400`.

Rate limit (server-enforced):

```sql
select 1 from cam_reports
 where session_id = $1 and cam_id = $2
   and created_at > now() - interval '24 hours'
 limit 1;
```

Match → `429 { error: "Already reported recently" }`. No insert, no email.

IP hashing:

```ts
const salt = process.env.CAM_REPORT_SALT;          // optional
const today = new Date().toISOString().slice(0, 10); // "2026-04-19"
const ipHash = salt
  ? crypto.createHash('sha256').update(`${ip}${salt}${today}`).digest('hex')
  : null;
```

If `CAM_REPORT_SALT` is unset, `ip_hash` stays `null` — don't fail submission over abuse triage.

Auth: route uses the **service role client** (same pattern as `/api/alerts/trigger`). RLS on `cam_reports` denies anon and authenticated writes, so this route is the only path rows can land through.

Returns:

```ts
// 201
{ ok: true }

// 400 | 404 | 429
{ error: string }
```

Never echoes the row back — client only needs the status.

### Email notification (fire-and-forget)

At the end of a successful submit, fire an email via Resend. Don't block the API response — wrap in `.catch()` and log failures.

Resend uses existing `RESEND_API_KEY`. Recipient is the first defined of: `CAM_REPORT_ADMIN_EMAIL`, `ALERT_ADMIN_EMAIL`, hardcoded fallback `jaredschuelerspotify@gmail.com`.

Email body:

```
  Subject: 🚨 Cam report · {resort.name} — {cam.name} ({reason_label})

  Reason:        Broken / won't load                  [or: Wrong view / Something else]
  Resort site:   also dead                            [or: still working / unknown]
  Suggested:     https://example.com/new-stream       [or: (none)]

  Cam:    {cam.name}
  Resort: {resort.name} · {resort.state}
  Embed:  {cam.embed_type} · {cam.youtube_id || cam.embed_url}

  Session: {session_id.slice(0,8)}… · {created_at} · {N} reports in last 7d
  Supabase: https://supabase.com/dashboard/project/owsxnogvufankayfwczl/editor?table=cam_reports&filter=cam_id:eq:{cam_id}
```

Plain text, no HTML. Copy-pasteable from any mail client.

**Rollup** — if the same `cam_id` already has ≥ 2 reports in the last 24h (not counting the current one), the subject becomes:

```
  Subject: 🔥 Cam report · {resort.name} — {cam.name} ({Nth} in 24h)
```

Body unchanged. Helps prioritize cams that are definitely broken vs one-off reports.

**Volume guard** — simple in-memory counter per process:

- If > 20 reports land in any rolling 10-minute window (across all cams), skip email sending for the next 60 min. DB still receives everything.
- Log `[cam-reports] email paused, N reports in 10m window` on console.
- Counter is a module-level array of timestamps, pruned on each submission. Resets on cold start. Good enough for V1 — if a bot flood happens on a serverless deploy, the serverless scaling limits the damage.

## Client components

### `components/cam/CamReportButton.tsx` (new)

Ghost pill on the cam card. State: `idle` / `submitted` / `alreadyReported`. Disabled when `submitted` or `alreadyReported`. Opens the modal.

Session check on mount: read a `peakcam_cam_reports` localStorage entry (a map of `{ [cam_id]: iso_timestamp }`) — if an entry exists and is within 24h, start in `alreadyReported` state.

### `components/cam/CamReportModal.tsx` (new)

Uses the existing `Modal` primitive. Form state: `reason`, `resort_link_dead`, `suggested_url`. Submit button disabled until `reason` is set.

On submit:

1. `POST /api/cam-reports/submit` with body.
2. On 201: stamp `peakcam_cam_reports[cam_id] = now()`, toast success, close modal, call `onSubmitted()` to flip the button to `submitted`.
3. On 429: toast "Already reported", close modal, flip button to `alreadyReported`.
4. On 4xx / 5xx: inline error in modal, don't close.

### `ResortDetailPage.tsx` / `CamPlayer` — minimal edit

Render `<CamReportButton cam={cam} />` as an absolutely-positioned element in the top-right corner of each cam tile. Don't refactor `CamPlayer`'s internals.

## Config

New environment variables (optional — defaults are safe):

- `CAM_REPORT_ADMIN_EMAIL` — recipient for notification emails. Falls back to `ALERT_ADMIN_EMAIL`, then to a hardcoded constant.
- `CAM_REPORT_SALT` — seed for daily-rotating IP hash. Any string. If unset, IP hashing is disabled.

Both go in `.env.local.example` + Vercel (Production + Preview).

## Testing

Manual verification post-deploy:

1. Submit a report via UI → row in `cam_reports`, email received within 30s.
2. Submit a second report for same cam/session within 24h → `429`, no row, no email, button shows "Already reported".
3. Submit with `suggested_url = "file:///etc/passwd"` → `400`.
4. Submit with `suggested_url = "http://localhost:3000/"` → `400`.
5. Submit with `reason = "nope"` → `400`.
6. Submit 3 reports for same cam from 3 different sessions → 3rd email subject has `🔥 · (3rd in 24h)`.
7. Flood 21 reports in 10 min (different sessions) → DB has all 21 rows, email stops at the 21st, console shows pause log.

No automated tests — matches existing submit routes.

## Rollout

1. Apply migration `011_cam_reports.sql` via Supabase MCP.
2. Add `CAM_REPORT_ADMIN_EMAIL` and `CAM_REPORT_SALT` to local `.env.local` and Vercel (Production + Preview).
3. Implement on branch `feat/cam-reports`. Preview deploy smoke tests the flow.
4. Open PR, merge, auto-deploy to production.

## Open questions

None — ready for implementation plan.
