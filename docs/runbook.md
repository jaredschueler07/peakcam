# PeakCam Runbook

> Last updated: 2026-10-20 (parity plan P10: the job table below was rewritten from the plists loaded on the Mac mini that day).
> Status: in production. Human-gated tasks are under "Where to look"; the public MCP server and `/connect` were retired on 2026-11-21 (last section).

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

Ground truth is `~/Library/LaunchAgents/com.peakcam.*.plist` on the mini, read over ssh on
2026-10-20 (`ssh mini 'launchctl list | grep peakcam'`); every row below was loaded and
matched the plist in the repo root. All jobs run as `maestro_admin` from the ops checkout
`/Users/maestro_admin/peakcam/peakcam` (on `main` at `9af28b4` that morning), write via the
service-role key in that checkout's `.env.local`, and log to the path in the last column
(stdout and stderr to the same file). Times are the mini's local time (America/Denver).

| Label | Script (`ProgramArguments`) | Schedule | Writes | Log |
|---|---|---|---|---|
| `com.peakcam.agents` | `node agents/loop.mjs` | always-on (`KeepAlive`, `RunAtLoad`) | `agent_memory`, Slack | `agents/loop.log` |
| `com.peakcam.snotel-sync` | `npx tsx scripts/snotel-sync.ts` | 00:15, 05:15, 06:15, 12:15, 18:15 Central (`StartCalendarInterval` ×5; two morning runs because NRCS has the day's values from about 11:00 UTC and sometimes answers 5xx) | `snowpack_daily`, `snow_reports` (source `snotel`), `resorts.cond_rating`; IndexNow ping when `INDEXNOW_ENABLED=1` | `scripts/snotel-sync.log` |
| `com.peakcam.model-sync` | `npx tsx scripts/model-sync.ts` | 00:45, 06:45, 12:45, 18:45 Central (`StartCalendarInterval` ×4) | `snow_reports` (source `open_meteo`) for the resorts without a station, `cond_rating` | `scripts/model-sync.log` |
| `com.peakcam.stations-sync` | `npx tsx scripts/stations-sync.ts` | hourly (3,600) | `stations`, `resort_stations`, `station_observations` (migration 026); never `snow_reports` | `scripts/stations-sync.log` |
| `com.peakcam.forecast-sync` | `npx tsx scripts/forecast-sync.ts` | 01:05, 09:05, 17:05 Central (`StartCalendarInterval` ×3, no `RunAtLoad`) | `forecast_runs`, `forecast_daily` (027); ~240 Open-Meteo calls a run; retention pass in the 01:05 Central run only (`isPruneRun`, starts before 12:00 UTC) | `scripts/forecast-sync.log` |
| `com.peakcam.forecast-score` | `npx tsx scripts/forecast-score.ts` | daily 07:30 (`StartCalendarInterval`) | `forecast_scores` (027), graded against SNOTEL depth deltas over 90 days | `scripts/forecast-score.log` |
| `com.peakcam.score-sync` | `npx tsx scripts/score-sync.ts` | 07:45 and 19:45 (`StartCalendarInterval` ×2, `RunAtLoad`) | `resort_scores` (028): one 0–100 Snow Score row per resort per day with five components (`lib/score.ts`), idempotent on `(resort_id, date)`; **to deploy** (P7, 2026-10-20, see "Snow Score") | `scripts/score-sync.log` |
| `com.peakcam.operator-sync` | `npx tsx scripts/operator-sync.ts` | every 30 minutes, 07:05 to 16:35 Central (`StartCalendarInterval` ×20) | `operator_status` (032), read from each operator's own lift-status page with Liftie's parsers (see "Operator status"); exit 1 only when every resort fails | `scripts/operator-sync.log` |
| `com.peakcam.cam-stills` | `npx tsx scripts/cam-capture-stills.ts` | every 15 min (900, `RunAtLoad`) | bucket `cam-stills`, `cams.still_url`, `cam_stills` (archive_allowed cams; 48 h / 6-h buckets to 30 d / keepers a year) | `scripts/cam-capture-stills.log` |
| `com.peakcam.cam-timelapse` | `npx tsx scripts/cam-timelapse.ts` | every 6 h (21,600, `RunAtLoad`) | bucket `cam-timelapses`, `cam_timelapses` (031): the 24 h MP4 + poster per archive-allowed cam, storm reels | `scripts/cam-timelapse.log` |
| `com.peakcam.cam-health-check` | `node scripts/cam-health-check.mjs` | daily 06:00 (`StartCalendarInterval`) | `cams.last_checked_at`, `consecutive_failures`, auto-disables dead cams | `scripts/cam-health-check.log` |
| `com.peakcam.pipeline` | — | not loaded: the file is `com.peakcam.pipeline.plist.disabled` | nothing (multi-source blender, dormant) | `logs/pipeline.log` (empty) |

Not on launchd: `npm run snotel-backfill` and `npm run seed-normals` (run once; "Season history"),
`npx tsx scripts/import-resorts-standalone.mjs` and `scripts/import-profiles.ts` (per coverage batch),
`npm run generate-descriptions` (per batch, needs `ANTHROPIC_API_KEY`), `scripts/approach-cams-sync.ts`
(by hand, pending the DriveBC terms call). Vercel runs one cron, `/api/alerts/trigger` daily
13:00 UTC (`vercel.json`, Bearer `CRON_SECRET`). The Mac Studio runs only `com.peakcam.cam-check`
(next section) and has no checkout.

**Reload recipe, any job.** The plist in the repo root is the source; copy it over the installed one,
bootout, bootstrap, then kickstart if the job should run now (`RunAtLoad` jobs start on bootstrap
by themselves). npm is not on the non-login PATH, so wrap npm/npx in `zsh -l -c`:

```bash
JOB=stations-sync   # any label suffix from the table
ssh mini 'zsh -l -c "cd /Users/maestro_admin/peakcam/peakcam && git pull && npm ci --no-audit --no-fund"'
ssh mini "cd /Users/maestro_admin/peakcam/peakcam && cp com.peakcam.$JOB.plist ~/Library/LaunchAgents/ && launchctl bootout gui/\$(id -u)/com.peakcam.$JOB 2>/dev/null; launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/com.peakcam.$JOB.plist && launchctl list | grep com.peakcam.$JOB"
ssh mini "launchctl kickstart -k gui/\$(id -u)/com.peakcam.$JOB"          # run now (optional)
ssh mini "tail -5 /Users/maestro_admin/peakcam/peakcam/scripts/$JOB.log"
```

`launchctl list | grep peakcam` prints `PID  last-exit  label`; a `-` PID is a scheduled job
between runs, a non-zero exit is the script's own (operator-sync exits 1 when every resort
fails; cam-stills exits 3 if its 30-min watchdog trips). A pull alone is enough for a script change (each run starts a fresh process); a plist
change needs the reload. The dependency order when restarting everything: `snotel-sync` and
`model-sync` first (they feed `snow_reports`), then `stations-sync`, `forecast-sync` (and the
scorer the next morning), `cam-stills` before `cam-timelapse`.

**Why three jobs run at fixed clock times (2026-11-20).** `snotel-sync`, `model-sync` and
`forecast-sync` used `StartInterval` 21,600. launchd counts an interval from the end of the
previous run, so each start drifted later every day (about 17 minutes for `snotel-sync`).
Two things broke:

- The powder-alert cron runs at 13:00 UTC (`vercel.json`) and reads `latest_snow_reports`.
  By 2026-11-19 the morning SNOTEL run had drifted past 13:00 UTC, so alerts went out on the
  previous day's numbers. The 06:15 and 06:45 Central runs now finish before 13:00 UTC in
  both standard and daylight time.
- Open-Meteo allows 10,000 weighted calls per UTC day per address. A forecast run costs about
  2,631 and a model run about 330. Most UTC days held four forecast runs (10,524 + 1,320),
  which ran the allowance out mid-afternoon. Three forecast runs and four model runs cost
  about 9,213 and leave roughly 790 for local builds. `forecast-sync` no longer has
  `RunAtLoad`, so reloading the job does not spend a run.

To run one now, kickstart it; a kickstart does not move the calendar times. Count an extra
forecast or model run against the same daily allowance before starting it.

First-time deploy notes for the individual jobs follow; they are kept because each carries
its dry-run and verification commands.

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

