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
| `com.peakcam.cam-stills` | Capture one frame per click-to-play cam → bucket `cam-stills`, `cams.still_url` (latest-only cams at most every 6 h); archive a frame for every `archive_allowed` cam → `cam_stills` + `archive/` prefix; prune: all frames 48 h, one per 6 h to 30 d, keepers to 365 d (`scripts/cam-capture-stills.ts`, policy `docs/cams/still-archive-policy.md`) | every 15 min (900 s, P8 block 1; was 21,600 s earlier on 2026-10-18, 7,200 s before that) | running on the mini (scheduled) — deploy note below |
| `com.peakcam.model-sync` | Weather-model sync (`scripts/model-sync.ts`) | every 6 h | running (scheduled) |
| `com.peakcam.pipeline` | Multi-source blender | daily 06:00 | **prepared but Disabled=true** — awaits migration 010 |

All of the above run from the ops checkout `/Users/maestro_admin/peakcam/peakcam` on the
Mac mini (hostname `Maestros-Mini`, user `maestro_admin`). Verified 2026-10-18 over ssh:
`com.peakcam.cam-stills` is loaded there with `StartInterval` 7200 and that working
directory; `com.peakcam.snotel-sync` (21600), `model-sync`, `cam-health-check` and
`agents` share the path. The clone was on `main` at `5583736` with one dirty file, so it
is behind `origin/main` until the next pull.

**Deploying a change to `com.peakcam.cam-stills` (e.g. the P8 15-min cadence, 2026-10-18):**
on the Mac mini as `maestro_admin` (`ssh mini`), pull `main` in
`/Users/maestro_admin/peakcam/peakcam` and reload the plist (the repo plist already
points at that path; the interval is now 900 s):

```bash
cd /Users/maestro_admin/peakcam/peakcam && git pull
cp com.peakcam.cam-stills.plist ~/Library/LaunchAgents/
launchctl bootout gui/$(id -u)/com.peakcam.cam-stills 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.peakcam.cam-stills.plist
launchctl kickstart -k gui/$(id -u)/com.peakcam.cam-stills   # first run now; expect "archived N" in the log
tail -3 scripts/cam-capture-stills.log                         # "... archive frames pruned (N selected of M candidates, 7 d lookback)"
```

After a cadence change or any gap longer than a week, run one full retention pass by
hand so the band the job re-thins each run (7 days behind the 48 h edge) is not left
with unthinned history: `npx tsx scripts/cam-capture-stills.ts --prune-only --prune-lookback-days 30`
(add `--dry-run` first to see the count).

After the first run `select count(*) from cam_stills` should grow by roughly the number
of archive-allowed active cams (249 on 2026-10-18) per run. The Studio runs only
`com.peakcam.cam-check` and has no peakcam clone (checked 2026-10-18).

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
| Still capture + archive (mini) | `~/peakcam/peakcam/scripts/cam-capture-stills.log`; `select count(*), max(captured_at) from cam_stills` |
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

**Rate limit — enforced since 2026-10-18** by a Vercel WAF custom rule added in
the dashboard (`Public API rate limit`: Request Path starts with `/api/v1/` or
`/api/mcp`, 60 requests per 60 s per IP, exceed action Deny). The firewall API
still answers `404 Seawall Config not found` for this project, so the rule is
only visible and editable at
<https://vercel.com/jaredschuelerspotify-3622s-projects/peakcam/firewall>.
Observed behaviour: the 61st distinct request inside a minute gets **403**
`Forbidden` (text/plain, `x-vercel-mitigated: deny`, no `Retry-After`), not
429; the edge counts every request to the matched paths, cache hits included,
and the window resets about a minute later. The OpenAPI document describes
this 403. Burst check:

```bash
for i in $(seq 1 70); do curl -s -o /dev/null -w '%{http_code}\n' "https://www.peakcam.io/api/v1/powder?minInches=$i"; done | sort | uniq -c   # 60×200, 10×403
```

Smoke check after a deploy:

```bash
curl -sI https://www.peakcam.io/api/v1/resorts/breckenridge | grep -iE '^(x-attribution|link|cache-control|access-control|x-vercel-cache)'
curl -s https://www.peakcam.io/api/v1/powder?source=snotel | jq '.results[:3] | map({slug, in24: .newSnow24h.value})'
curl -s https://www.peakcam.io/api/v1/openapi.json | npx --yes @redocly/cli lint --format=summary -
```

## Discovery surface (markdown alternates, Link headers, robots, llms.txt, IndexNow)

