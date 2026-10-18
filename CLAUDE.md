# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PeakCam is a live mountain webcam and snow report aggregator, in production at https://www.peakcam.io (Vercel, auto-deploy on push to main). Stack: Next.js 16 (App Router), React 19, Supabase (Postgres + Auth), Tailwind CSS 4, MapLibre GL (react-map-gl), Resend, PostHog. ~148 resorts and ~350 cam rows seeded from `data/*.csv`.

## Commands

```bash
npm run dev              # Dev server (localhost:3000)
npm run build            # Production build
npm run lint             # ESLint (flat config, next/core-web-vitals + TS)
npx tsc --noEmit         # Type check
npm test                 # node:test via tsx — lib/*.test.ts + scripts/*.test.ts
npm run drop-in:sync-three   # Re-vendor public/drop-in/three.module.js after bumping `three`

# Data & ops scripts (all load .env.local themselves, write via service-role key)
npm run import-resorts:standalone  # Seed resorts/cams from data/*.csv (the maintained importer). A newly-imported resort has no live page until the next deploy — /resorts/[slug] uses dynamicParams=false, so its static params list is fixed at build time.
npm run snotel-sync      # SNOTEL sync — the production data feed for NRCS-station resorts (launchd runs it every 6h)
npm run model-sync       # Open-Meteo sync for resorts without a SNOTEL station (South America etc.; launchd every 6h)
npm run pipeline-sync    # Multi-source pipeline (currently dormant in prod — see Gotchas)
npm run seed-normals     # 30-year SNOTEL normals (run-once/annual)
npm run cam-health       # Probe all cam URLs, stamp cams.last_checked_at
```

There are no `liftie-sync` / `snodas-sync` npm scripts — that logic lives in `lib/pipeline/fetchers/` and runs only via `pipeline-sync`. `npm run import-resorts` (the ts-node variant) is stale and truncates SNOTEL triplet IDs — use `:standalone`.

## Architecture

### Read path (the site)

Every data-bearing page is a thin Server Component with ISR (`export const revalidate = 3600`) that fetches via `lib/supabase.ts` (anon-key client) and passes the full dataset as props to one large `"use client"` component that owns all interactivity. There is no client-side fetching of resort/snow data. `getAllResorts()` runs 3 queries (active resorts, `latest_snow_reports` view, active cams) and stitches them into `ResortWithData[]` in JS.

- `/` → `BrowsePage` (Fuse.js search, filter chips, sort incl. curated `POPULAR_SLUGS`, optional map sidebar)
- `/resorts/[slug]` → SSG via `generateStaticParams` + live NWS forecast (`lib/weather.ts`) + crowd reports; dynamic OG image
- `/map` → MapLibre full-page map with clustered GeoJSON (`lib/map-utils.ts`) + RainViewer radar
- `/compare`, `/snow-report`, `/favorites`, `/dashboard` (client-only, react-grid-layout), `/auth`, `/alerts/manage`

Cam embeds are click-to-play by `embed_type`: `youtube` (autoplay+mute embed), `iframe`, `image` (30s cache-buster auto-refresh), `link` (link-out). Cam tiles carry `CamReportButton` → `/api/cam-reports/submit`.

### Three Supabase clients — pick the right one

- `lib/supabase.ts` — module-level anon client + all public read queries. Throws at import if env vars missing (affects builds).
- `lib/supabase-browser.ts` — `@supabase/ssr` browser client for Client Components needing auth (favorites, dashboard, auth UI).
- `lib/supabase-server.ts` — cookie-bound server client for Route Handlers / Server Components needing the user session (RLS as the user).

`proxy.ts` (Next 16 middleware successor) refreshes the Supabase session on every non-static request.

### Write path (API routes)

Route handlers under `app/api/` (28 `route.ts` files as of 2026-10-18), each with its own auth model: alerts subscribe/manage/unsubscribe (capability `manage_token`, service-role writes, deny-all RLS; `manage` also adds/tests/removes webhook destinations), `alerts/trigger` (Bearer `CRON_SECRET`; Vercel cron daily 13:00 UTC per `vercel.json`; writes a `powder_alert_runs` row, fans out Standard-Webhooks deliveries, `maxDuration` 60), `conditions/vote` (anonymous, localStorage session UUID), `user-conditions/submit` (auth session + RLS + profanity flag), `cam-reports/submit` (anonymous, validated by `lib/cam-reports/validate.ts`, salted IP hash, Resend admin email), `csp-report` (CSP violation sink, 1-in-20 sampled to PostHog), `v1/*` (public read-only JSON API, no auth; `v1/batch` and `v1/ask` also take POST but write nothing), `mcp` (read-only MCP server, no auth).

### Agent surface (public, read-only, no auth)

