# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PeakCam is a live mountain webcam and snow report aggregator, in production at https://www.peakcam.io (Vercel, auto-deploy on push to main). Stack: Next.js 16 (App Router), React 19, Supabase (Postgres + Auth), Tailwind CSS 4, MapLibre GL (react-map-gl), Resend, PostHog. ~127 resorts and ~299 cams seeded from `data/*.csv`.

## Commands

```bash
npm run dev              # Dev server (localhost:3000)
npm run build            # Production build
npm run lint             # ESLint (flat config, next/core-web-vitals + TS)
npx tsc --noEmit         # Type check
npm test                 # node:test via tsx — lib/**, scripts/** (.ts + .mjs), tests/**/*.test.ts
npm run test:auth-e2e    # Playwright auth suite (playwright.auth.config.ts) — needs a dev server
npm run test:mobile-e2e  # Playwright mobile suite (playwright.mobile.config.ts)

# Data & ops scripts (all load .env.local themselves, write via service-role key)
npm run import-resorts:standalone  # Seed resorts/cams from data/*.csv (the maintained importer). A newly-imported resort has no live page until the next deploy — /resorts/[slug] uses dynamicParams=false, so its static params list is fixed at build time.
npm run snotel-sync      # SNOTEL sync — the production data feed (launchd runs it every 6h)
npm run pipeline-sync    # Multi-source pipeline (currently dormant in prod — see Gotchas)
npm run seed-normals     # 30-year SNOTEL normals (run-once/annual)
npm run cam-health       # Probe all cam URLs, stamp cams.last_checked_at
```

Beware: `npm test` runs `scripts/bake-resort.test.ts` and `scripts/dem/gdal.test.ts`, which shell out to `gdal_translate` — without GDAL on PATH those two files fail. Liftie and SNODAS have no npm scripts; their logic lives in `lib/pipeline/fetchers/` and only `pipeline-sync` drives it. `npm run import-resorts` (the ts-node variant) no longer exists — `:standalone` is the maintained importer.

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

7 route handlers in `app/api/`, each with a different auth model: alerts subscribe/manage/unsubscribe (capability `manage_token`, service-role writes, deny-all RLS), `alerts/trigger` (Bearer `CRON_SECRET`; Vercel cron daily 13:00 UTC per `vercel.json`), `conditions/vote` (anonymous, localStorage session UUID), `user-conditions/submit` (auth session + RLS + profanity flag), `cam-reports/submit` (anonymous, validated by `lib/cam-reports/validate.ts`, salted IP hash, Resend admin email).

### Data ingestion — two pipelines, one live

1. **`scripts/snotel-sync.ts` — the production feed** (launchd `com.peakcam.snotel-sync`, every 6h). NRCS AWDB API → QC via `lib/snow-quality.ts` (range/spike checks, carry-forward) → `snowpack_daily` → full conditions engine (normals, 7-day SWE history, user reports, NWS grid) → appends `snow_reports` (source='snotel') + patches `resorts.cond_rating`. This is the only thing feeding the live site.
2. **`lib/pipeline/` — multi-source blender** (SNOTEL + NWS + Liftie + SNODAS + Weather Unlocked + user reports → `data_source_readings` + `resort_conditions_summary`). Code-complete but dormant: its launchd job has never succeeded (plist missing PATH), the blender has stubbed inputs (pct_of_normal=null, NWS grid fields never populated, elevation hardcoded), and no UI code reads its output tables. Both pipelines write `snow_reports` and overwrite `resorts.cond_rating` — last writer wins.

### Conditions engine

`lib/conditions-engine.ts` — pure functions: rating thresholds (`RATING_THRESHOLDS`), 7-day trend, outlook ladder, tag/narrative synthesis, and a 70/30 SNOTEL/user-report blend (needs ≥2 unflagged reports, clamped ±1 tier). `lib/snow-quality.ts` holds QC + water-year math. Keep these pure — scripts and (nominally) the pipeline both import them.

### Database

18 tables + 2 views, migrations `supabase/migrations/001–011`. Migrations are applied **by hand** (SQL Editor / MCP `apply_migration`) — there is no Supabase CLI config, numbering is documentation only, and 004/005 each have two files. RLS postures: public-read (catalog/snow tables), anon-insert (`condition_votes`, `agent_memory`), auth.uid()-scoped (`user_conditions`, `user_favorites`, `dashboard_layouts`), deny-all/service-role-only (alerts tables, `cam_reports`).

Known live-DB drift from the repo migrations (verify against prod before trusting a migration file):
- `user_conditions.snow_quality`: 004 still checks `icy/slush`, but prod was widened to `powder/packed/crud/ice/spring` (the vocabulary the code submits) by hand around 2026-09-02. **Recorded, after the fact, as `018_user_conditions_snow_quality_vocab.sql`** — do not re-apply 004's check.
- `user_conditions.submitted_at`: 004 defines the column; the live table never got it, so `getUserConditions`, the submit rate limiter and the snotel-sync user blend all degrade silently. **`020_user_conditions_submitted_at.sql` is written but not yet applied.**
- `latest_snow_reports` view was created as `SELECT *` in 001; columns added to `snow_reports` by 005/007 required manual view recreation in prod, which 013 finally recorded. **`019_latest_snow_reports_index_and_view.sql` (pending apply)** adds the composite `(resort_id, updated_at desc)` index and rewrites the view as a per-resort `LATERAL … limit 1` with `security_invoker = true`; its `DISTINCT ON` predecessor was the cause of the Sept 2026 statement-timeout wave. Any migration that adds a column to `snow_reports` must still drop and recreate this view.
- `021_function_hardening.sql` (pending apply) revokes anon/authenticated EXECUTE on `rls_auto_enable()` and pins `drop_in_immutable_morning()`'s `search_path`.
- `cams` has no unique constraint: re-running the importer duplicates cam rows (`ignore-duplicates` is a no-op).

