# AGENTS.md — peakcam

> Folder-scoped agent guide. Generated 2026-09-12 by an automated documentation pass.
> Scope: everything under `peakcam/` and nothing outside it.

## What this is

PeakCam is a live mountain-webcam and snow-report aggregator, in production at
https://www.peakcam.io (Vercel, auto-deploy on push to `main`, ~148 resorts / ~350 cam
rows seeded from `data/*.csv`). It serves resort pages, an interactive map, side-by-side
comparison, a sortable snow report, favorites, powder alerts, and a browser ski game
("Drop In"). Status: **active production**, not a prototype — `docs/roadmap-2026-09-11.md`
records the verified release boundary and current priorities. Three adjacent subsystems live
in the same repo but are *not* the web app: `agents/` (a 9-bot Slack loop, dormant),
`dashboard/` (standalone Express ops dashboard), and `generate-images.py` (brand images).

## Stack & key facts

- **Language(s):** TypeScript strict (`tsconfig.json`), plus `.mjs` / `.py` / `.sh` tooling. No Python app.
- **Framework / runtime:** Next.js 16.1.6 App Router + React 19.2.3 on Node. Tailwind CSS 4 via `@tailwindcss/postcss`; theme in `tailwind.config.ts` + `app/globals.css`.
- **Package manager:** npm — `package-lock.json` is committed and authoritative. `.npmrc` pins `cache=.npm-cache` *inside the repo* (gitignored, never read it).
- **Entry points:** `app/layout.tsx` → `app/page.tsx` (browse directory at `/`); `app/resorts/[slug]/page.tsx` (SSG resort pages); `proxy.ts` (Next 16 middleware successor — refreshes the Supabase session on non-static requests); data jobs are `scripts/*.ts` run through `tsx`.
- **Database / auth:** Supabase Postgres + Auth via `@supabase/ssr`. 21 SQL files in `supabase/migrations/`; **applied by hand** (no Supabase CLI config).
- **External services:** MapTiler + Carto (tiles), RainViewer (radar), NWS + Open-Meteo (forecast), NRCS AWDB/SNOTEL (snow telemetry), Resend (email), PostHog + Vercel Analytics + Meta Pixel (analytics).
- **3D / game:** `three@0.185.1` + `postprocessing`. Drop In defaults to a **WebGPU** backend with WebGL fallback (`lib/game/rendering/backend.ts`; `?gfx=webgl` forces fallback).
- **Maps:** `maplibre-gl@5.21` through `react-map-gl@8.1`.
- **Testing:** `node:test` driven by `tsx` (unit) and Playwright 1.61.1 (`tests/e2e/`).
- **Scheduling:** Vercel cron (`vercel.json` → `/api/alerts/trigger`, daily 13:00 UTC) plus macOS launchd jobs (`com.peakcam.*.plist`) for the data syncs.
- **Disk:** ~1.6 GB. The bulk is `node_modules/`, `.next/`, `.npm-cache/`, `public/game/terrain/`, and three extensionless root PNGs (design references, see Gotchas).

## Layout

