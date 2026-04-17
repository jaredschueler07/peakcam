# PeakCam Runbook

> Last updated: 2026-04-17
> Status: pre-V0-launch baseline. Human-gated tasks (QA smoke, PostHog dashboard, alerts inbox E2E) will add to this doc as they complete.

## Environments

| Environment | URL |
|---|---|
| Production | https://www.peakcam.io |
| Vercel dashboard | https://vercel.com/ → peakcam project |
| Supabase | https://supabase.com/dashboard → peakcam project |
| PostHog | https://us.posthog.com/ (dashboard URL: **TBD — populated by Task 4.7**) |
| GitHub | https://github.com/jaredschueler07/peakcam |

## Secrets

All secrets live in three places:
1. Local dev: `.env.local` (never commit — gitignored)
2. Vercel prod: `vercel env ls production`
3. Launchd jobs on the Mac Mini: loaded via `.env.local` at script start

Full inventory: see memory file `reference_env_keys.md` (not reproduced here to avoid dual-source drift).

**Rotation:** update in all three places, then redeploy Vercel and restart the relevant launchd agent (`launchctl kickstart -k gui/501/com.peakcam.<label>`).

## Deploy & Rollback

**Deploy:** `git push origin main` triggers Vercel auto-deploy.

**Rollback:** Vercel dashboard → Deployments → find last known good → "Promote to Production".

**Verify deploy health:**
```bash
curl -sI https://www.peakcam.io | head -1    # expect HTTP/2 200
```
Then spot-check `/`, a `/resorts/<slug>`, `/snow-report`, `/about`.

## Launchd Services (Mac Mini)

| Label | Purpose | Schedule | Status |
|---|---|---|---|
| `com.peakcam.agents` | 9-agent Slack bot loop | always-on | **running** |
| `com.peakcam.snotel-sync` | SNOTEL data sync → `snow_reports` | daily 07:00 | running (scheduled) |
| `com.peakcam.cam-health-check` | Verify 248 cams, deactivate dead | weekly | running (scheduled) |
| `com.peakcam.pipeline` | Multi-source blender | daily 06:00 | **prepared but Disabled=true** — awaits migration 010 |

## Incident Scenarios

### 1. Agent loop crashed

**Symptom:** no recent heartbeat in `~/peakcam/peakcam/agents/loop.log`; Slack bots silent.

**Recover:**
```bash
launchctl stop com.peakcam.agents
launchctl start com.peakcam.agents
tail -f ~/peakcam/peakcam/agents/loop.log
```