Added 2026-10-18 (branch `feat/discovery-surface`, execution plan Sprint 4). All
of it is read-only and rides on the same cached catalogue as `/api/v1`.

| Surface | Where | Cache |
| --- | --- | --- |
| `GET /resorts/{slug}/index.md` | `app/resorts/[slug]/index.md/route.ts` → `lib/public-api/markdown-page.ts` `resortMarkdown()` | ISR 900 s + public API `Cache-Control` |
| `GET /index.md` | `app/index.md/route.ts` → `indexMarkdown()` | ISR 900 s |
| `Link` header on `/` and `/resorts/{slug}` | `next.config.ts` `headers()` (`discoveryLinkHeader`) | static config |
| `GET /robots.txt` | `app/robots.txt/route.ts` → `lib/robots.ts` (replaced `app/robots.ts`) | 24 h |
| `GET /llms.txt` | `app/llms.txt/route.ts`, "For agents" block | ISR 3600 s |
| IndexNow key | `public/<key>.txt`, key constant in `scripts/indexnow-ping.ts` | static |

The markdown alternates answer `Content-Type: text/markdown; charset=utf-8`,
`X-Robots-Tag: noindex` (the HTML page is what should rank), a `Link` with
`rel="canonical"` plus the author/license relations, and the CORS/attribution
set from `lib/public-api/headers.ts`. They are not in the sitemap. The page
`Link` header uses relative URLs on purpose so a preview advertises its own
alternates: `</sitemap.xml>; rel="sitemap", </resorts/{slug}/index.md>;
rel="alternate"; type="text/markdown", </.well-known/api-catalog>;
rel="api-catalog", </api/v1/openapi.json>; rel="service-desc"; ...`.

`robots.txt` is byte-identical to the old metadata-route output plus one line
in the `User-Agent: *` group, `Content-Signal: search=yes, ai-input=yes,
ai-train=yes` (Content Signals Policy, Cloudflare syntax). Changing the policy
is `CONTENT_SIGNAL` in `lib/robots.ts`; the per-bot allow rules are unchanged
and still the place to block a single crawler.

Smoke check after a deploy:

```bash
curl -sI https://www.peakcam.io/resorts/breckenridge | grep -i '^link'
curl -sI https://www.peakcam.io/resorts/breckenridge/index.md | grep -iE '^(content-type|x-robots-tag|link|x-vercel-cache)'
curl -s https://www.peakcam.io/robots.txt | grep -n Content-Signal      # line 2
curl -s https://www.peakcam.io/llms.txt | sed -n '/## For agents/,/## Key pages/p'
```

**IndexNow — enabled on the Mini since 2026-10-18** (`INDEXNOW_ENABLED=1` in the ops
checkout's `.env.local`; the first manual run submitted 89 URLs, HTTP 202). `scripts/snotel-sync.ts`
collects the slugs that got a new `snow_reports` row and, only when
`INDEXNOW_ENABLED=1`, POSTs their page URLs to `https://api.indexnow.org/indexnow`
in batches of at most 10,000 (`scripts/indexnow-ping.ts`; payload and batching
are unit-tested, no network in tests). The key file must be reachable at
`https://www.peakcam.io/<key>.txt` first, which happens when this branch
reaches production. A failed ping is logged and never fails the sync.

How it was enabled on the Mac mini (repeat only if the checkout or `.env.local` is rebuilt):

1. `ssh mini`, then as `maestro_admin` in `/Users/maestro_admin/peakcam/peakcam`:
   `git pull` so `scripts/indexnow-ping.ts` exists, then append
   `INDEXNOW_ENABLED=1` to that checkout's `.env.local` (the sync loads it;
   no plist edit needed, the launchd job `com.peakcam.snotel-sync` keeps its
   21,600 s interval). To gate per job instead, add the key under
   `EnvironmentVariables` in `~/Library/LaunchAgents/com.peakcam.snotel-sync.plist`
   and `launchctl unload`/`load` it.
2. Verify with a manual run: `npx tsx scripts/snotel-sync.ts 2>&1 | grep indexnow`
   should print `[indexnow] N URLs submitted (HTTP 200)` (202 on the first
   submissions while the key is being verified; 403 means the key file is not
   live yet, 422 means a URL was off-host).
3. One-off submissions: `npx tsx scripts/indexnow-ping.ts breckenridge vail`.
   Bing Webmaster Tools > IndexNow shows what was received.

`scripts/model-sync.ts` (Open-Meteo resorts) does not ping yet; add the same
three lines there when the SNOTEL path has run clean for a week.

## Connect page and MCP listings (`/connect`, server card, `server.json`)