| Path | Contents |
| --- | --- |
| `app/` | App Router. Pages: `auth`, `account`, `admin/bug-reports`, `alerts` (+ `manage`), `about`, `compare`, `dashboard`, `drop-in`, `favorites`, `map`, `methodology`, `resorts/[slug]` (+ `/drop-in`), `snow-report`. Also `sitemap.ts`, `robots.ts`, `manifest.ts`, `opengraph-image.tsx`, `llms.txt/route.ts`, `not-found.tsx`. |
| `app/api/` | 16 route handlers — see the API table below. |
| `components/` | 75 files, domain-grouped: `alerts`, `auth`, `browse`, `cam`, `compare`, `dashboard`, `drop-in`, `feedback`, `home`, `layout`, `map`, `resort`, `snow-report`, `ui`, `weather`. |
| `lib/` | Supabase clients (`supabase.ts` anon / `supabase-browser.ts` / `supabase-server.ts`), pure engines (`conditions-engine.ts`, `snow-quality.ts`, `snow-forecast.ts`, `resort-search.ts`), `types.ts`, plus colocated `*.test.ts`. |
| `lib/game/` | 224 files — the Drop In engine: `core/`, `physics/`, `terrain/`, `rendering/`, `runtime/`, `replay/`, `server/`, `competition/`, `config/`, `audio/`, `input/`, `analytics/`. |
| `lib/pipeline/` | Multi-source blender (SNOTEL/NWS/Liftie/SNODAS/Weather Unlocked/user reports). Code-complete but **dormant in prod** — see Gotchas. |
| `scripts/` | Data ingestion, terrain bake, health checks, image generation. Mix of `.ts` (tsx) and `.mjs`; many have colocated tests. |
| `supabase/` | `migrations/` (21 SQL), `seeds/`, `email-templates/`. |
| `data/` | `resorts.csv` (148 rows), `cams.csv` (349), `resort_socials.csv`, `snotel_stations.json` (17 MB), `resort-editorial.ts`. Import source for `import-resorts:standalone`. |
| `tests/` | `e2e/` Playwright specs, `fixtures/` (incl. `drop-in-v1/*.json`), `drop-in-v1-parity.test.ts`. |
| `plugins/`, `agents/` | Nine `.plugin` files (zip archives) and the Slack bot loop + `agents/manifests/*.yaml`. Effectively dormant. |
| `dashboard/` | Separate Express app (port 3333) with its **own** `package.json`; not covered by the root test/lint setup. |
| `docs/` | 144 files: `runbook.md`, `roadmap-2026-09-11.md`, `design-system/`, `terrain/`, `drop-in-v2/`, `reviews/`. |
| `qa-findings/` | 2026-08-10 live-site QA reports. A dated snapshot, not current state. |
| `public/game/` | Committed game assets: `terrain/`, `textures/`, `audio/`, `basis/`. |
| root | `CLAUDE.md` (owner's guide, accurate), `GEMINI.md` (stale on styling), `TASKS.md` + `UX-AUDIT-PLAN*.md` (historical), `README.md` (unmodified create-next-app boilerplate). |

### API routes (`app/api/`)

Sixteen handlers, each with its own auth model — read the handler before changing it.

| Route | Auth model (verified where noted) |
| --- | --- |
| `alerts/subscribe`, `alerts/manage`, `alerts/unsubscribe` | Capability `manage_token`; direct PostgREST writes with the service-role key. |
| `alerts/trigger` | `Authorization: Bearer $CRON_SECRET`, fails closed if unset; Vercel cron daily 13:00 UTC. |
| `conditions/vote` | Anonymous (localStorage session UUID). |
| `user-conditions/submit` | Supabase auth session + RLS + service-role write. |
| `cam-reports/submit` | Anonymous, validated via `lib/cam-reports/validate.ts`, salted IP hash, Resend admin email. |
| `cams/[id]/status` | Not verified in this pass. |
| `bug-reports`, `admin/bug-reports`, `admin/bug-reports/[id]` | Service-role; the admin page redirects to `/auth?next=…` on `ReviewAccessError` 401. |
| `drop-in/sessions`, `drop-in/runs`, `drop-in/leaderboard`, `drop-in/ghosts/[runId]` | Run-ticket flow (`DROP_IN_TICKET_KEYS`, server-only); details not verified in this pass. |
| `drop-in/morning` | `CRON_SECRET`; hourly job that only captures each resort's 07:00 hour. |

Three more route handlers live outside `app/api/`: `app/resorts/route.ts` (308 → `/`),
`app/auth/callback/route.ts` (OAuth/magic-link exchange), `app/llms.txt/route.ts` (ISR
markdown index for LLM crawlers).

## Build / Run / Test

Every command below exists in `package.json` unless flagged. Source of truth: `package.json` `scripts`.

```bash
npm run dev      # next dev (localhost:3000) — needs .env.local first
npm run build    # next build — prerenders ~148 resort pages against live Supabase
npm run start    # next start
npm run lint     # eslint (flat config: next/core-web-vitals + next/typescript)
npm test         # node --import tsx --test lib/*.test.ts 'lib/game/**/*.test.ts' scripts/*.test.ts tests/*.test.ts
npx tsc --noEmit # type check (documented in CLAUDE.md; passes per docs/roadmap-2026-09-11.md)

# Playwright e2e — the config's webServer runs `npm run start`, so build first.
npx playwright test                                   # drop-in suite on :3113
PLAYWRIGHT_WEBGPU=1 npx playwright test --project=chromium-webgpu --headed
npx playwright test -c playwright.auth.config.ts      # auth/account, boots its own fixture server
npx playwright test -c playwright.mobile.config.ts    # mobile-review + mobile-flows

# Data & ops scripts (all read .env.local themselves; writes use the service-role key)
npm run import-resorts:standalone  # seed resorts/cams from data/*.csv (the maintained importer)
npm run snotel-sync                # production SNOTEL feed
npm run cam-health                 # probe cam URLs, stamp cams.last_checked_at
npm run seed-normals               # 30-year SNOTEL normals (run-once/annual)
npm run pipeline-sync              # multi-source pipeline (dormant in prod)
npm run bake-terrain               # tsx scripts/bake-resort.ts
npm run validate-game-assets       # tsx scripts/validate-game-assets.ts
```

**Cannot run locally as-is:**

- There is **no `.env.local`** in this workspace. `lib/supabase.ts` throws at import when env vars are missing, so `dev`, `build` and any Supabase-touching test fail until you copy `.env.local.example` → `.env.local` and fill it in.
- Builds need live Supabase egress; `generateStaticParams` fails closed and the fetch has an 8 s abort (`next.config.ts` sets `staticGenerationRetryCount: 3`).
- **5 of 1410 tests fail here**: GDAL terrain-bake tests shell out to `gdal_translate`, which is not on PATH. `docs/roadmap-2026-09-11.md` reports the same failure class.
- Playwright `webServer` runs `npm run start`, so an e2e run requires a completed `npm run build` first.
- Drop In run submission requires server-only `DROP_IN_TICKET_KEYS` (roadmap P0: currently needs restoring in prod).
- Anything that mutates prod Supabase needs `SUPABASE_SERVICE_ROLE_KEY` — do not run those without explicit instruction.

## Conventions & gotchas

- `CLAUDE.md` is the owner's authoritative guide and is accurate; keep following it. `GEMINI.md` and `README.md` are partly stale (below).
- Path alias `@/*` maps to the repo root (`tsconfig.json`).
- Read path: each data page is a thin Server Component with `export const revalidate = 3600` that fetches via `lib/supabase.ts` and hands the dataset to one large `"use client"` component. There is no client-side fetching of resort/snow data.
- Pick the right Supabase client: `lib/supabase.ts` (anon reads), `lib/supabase-browser.ts` (client components with auth), `lib/supabase-server.ts` (route handlers / RSC with the user session).
- `snow_reports` is append-only; the latest row per resort comes from the `latest_snow_reports` view. `snow_reports.conditions` is an overloaded string, `"tag1,tag2||narrative"` — split on `||`.
- `/resorts/[slug]` sets `dynamicParams = false`, so a newly imported resort has no live page until the next deploy.
- `cams` has no unique constraint: re-running the importer duplicates cam rows.
- Two auth UX flows coexist — `/auth` (email + password) and the magic-link `AuthModal`; both land on `/auth/callback`.
- MapLibre components must be mounted with `dynamic(..., { ssr: false })`.
- Powder threshold (8") and the resort-count copy are hardcoded in several places — grep before changing either.
- `lib/pipeline/` is code-complete but dormant: its launchd job has never succeeded, the blender has stubbed inputs, and no UI reads its output tables. Both it and `scripts/snotel-sync.ts` write `snow_reports` / overwrite `resorts.cond_rating` — last writer wins.
- The three extensionless root files `header-and-cards` (6673×11933), `resort-detail`, `filter-chips-closeup` are PNG design references, not source or text.
- `dashboard/` is unauthenticated and can spawn privileged processes — never expose it beyond localhost/LAN.

### Conflicts with the pre-existing guides (code verified; guides left untouched)

1. **Theme.** `GEMINI.md` describes an "Alpine Bold" dark theme with `bg`/`surface`/`cyan` tokens. The code is a **light** cream/ink/forest "retro ski poster" theme (`tailwind.config.ts`, `--pc-*` tokens in `app/globals.css`), and `tailwind.config.ts:101` explicitly remaps legacy `cyan` → forest "for any stragglers". `CLAUDE.md` is correct; use `pc-*`/poster tokens for new work.
2. **Drop In architecture.** `CLAUDE.md` says the game is `public/drop-in/engine.html`, a bundler-free single file in an iframe sandboxed without `allow-same-origin`, with a vendored `three.module.js`, and that `RESORT_PROFILES` in the engine must stay hand-synced with `PROFILES` in `lib/drop-in.ts`. **None of that exists now**: `public/drop-in/` is gone, and there is no `engine.html` or non-`node_modules` `three.module.js` anywhere. Drop In is a React client app — `components/drop-in/DropInGame.tsx` drives `lib/game/runtime/GameRuntime.ts` on `lib/game/rendering/Renderer`; `lib/drop-in.ts` is a thin facade over `lib/game/config/profiles`. The drift guard is now `tests/drop-in-v1-parity.test.ts` against byte-identical fixtures in `tests/fixtures/drop-in-v1/`. `eslint.config.mjs` still ignores the removed `public/drop-in/three.module.js` — harmless, stale.
3. **Scripts that do not exist.** `CLAUDE.md` cites `npm run drop-in:sync-three` and `npm run import-resorts`; neither is in `package.json`. Separately, `npm run liftie-sync` and `npm run snodas-sync` **do** exist but point at `scripts/liftie-sync.ts` / `scripts/snodas-sync.ts`, which are missing (that logic lives in `lib/pipeline/fetchers/`) — both are broken.
4. **API route count.** `CLAUDE.md` says "7 route handlers in `app/api/`"; there are 16, plus the 3 outside it listed above.
5. **Migration range.** `CLAUDE.md` says `001–011`; there are 21 files through `017`, and **migration 016 is absent from `main`** even though `docs/roadmap-2026-09-11.md` references it for open PR 69.
6. **`public/images/`.** `CLAUDE.md` says nothing there is referenced by app code; `components/cam/CamEmbed.tsx:62` loads `/images/cam-placeholder.jpg`.
7. **Schedules.** `docs/runbook.md` (snotel daily 07:00, cam-health weekly) disagrees with `CLAUDE.md` (snotel every 6 h, cam-health daily 06:00). The launchd plists are ground truth — verify before trusting either.
8. **`qa-findings/` is a snapshot.** Agent 1's `/resorts` 404 is fixed by `app/resorts/route.ts` (308 → `/`), and agent 3's "no `/drop-in` entry point" is fixed by `app/drop-in/page.tsx` (static roster hub). Treat the remaining findings as unverified leads.

## For agents working here

- **Safe to change:** `app/`, `components/`, `lib/` (outside `lib/game/core|physics|terrain|replay`), `scripts/`, `docs/`, tests, and new additive files in `supabase/migrations/`.
- **Mind the lint contract in `lib/game/`:** `eslint.config.mjs` forbids React, the DOM, `three`, network/audio/analytics imports, and browser globals inside `lib/game/{core,physics,terrain,replay}` — the deterministic core must stay pure and portable.
- **Do not touch:** `package-lock.json`, `next-env.d.ts`, `tsconfig.tsbuildinfo`, `CLAUDE.md`/`GEMINI.md` (owner's guides), and the historical records `TASKS.md`, `UX-AUDIT-PLAN*.md`, `qa-findings/`.
- **Generated / vendored (never edit):** `node_modules/`, `.next/`, `.npm-cache/`, `*.tsbuildinfo`, `public/game/terrain/*.br` (baked — regenerate with `npm run bake-terrain`, and note `*.height.u16` raw intermediates are gitignored), `plugins/*.plugin` (zips).
- **Never commit or paste into a prompt/log:** `.env*`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `DROP_IN_TICKET_KEYS`, `CAM_REPORT_SALT`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, Slack bot tokens.
- **Before finishing a change:** `npx tsc --noEmit && npm run lint && npm test`. For Drop In or runtime work, also `npm run build && npx playwright test`. Expect the 5 GDAL terrain-bake failures unless GDAL is installed — that is environmental, not your regression.