- `/api/v1/resorts`, `/api/v1/resorts/{slug}`, `/api/v1/resorts/{slug}/cams`, `/api/v1/powder`, `/api/v1/resorts/search-index` (slug/name/aliases/lat-lon, 24 h cache), `/api/v1/status` (report freshness + cam health, 200 `degraded`), `POST /api/v1/batch` (≤ 10 GET paths dispatched in-process to the route handlers), `/api/v1/openapi.json`, `/.well-known/api-catalog`, `/.well-known/schemas/{file}.json` (standalone JSON Schemas from the same zod registry): every value carries `{value, unit, source, measuredAt, station?}` provenance; serializer in `lib/public-api/` (`serialize.ts`, `schema.ts` zod 4, `headers.ts`, `data.ts`, plus `status.ts`, `search-index.ts`, `batch.ts`, `json-schemas.ts`). Header set: CORS `*`, `X-Attribution`, `Link rel=author/license`, `Cache-Control s-maxage=900`. Exporting `OPTIONS` makes a route non-static, so caching is `Cache-Control` + `unstable_cache`, not `revalidate`.
- Answer endpoint: `GET|POST /api/v1/ask` (`q`/`query`) and the NLWeb-shaped `GET|POST /ask` (`app/ask/route.ts`, excluded from `proxy.ts`) run `lib/ask/router.ts` (pure: resort by name/slug/nickname from `lib/ask/aliases.ts` with one typo of slack, intent by keyword rules) and `lib/ask/answer.ts` (one MCP tool call + a `lib/quotable.ts` sentence + citations). No LLM; `answerable: false` with suggestions instead of a guess; unmatched questions go to `agent_memory` (`entity = ask:unmatched`, salted day-scoped IP hash, 30-day TTL) via `lib/mcp/data.ts`. Router tests: `lib/ask/router.test.ts`.
- `/api/mcp`: MCP server `io.peakcam/snow` on `mcp-handler@2` (MCP SDK v2 packages, stateless Streamable HTTP, route is `app/api/mcp/route.ts`, no `[transport]` segment). Fourteen tools in `lib/mcp/tools.ts` (pure builders over an injected `McpDataSource`; `lib/mcp/data.ts` is the production source; names in `lib/mcp/tool-names.ts`, shared catalogue helpers in `lib/mcp/catalog.ts`, one example per tool in `lib/mcp/examples.ts`): the original eight plus `get_resort_profile`, `get_percent_of_normal`, `list_regions`, `get_alert_options` (explains recipes, never writes), `get_cam_timeline` (`cam_still_timeline` view, links only) and `ask`. Resource `peakcam://resorts/{slug}`. Verify with `npx @modelcontextprotocol/inspector --cli https://www.peakcam.io/api/mcp --method tools/list`. Docs: `docs/mcp.md`, user-facing `/connect` (tool table, prompts and server card derive from the name tuple), server card at `/.well-known/mcp/server-card.json` (alias `/api/mcp/server-card`), registry manifest `server.json` (published to the MCP Registry 2026-10-18; signing key and re-publish steps in `docs/runbook.md`).
- Markdown alternates `/resorts/{slug}/index.md` and `/index.md` (`lib/public-api/markdown-page.ts`, noindex, canonical Link); the compact `lib/public-api/markdown.ts` renders MCP tool text. `Link` discovery headers on `/` and `/resorts/:slug` come from `next.config.ts`.
- `robots.txt` is a route handler (`lib/robots.ts`) with a `Content-Signal` line; `llms.txt` has a "For agents" block (tool list from `PEAKCAM_TOOL_NAMES`); `llms-full.txt` (`lib/public-api/llms-full.ts`) is the long guide built from the tool definitions and examples; `gpt-instructions.md` is the Custom GPT instructions block. IndexNow ping (`scripts/indexnow-ping.ts`) runs at the end of `snotel-sync` only when `INDEXNOW_ENABLED=1`.
- Feeds: `/resorts/{slug}/powder.xml` (Atom), `/alerts/feed/{manage_token}` (Atom, `?format=ics`). Webhook contract and agent recipes: `docs/alerts-verification.md`.
- Freshness copy: `lib/quotable.ts` builds the dated, source-labelled sentences on `/`, resort pages and `/snow-report/percent-of-normal`; `lib/stations.ts` names the SNOTEL station. Timestamps are the report's `updated_at` in Mountain time, never render time.

### Data ingestion — two pipelines, one live