**Loading `com.peakcam.stations-sync` for the first time (parity block P3):** on the
Mac mini as `maestro_admin`, pull `main`, prove the fetchers against public APIs with a
dry run, then load the plist and kick it once. The job needs `SUPABASE_SERVICE_ROLE_KEY`
in the checkout's `.env.local` (already there for `snotel-sync`); the optional road-cam
keys (`UDOT_API_KEY`, `WSDOT_ACCESS_CODE`, `COTRIP_API_KEY`) are read only by
`approach-cams-sync`.

```bash
ssh mini
cd /Users/maestro_admin/peakcam/peakcam && git pull && npm ci
npx tsx scripts/stations-sync.ts --dry-run --resort alta        # expect a summit NWS row and the Atwater SNOTEL row
cp com.peakcam.stations-sync.plist ~/Library/LaunchAgents/
launchctl bootout gui/$(id -u)/com.peakcam.stations-sync 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.peakcam.stations-sync.plist
launchctl kickstart -k gui/$(id -u)/com.peakcam.stations-sync   # first full sync now, ~10 min for 148 resorts
tail -f scripts/stations-sync.log                                # ends with "N/148 resorts with ≥1 station, M with ≥2 sources"
npx tsx scripts/approach-cams-sync.ts --dry-run                  # 19 resorts / 71 cams from Caltrans + DriveBC on 2026-10-18
npx tsx scripts/approach-cams-sync.ts                            # writes kind=approach cams rows once the DriveBC terms call is made
```

Verify in production after the first run:

```bash
curl -s https://www.peakcam.io/api/v1/resorts/alta | jq '.measuredNow[] | {role, source, sourceId, elevationFt, ageMinutes, snowDepthIn, tempF, windMph}'
curl -s https://www.peakcam.io/resorts/alta/index.md | grep -A6 "What the instruments say"
```

and in SQL: `select source, count(*) from stations group by 1;`
`select count(distinct resort_id) from resort_stations;`
`select max(observed_at) from station_observations;`. The API and the page cache the
station index for 15 minutes, so allow that long after the first sync.

**Deploying `com.peakcam.cam-timelapse` (P8 block 2, 2026-10-20):** on the Mac mini as
`maestro_admin`. ffmpeg 9.0.2 with libx264 is already installed there (`/opt/homebrew/bin/ffmpeg`,
checked 2026-10-20). Apply migration 031 first (the renderer writes `poster_url`, `starts_at`,
`ends_at`, `bytes` and the site reads `cam_timelapse_current`); the renderer creates the public
bucket `cam-timelapses` itself if the migration did not. A dry run renders to a temp dir and
writes nothing; the first real run over ~374 cams takes 10–20 min at concurrency 2.

```bash
ssh mini 'zsh -l -c "ffmpeg -version | head -1 && ffmpeg -hide_banner -encoders | grep libx264"'   # ffmpeg 9.0.2, libx264 present
ssh mini 'zsh -l -c "cd /Users/maestro_admin/peakcam/peakcam && git pull && npm ci --no-audit --no-fund"'
ssh mini 'zsh -l -c "cd /Users/maestro_admin/peakcam/peakcam && npx tsx scripts/cam-timelapse.ts --dry-run --resort alta | tail -8"'   # "✓ alta/<cam> 24h: N frames WxH K KB (dry run, not stored)"
ssh mini 'zsh -l -c "cd /Users/maestro_admin/peakcam/peakcam && npx tsx scripts/cam-timelapse.ts --resort alta | tail -8"'             # first real clips for one resort
ssh mini 'cd /Users/maestro_admin/peakcam/peakcam && cp com.peakcam.cam-timelapse.plist ~/Library/LaunchAgents/ && launchctl bootout gui/$(id -u)/com.peakcam.cam-timelapse 2>/dev/null; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.peakcam.cam-timelapse.plist && launchctl list | grep com.peakcam.cam-timelapse'
# RunAtLoad starts the first full render at bootstrap; watch it finish:
ssh mini 'tail -f /Users/maestro_admin/peakcam/peakcam/scripts/cam-timelapse.log'   # ends "[cam-timelapse] done: N × 24 h and M storm clips rendered (X MB), ..."
```

Verify in the database: `select "window", count(*), max(rendered_at), round(avg(bytes)/1024) as avg_kb, max(bytes) as max_bytes from cam_timelapses group by 1`
(every `max_bytes` ≤ 3,145,728), `select count(*) from cam_timelapse_current`. Then in production (allow the
15-minute API cache): `curl -s https://www.peakcam.io/api/v1/resorts/alta/timelapses | jq '{available, clipCount, lastStorm: .lastStorm.stormDate, cams: [.cams[] | {camName, clip: .current.url}]}'`,
`curl -s https://www.peakcam.io/api/v1/resorts/alta/cams | jq '.cams[0].timelapses'`,
`curl -s https://www.peakcam.io/resorts/alta/webcams/index.md | grep -i timelapse`,
and `curl -sI "$(curl -s https://www.peakcam.io/api/v1/resorts/alta/timelapses | jq -r '.cams[0].current.url')" | grep -i 'content-type\|content-length'`
(video/mp4, under 3 MB). The webcams page shows the "Last 24 hours" strip after its hourly ISR window.
Cadence: `StartInterval` in the plist; frame rate, size cap and storm rules: the constants at the
top of `lib/cam-timelapse.ts`. `--prune-only` runs the storm-reel retention pass alone.

**Deploying the P4 forecast jobs (`com.peakcam.forecast-sync`, `com.peakcam.forecast-score`, 2026-10-20):**
on the Mac mini as `maestro_admin` (`ssh mini`; use `zsh -l -c` because npm is not on the
non-login PATH), pull `main` in `/Users/maestro_admin/peakcam/peakcam`, load both plists and
run one sync now. The first sync writes ~2,600 runs (148 resorts × ≤2 points × ≤9 models);
scores appear after the first 07:30 scorer run that finds a stored day-1 run for a measured
date, i.e. from the second day on, and fill in over the following weeks as leads 3 and 7 get
their issue days.

```bash
ssh mini 'zsh -l -c "cd /Users/maestro_admin/peakcam/peakcam && git pull && npm ci --no-audit --no-fund"'
ssh mini 'zsh -l -c "cd /Users/maestro_admin/peakcam/peakcam && npx tsx scripts/forecast-sync.ts --dry-run --resort alta | tail -5"'   # Open-Meteo reachable, 18 runs would be written
ssh mini 'cd /Users/maestro_admin/peakcam/peakcam && cp com.peakcam.forecast-sync.plist com.peakcam.forecast-score.plist ~/Library/LaunchAgents/ && launchctl bootout gui/$(id -u)/com.peakcam.forecast-sync 2>/dev/null; launchctl bootout gui/$(id -u)/com.peakcam.forecast-score 2>/dev/null; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.peakcam.forecast-sync.plist && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.peakcam.forecast-score.plist && launchctl list | grep com.peakcam.forecast'
# RunAtLoad starts the first sync at bootstrap; watch it finish (≈ 5 min at 150 ms between calls):
ssh mini 'tail -f /Users/maestro_admin/peakcam/peakcam/scripts/forecast-sync.log'            # ends "[forecast-sync] Done. 148 resorts, ~290 Open-Meteo calls, ~2600 runs written ..."
ssh mini 'zsh -l -c "cd /Users/maestro_admin/peakcam/peakcam && npx tsx scripts/forecast-score.ts --dry-run --resort alta | tail -3"'   # "no stored runs yet" today; a scored line from tomorrow
ssh mini 'launchctl kickstart -k gui/$(id -u)/com.peakcam.forecast-score'                   # optional: run the scorer now instead of waiting for 07:30
```

Verify in the database (Supabase SQL Editor / MCP): `select point, count(*) from forecast_runs
group by 1` (≈ 145 summit + 148 base after the first run), `select count(*) from forecast_daily`
(≈ 25 k), `select model, count(*) from forecast_scores group by 1` (empty until the scorer has
a day-1 pair). Then the production smoke checks under "Public API" below. Cadence or retention
changes: `StartInterval` in the plist for the sync; `THIN_AFTER_DAYS` / `DELETE_AFTER_DAYS` in
`lib/forecast/retention.ts`.

### Cam health check: what each cam type is judged on

`scripts/cam-health-check.mjs` (daily 06:00 Central). Three consecutive failures auto-disable a
row (`is_active=false`, `auto_disabled=true`); an auto-disabled row keeps being probed and comes
back on its first healthy check; a manually disabled row (`is_active=false`,
`auto_disabled=false`) is never written beyond `last_checked_at`.