Common causes: Slack auth token expired (rotate in bot's App config), Supabase connection error (check `https://status.supabase.com`), OOM (check Console for kill signal).

### 2. SNOTEL sync failing

**Symptom:** `snow_reports` not updating; Top Conditions row and alert thresholds stale.

**Recover:**
```bash
cd ~/peakcam/peakcam
node scripts/snotel-sync.mjs 2>&1 | tee /tmp/snotel.log
```

Known transient: NRCS SNOTEL server returns HTML error pages during outages. Current `fetchers/snotel.ts` parses these as date columns and errors with PostgREST 22007. Non-fatal — next day's sync recovers. Upstream fix filed to V0.5.

If persistent: check specific station IDs in `data/resorts-with-snotel.json`. Station decommissions happen; audit with `npm run snotel-sync -- --verbose`.

### 3. Vercel deploy broken

**Symptom:** 500 on prod, blank page, or build failure in CI.

**Recover:** Vercel dashboard → Deployments → last-good → Promote to Production. Then: Functions → Logs to see the error.

Never force-push to `main` as a fix — open a revert PR.

### 4. Supabase outage

**What breaks:** auth (login/signup), favorites, condition votes, alert writes, user report submissions.

**What still works:** static cam iframes (hosted on resort domains), ISR-cached resort pages until next revalidate (1h), publicly cached JSON-LD.

**Mitigation:** check https://status.supabase.com. No self-recover. Post a status note on `/about` if >1h outage.

### 5. Powder alerts not firing

**Symptom:** subscribers email that they didn't receive an alert after fresh snow.

**Provider:** Resend, from `PeakCam Alerts <alerts@peakcam.io>`. Key: `RESEND_API_KEY`.
**Cron:** Vercel cron daily 13:00 UTC against `/api/alerts/trigger`, Bearer `CRON_SECRET`.

**Recover:**
```bash
# Manual trigger (can re-run anytime; dedup log prevents double-send per day)
CRON_SECRET=<value> node scripts/powder-alert-check.mjs

# Full E2E with a test email
node scripts/alert-e2e-test.mjs --email you+test@your-domain.com --resort-slug <slug>
```

Check in order:
1. `RESEND_API_KEY` set in Vercel prod (dashboard → Env Vars → Production)
2. `CRON_SECRET` set in Vercel prod
3. Vercel cron log: Dashboard → Crons → `/api/alerts/trigger` (last run, status)
4. Resend dashboard: deliveries tab — look for failed or bounced sends
5. Supabase: `select count(*) from alert_preferences` to confirm subscribers exist

See `docs/alerts-verification.md` for the E2E run log.

## Where to look

| Signal | Location |
|---|---|
| Agent loop health | `~/peakcam/peakcam/agents/loop.log` |
| Pipeline health | `~/peakcam/peakcam/logs/pipeline.log` (once enabled) |
| SNOTEL sync | `~/peakcam/peakcam/scripts/snotel-sync.log` |
| Vercel function logs | Vercel dashboard → Functions → Logs |
| Vercel cron runs | Vercel dashboard → Crons |
| Supabase query logs | Supabase dashboard → Logs |
| Analytics | PostHog dashboard (**URL TBD — Task 4.7**) |
| Resend deliveries | Resend dashboard → Logs |
| Launchd jobs | `launchctl list \| grep com.peakcam` |

## Analytics Events Reference

From `lib/analytics-events.ts`:

| Event | Fires when | Key properties |
|---|---|---|
| `browse_opened` | auto via `$pageview` on `/` | — |
| `resort_viewed` | auto via `$pageview` on `/resorts/[slug]` | — |
| `snow_report_opened` | auto via `$pageview` on `/snow-report` | — |
| `alert_signup_submitted` | after POST `/api/alerts/subscribe` success | `resort_slugs`, `resort_count`, `thresholds` |
| `alert_confirmed` | on `/alerts/manage` mount | `token` (first 8 chars only) |
| `auth_signup_started` | before `supabase.auth.signUp()` | `email_domain` |
| `auth_signup_completed` | after `signUp` success | `email_domain` |
| `favorite_added` / `favorite_removed` | after DB write | `item_id`, `item_type` |
| `condition_voted` | after vote POST success | `resort_slug`, `snow_quality`, `comfort` |

**Known observational caveats (for the dashboard owner):**
- `alert_confirmed` fires on every visit to `/alerts/manage` — if a user revisits to edit preferences, the funnel will show >100% step-3 conversion. Read the raw value, not the ratio.
- `condition_voted` has `snow_quality` + `comfort`, not a single `rating`. Build funnels against those fields, not an imaginary `rating` prop.
- Legacy events in `lib/posthog.tsx` (`resort_card_clicked`, `cam_clicked`, `search_performed`, `filter_applied`) still fire but live outside the central `EVENTS` constant. Tracked for future consolidation; not load-bearing for launch.

## Known Issues / Fast-Follow Backlog

Captured from Task 3 discovery + Task 4 review. Not launch blockers.

1. **Pipeline `snow_reports.source` constraint** — migration 010 pending human apply. Until then, `pipeline-backfill.ts` writes to `data_source_readings` + `resort_conditions_summary` but fails on `snow_reports` insert. Alerts work off `snow_reports` populated by `snotel-sync` instead.
2. **`user_conditions.submitted_at` column missing** — user-reports fetcher selects a column that doesn't exist. Either add via future migration or update the fetcher.
3. **SNODAS tar missing file `1036`** — upstream catalog change or stale filename. Every SNODAS fetch fails silently.
4. **SNOTEL HTML error parsing** — during NRCS outages, fetcher parses HTML `<p class="note">` as a date column. Needs content-type validation.
5. **`alert_confirmed` re-fires on manage-page revisit** — gate the `useEffect` on a server-supplied "first visit" flag, or move capture to the confirm-callback route.

P2 findings from the cross-browser smoke (Task 2) will be appended here by Task 5.2.

## Useful Commands

```bash
# Health check
curl -sI https://www.peakcam.io | head -1

# Inspect pipeline tables
cd ~/peakcam/peakcam && node scripts/pipeline-inspect.mjs

# Manual alert trigger
cd ~/peakcam/peakcam && CRON_SECRET=<val> node scripts/powder-alert-check.mjs

# Agent loop restart
launchctl stop com.peakcam.agents && launchctl start com.peakcam.agents

# Tail all launchd-managed logs
tail -f ~/peakcam/peakcam/agents/loop.log \
       ~/peakcam/peakcam/scripts/snotel-sync.log \
       ~/peakcam/peakcam/logs/pipeline.log
```