1. **`scripts/snotel-sync.ts` — the production feed** (launchd `com.peakcam.snotel-sync`, every 6h). NRCS AWDB API → QC via `lib/snow-quality.ts` (range/spike checks, carry-forward) → `snowpack_daily` → full conditions engine (normals, 7-day SWE history, user reports, NWS grid) → appends `snow_reports` (source='snotel') + patches `resorts.cond_rating`. `scripts/model-sync.ts` mirrors it for the ~59 resorts with no SNOTEL station, using the Open-Meteo model (source='open_meteo'). Together these two scripts are the only things feeding the live site.
2. **`lib/pipeline/` — multi-source blender** (SNOTEL + NWS + Liftie + SNODAS + Weather Unlocked + user reports → `data_source_readings` + `resort_conditions_summary`). Code-complete but dormant: its launchd job has never succeeded (plist missing PATH), the blender has stubbed inputs (pct_of_normal=null, NWS grid fields never populated, elevation hardcoded), and no UI code reads its output tables. Both pipelines write `snow_reports` and overwrite `resorts.cond_rating` — last writer wins.

### Conditions engine

`lib/conditions-engine.ts` — pure functions: rating thresholds (`RATING_THRESHOLDS`), 7-day trend, outlook ladder, tag/narrative synthesis, and a 70/30 SNOTEL/user-report blend (needs ≥2 unflagged reports, clamped ±1 tier). `lib/snow-quality.ts` holds QC + water-year math. Keep these pure — scripts and (nominally) the pipeline both import them.

### Database