| Cam | Healthy when | Fails with |
|---|---|---|
| `youtube` | the watch page says playable, embeddable and live now | `youtube: stream ended`, `youtube: unavailable`, `youtube: login required`, `youtube: not embeddable`, `youtube: not a live stream` |
| `image` | HTTP 2xx, the body starts with JPEG/PNG/GIF/WebP bytes (or is `image/*` and not markup), and `Last-Modified`, when sent, is at most 5 days old (`IMAGE_STALE_DAYS`) | `image: not an image (<content type>)`, `image: frame N days old`, or the HTTP/TLS error |
| camstreamer `…/embed/<id>` | the YouTube stream the embed page currently serves is live | `camstreamer → youtube: …` |
| ipcamlive player | the provider's stream-state endpoint reports a stream | `ipcamlive: no stream` |
| other `iframe` / `link` | HTTP status below 400 | the HTTP/TLS error |

- **A probe that cannot reach a verdict never counts.** If the YouTube watch page cannot be
  fetched or read (network error, consent or "not a bot" page, missing fields), the row is judged
  on oEmbed as before and logged "liveness unknown". Same for a camstreamer page with no YouTube
  id in it (the `/embed/<a>/<b>` and `/live/stream/<n>` forms do not expose one) and for an image
  with no `Last-Modified` header.
- **Off-season.** At a resort that is out of season (`isOffSeasonAt`, the same months as
  `lib/map-utils` `isOffSeason`), "no stream" and "frame N days old" are recorded but not counted:
  operators switch cameras off for the summer. A dead YouTube id counts in any season, because
  the id never returns; a restarted stream gets a new one.
- **Why (2026-11-20).** oEmbed answers 200 for any video that still exists, so 92 of 264 active
  YouTube rows were ended streams shown as live; 21 active image rows had a frame between 10
  days and 11 months old; three returned an HTML page with status 200.
- **Reading the log.** The last lines are `Done. N/M cams healthy.`, the disabled / recovered /
  TLS / off-season counts, and `Dead by rule: …` with one count per rule above plus the number
  of rows whose YouTube liveness was unknown. A run with a few hundred "liveness unknown" means
  YouTube is turning the job away, not that the cams are fine.
- YouTube rows are paced about one a second, so a run takes several minutes longer than before.

### Reading an Open-Meteo failure in the sync logs

Since 2026-11-21 `forecast-sync` and `model-sync` print one line per failed Open-Meteo request (`lib/open-meteo-failure.ts`):

```
2026-11-21T07:12:30.000Z Open-Meteo FAIL Alta summit class=429 status=429 limit=minutely retry-after=60 x-ratelimit-remaining=0 reason="Minutely API request limit exceeded. Please try again in one minute."
```

`class` is one of `429`, `5xx`, `timeout` (the client's own abort), `network` (no response) or `other`; a 429 also carries `limit=minutely|hourly|daily|unstated`, read from Open-Meteo's reason text. The run's last line adds `Open-Meteo failures by class: …` (the 429s split by limit), `Run started …, ended …, took …` and, for `forecast-sync`, `Retention: N old runs pruned` or why it did not prune. Nothing is retried; the lines are for telling an allowance refusal from an outage.

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
launchctl kickstart -k gui/$(id -u)/com.peakcam.agents
tail -f ~/peakcam/peakcam/agents/loop.log
```

Common causes: Slack auth token expired (rotate in bot's App config), Supabase connection error (check `https://status.supabase.com`), OOM (check Console for kill signal).

### 2. SNOTEL sync failing

**Symptom:** `snow_reports` not updating; Top Conditions row and alert thresholds stale.

**Recover:**
```bash
cd ~/peakcam/peakcam
npx tsx scripts/snotel-sync.ts 2>&1 | tee /tmp/snotel.log     # or: launchctl kickstart -k gui/$(id -u)/com.peakcam.snotel-sync
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
| Launchd jobs | `launchctl list \| grep com.peakcam` (table above) |
| Model sync (mini) | `~/peakcam/peakcam/scripts/model-sync.log` |
| Station layer (mini) | `~/peakcam/peakcam/scripts/stations-sync.log`; `select max(observed_at) from station_observations` |
| Forecast runs and scores (mini) | `~/peakcam/peakcam/scripts/forecast-sync.log`, `forecast-score.log`; `select max(issued_at) from forecast_runs` |
| Operator status (mini) | `~/peakcam/peakcam/scripts/operator-sync.log` (`OK` / `FAIL <class>` per resort, failure classes counted on the `Done.` line) |
| Still capture + archive (mini) | `~/peakcam/peakcam/scripts/cam-capture-stills.log`; `select count(*), max(captured_at) from cam_stills` |
| Timelapse renders (mini) | `~/peakcam/peakcam/scripts/cam-timelapse.log`; `select "window", count(*), max(rendered_at) from cam_timelapses group by 1` |
| Cam health check (mini) | `~/peakcam/peakcam/scripts/cam-health-check.log` |
| Public API health | `curl -s https://www.peakcam.io/api/v1/status \| jq '{status, issues}'` |
| IndexNow receipts | Bing Webmaster Tools → IndexNow; `grep indexnow ~/peakcam/peakcam/scripts/snotel-sync.log \| tail` |
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
| `auth_signup_started` | before `supabase.auth.signUp()`; Google button clicked on the Sign up tab | `email_domain`; `method: "google"` (absent = email) |
| `auth_signup_submitted` | after `signUp` returns (email confirmation still pending); Google: provider confirmed enabled, browser about to leave for Google | `email_domain`; `method: "google"`, `session_issued: false` |
| `auth_signup_completed` | on `/auth/callback` landing with `?welcome=signup` when `email_confirmed_at` is fresh (Google adds `&welcome_method=google`), or immediately when signUp returns a session | `confirmation: "email" \| "none" \| "oauth"`, `method: "google"` for Google |
| `auth_callback_failed` | `/auth?error=auth_failed` (email links) or `/auth?error=oauth_failed` (Google) | `reason` (`missing_code`, `missing_code_verifier`, `exchange_failed`, `verify_failed`; for Google the Supabase `error_code`, e.g. `access_denied`, `provider_disabled`, `email_exists`, `flow_state_expired`); `method: "google"` on the OAuth path |
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

## Google sign-in (Supabase provider + Google Cloud)

Parity plan P11 (2026-10-20). The code ships dark: `components/auth/AuthForm.tsx` renders "Continue with Google" on `/auth` and in `AuthModal`, probes `GET {SUPABASE_URL}/auth/v1/settings` and shows "Google sign-in is not enabled yet" while `external.google` is `false`. Nothing below needs a deploy; switching the provider on in Supabase turns the button live. Facebook/Meta login is deliberately not configured (see `docs/research/ai-assistant-first/2026-10-20-social-login-research.md`).

The round trip: button → `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: "<origin>/auth/callback?next=…", queryParams: { prompt: "select_account" } } })` (`lib/auth-oauth.ts`) → `https://owsxnogvufankayfwczl.supabase.co/auth/v1/authorize` → Google consent → `https://owsxnogvufankayfwczl.supabase.co/auth/v1/callback` → `/auth/callback?code=…&next=…` (PKCE exchange, same path as the email links) → `next`. A failure comes back as `/auth/callback?error=…&error_code=…` and lands on `/auth?error=oauth_failed&reason=<error_code>` with copy from `lib/auth-errors.ts`.

Do these in order; steps 1–3 are in Google Cloud, 4–6 in Supabase.

1. **Google Cloud → APIs & Services → OAuth consent screen** (any project; a new "PeakCam" project keeps it tidy). User type **External**. App name `PeakCam`; user support email: the owner's address; app logo: leave empty (a logo triggers Google's brand verification review, which is not needed for the `openid`, `email`, `profile` scopes); application home page `https://www.peakcam.io`; privacy policy `https://www.peakcam.io/about#privacy`; terms `https://www.peakcam.io/about#terms`; authorized domain `peakcam.io`; developer contact email. Scopes: add `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` only (all non-sensitive, no verification). Publishing status: **In production** (while it stays "Testing", only listed test users can sign in and tokens expire after 7 days).
2. **Credentials → Create credentials → OAuth client ID**, type **Web application**, name `PeakCam web (Supabase)`. Authorized JavaScript origins: `https://www.peakcam.io` (add `http://localhost:3000` for local dev). Authorized redirect URIs: `https://owsxnogvufankayfwczl.supabase.co/auth/v1/callback` — this one, not the site's `/auth/callback`; Supabase is the OAuth client, PeakCam only receives the finished session. Copy the client ID and client secret; the secret is shown once.
3. (Optional, later) Supabase **custom auth domain** (`auth.peakcam.io`, paid add-on under Project Settings → Custom Domains): the consent screen then says "to continue to auth.peakcam.io" instead of the `owsxnogvufankayfwczl.supabase.co` project ref. If adopted, add `https://auth.peakcam.io/auth/v1/callback` as a second authorized redirect URI in step 2 and keep the old one until the switch is verified. Not required to ship.
4. **Supabase → Authentication → Providers → Google**: toggle **Enabled**, paste the client ID and client secret, leave "Skip nonce check" off, Save. (Authorized Client IDs is for ID-token sign-in / One Tap and can stay empty.)
5. **Supabase → Authentication → URL Configuration**: Site URL `https://www.peakcam.io`; redirect allowlist must contain `https://www.peakcam.io/auth/callback` (already there for the email flows — verify) and, for local dev, `http://localhost:3000/auth/callback`; Vercel previews need `https://*-jaredschueler07s-projects.vercel.app/auth/callback` (wildcard entries are allowed) or the button on a preview will land on production's Site URL after Google. Without a matching entry Supabase ignores `redirectTo` and sends the session to the Site URL, so `next` is lost but sign-in still completes.
6. **Supabase → Authentication → Sign In / Providers → "Allow new users to sign up"** stays on, otherwise a first-time Google user gets `signup_disabled`. Identity linking: Supabase links a Google identity to an existing email account with the same address automatically because Google reports the address verified; no setting to change. Manual linking (`linkIdentity`) stays off.

