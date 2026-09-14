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
npm test                 # node:test via tsx — lib/**/*.test.ts (incl. lib/descent) + scripts/*.test.ts + tests/*.test.ts
npx tsx scripts/descent-playtest.ts --slug breckenridge --scenario carve --out /tmp/pt   # scripted Drop In playtest (needs `npm run dev`)

# Data & ops scripts (all load .env.local themselves, write via service-role key)
npm run import-resorts:standalone  # Seed resorts/cams from data/*.csv (the maintained importer). A newly-imported resort has no live page until the next deploy — /resorts/[slug] uses dynamicParams=false, so its static params list is fixed at build time.
npm run snotel-sync      # SNOTEL sync — the production data feed (launchd runs it every 6h)
npm run pipeline-sync    # Multi-source pipeline (currently dormant in prod — see Gotchas)
npm run seed-normals     # 30-year SNOTEL normals (run-once/annual)
npm run cam-health       # Probe all cam URLs, stamp cams.last_checked_at
```

Beware: `npm run liftie-sync` and `npm run snodas-sync` reference script files that do not exist (the logic lives in `lib/pipeline/fetchers/`). `npm run import-resorts` (the ts-node variant) is stale and truncates SNOTEL triplet IDs — use `:standalone`.

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
- `user_conditions.snow_quality`: migration checks `icy/slush`; code and UI submit `crud/ice/spring`.
- `latest_snow_reports` view was created as `SELECT *` in 001; columns added to `snow_reports` by 005/007 required manual view recreation in prod — no migration records it.
- `cams` has no unique constraint: re-running the importer duplicates cam rows (`ignore-duplicates` is a no-op).

`snow_reports.conditions` is an overloaded string: `"tag1,tag2||narrative"`. Consumers must split on `||` (done in ConditionsStrip, ComparePage, map-utils). Don't add new consumers without unpacking it.

### Design system

Retro ski-poster theme (cream paper / ink / forest / alpenglow; Fraunces display, DM Sans body, JetBrains Mono readouts; hard "stamp" shadows) defined in `tailwind.config.ts` + `app/globals.css` (`--pc-*` tokens, `.pc-paper`/`.pc-topo` utilities). Light theme only. `tailwind.config.ts` contains a **legacy alias layer** remapping old dark-theme token names (`bg`, `surface*`, `text-*`, even `cyan` → forest green) so un-migrated components still render. Still on legacy tokens: ResortDetailPage internals, SnowReportPage, FavoritesPage, AlertManagePage, ConditionVoter, UserConditionsForm, MapBottomSheet, weather icons (which hardcode dark-theme hex). Use the new `pc-*`/poster tokens for all new work; migrating a legacy component means replacing old class names, not extending the alias layer.

### Drop In (`/resorts/[slug]/drop-in`) — the Descent engine (v3)

An arcade ski descent on real lidar terrain, live for three pilot resorts (`ski-portillo`, `breckenridge`, `heavenly`). Entry points: the map popup card, the mobile bottom sheet, the resort detail page and the `/drop-in` hub — all gated on `isDropInResort()`.

The game is `lib/descent/` (engine) + `components/descent/` (React shell), modelled on the feel of a single-file browser ski sim: one 120 Hz fixed-step rider sim, one three.js WebGL scene, one zustand HUD store.

- **Contracts** live in `lib/descent/types.ts` (`World`, `RiderState`, `InputState`, `HudSnapshot`, `DescentRuntime`). `lib/descent/index.ts` exports `createDescent()`; the shell imports it lazily (three.js must stay out of SSR).
- **World** (`world/loadWorld.ts`): reuses the v2 data path — `TerrainAssetLoader`/`FarFieldAssetLoader` + `createTerrainSource` from `lib/game/terrain/*` — then derives courses (every named OSM run, start shifted ≤ 45 m to sustained downhill), rideable lifts, a tree spatial hash and lake outlines. `buildWorld()` is pure so tests build the real mountains from disk (`lib/descent/testing/fixture-world.ts`).
- **Sim** (`sim/rider.ts`, numbers in `sim/tuning.ts`): point mass on the bicubic heightfield with a ski axis; lateral speed bled by edge grip, turn-generated lateral fed back as forward speed (carve conservation, energy-safe), brake = power smear, Space = charge/pop, natural air off lips, spins/flips/grabs with landing tolerances, tree crashes, gates as checkpoints, lifts via `prepareLiftPath`. Stays inside the leaderboard validator's envelope (`rider.test.ts` samples at 30 Hz to prove it).
- **Render** (`render/*`): chunked flat-shaded terrain with skirts and distance LOD (`TerrainMesh`), PCFF horizon (`FarField`), sky/sun/fog from the profile weather presets (`Sky`), instanced conifers + rocks, lifts with moving chairs, canvas-text gate/finish/junction signs, ski-track ribbons, snowfall + spray points, an articulated rider rig posed from `RiderState`, a critically damped chase camera with four presets. `Renderer` adapts a quality rung from frame time.
- **Competition** reuses `lib/game/competition/*` and `lib/game/replay/codec.ts`: ghosts are sampled at 30 Hz with the same `GhostSample` shape, so `/api/drop-in/*` and the server validator are unchanged. `COURSE_GATES` still keys ranked start/finish off the v2 run vertices — keep the ≤ 45 m start shift.
- **Dev/e2e hooks**: in non-production the runtime is on `window.__descent` (`diagnostics`, `setAutopilot(true)`); `scripts/descent-playtest.ts` drives scripted runs in headless Chromium against a running dev server and writes screenshots + a JSON trace; `tests/e2e/descent.spec.ts` is the Playwright smoke run.
- **Brotli over HTTP**: browsers only accept `Content-Encoding: br` on HTTPS, so the loaders fall back to `/api/drop-in/terrain/<file>` (server-side decompression) when the static `.br` fetch fails — the LAN dev URL, for instance.

The v2 engine under `lib/game/{rendering,runtime,physics,core,input,audio}` and `components/drop-in/{DropInGame,hud/*,input/*}` is no longer mounted by the route; `lib/game/terrain`, `config`, `conditions`, `competition`, `replay` and `server` are still live dependencies. `components/drop-in/hud/{SubmitRunCard,LeaderboardPanel}` are reused by the v3 results card.

### Adjacent subsystems (same repo, not part of the web app)

- `agents/` — 9-bot Slack "company" (`agents/loop.mjs`, polling + Anthropic API, shared memory in `agent_memory`). Runs via launchd but is effectively dormant.
- `dashboard/` — standalone Express ops dashboard on port 3333. **Unauthenticated and can spawn `claude --dangerously-skip-permissions`** — never expose beyond localhost/LAN.
- `generate-images.py` (repo root) — canonical brand-image generator (xAI Grok), driven by the user-level `peakcam-imagegen` skill; `scripts/generate-images.mjs` is its abandoned predecessor. Nothing in `public/images/` is referenced by app code.

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