34 tables + 4 views in `public` as of 2026-10-18 (migrations through `028`; 2026-10-18 added `powder_alert_runs`, `alert_destinations` in 023, `cams.archive_allowed` + `cam_stills` + view `cam_still_timeline` in 024, and the parity data model in 025–028: resort profile columns + `elevation_base_ft`/`elevation_summit_ft` on `resorts` (backfilled from `resort_metadata`, which is now the legacy copy), `cams.kind/credit/source_terms_url`, `cam_timelapses`, `stations`, `resort_stations`, `station_observations`, `forecast_runs`, `forecast_daily`, `forecast_scores`, `resort_scores` — all empty until their P3–P8 jobs land; see `docs/runbook.md` "Parity data model"; note that 022's `cam_stills` table was never applied in prod, 024 created it). Migrations are applied **by hand** (SQL Editor / MCP `apply_migration`) — there is no Supabase CLI config, numbering is documentation only, and 004/005 each have two files. RLS postures: public-read (catalog/snow tables), anon-insert (`condition_votes`, `agent_memory`), auth.uid()-scoped (`user_conditions`, `user_favorites`, `dashboard_layouts`), deny-all/service-role-only (alerts tables, `cam_reports`).

Known live-DB drift from the repo migrations (verify against prod before trusting a migration file):
- `user_conditions.snow_quality`: the 004 file still checks `icy/slush`, but prod's CHECK is already `powder/packed/crud/ice/spring` (changed by hand; matches code and UI). Migration 019 records the prod definition idempotently.
- `user_conditions` timestamp column: 004 says `submitted_at`; prod has `created_at`. Code used `submitted_at` for months (PostgREST 400 → "No recent reports", zero user reports in the sync blend, rate limit failing open). Reconciled in code — every consumer now reads `created_at` — and documented by migration 019 (renames only if `submitted_at` still exists; no-op on prod).
- `latest_snow_reports` exposes `resorts.id AS resort_id` (migration 029) so a per-resort filter pushes down to one index probe; keep that when recreating it. It was created as `SELECT *` in 001; columns added to `snow_reports` by 005/007 required manual view recreation in prod — no migration records it.
- `cams` now has unique indexes (`cams_unique_per_resort` on resort_id+name+embed_url+youtube_id, and `cams_resort_embed_url_idx`) applied by hand in prod, so the importer's `ignore-duplicates` works; migrations in the repo contain no CREATE INDEX at all — every prod index exists only in the live DB.
- `latest_snow_reports` is hit ~12k times/day by the anon role, which has a 3s `statement_timeout`; the view must stay index-friendly (see migration 018).

`snow_reports.conditions` is an overloaded string: `"tag1,tag2||narrative"`. Consumers must split on `||` (done in ConditionsStrip, ComparePage, map-utils). Don't add new consumers without unpacking it.

### Design system

Retro ski-poster theme (cream paper / ink / forest / alpenglow; Fraunces display, DM Sans body, JetBrains Mono readouts; hard "stamp" shadows) defined in `tailwind.config.ts` + `app/globals.css` (`--pc-*` tokens, `.pc-paper`/`.pc-topo` utilities). Light theme only. `tailwind.config.ts` contains a **legacy alias layer** remapping old dark-theme token names (`bg`, `surface*`, `text-*`, even `cyan` → forest green) so un-migrated components still render. Still on legacy tokens: ResortDetailPage internals, SnowReportPage, FavoritesPage, AlertManagePage, ConditionVoter, UserConditionsForm, MapBottomSheet, weather icons (which hardcode dark-theme hex). Use the new `pc-*`/poster tokens for all new work; migrating a legacy component means replacing old class names, not extending the alias layer.

### Drop In (`/resorts/[slug]/drop-in`)

A self-contained arcade ski descent, live for three pilot resorts (`ski-portillo`, `breckenridge`, `heavenly`). Entry points: the map popup card, the mobile bottom sheet, and the resort detail page — all gated on `isDropInResort()`.

`public/drop-in/engine.html` is the entire game in one file (markup, CSS, and an inline module) and imports a **vendored** `three.module.js` beside it. It is a bundler-free static asset, so it carries its own copy of every resort profile: **`RESORT_PROFILES` in the engine and `PROFILES` in `lib/drop-in.ts` must stay in sync by hand**, and `scripts/drop-in-engine.test.ts` fails the build if they drift. The host mounts it in an iframe sandboxed *without* `allow-same-origin` (`components/drop-in/DropInFrame.tsx`) — the engine therefore has an opaque origin, cannot touch app cookies, and announces itself over `postMessage` authenticated by `event.source`, not by origin. `proxy.ts` excludes `/drop-in/` so the static assets skip the Supabase session round-trip.

### Adjacent subsystems (same repo, not part of the web app)

- `agents/` — 9-bot Slack "company" (`agents/loop.mjs`, polling + Anthropic API, shared memory in `agent_memory`). Runs via launchd but is effectively dormant.
- `dashboard/` — standalone Express ops dashboard on port 3333. **Unauthenticated and can spawn `claude --dangerously-skip-permissions`** — never expose beyond localhost/LAN.
- `generate-images.py` (repo root) — canonical brand-image generator (xAI Grok), driven by the user-level `peakcam-imagegen` skill (its abandoned predecessor `scripts/generate-images.mjs` was removed Sept 2026). Nothing in `public/images/` is referenced by app code.

### Scheduling map

- Vercel cron: `/api/alerts/trigger` daily 13:00 UTC (`vercel.json`).
- Mac Mini launchd (`~/Library/LaunchAgents/com.peakcam.*`, user `maestro_admin`, ops checkout at `/Users/maestro_admin/peakcam/peakcam`, reachable as `mac-mini-ha-1` over Tailscale): snotel-sync every 6h, model-sync every 6h, cam-stills every 15 min (900 s since the P8 cadence change on 2026-10-18; archives frames for `archive_allowed` cams into `cam_stills`, keeps every frame 48 h, one per 6 h to 30 days, keepers a year; latest-only cams still captured every 6 h), cam-health-check daily, agents (KeepAlive); the pipeline plist is renamed `.disabled`. The Mac Studio runs only `com.peakcam.cam-check` and has no checkout. Logs are `scripts/*.log` and `agents/loop.log` in that checkout. Plists are the scheduling ground truth — `docs/runbook.md`'s job table is stale. The Mini's `.env.local` is the canonical secrets file; the dev checkout must copy it.

## Environment Variables

`.env.local.example` documents the app-facing vars (Supabase ×3, MapTiler, site URL, Resend, CRON_SECRET, cam-report admin/salt, PostHog, and the env-gated conversion tags listed below). Beyond the example, code also reads: `ANTHROPIC_API_KEY`, `SLACK_BOT_TOKEN_*` (9, agents), `NEXT_PUBLIC_POSTHOG_KEY/HOST`, `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_GOOGLE_ADS_ID` + `NEXT_PUBLIC_GOOGLE_ADS_ALERT_LABEL` (Google Ads tag + conversion), `NEXT_PUBLIC_REDDIT_PIXEL_ID`, `WEATHER_UNLOCKED_APP_ID/API_KEY`, `XAI_API_KEY`, `PEAKCAM_POLL_INTERVAL/LOG_LEVEL/CLAUDE_MODEL`. Secrets live in `.env.local` (local), Vercel project env (prod), and launchd jobs source `.env.local`.

## Key Patterns & Gotchas

- Path alias `@/*` maps to the repo root (`tsconfig.json`).
- MapLibre (`components/map/MapView.tsx`) must be loaded with `dynamic(..., { ssr: false })`.
- `snow_reports` is append-only; the latest row per resort comes from the `latest_snow_reports` view.
- Powder threshold (8") is hardcoded in multiple places — grep before changing it. The resort count in UI copy is computed from data; page metadata says "150+".
- NWS forecast snow amounts are keyword heuristics (`lib/weather.ts`), not QPF.
- Two auth UX flows coexist: `/auth` page (email+password) and `AuthModal` (magic link). Both land on `/auth/callback`.
- Docs trust: `GEMINI.md` is an accurate high-level overview; `docs/runbook.md` has stale schedules; `UX-AUDIT-PLAN*.md` are executed historical artifacts.