`snow_reports.conditions` is an overloaded string: `"tag1,tag2||narrative"`. Consumers must split on `||` (done in ConditionsStrip, ComparePage, map-utils). Don't add new consumers without unpacking it.

### Design system

Retro ski-poster theme (cream paper / ink / forest / alpenglow; Fraunces display, DM Sans body, JetBrains Mono readouts; hard "stamp" shadows) defined in `tailwind.config.ts` + `app/globals.css` (`--pc-*` tokens, `.pc-paper`/`.pc-topo` utilities). Light theme only. `tailwind.config.ts` contains a **legacy alias layer** remapping old dark-theme token names (`bg`, `surface*`, `text-*`, even `cyan` → forest green) so un-migrated components still render. Still on legacy tokens: ResortDetailPage internals, SnowReportPage, FavoritesPage, AlertManagePage, ConditionVoter, UserConditionsForm, MapBottomSheet, weather icons (which hardcode dark-theme hex). Use the new `pc-*`/poster tokens for all new work; migrating a legacy component means replacing old class names, not extending the alias layer.

### Drop In (`/resorts/[slug]/drop-in`)

An arcade ski descent for three pilot resorts (`ski-portillo`, `breckenridge`, `heavenly`). **Parked in production since 2026-09-17** behind `NEXT_PUBLIC_DROP_IN_ENABLED`: `isDropInEnabled()` in `lib/drop-in.ts` reads it at call time and, when unset, `isDropInResort()`/`getDropInProfile()`/`getDropInRoster()` return empty, every entry point (nav, resort detail, map popup, mobile bottom sheet, `/drop-in` hub, the game page, the sitemap) disappears, and the API routes answer `dropInDisabledResponse()` (404). The code stays in the tree so the v3 engine branch keeps merging cleanly; flip the env var in Vercel to bring it all back at once.

The game itself is bundled TypeScript under `lib/game/` (`core`, `physics`, `rendering`, `terrain`, `runtime`, `server`, …), mounted by `components/drop-in/DropInGame.tsx`, which dynamically imports `@/lib/game/runtime/createGame` on the client. There is no `public/drop-in/engine.html`, no vendored `three.module.js`, and no `DropInFrame` iframe — all three were deleted in 499d787; the pre-parking iframe engine lives on `origin/archive/drop-in-2026-09-17` if you need the old behaviour. Resort profiles now have a single source (`DROP_IN_GAME_PROFILES` in `lib/game/config/profiles.ts`, re-exported by `lib/drop-in.ts`), so the old hand-sync rule is gone. The `drop-in/` exclusion still in `proxy.ts:45` is a leftover of the static-asset era and no longer matches anything the game serves.

### Adjacent subsystems (same repo, not part of the web app)

- `agents/` — 9-bot Slack "company" (`agents/loop.mjs`, polling + Anthropic API, shared memory in `agent_memory`). Runs via launchd but is effectively dormant.
- `dashboard/` — standalone Express ops dashboard on port 3333. **Unauthenticated and can spawn `claude --dangerously-skip-permissions`** — never expose beyond localhost/LAN.
- `generate-images.py` (repo root) — the only brand-image generator (xAI Grok), driven by the user-level `peakcam-imagegen` skill. Its abandoned `scripts/generate-images.mjs` predecessor and the two npm scripts that ran it were deleted. Nothing in `public/images/` is referenced by app code.

### Scheduling map

- Vercel cron: `/api/alerts/trigger` daily 13:00 UTC (`vercel.json`).
- Mac Mini launchd (`~/Library/LaunchAgents/com.peakcam.*`): snotel-sync every 6h, cam-health-check daily 06:00, pipeline daily 06:00 (failing), agents (KeepAlive). Plists are the scheduling ground truth — `docs/runbook.md`'s job table is stale.

## Environment Variables

`.env.local.example` documents only ~9 of the ~24 vars the code reads. Beyond the example (Supabase ×3, MapTiler, site URL, Resend, CRON_SECRET, cam-report admin/salt), code also reads: `ANTHROPIC_API_KEY`, `SLACK_BOT_TOKEN_*` (9, agents), `NEXT_PUBLIC_POSTHOG_KEY/HOST`, `NEXT_PUBLIC_META_PIXEL_ID`, `WEATHER_UNLOCKED_APP_ID/API_KEY`, `XAI_API_KEY`, `PEAKCAM_POLL_INTERVAL/LOG_LEVEL/CLAUDE_MODEL`. Secrets live in `.env.local` (local), Vercel project env (prod), and launchd jobs source `.env.local`.

## Key Patterns & Gotchas

- Path alias `@/*` maps to the repo root (`tsconfig.json`).
- MapLibre (`components/map/MapView.tsx`) must be loaded with `dynamic(..., { ssr: false })`.
- `snow_reports` is append-only; the latest row per resort comes from the `latest_snow_reports` view.
- Powder threshold (8") and the "128 resorts" copy are hardcoded in multiple places — grep before changing either.
- NWS forecast snow amounts are keyword heuristics (`lib/weather.ts`), not QPF.
- Two auth UX flows coexist: `/auth` page (email+password) and `AuthModal` (magic link). Both land on `/auth/callback`.
- Docs trust: `GEMINI.md` is an accurate high-level overview; `docs/runbook.md` has stale schedules; `UX-AUDIT-PLAN*.md` are executed historical artifacts.