Verify in production, in this order: (a) `curl -s -H "apikey: <anon key>" https://owsxnogvufankayfwczl.supabase.co/auth/v1/settings | jq .external.google` prints `true`; (b) on `/auth`, Sign in tab, "Continue with Google" opens Google's account chooser showing "PeakCam" and the privacy link, and lands back signed in on `/`; (c) `/auth?next=/favorites` lands on `/favorites`; (d) the modal (heart a resort while signed out) does the same and returns to that resort page; (e) a brand-new Google address lands with `?welcome=signup&welcome_method=google` for a moment (PostHog `auth_signup_completed` with `method=google`, `confirmation=oauth`); (f) an existing email+password address signs in to the *same* user (check `auth.users` → one row, `identities` has both `email` and `google`); (g) `/account` shows the Google display name, avatar and "Signed in with Google"; (h) cancelling at the chooser lands on `/auth?error=oauth_failed&reason=access_denied` with the "cancelled" copy; (i) repeat (b) in Safari (ITP: the PKCE verifier cookie is first-party on `www.peakcam.io`, so it survives the Google hop). Rollback: toggle the provider off in step 4; the button then shows the "not enabled yet" message again and the email flows are unaffected.

Local dev: `.env.local` already has the project URL and anon key; after steps 4–5 (with the localhost allowlist entry) `npm run dev` → `http://localhost:3000/auth` works end to end. The OAuth client's JavaScript origin is only checked for the One Tap / ID-token flows, so `http://localhost:3000` in step 2 is a convenience, not a requirement, for the redirect flow.