Added 2026-10-18 (branch `feat/connect-page`, execution plan Sprint 6). All
static; nothing here reads the database.

| Surface | Where | Cache |
| --- | --- | --- |
| `GET /connect` | `app/connect/page.tsx`, data in `components/connect/links.ts` (links, tools, prompts, client recipes) | static per deploy |
| `GET /.well-known/mcp/server-card.json` | `app/.well-known/mcp/server-card.json/route.ts` → `components/connect/server-card.ts` | 1 day, ETag, CORS `*` |
| `GET /api/mcp/server-card` | `app/api/mcp/server-card/route.ts`, re-exports the `.well-known` handlers (SEP-2127 reserved location `<streamable-http-url>/server-card`) | same, byte-identical |
| `server.json` (repo root) | MCP Registry manifest, read by `mcp-publisher publish` from the repo root; not served | n/a |
| Footer "Developers" column | `components/home/PeakFooter.tsx`: `/connect`, `/api/mcp`, `/api/v1/resorts`, `/api/v1/openapi.json`, `/llms.txt` | static |
| `llms.txt` "For agents" MCP line | `app/llms.txt/route.ts` | ISR 3600 s |

The server card follows the SEP-2127 **v1** shape (schema
`https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json`):
`name`, `version` (package.json), `description` (≤ 100 chars), `title`,
`websiteUrl`, `repository`, `remotes[{type, url, supportedProtocolVersions}]`.
The card does not list tools or auth at the top level by design (runtime
listing owns that); the human summary (tools, no-auth, licence, contact,
documentation) is under `_meta["io.peakcam/connect"]`. The SEP's reserved
location is `<streamable-http-url>/server-card`, i.e. `/api/mcp/server-card`,
served since 2026-10-18 by re-exporting the same handlers, so the two documents
cannot drift. An `/.well-known/ai-catalog.json` pointing at the card is the
discovery entry the extension expects and is not shipped yet.

Guard rails: `tests/connect-links.test.ts` walks every internal href in
`CONNECT_LINKS` and fails if it does not match a `page.tsx`/`route.ts` under
`app/` (dynamic `[segment]`s match anything) or a file under `public/`; a link
may be `pending: true` only while its route is absent, and the test fails the
other way once the route exists. `tests/mcp-listings.test.ts` checks both
documents parse, agree on name/version/endpoint, and that `server.json` keeps
the one `_meta` key the registry preserves. Bump `server.json` `version` when
`package.json` moves (the test enforces equality).

Smoke check after a deploy:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://www.peakcam.io/connect
curl -sI https://www.peakcam.io/.well-known/mcp/server-card.json | grep -iE '^(content-type|cache-control|etag|access-control-allow-origin)'
curl -s https://www.peakcam.io/.well-known/mcp/server-card.json | jq '{name, version, remotes}'
curl -s https://www.peakcam.io/llms.txt | grep -n 'MCP server'
curl -s https://www.peakcam.io/sitemap.xml | grep -c '/connect<'
```

**Submissions.** MCP Registry: **published 2026-10-18** as `io.peakcam/snow`
0.1.0 (`curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.peakcam/snow"`).
Namespace proof is the apex TXT `peakcam.io. IN TXT "v=MCPv1; k=ed25519; p=…"`
in Vercel DNS (record `rec_82e1d6ea8c9f5198f4beef15`); the matching Ed25519
private key lives on the Mac Studio at `~/.config/peakcam-mcp-registry-key.pem`
(user `totcho_admin`, not in the repo, not backed up anywhere else). To
re-publish after bumping `version` in both `package.json` and `server.json`, on
the Studio from the repo root:

```bash
OPENSSL=/opt/homebrew/opt/openssl@3/bin/openssl
PRIVATE_KEY="$($OPENSSL pkey -in ~/.config/peakcam-mcp-registry-key.pem -noout -text | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')"
mcp-publisher login dns --domain peakcam.io --private-key "$PRIVATE_KEY"
mcp-publisher validate && mcp-publisher publish
```

(`brew install mcp-publisher`; a lost key means a new key, a replaced TXT record
and a fresh login, nothing else.) Claude
Connectors Directory (not yet submitted, needs the owner's claude.ai login) through <https://claude.ai/directory/manage> → Submit new
→ MCP connector (listing fields: name, one-liner ≤ 200, description ≤ 2,000,
categories, documentation `/connect`, privacy `/about#privacy`, support
`hello@peakcam.io`, icon, no authentication). The PR that shipped this page
carries the exact commands and payload text.
