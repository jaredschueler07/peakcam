# PeakCam Runbook

> Last updated: 2026-04-17
> Status: pre-V0-launch baseline. Human-gated tasks (QA smoke, PostHog dashboard, alerts inbox E2E) will add to this doc as they complete.

## Environments

| Environment | URL |
|---|---|
| Production | https://www.peakcam.io |
| Vercel dashboard | https://vercel.com/ → peakcam project |
| Supabase | https://supabase.com/dashboard → peakcam project |
| PostHog | https://us.posthog.com/project/350200/dashboard/1486208 |
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
| `com.peakcam.cam-health-check` | Probe every cam, bump `consecutive_failures`, auto-disable dead ones | daily 06:00 | running (scheduled) |
| `com.peakcam.cam-stills` | Capture one frame per click-to-play cam → bucket `cam-stills`, `cams.still_url`; archive a frame for every `archive_allowed` cam → `cam_stills` + `archive/` prefix, prune by retention (`scripts/cam-capture-stills.ts`, policy `docs/cams/still-archive-policy.md`) | every 6 h (21,600 s, since 2026-10-18; was 2 h) | **host unverified, see below** |

**Deploying a change to `com.peakcam.cam-stills` (e.g. the Sprint 8 archive, 2026-10-18):**
pull `main` on whichever machine runs `com.peakcam.cam-stills` — verify with
`launchctl list | grep peakcam` on the mini **and** the Studio — then reload the plist:

```bash
cd <that machine's peakcam checkout> && git pull
cp com.peakcam.cam-stills.plist ~/Library/LaunchAgents/
launchctl bootout gui/$(id -u)/com.peakcam.cam-stills 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.peakcam.cam-stills.plist
launchctl kickstart -k gui/$(id -u)/com.peakcam.cam-stills   # first run now; expect "archived N" in the log
```

Finding of 2026-10-18: the repo plist points at `/Users/maestro_admin/peakcam/peakcam`
with a 7,200 s interval, but the Mac Studio (user `totcho_admin`) has no `maestro_admin`
user, no peakcam clone and only `com.peakcam.cam-check.plist` loaded, so the stills job is
**not** running on the Studio. It most likely runs on the Mac mini like the other
`com.peakcam.*` jobs, but that was not verified. Edit the plist paths for the real
checkout before copying it. After the first run: `select count(*) from cam_stills` should
grow by roughly the number of archive-allowed active cams (249 on 2026-10-18) per run.
| `com.peakcam.model-sync` | Weather-model sync (`scripts/model-sync.ts`) | scheduled | running (scheduled) |
| `com.peakcam.pipeline` | Multi-source blender | daily 06:00 | **prepared but Disabled=true** — awaits migration 010 |

## Launchd Services (Studio)

| Label | Purpose | Schedule | Status |
|---|---|---|---|
| `com.peakcam.cam-check` | Camera-preview health check with an escalation ladder (`scripts/cam-check.sh`) | every 3 h | running (scheduled) |