Later, not in P11: Google One Tap on resort pages via `signInWithIdToken` with a nonce (needs the client ID in Supabase's "Authorized Client IDs" and the `https://accounts.google.com/gsi/client` script in CSP `script-src` + `frame-src`).

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
launchctl kickstart -k gui/$(id -u)/com.peakcam.agents

# Tail every launchd-managed log on the mini
tail -f ~/peakcam/peakcam/agents/loop.log ~/peakcam/peakcam/scripts/{snotel-sync,model-sync,stations-sync,forecast-sync,forecast-score,operator-sync,cam-capture-stills,cam-timelapse,cam-health-check}.log
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
| `GET /api/v1/resorts/{slug}/conditions` | P6 conditions contract v2: versioned envelope (`schemaVersion` 1.0.0, `schemaUrl` → `/.well-known/schemas/resort-conditions-v1.json`), `data` with every field as `{value, source, observedAt, confidence, freshness: {tier, ageHours}}`, derived `status` (OPEN / CLOSED_TODAY / PRE_SEASON / OFF_SEASON / UNKNOWN, never defaulting to open), `recommendableToday` + `reasons`, `depthDisagreement`, `measuredNow`, a quotable `sentence`; `lib/public-api/conditions.ts` over `lib/conditions-contract.ts` | 900 s |
| `GET /api/v1/resorts/{slug}/forecast?point=summit\|base` | Blended 14-day forecast (median across models, 25th/75th band, `modelCount` per day, summary) + every model run in provider units; `credits` and `X-Attribution` carry the Open-Meteo CC BY 4.0 line (P4) | 900 s |
| `GET /api/v1/resorts/{slug}/forecast-accuracy` | Per-model 90-day verification: day-1/3/7 MAE (cm), bias ratio, samples, rank, `truthBasis`, `measuredDays` (P4) | 900 s |
| `GET /api/v1/powder?window=24h\|48h&state=&minInches=&source=&limit=` | Ranked new snow; `source=snotel` = measured only | ISR 900 s per URL |
| `GET /api/v1/openapi.json` | OpenAPI 3.1, generated from the zod registry in `lib/public-api/schema.ts` | static, 1 h / 24 h CDN |
| `GET /.well-known/api-catalog` | RFC 9727 linkset pointing at the OpenAPI document | static, 1 h / 24 h CDN |
| `GET /api/v1/resorts/search-index` | Slug, name, aliases (`lib/ask/aliases.ts`), state, country, lat/lon, page URL per resort (P9) | 1 h / 24 h CDN |
| `GET /api/v1/status` | Report freshness (≤ 12 h) and cam health (≥ 90 % live) with thresholds; 200 `degraded`, 503 only when the read throws (P9) | 5 min CDN |
| `GET\|POST /api/v1/ask` | Deterministic answer endpoint (`lib/ask/*`): `?q=` or `{"query"}`; `AskAnswer` with `answerable`, `sentence`, `data`, `citations`; 400 only for a missing/oversized question (P9) | 900 s; `no-store` when unanswerable |
| `GET\|POST /ask` | NLWeb-shaped wrapper over the same router (`query_id`, `results[]`, `peakcam`); excluded from `proxy.ts` like `/api/v1` (P9) | same |
| `POST /api/v1/batch` | ≤ 10 GET paths (`{"requests":[{"path"}]}` or a string array) dispatched in-process to the route handlers, results in order; 400 names a disallowed path (P9) | `no-store` |
| `GET /api/v1/resorts/{slug}/history`, `/season-stats`, `/monthly` | P5: season curve vs the station's normal band + ten past seasons; season-to-date on two baselines with last year; monthly climatology (`lib/public-api/history.ts`, reads `snowpack_daily` paged + the migration-030 normals, 15-min Data Cache per resort) | 900 s |
| `GET /api/v1/leaderboards/{kind}?state=&source=&limit=` | P5: `best-powder-this-week`, `season-powder-days`, `deepest-base`, `season-snowfall` over `season_stats(powder_in, …)` (migration 030); `unavailable: true` until it is applied | 900 s |
| `GET /.well-known/schemas` + `/{file}.json` | Standalone JSON Schemas (draft 2020-12) per registered shape, `lib/public-api/json-schemas.ts` | static, 1 h / 24 h CDN |
| `GET /llms-full.txt` | Long agent guide: every REST route with curl, the answer endpoint's intents and example questions (`lib/public-api/llms-full.ts`) | static, 1 h / 24 h CDN |
| `GET /gpt-instructions.md` | Custom GPT instructions (`lib/public-api/gpt-instructions.ts`) | static, 1 h / 24 h CDN |

All routes answer `OPTIONS` with 204. (The MCP server that served the same data at
`/api/mcp` was retired on 2026-11-21; the route answers 410, see the last section.) Unknown slugs 404 with `Cache-Control:
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

**Versioning and deprecation policy** (P9, 2026-10-20; the text is `deprecationPolicyText()` in
`lib/public-api/openapi.ts`, printed in `info.description`, carried as `info.x-deprecation-policy`
and repeated in `llms-full.txt`). The base path carries the major version (`/api/v1`); inside it
PeakCam only adds fields, enum values and operations. Removing or renaming anything is announced
at least **12 months** ahead: the affected operation starts answering with `Deprecation:
@<unix-seconds>` (RFC 9745, the announcement date) and `Sunset: <HTTP-date>` (RFC 8594, the
earliest removal date, ≥ 12 months after the announcement) plus `Link: <changelog>; rel="sunset"`;
its OpenAPI summary gains "Deprecated:" with the replacement; the same notice goes
in `llms-full.txt`. Current operations carry neither header (the shared header set documents
both as optional for that reason). A new major version is published at its own base path
(`/api/v2`) and the previous one keeps answering for the full notice period after the new one is
announced. (The policy covers `/api/v1`. The sentence that extended it to MCP tool names left
with the MCP server on 2026-11-21, which the owner retired without that notice period.) How to
execute a deprecation: add the two headers in `lib/public-api/headers.ts` behind a per-route
option, set the summary, write the changelog entry the `Link` points at, and record the sunset
date here.

Code: `lib/public-api/{schema,serialize,headers,openapi,data}.ts`, routes under
`app/api/v1/` and `app/.well-known/api-catalog/`. `proxy.ts` excludes
`api/v1/` and `api/mcp` (now the 410 route) from the Supabase session refresh. Station names and
elevations come from `lib/public-api/stations.json`, trimmed from
`data/snotel_stations.json` to the triplets the catalogue references;
regenerate it when a resort gets a new station.

**Rate limit — enforced since 2026-10-18** by a Vercel WAF custom rule added in
the dashboard (`Public API rate limit`: Request Path starts with `/api/v1/` or
`/api/mcp`, 60 requests per 60 s per IP, exceed action Deny; the `/api/mcp` clause is left over
from the retired MCP server and the public texts name `/api/v1` only). The firewall API
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
# P9 block 1
curl -s 'https://www.peakcam.io/api/v1/ask?q=is+alta+open' | jq '{answerable, intent, tool, sentence, citations}'
curl -s https://www.peakcam.io/api/v1/ask -H 'content-type: application/json' -d '{"query":"where did it snow most in Colorado, measured only"}' | jq '{intent, arguments, sentence}'
curl -s 'https://www.peakcam.io/ask?query=compare+vail+and+keystone' | jq '{query_id, n: (.results|length), first: .results[0].description}'
curl -s https://www.peakcam.io/api/v1/batch -H 'content-type: application/json' -d '{"requests":[{"path":"/api/v1/resorts/alta"},{"path":"/api/v1/resorts/vail/cams"},{"path":"/api/v1/powder?state=UT&limit=3"},{"path":"/api/v1/nope"}]}' | jq '{status: .status, error}'   # 400 disallowed_path
curl -s https://www.peakcam.io/api/v1/batch -H 'content-type: application/json' -d '{"requests":[{"path":"/api/v1/resorts/alta"},{"path":"/api/v1/status"}]}' | jq '.results[] | {path, status}'
curl -s https://www.peakcam.io/api/v1/resorts/search-index | jq '{count, breck: (.resorts[] | select(.slug=="breckenridge") | .aliases)}'
curl -s https://www.peakcam.io/api/v1/status | jq '{status, age: .checks.snowReports.ageHours, live: .checks.cams.liveRatio, issues}'
curl -s https://www.peakcam.io/.well-known/schemas | jq '.count'
curl -s https://www.peakcam.io/.well-known/schemas/resort.json | jq '."$id"'
curl -s https://www.peakcam.io/llms-full.txt | grep -c '^### '          # 21 tools + 20 REST routes = 41 (P7: get_score, score-components, snow-report)
curl -s https://www.peakcam.io/api/v1/openapi.json | jq '.info["x-deprecation-policy"], (.info.description | test("12 months"))'
# P4 forecast (available:false with empty arrays until com.peakcam.forecast-sync has run on the mini)
curl -sI https://www.peakcam.io/api/v1/resorts/alta/forecast | grep -i '^x-attribution'   # ends "Weather data by Open-Meteo.com (CC BY 4.0)"
curl -s https://www.peakcam.io/api/v1/resorts/alta/forecast | jq '{available, point, points, models: .summary.modelCount, next7: .summary.total7dIn, peak: .summary.peak, days: (.daily|length), byModel: [.byModel[] | {model, horizonDays, issuedAt}]}'
curl -s 'https://www.peakcam.io/api/v1/resorts/alta/forecast?point=base' | jq '{point, note, first: .daily[0]}'
curl -s https://www.peakcam.io/api/v1/resorts/alta/forecast-accuracy | jq '{truthBasis, measuredDays, scoredPoint, best: .bestModel, computedAt, models: [.models[] | {model, rank, day1Mae, day3Mae, day7Mae, biasRatio, samples}]}'
curl -s https://www.peakcam.io/api/v1/resorts/alta | jq '{forecast, scores: (.forecastScores|length)}'
curl -s https://www.peakcam.io/api/v1/batch -H 'content-type: application/json' -d '{"requests":[{"path":"/api/v1/resorts/alta/forecast"},{"path":"/api/v1/resorts/alta/forecast-accuracy"}]}' | jq '.results[] | {path, status}'
curl -s 'https://www.peakcam.io/api/v1/ask?q=forecast+for+alta' | jq '{tool, sentence}'
curl -s https://www.peakcam.io/resorts/alta | grep -o '14-day snow outlook[^<]*' | head -1   # the strip renders once a run is stored
curl -sI https://www.peakcam.io/gpt-instructions.md | grep -i '^content-type'
# P6 conditions contract
curl -s https://www.peakcam.io/api/v1/resorts/alta/conditions | jq '{status: .data.status, lifts: [.data.liftsOpen.value, .data.liftsTotal.value], base: .data.baseDepthIn, verdict: .data.recommendableToday, reasons: .data.reasons, tiers: .meta.freshness, sentence}'
curl -s https://www.peakcam.io/api/v1/resorts/ski-portillo/conditions | jq '{status: .data.status.value, tz: .meta.timeZone, day: .meta.localDate, sources: .meta.sources}'   # OFF_SEASON after the closing date, America/Santiago
curl -s https://www.peakcam.io/.well-known/schemas/resort-conditions-v1.json | jq '."$id", .title'
curl -s 'https://www.peakcam.io/api/v1/ask?q=is+alta+open+today' | jq '{tool, sentence, status: .data.data.status.value}'
curl -s https://www.peakcam.io/resorts/alta/index.md | sed -n '/## Status and freshness/,/## What the instruments say/p' | head -20
curl -s https://www.peakcam.io/resorts/alta | grep -o 'data-testid="resort-status" data-status="[A-Z_]*"'
```

Unmatched `/ask` questions land in `agent_memory` (`entity = 'ask:unmatched'`, `source_agent`
`ask-api` or `ask-mcp`, `source_thread` = salted day-scoped IP hash or null, `expires_at` 30
days). Review with
`select fact, source_agent, created_at from agent_memory where entity = 'ask:unmatched' order by created_at desc limit 50;`
and turn recurring misses into alias or intent rules in `lib/ask/aliases.ts` / `lib/ask/router.ts`.

## Parity data model (migrations 025–028)

Added 2026-10-18 (branch `feat/p0-schema`, parity plan block P0 in
`docs/research/ai-assistant-first/2026-10-18-parity-plan.md`). The tables
exist in prod and are empty; each is filled by a later block's job on the
Mac Mini (launchd, service role, like `snotel-sync`). Nothing in the app
writes any of them. RLS on every new table: public `select`, no insert /
update / delete policy, so only the service role writes. The zod shapes for
all of it are already on the v1 contract (`lib/public-api/schema.ts`):
`Resort.profile` is served now (nulls until filled); `stations`,
`measuredNow`, `forecast`, `forecastScores`, `score` and `Cam.timelapses`
are optional until their block lands.

| Table / columns | Migration | Written by | Read by |
| --- | --- | --- | --- |
| `resorts.runs_total, lifts_total, skiable_acres, vertical_ft, annual_snowfall_in, longest_run_mi, description, description_source, trail_map_url, wikidata_id, aliases[], passes[], elevation_base_ft, elevation_summit_ft` | 025 | `scripts/import-resorts-standalone.mjs` (optional CSV columns), later the P2 enrichment job | `/api/v1` `profile` + `location`, resort pages (P2) |
| `cams.kind, credit, source_terms_url` | 025 | importer (optional `cams.csv` columns), `scripts/approach-cams-sync.ts` (kind=approach), P8 cam audit | `/api/v1` cams |
| `cam_timelapses` (`"window"` is quoted in SQL: reserved word) + `poster_url`, `starts_at`, `ends_at`, `bytes` and view `cam_timelapse_current` (031) | 025, 031 | `scripts/cam-timelapse.ts` (`com.peakcam.cam-timelapse`, every 6 h; bucket `cam-timelapses`) | webcams subpage strip + overview tile, `/resorts/{slug}/timelapses`, `Cam.timelapses` on `/cams`, markdown alternates |
| `stations`, `resort_stations` | 026 | `scripts/stations-sync.ts` (hourly, `com.peakcam.stations-sync`) | `Resort.stations`, resort page "What the instruments say" |
| `station_observations` (PK `(station_id, observed_at)` is the read index) | 026 | `scripts/stations-sync.ts` via `lib/stations/` (SNOTEL, GHCN, NWS, BC ASWS, ECCC) | `Resort.measuredNow` |
| `forecast_runs`, `forecast_daily` | 027 | `scripts/forecast-sync.ts` (`com.peakcam.forecast-sync`, every 6 h; live since P4, 2026-10-20) | `Resort.forecast` summary, `/resorts/{slug}/forecast`, `get_forecast`, the resort page strip |
| `forecast_scores` | 027 | `scripts/forecast-score.ts` (`com.peakcam.forecast-score`, daily 07:30; rewrites per resort/model/window, `blend` row included) | `Resort.forecastScores`, `/resorts/{slug}/forecast-accuracy`, `compare_models` |
| `resort_scores` | 028 | `scripts/score-sync.ts` (`com.peakcam.score-sync`, 07:45 and 19:45; P7, 2026-10-20), `scored_by = 'algorithmic'`, `components` jsonb keyed by `lib/score.ts SCORE_COMPONENT_IDS` | `Resort.score` (and `ScoreLight` on list / powder / compare rows), `/resorts/{slug}/score-components`, `/snow-report?sort=score`, the resort page `#snow-score` card, the homepage strip, the markdown alternate |
| `operator_status` + view `latest_operator_status` | 032 (P6, 2026-10-20) | `scripts/operator-sync.ts` (`com.peakcam.operator-sync`, every 30 minutes 07:05 to 16:35 Central) via `lib/operators/liftie-local.ts` and `scripts/liftie-worker/`; one row per fetch, idempotent on `(resort_id, source, observed_at)`; public read, no write policies | `/api/v1/resorts/{slug}/conditions` (`data.liftsOpen` …), the resort page status chip, `get_resort_conditions`, the markdown "Status and freshness" section |

Elevations: `resorts.elevation_base_ft/summit_ft` are the canonical home from
025 on (backfilled from `resort_metadata` for 145 resorts); `getResortElevationIndex()`
still reads `resort_metadata` until P2 switches the read path, and the
serializer falls back to the resort row when the metadata row is absent.
`season_stats` (the plan's view over `snowpack_daily` + `resort_scores`) is
not created yet: its powder-day threshold is an editorial call (plan §4).

Apply / re-apply: the four files are idempotent; `apply_migration` via the
Supabase MCP or paste into the SQL Editor. Verify with
`select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`
(34 after 028).

## Season history (P5, migration 030)

Branch `feat/p5-history`, parity plan block P5. The history page
(`/resorts/{slug}/history`, markdown at `/history/index.md`), the three per-resort routes,
the four leaderboards under `/snow-report/` and the internal history tools (`lib/mcp/tools-history.ts`) all read
`snowpack_daily` (one QC'd row per resort per day, now with `new_snow_in`) and the station
normals. Two run-once jobs fill them; nothing is scheduled.

| Job | What | When | Runtime / volume |
| --- | --- | --- | --- |
| `npm run snotel-backfill` | Ten water years of daily SNOTEL values per station from AWDB → `snowpack_daily` (upsert on `(resort_id, date)`, 500-row batches), QC'd day by day like the sync, daily new snow derived | Once, after migration 030; re-run is safe | 72 AWDB calls (~12 s, ~760 KB each) + ~650 PostgREST requests for 89 resorts × ~3,650 rows; ~20 min |
| `npm run seed-normals` | 1991–2020 SWE/depth percentiles (unchanged) + 30- and 10-winter cumulative new-snow normal on `snotel_normals` + `snotel_monthly_normals` | Once, then every October after the water year closes | 72 AWDB calls (35 years of SNWD+WTEQ, ~1 MB each) + 3 requests per station; ~3 min |
| `com.peakcam.snotel-sync` (existing) | Now also writes `snowpack_daily.new_snow_in` on today's row | every 6 h | unchanged |

On the Mini (`ssh mini`, user `maestro_admin`; npm is not on the non-login PATH, so wrap in
`zsh -l -c`):

```bash
ssh mini 'zsh -l -c "cd /Users/maestro_admin/peakcam/peakcam && git pull && npm ci"'
# 1. apply supabase/migrations/030_history_normals.sql by hand (SQL Editor / MCP apply_migration), then:
ssh mini 'zsh -l -c "cd /Users/maestro_admin/peakcam/peakcam && npm run snotel-backfill -- --dry-run --resort breckenridge"'   # one AWDB read, no writes
ssh mini 'zsh -l -c "cd /Users/maestro_admin/peakcam/peakcam && npm run snotel-backfill 2>&1 | tee scripts/snotel-backfill.log"'
ssh mini 'zsh -l -c "cd /Users/maestro_admin/peakcam/peakcam && npm run seed-normals 2>&1 | tee scripts/seed-normals.log"'
```

Verify in prod (SQL Editor / MCP `execute_sql`):

```sql
select count(*), min(date), max(date), count(new_snow_in) as with_new_snow from snowpack_daily;   -- ≈ 330k rows back to 2016-10-01
select count(*) filter (where cum_snow_mean_in is not null) as band_days, count(distinct station_id) from snotel_normals;   -- 72 stations × 273 band days
select count(*), count(distinct station_id) from snotel_monthly_normals;   -- 72 × 24
select resort_id, season_total_in, powder_days, week_total_in from season_stats(8) order by season_total_in desc limit 5;
```

Then on the site:

```bash
curl -s https://www.peakcam.io/api/v1/resorts/breckenridge/history | jq '{season: .season.label, asOf, points: (.curve.points|length), band: (.curve.band|length), normalYears: .curve.normalYears, past: [.pastSeasons[] | {s: .season.label, totalIn, powderDays, enso: .enso.label}]}'   # 10 past seasons, band 273, normalYears ≥ 25
curl -s https://www.peakcam.io/api/v1/resorts/breckenridge/season-stats | jq '{sentence, seasonToDateIn, powderDays, pct: .percentOfNormal, lastYear}'
curl -s https://www.peakcam.io/api/v1/resorts/alta/monthly | jq '{available, months: [.months[] | {label, avg: .thirtyYear.avgSnowfallIn, recent: .recentDecade.avgSnowfallIn, pct: .recentVsThirtyPct}]}'
curl -s 'https://www.peakcam.io/api/v1/leaderboards/season-snowfall?limit=5' | jq '{sentence, unavailable, rows: [.results[] | {rank, name, value, source}]}'
curl -sI https://www.peakcam.io/resorts/breckenridge/history | grep -i '^link'                # rel="alternate" → /resorts/breckenridge/history/index.md
curl -s https://www.peakcam.io/resorts/breckenridge/history/index.md | head -12
curl -s https://www.peakcam.io/snow-report/season-powder-days | grep -o 'data-testid="leaderboard-freshness"[^<]*<[^>]*>[^<]*' | head -1
```

Before the backfill runs the pages still render: the curve shows the rows the sync has
written since 2026-03-21, past seasons are empty, the band is absent, and the two season
boards say "unavailable" until migration 030 exists. Normals: a station with fewer than 25
qualifying winters is logged by the seed (`NOTE fewer than 25 qualifying winters`); the band
still renders with whatever it has and `curve.normalYears` says how many.

## Snow Score (P7, migration 028)

Added 2026-10-20 (branch `feat/p7-score`, parity plan block P7). The table has existed in
prod since P0; the job fills it. `lib/score.ts` is the formula (documented at
`/methodology#score`), `scripts/score-sync.ts` the job, `lib/public-api/score.ts` the
documents. The read path (`getLatestScoresIndex()`) treats the newest row at most 3 days old as
"today", so a missed run shows yesterday's score dated as such, never nothing; everything fails
soft to `available: false` / `score: null` while the table is empty.

| Job | What it does | Schedule | Notes |
| --- | --- | --- | --- |
| `com.peakcam.score-sync` (`npm run score-sync`) | Per resort: the newest `snow_reports` row of the day (publishable % of normal, 24/48 h, tags), `snowpack_daily` back 14 days (7-day new-snow sum, days since a ≥ 1 in day, 3-day high), the summit (else base) forecast runs issued that day blended with `lib/forecast/blend.ts` (7-day total, model count, first-day high for model resorts), `deriveStatus` over `resort_openings` + `latest_operator_status` (today only; past days rest on the dates) → `computeScore` → upsert `resort_scores` | 07:45 and 19:45 local | ~4 PostgREST reads per resort, 150 ms apart, ≈ 2 min for 148 resorts. `--dry-run` reads with the anon key and writes nothing; `--resort slug`; `--backfill N` scores the N days ending today (one set of reads per resort, N rows). Exit 1 only when every resort failed. |

Deploy on the mini (user `maestro_admin`, checkout `/Users/maestro_admin/peakcam/peakcam`),
after the merge has reached `main` and `git pull` there:

```bash
ssh mini 'zsh -l -c "cd /Users/maestro_admin/peakcam/peakcam && git pull --ff-only && npm ci --no-audit --no-fund 2>&1 | tail -1"'
ssh mini 'zsh -l -c "cd /Users/maestro_admin/peakcam/peakcam && npx tsx scripts/score-sync.ts --dry-run --resort alta | tail -3"'      # "OK Alta Ski Area — <date> score N (rating): depth …"
ssh mini 'zsh -l -c "cd /Users/maestro_admin/peakcam/peakcam && npx tsx scripts/score-sync.ts --backfill 30 | tail -5"'                # first real rows: 148 resorts × 30 days, so the sparkline is not empty on day one (≈ 3–4 min)
ssh mini 'cd /Users/maestro_admin/peakcam/peakcam && cp com.peakcam.score-sync.plist ~/Library/LaunchAgents/ && launchctl bootout gui/$(id -u)/com.peakcam.score-sync 2>/dev/null; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.peakcam.score-sync.plist && launchctl list | grep com.peakcam.score-sync'
ssh mini 'tail -3 /Users/maestro_admin/peakcam/peakcam/scripts/score-sync.log'   # RunAtLoad wrote today's row again; ends "[score-sync] Done. 148 scored (148 rows), 0 failed (of 148)."
```

Verify in production (the catalogue cache is 15 min, so allow that after the first write):

```bash
curl -s https://www.peakcam.io/api/v1/resorts/alta/score-components | jq '{available, score: .today.score, rating: .today.rating, date: .today.date, scoredBy: .today.scoredBy, tagline: .today.tagline, parts: [.today.components | to_entries[] | {k: .key, pts: .value.points, max: .value.max, src: .value.source}], history: (.history | length)}'
curl -s 'https://www.peakcam.io/api/v1/snow-report?sort=score' | jq '{sentence, scoredAsOf, top: [.resorts[:5][] | {slug, score: .score.score, rating: .score.rating}]}'
curl -s 'https://www.peakcam.io/api/v1/resorts?sort=score' | jq '.resorts[:3] | map({slug, score})'
curl -s https://www.peakcam.io/api/v1/resorts/alta | jq '.score | {date, score, rating, scoredBy}'
curl -s https://www.peakcam.io/api/v1/powder?limit=3 | jq '.results[] | {slug, score}'
curl -s https://www.peakcam.io/.well-known/schemas/score-components.json | jq '."$id", .title'
curl -s https://www.peakcam.io/api/v1/batch -H 'content-type: application/json' -d '{"requests":[{"path":"/api/v1/resorts/alta/score-components"},{"path":"/api/v1/snow-report?sort=score&state=UT"}]}' | jq '.results[] | {path, status}'
curl -s https://www.peakcam.io/resorts/alta | grep -o 'data-testid="score-card" data-score="[0-9a-z]*" data-rating="[a-z]*"'
curl -s https://www.peakcam.io/resorts/alta/index.md | grep '^Snow Score:'
curl -s https://www.peakcam.io/ | grep -o 'data-testid="featured-score-sentence"'
```

Re-scoring after a formula change: bump `SCORE_VERSION` in `lib/score.ts`, merge, then
`npx tsx scripts/score-sync.ts --backfill 30` on the mini rewrites the window (the upsert
replaces each `(resort_id, date)` row). Rows older than the window keep the old formula; the
API's `version` says which formula is live, not which one scored an old row.

## Operator status (P6, migration 032)

**How the status reads a day (2026-11-20, `lib/operator-day.ts`).** The site does not judge a resort by the newest reading alone. Over the resort's own calendar day: a reading with a lift open makes it "operated" (OPEN and the hub "Open" chip stay after the last chair, quoting the day's latest open count with its time); else lifts scheduled in the newest reading show "Opens today" until 16:00 local; else a reading between 10:00 and 15:00 local with nothing open or scheduled is CLOSED_TODAY when the season is on; a 0/0 reading outside those hours decides nothing and the opening dates do. Between local midnight and the day's first reading the previous day's last open count is carried, dated as yesterday's. The read behind it (`fetchRecentOperatorReadings`, last 30 h, paged) works without an index; `supabase/migrations/033_operator_status_observed_idx.sql` adds one on `observed_at` and should be applied by hand, as a single statement, when the table has grown (about 1,900 rows a day). **First chair (2026-11-21).** A reading taken before 08:00 resort time (`FIRST_CHAIR_HOUR`) that says lifts are open is read as the day's plan, not as lifts turning: Arapahoe Basin, Copper, Loveland and Winter Park mark planned lifts open from 06:05. Such a day is `scheduled` ("Opens today", "N lifts set to run today") until a reading at or after 08:00 shows a lift open, and an early flag is never carried overnight. `data.liftsOpen` still carries the feed's raw number.

Branch `feat/p6-conditions`, parity plan block P6. The conditions contract
(`lib/conditions-contract.ts`, served by `/api/v1/resorts/{slug}/conditions`, inside
`get_resort_conditions`, on the resort page as the status chip and freshness labels, and in
the markdown alternates as "Status and freshness") joins the snow report, the opening row,
the station layer, the stored forecast blend and the newest operator report. Only the last
of those is new: `operator_status` (one row per fetch) and `latest_operator_status`.

| Job | What | When | Notes |
| --- | --- | --- | --- |
| `com.peakcam.operator-sync` (`npm run operator-sync`) | For each of the 93 resorts mapped in `data/operator-sources.json`, read the operator's own lift-status page or feed and parse it with Liftie's open-source parser → lifts open / hold / scheduled / closed, the operator page URL, an opening date still ahead | 06:00 and 11:00 local | `--dry-run` needs no service key; `--resort alta`, `--state CO`, `--only vail,keystone`. Exit 1 only when every resort fails. 93 page reads, 500 ms apart, about 2 minutes |

**How it reads lift status (since 2026-11-20).** liftie.info's API has answered every
script with a Cloudflare challenge since 2026-10-20, so `operator_status` never received a
row from it. Liftie's parsers are open source (github.com/pirxpilot/liftie, BSD-3-Clause),
so the sync now runs them itself:

- `scripts/liftie-worker/vendor/liftie/` holds the parser files, copied unmodified from the
  npm package at the version, commit and tarball hash in `VERSION.json` (4.4.2 today).
  Only the parse helpers, the shared parser families and the resort definitions that
  `data/operator-sources.json` maps are copied; Liftie's server and build tooling are not.
  `scripts/liftie-worker/NOTICE.md` carries the licence notice.
- `scripts/liftie-worker/worker.mjs` fetches and parses. `scripts/operator-sync.ts` starts
  it as a child process whose environment holds no secrets (`workerEnv` in
  `lib/operators/liftie-local.ts`), because some parsers evaluate a script block from the
  operator's page with `node:vm`. Only the parent holds the Supabase keys and writes rows.
- The worker needs five small parsing libraries of its own:
  `npm ci --prefix scripts/liftie-worker` (20 packages, about 3 MB, no install scripts). The
  web app's `package.json` is untouched.
- One request at a time, 500 ms apart, with a User-Agent that names PeakCam
  (`OPERATOR_SYNC_USER_AGENT` overrides it). Each operator's `robots.txt` is read once per
  host per day (cache in the system temp dir) and honoured for the path fetched.

Failure classes on the `FAIL` lines and the `Done.` line:

| Class | Meaning | What to do |
| --- | --- | --- |
| `parse_empty` | The page loaded but the parser found no lifts. Normal before a resort's season: the Vail Resorts pages list no lifts until then | Nothing pre-season. In season, the operator changed the page: check upstream for a newer Liftie and re-vendor |
| `blocked` | 401/403/429, a bot challenge or a waiting room | Leave it. Do not work around a challenge |
| `robots` | The operator's `robots.txt` disallows the path | Leave it; the resort has no lift status from this source |
| `network` | No answer from the host, after one retry (DNS, TLS, timeout) | Usually the operator's side; recheck next run |
| `http` | Any other non-2xx, typically a 404 after a site redesign | Check upstream for a newer Liftie and re-vendor |
| `invalid` | The feed was not what the parser reads (for example not JSON) | As `http` |
| `no_parser` | The mapped id has no vendored definition | `node scripts/liftie-worker/vendor.mjs` after editing the mapping |

First full dry run (Studio, 2026-11-20 about 09:30 Mountain): 67 of 93 resorts returned
lift status, including all 17 mapped Colorado resorts; 16 `parse_empty`, 4 `network`,
2 `http`, 2 `blocked` (Gore, Whiteface), 1 `invalid`, 1 `robots` (Mountain High).

Re-vendor when parsers break (`node scripts/liftie-worker/vendor.mjs <exact version>`, then
the two test files named in `NOTICE.md` and a Colorado dry run). Liftie publishes lifts
only, so trails, base depth and surface stay null; `verified` stays false because the
status is parsed from a page, not taken from an operator API under an agreement. Each
operator's website terms have not been reviewed; do that before raising the frequency.
`npm run operator-sync -- --liftie-api` still takes the old liftie.info path.

Seven Colorado resorts have no Liftie parser: Granby Ranch, Powderhorn, Purgatory,
Silverton, Ski Cooper, Sunlight and Wolf Creek.

Deploy on the Mini (`ssh mini`, user `maestro_admin`; `zsh -l -c` because npm is not on the
non-login PATH):

```bash
# 1. apply supabase/migrations/032_operator_status.sql by hand (SQL Editor / MCP apply_migration; not during a Vercel build), then:
ssh mini 'zsh -l -c "cd /Users/maestro_admin/peakcam/peakcam && git pull && npm ci --prefix scripts/liftie-worker --no-audit --no-fund"'   # the worker's own 3 MB of libraries; the root install is unchanged
ssh mini 'zsh -l -c "cd /Users/maestro_admin/peakcam/peakcam && npx tsx scripts/operator-sync.ts --dry-run --state CO | tail -22"'   # "OK <resort> — N open … of M" per resort
ssh mini 'cd /Users/maestro_admin/peakcam/peakcam && cp com.peakcam.operator-sync.plist ~/Library/LaunchAgents/ && launchctl bootout gui/$(id -u)/com.peakcam.operator-sync 2>/dev/null; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.peakcam.operator-sync.plist && launchctl list | grep com.peakcam.operator-sync'
ssh mini 'launchctl kickstart -k gui/$(id -u)/com.peakcam.operator-sync && sleep 60 && tail -5 /Users/maestro_admin/peakcam/peakcam/scripts/operator-sync.log'
```

Verify in the database: `select source, count(*), max(observed_at) from operator_status group by 1;`
`select count(*) from latest_operator_status where lifts_total is not null;`. Then on the
site (allow the 15-minute cache): the P6 lines under "Public API" above. Without rows the
contract still validates for every resort; `/api/v1/resorts/alta/conditions` shows
`data.liftsOpen.source = "none"` and the status from the opening row.

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
checkout's `.env.local`, re-verified present on 2026-10-20 with `grep -c '^INDEXNOW_ENABLED=1' .env.local`
over ssh; the first manual run submitted 89 URLs, HTTP 202). `scripts/snotel-sync.ts`
collects the resorts (slug and state) that got a new `snow_reports` row and, only when
`INDEXNOW_ENABLED=1`, POSTs to `https://api.indexnow.org/indexnow` in batches of at most 10,000
(`scripts/indexnow-ping.ts`; payload and batching are unit-tested, no network in tests).
Since P10 (2026-10-20) each changed resort submits its whole page family (overview, snow report,
forecast, webcams, history), the state's `/ski-cams/{hub}` and `/snow-report/{hub}` pages, and
the aggregate pages whose ranking moves with any report (`/`, `/snow-report`,
`/snow-report/percent-of-normal`, the four leaderboards), de-duplicated: 89 changed resorts ≈ 500
URLs a run. Markdown alternates are `noindex` and never submitted. The key file is live at
`https://www.peakcam.io/<key>.txt`. A failed ping is logged and never fails the sync. If the
mini's `.env.local` is ever rebuilt, the flag must be added again (user item; nothing else gates it).

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
3. One-off submissions: `npx tsx scripts/indexnow-ping.ts breckenridge:CO vail:CO` (the
   `:STATE` suffix lets the script add the hub pages; without it only the page family and
   the aggregates go). Bing Webmaster Tools > IndexNow shows what was received.

`scripts/model-sync.ts` (Open-Meteo resorts) does not ping yet; add the same
three lines there when the SNOTEL path has run clean for a week.

## MCP server and /connect: retired 2026-11-21

The public MCP server (`io.peakcam/snow` at `/api/mcp`), the `/connect` setup page, the two
server-card routes, the registry manifest `server.json` and the unpublished npm stdio bridge
`packages/peakcam-mcp/` were removed on 2026-11-21 by the owner's decision. `docs/mcp.md` is the
short record. What is left in the repo:

| Surface | Where | Behaviour |
| --- | --- | --- |
| `GET`/`POST`/`DELETE /api/mcp` | `app/api/mcp/route.ts` (test: `tests/mcp-retired.test.ts`) | 410 with `{error: "gone", message, openapi, docs}`, CORS `*`, `Cache-Control: public, max-age=3600`; `OPTIONS` 204 |
| `/connect` | `next.config.ts` `redirects()` | permanent redirect to `/` |
| `/.well-known/mcp/server-card.json`, `/api/mcp/server-card` | removed | 404 |
| `lib/mcp/` | internal tool layer | Behind `/ask`, `/api/v1/ask` and the markdown renderers; tests in `lib/mcp/tools.test.ts`. Not a public surface |

The agent surface that stays is the REST API (`/api/v1`, OpenAPI, `/.well-known/api-catalog`,
the JSON Schemas), the answer endpoint (`/ask`, `/api/v1/ask`), `llms.txt`, `llms-full.txt`,
`/gpt-instructions.md` and the markdown alternates. None of them mentions MCP;
`lib/public-api/agent-surface.test.ts` fails if one does.

Verify after the deploy:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://www.peakcam.io/api/mcp                       # 410
curl -s https://www.peakcam.io/api/mcp | jq '{error, openapi, docs}'
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.peakcam.io/connect        # 308 https://www.peakcam.io/
curl -s -o /dev/null -w '%{http_code}\n' https://www.peakcam.io/.well-known/mcp/server-card.json   # 404
curl -s https://www.peakcam.io/llms.txt https://www.peakcam.io/llms-full.txt | grep -ci 'mcp'  # 0
curl -s https://www.peakcam.io/api/v1/openapi.json | jq '.info | has("x-mcp-endpoint")'        # false
curl -s https://www.peakcam.io/sitemaps/pages.xml | grep -c '/connect<'                        # 0
```

**Left for the owner** (each needs an account or a dashboard only the owner holds):

1. **MCP Registry**: the entry `io.peakcam/snow` (published 2026-10-18, remote only) still
   points at `/api/mcp` and has to be withdrawn. The namespace login is the DNS method: the
   Ed25519 key is on the Mac Studio at `~/.config/peakcam-mcp-registry-key.pem` and the apex TXT
   record `v=MCPv1; k=ed25519; p=…` is in Vercel DNS (`rec_82e1d6ea8c9f5198f4beef15`). The TXT
   record and the key can go once the entry is withdrawn.
2. **Claude Connectors Directory**: the listing submitted on 2026-10-18 names
   `https://www.peakcam.io/api/mcp`; withdraw it at <https://claude.ai/directory/manage>. Any
   custom connector that was added by URL (the owner's own claude.ai account has one) starts
   failing with the 410 and should be removed.
3. **Vercel WAF rule** `Public API rate limit`: the `/api/mcp` path clause now only covers the
   410 route and can be dropped; the public texts already say the limit applies to `/api/v1`.
4. **npm**: nothing to do. `peakcam-mcp` was never published.