`cam-check.sh` runs four tiers: `scripts/cam-check.ts` collects facts (Supabase stills + card coverage via `lib/cam-preview.ts`, the mini's launchd jobs and log tails over ssh, www.peakcam.io + stored-still HEADs) and applies fixed rules; Muse Glimmer (local Ollama on the Studio) triages the facts; when either flags an issue, Muse Code (`muse exec --model muse-spark-1.3`) investigates read-only in the repo; it can hand off to Muse Wonder (`muse-wonder-full-1.0`). Nothing is modified by the ladder. Reports: `~/Library/Application Support/peakcam-cam-check/runs/<stamp>/report.md` (`latest.md` is the newest); log `~/Library/Logs/peakcam-cam-check.log`. WhatsApp (via `hermes send`; Slack `#village-agents` as fallback when the WhatsApp bridge is down) gets a message on status change, after any escalation, and once a day after 07:00. The same alert set is not re-investigated within 24 h. Manual: `bash scripts/cam-check.sh --dry-run` (tier 0 only), `--force-escalate --no-notify` to exercise the ladder. Install: `cp com.peakcam.cam-check.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.peakcam.cam-check.plist`.

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
| Analytics | PostHog dashboard (https://us.posthog.com/project/350200/dashboard/1486208) |
| Resend deliveries | Resend dashboard → Logs |
| Launchd jobs | `launchctl list \| grep com.peakcam` |
| Still capture + archive (mini, unverified) | `~/peakcam/peakcam/scripts/cam-capture-stills.log`; `select count(*), max(captured_at) from cam_stills` |
| Cam health check (mini) | `~/peakcam/peakcam/scripts/cam-health-check.log` |
| Camera-preview check (Studio) | `~/Library/Application Support/peakcam-cam-check/latest.md`, `~/Library/Logs/peakcam-cam-check.log` |

## Analytics Events Reference

From `lib/analytics-events.ts`:

| Event | Fires when | Key properties |
|---|---|---|
| `browse_opened` | auto via `$pageview` on `/` | — |
| `resort_viewed` | `ResortDetailPage` mount (queued until PostHog init; see `lib/analytics-events.ts`) | `resort_slug` |
| `snow_report_opened` | auto via `$pageview` on `/snow-report` | — |
| `resort_card_clicked` / `cam_clicked` / `cam_played` / `search_performed` / `filter_applied` | browse + resort interactions via `lib/posthog.tsx` helpers (all routed through `track()`) | `resort_slug`, `cam_name`, `embed_type`, `surface`, `query`, `filter` |
| `alert_modal_opened` | powder-alert modal opened | `source` |
| `alert_signup_submitted` | after POST `/api/alerts/subscribe` success (legacy name; kept for dashboard continuity) | `resort_slugs`, `resort_count`, `thresholds` |
| `alert_signup_succeeded` | same success handler; also fires Meta `Lead`, Google Ads and Reddit `SignUp` conversions once per browser | `resort_count`, `threshold_min`, `resort_slugs`, `repeat_in_browser` |
| `alert_confirmed` | on `/alerts/manage` mount | — (token no longer sent) |
| `auth_signup_started` | before `supabase.auth.signUp()` | `email_domain` |
| `auth_signup_submitted` | after `signUp` returns (email confirmation still pending) | `email_domain` |
| `auth_signup_completed` | on `/auth/callback` landing with `?welcome=signup` when `email_confirmed_at` is fresh, or immediately when signUp returns a session | `confirmation: "email" \| "none"` |
| `auth_callback_failed` | `/auth?error=auth_failed` | `reason` (`missing_code`, `missing_code_verifier`, `exchange_failed`, `verify_failed`) |
| `favorite_added` / `favorite_removed` | after DB write | `item_id`, `item_type` |
| `condition_voted` | after vote POST success | `resort_slug`, `snow_quality`, `comfort` |

PostHog `identify(user.id, { email_domain })` runs on sign-in and `reset()` on sign-out (`lib/posthog-auth-sync.tsx`); the `/about` privacy copy describes this.

**Known observational caveats (for the dashboard owner):**
- `alert_confirmed` fires on every visit to `/alerts/manage` — if a user revisits to edit preferences, the funnel will show >100% step-3 conversion. Read the raw value, not the ratio.
- `condition_voted` has `snow_quality` + `comfort`, not a single `rating`. Build funnels against those fields, not an imaginary `rating` prop.
- Legacy events in `lib/posthog.tsx` (`resort_card_clicked`, `cam_clicked`, `search_performed`, `filter_applied`) still fire but live outside the central `EVENTS` constant. Tracked for future consolidation; not load-bearing for launch.

## Auth Email Templates (Supabase dashboard)

Source of truth is `supabase/email-templates/*.html` (mirrored, JSON-escaped, in `templates.json`, which also holds the subjects as `mailer_subjects_*`). **Supabase does not read the repo.** A template change takes effect only when the HTML is pasted into the dashboard: project `owsxnogvufankayfwczl` → **Authentication → Email Templates → (Confirm signup | Reset password | …) → Source**, then Save.

`confirmation.html` (Confirm signup) and `recovery.html` (Reset password) link straight to our callback with a token hash:

```
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup&next={{ .RedirectTo }}
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next={{ .RedirectTo }}
```

`app/auth/callback/route.ts` verifies the hash server-side (`supabase.auth.verifyOtp({ token_hash, type })`) and writes the session cookies from that response, so the link works in whichever browser opens it. The previous `{{ .ConfirmationURL }}` form bounced through Supabase's `/auth/v1/verify` and came back with a PKCE `code` that only the browser holding the code-verifier cookie could exchange — mail-app webviews and second devices landed on `/auth?error=auth_failed&reason=missing_code_verifier` with the account already confirmed. The `code` path is still handled, for links already sitting in inboxes and for the templates that keep `{{ .ConfirmationURL }}` (invite, email change). `{{ .RedirectTo }}` is the `emailRedirectTo` the form sent (`…/auth/callback?next=/favorites`); the callback unwraps it to its inner `next`, runs it through `safeNext()`, and collapses anything off-origin to `/`.

Order of operations when changing these:

1. Deploy the app with the `token_hash`-aware callback first — it is backwards compatible, the templates are not.
2. **Authentication → URL Configuration**: Site URL must be `https://www.peakcam.io` (the link is built from `{{ .SiteURL }}`), and `https://www.peakcam.io/auth/callback` (or `https://www.peakcam.io/**`) must be on the redirect allowlist, otherwise Supabase downgrades `{{ .RedirectTo }}` to the bare Site URL and every confirmed user lands on `/` instead of their `next` page.
3. Paste `supabase/email-templates/confirmation.html` into **Confirm signup** and `recovery.html` into **Reset password**; Save each.
4. Test with a designated inbox: sign up on one device, open the link in a different browser → should land on the `next` page with `?welcome=signup`; request a password reset → link should land on `/auth/update-password` signed in. In PostHog, `auth_callback_failed` with `reason=verify_failed` means the hash was expired or already used (token-hash links are single-use — a mail scanner that follows the link first consumes it).

Rollback: paste the previous template body back (the `{{ .ConfirmationURL }}` form is in git history for both files). The callback keeps accepting `code`, so no app change is needed to roll back.

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

## Drop In (arcade game) — parked

Drop In was gated out of production on 2026-09-17 so the core cam/snow product gets focus. The code stays in the tree; `lib/drop-in.ts` reads `NEXT_PUBLIC_DROP_IN_ENABLED` and, while it is not `"true"`, hides the nav item, resort/map buttons, sitemap entry and 404 link, and 404s `/drop-in`, `/resorts/{slug}/drop-in` and every `/api/drop-in/*` route.

- **Re-enable:** set `NEXT_PUBLIC_DROP_IN_ENABLED=true` in the Vercel environment (it is inlined at build time, so redeploy).
- **Snapshot of the game before parking:** branch `archive/drop-in-2026-09-17`, tag `drop-in-archive-2026-09-17`. The unmerged v3 engine lives on `feat/drop-in-v3-skisim`.
- **Game e2e specs** skip themselves unless the flag is set.

## Public API (`/api/v1`)

Read-only, anonymous JSON for agents and developers, added 2026-10-18 (branch
`feat/public-api-mcp`, execution plan Sprint 3). Everything reads through the
cached catalogue (`getAllResorts()`, 1 h) plus `resort_openings` and
`resort_metadata` elevations; nothing here writes.

| Route | What | Cache |
| --- | --- | --- |
| `GET /api/v1/resorts` | Light list: every active resort, headline numbers, rating, season status, cam counts | ISR 900 s |
| `GET /api/v1/resorts/{slug}` | Full document: location, snow report per field with provenance, season, cams | ISR 900 s |
| `GET /api/v1/resorts/{slug}/cams` | Active cams: `live` health, still URL, `capturedAt` (PeakCam captures only) | ISR 900 s |
| `GET /api/v1/powder?window=24h\|48h&state=&minInches=&source=&limit=` | Ranked new snow; `source=snotel` = measured only | ISR 900 s per URL |
| `GET /api/v1/openapi.json` | OpenAPI 3.1, generated from the zod registry in `lib/public-api/schema.ts` | static, 1 h / 24 h CDN |
| `GET /.well-known/api-catalog` | RFC 9727 linkset pointing at the OpenAPI document | static, 1 h / 24 h CDN |

All routes answer `OPTIONS` with 204. Unknown slugs 404 with `Cache-Control:
no-store`; all other responses carry `public, s-maxage=900,
stale-while-revalidate=3600`, so a bad deploy clears from the CDN within 15
minutes and a Supabase outage keeps serving the last good document (the read
path throws rather than returning an empty catalogue).

Headers on every response (`lib/public-api/headers.ts`):
`Access-Control-Allow-Origin: *`, `Access-Control-Expose-Headers: Link,
X-Attribution`, `X-Attribution: PeakCam (https://www.peakcam.io) - SNOTEL data:
USDA NRCS; forecasts: NWS/Open-Meteo; cams: their operators`, `Link:
<https://www.peakcam.io>; rel="author", <https://www.peakcam.io/about#terms>;
rel="license"`, `Vary: Accept`. The licence link points at the Terms section of
`/about` because there is no standalone `/terms` page; move it when one exists.

Code: `lib/public-api/{schema,serialize,headers,openapi,data}.ts`, routes under
`app/api/v1/` and `app/.well-known/api-catalog/`. `proxy.ts` excludes
`api/v1/` and `api/mcp` from the Supabase session refresh. Station names and
elevations come from `lib/public-api/stations.json`, trimmed from
`data/snotel_stations.json` to the triplets the catalogue references;
regenerate it when a resort gets a new station.

**Rate limit — not enforced yet.** The plan calls for a Vercel WAF custom rule
(60 requests / 60 s per IP on `/api/v1/` and `/api/mcp`, action
`rate_limit` → 429). On 2026-10-18 every firewall endpoint for project
`prj_kW5KDfMw3cWyOKSEJSFeZ9q7Q85W` (team `team_9gcibwoI6xSIs4ixHDAN8SYA`)
returned `404 not_found: Seawall Config not found` — `GET
/v1/security/firewall/config/active`, `PUT /v1/security/firewall/config` with
the rule, and `PATCH … {action: firewallEnabled}` all alike. That is the
response for a project whose WAF has never been provisioned, and custom rules /
rate limiting are a Pro-plan feature, so this needs a human in the dashboard:
<https://vercel.com/jaredschuelerspotify-3622s-projects/peakcam/firewall> →
Configure → Add rule: name `Public API rate limit`, condition `Request Path`
*starts with* `/api/v1/` OR *starts with* `/api/mcp`, action **Rate Limit**,
60 requests per 60 s, keyed by IP, then **Deny**. The OpenAPI document already
advertises the 60/min limit and a 429 response. Until the rule exists the only
protection is the 15-minute CDN cache, which absorbs read bursts on hot URLs
but not a scan of distinct query strings on `/api/v1/powder`.

Smoke check after a deploy:

```bash
curl -sI https://www.peakcam.io/api/v1/resorts/breckenridge | grep -iE '^(x-attribution|link|cache-control|access-control|x-vercel-cache)'
curl -s https://www.peakcam.io/api/v1/powder?source=snotel | jq '.results[:3] | map({slug, in24: .newSnow24h.value})'
curl -s https://www.peakcam.io/api/v1/openapi.json | npx --yes @redocly/cli lint --format=summary -
```
