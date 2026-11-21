# AGENTS.md — peakcam

> Repository-wide agent guide (`jaredschueler07/peakcam`). For detailed deployment and ops recipes, also see `CLAUDE.md`, `docs/runbook.md`, and `docs/parity-scorecard.md`.

## What This Is

PeakCam (`https://www.peakcam.io`, Vercel auto-deploy on push to `main`) is a live mountain-webcam, snow-telemetry, and multi-model forecast platform covering **318 active ski resorts** across the Americas (246 US, 49 CA, 13 CL, 10 AR), 963 camera rows (`data/cams.csv`), 699 weather stations (`SNOTEL`, `GHCN`, `NWS`, `ECCC`, `BC ASWS`), a 9-model 14-day blended forecast, 10-season SNOTEL history (`snowpack_daily`), algorithmic Snow Scores (0–100), favorites, powder alerts, and the browser 3D ski game ("Drop In").

Adjacent subsystems inside the same repository (outside the Next.js web app):
- `agents/` — dormant 9-bot Slack agent loop (`agents/loop.mjs`, `agents/manifests/*.yaml`).
- `dashboard/` — two standalone local servers. `dashboard/server.js` is the Express ops dashboard (own `dashboard/package.json`, port 3333, bound to 127.0.0.1); it is unauthenticated and can spawn `claude --dangerously-skip-permissions`, so never expose it beyond localhost. `dashboard/commercialization/server.mjs` is the commercialization tracker (`npm run commercialization`, port 3334, also 127.0.0.1).
- `generate-images.py` — brand image generation script.

## Stack & Key Facts

- **Language / Runtime:** TypeScript strict (`tsconfig.json`, path alias `@/*` → repo root), plus `.mjs` / `.py` / `.sh` scripts.
- **Framework:** Next.js 16 App Router + React 19 on Node. Tailwind CSS 4 via `@tailwindcss/postcss`; tokens in `tailwind.config.ts` and `app/globals.css`.
- **Package Manager:** `npm` (`package-lock.json` committed; `.npmrc` sets `cache=.npm-cache` inside the repo, gitignored).
- **Database / Auth:** Supabase Postgres + Auth via `@supabase/ssr`. **38 SQL files** under `supabase/migrations/` (`001`–`033` with duplicate `004`/`005` numbers plus three dated `20260907*` bug-report migrations). Migrations are **applied by hand** (no Supabase CLI migration runner) — verify live production schema before assuming a migration file matches prod (`CLAUDE.md` documents known historical view/column drift).
- **Session Proxy:** `proxy.ts` (Next 16 middleware replacement) refreshes Supabase auth cookies only where a server reads the session: `/account`, `/auth`, `/dashboard`, `/favorites`, `/alerts`, `/admin` and `/api/*` except `api/v1/` and `api/mcp` (since #127; `tests/proxy-matcher.test.ts` pins the list). Public pages read the session in the browser.
- **Maps & Tiles:** `maplibre-gl` via `react-map-gl/maplibre` + MapTiler / CARTO / RainViewer radar. Mount MapLibre components with `dynamic(..., { ssr: false })`.
- **3D / Game:** `three` + `postprocessing`. Drop In defaults to WebGPU with WebGL fallback (`lib/game/rendering/backend.ts`; `?gfx=webgl` forces WebGL).
- **Testing:** `node:test` via `tsx` (unit) and Playwright (`tests/e2e/`).
- **Scheduling:** Vercel cron (`vercel.json` → `/api/alerts/trigger` daily 13:00 UTC) plus macOS `launchd` plists in the repo root (`com.peakcam.*.plist`) for sync, still capture, timelapse, and scoring jobs.

## Repository Layout

| Path | Contents |
| --- | --- |
| `app/` | App Router pages: `/` (`BrowsePage`), `/about`, `/account`, `/admin/bug-reports`, `/alerts` (`+ manage`, `feed/[token]`), `/auth` (`+ callback`, `update-password`), `/compare`, `/dashboard`, `/drop-in`, `/favorites`, `/map`, `/methodology`, `/opening-dates`, `/passes` (`+ [pass]`), `/ski-cams` (`+ [hub]`), `/snow-report` (`+ [hub]`, `leaderboards`, `percent-of-normal`, `best-powder-this-week`, `season-powder-days`, `deepest-base`, `season-snowfall`), and `/resorts/[slug]` (`+ snow-report`, `snow-forecast`, `webcams`, `history`, `drop-in`, `powder.xml`, `index.md`, `opengraph-image.tsx`). Also `/index.md`, `sitemap.xml/route.ts`, `sitemaps/[file]/route.ts`, `robots.txt`, `llms.txt`, `llms-full.txt`, `gpt-instructions.md`, `ask/route.ts`, `resorts/route.ts` (308 → `/`), and `/.well-known/*` (`api-catalog`, `schemas`, `schemas/[file]`); `/connect` is a redirect to `/` since the public MCP server was retired on 2026-11-21. |
| `app/api/` | **37 `route.ts` handlers**: `admin/bug-reports*`, `alerts/{subscribe,manage,unsubscribe,trigger}`, `bug-reports`, `cam-reports/submit`, `cams/[id]/status`, `conditions/vote`, `csp-report`, `drop-in/{sessions,runs,leaderboard,morning,ghosts/[runId]}`, `mcp` (a 410 stub: the public MCP server was retired on 2026-11-21; `lib/mcp/` remains as the internal tool layer behind `/ask`), `user-conditions/submit`, `v1/*` (`resorts*`, `powder`, `snow-report`, `leaderboards/[kind]`, `status`, `batch`, `ask`, `openapi.json`). |
| `components/` | Domain-grouped React components: `alerts`, `analytics`, `auth`, `browse`, `cam`, `compare`, `connect`, `dashboard`, `drop-in`, `feedback`, `forecast`, `history`, `home`, `hubs`, `layout`, `map`, `openings`, `resort`, `snow-report`, `ui`, `weather`. |
| `lib/` | Supabase clients (`supabase.ts`, `supabase-browser.ts`, `supabase-server.ts`), conditions & scoring (`conditions-contract.ts`, `conditions-engine.ts`, `score.ts`, `snow-quality.ts`, `snow-history.ts`, `season-stats.ts`, `leaderboards.ts`, `percent-of-normal.ts`), forecast (`lib/forecast/`), stations (`lib/stations/`), operators (`lib/operators/`), public API & markdown (`lib/public-api/`), deterministic Q&A (`lib/ask/`), the internal tool layer behind `/ask` (`lib/mcp/` — tool handlers named in `PEAKCAM_TOOL_NAMES`; no public MCP server since 2026-11-21), Drop In (`lib/game/`), dormant `lib/pipeline/`, and colocated `*.test.ts`. |
| `data/` | Authoritative CSV/JSON seeds: `resorts.csv` (320 lines: 319 data rows, 318 active), `cams.csv` (1,041 lines / 1,040 data rows), `resort-profiles.csv` (320 lines / 319 data rows), `resort-openings.csv` (66 lines / 65 data rows), `operator-sources.json` (93 resorts mapped to Liftie parsers), `resort_socials.csv`, `resort-editorial.ts`, `snotel_stations.json` (~17 MB). |
| `scripts/` | Syncs, importers, terrain bakes, health/timelapse scripts (`.ts` / `.mjs`) with colocated tests. |
| `supabase/` | `migrations/` (38 SQL files), `seeds/`, `email-templates/`. |
| `tests/` | `e2e/` Playwright specs, `fixtures/` (including `drop-in-v1/`), and `drop-in-v1-parity.test.ts`. |
| `docs/` | Runbook (`runbook.md`), parity scorecard (`parity-scorecard.md`), design system (`design-system/`), cams, terrain, drop-in-v2, marketing, and reviews. |
| `public/` | Static assets (`public/game/{terrain,textures,audio,basis}/`, `public/images/`). Note: `public/drop-in/` no longer exists; `eslint.config.mjs` ignores the historical `public/drop-in/three.module.js` path. |

## Build, Run & Test

```bash
npm run dev       # next dev (needs .env.local; lib/supabase.ts throws at import if env vars missing)
npm run build     # next build — prerenders resort pages against live Supabase
npm run start     # next start
npx tsc --noEmit  # TypeScript check
npm run lint      # ESLint (flat config)
npm test          # node --import tsx --test 'lib/**/*.test.ts' 'scripts/**/*.test.ts' 'scripts/**/*.test.mjs' 'tests/**/*.test.ts'

# Playwright E2E
npx playwright test drop-in                        # Drop In specs only (runs `npm run start` on :3113 — run `npm run build` first)
# A bare `npx playwright test` runs every spec in tests/e2e (auth, mobile, signup and Meta Pixel included, 11 files)
# against :3113 with no fixture server; use the per-suite configs below for those.
PLAYWRIGHT_WEBGPU=1 npx playwright test --project=chromium-webgpu --headed
npx playwright test -c playwright.meta-pixel.config.ts # Meta Pixel replay (runs `npm run start` — run `npm run build` first; the spec skips, and still reports green, unless NEXT_PUBLIC_META_PIXEL_ID was set at build time)
npx playwright test -c playwright.auth.config.ts   # Auth/account flows (runs `npm run dev` + fixture auth server)
npx playwright test -c playwright.mobile.config.ts # Mobile flows (targets running server at MOBILE_TEST_URL, default 127.0.0.1:3116)
```

Important `package.json` script notes:
- Use `npm run import-resorts:standalone` (never stale non-standalone `npm run import-resorts` from older docs, or stale `npm run drop-in:sync-three`, neither of which exists in `package.json`) to seed `data/*.csv` into Supabase. `scripts/import-resorts-standalone.mjs` deduplicates cameras against the live `cams_unique_per_resort` identity (`camIdentity()` / `partitionCamRecords()`).
- Live snow reports come from `npm run snotel-sync` + `npm run model-sync`. `lib/pipeline/` (`npm run pipeline-sync`) is dormant in production; both `snotel-sync` and `lib/pipeline/` write `snow_reports` and `resorts.cond_rating` (last writer wins).
- Other maintained sync/seed scripts: `stations-sync`, `forecast-sync`, `forecast-score`, `score-sync`, `operator-sync`, `approach-cams-sync`, `cam-health`, `cam-stills`, `cam-timelapse`, `seed-openings`, `seed-normals`, `snotel-backfill`, `generate-descriptions`, `powder-alerts`, plus `npx tsx scripts/import-profiles.ts --dry-run`.

## Conventions & Gotchas

1. **Design System (Light Theme Only):** `tailwind.config.ts` and `app/globals.css` define the retro ski-poster light theme (`--pc-cream` `#f1e7cf`, `--pc-cream-50` `#faf4e6`, `--pc-cream-dk` `#e3d5b2`, `--pc-ink` `#2a1f14`, `--pc-bark` `#63482d`, `--pc-bark-50` `#b59b74`, `--pc-forest` `#3c5a3a`, `--pc-alpen` `#d9552f`; Fraunces, DM Sans, JetBrains Mono). Never extend or add new usages of the legacy dark-theme aliases (`bg`, `surface*`, `cyan`).
2. **Three Supabase Clients:**
   - `lib/supabase.ts`: anon client for public reads (throws at import if Supabase URL/key are missing).
   - `lib/supabase-browser.ts`: client auth UI/favorites/dashboard.
   - `lib/supabase-server.ts`: cookie-bound RSC & route-handler user sessions.
3. **`snow_reports` & `conditions` Format:** `snow_reports` is append-only; reads query the `latest_snow_reports` view, which must stay index-friendly under the anon role's 3s `statement_timeout` (see `CLAUDE.md`). Its `conditions` column is stored as `"tag1,tag2||narrative"` — every consumer must split on `||`.
4. **Static Params, CSV → Supabase Split & Cache:**
   - `dynamicParams = false` is set on `/resorts/[slug]`, `/resorts/[slug]/snow-report`, `/resorts/[slug]/webcams`, `/snow-report/[hub]`, `/ski-cams/[hub]`, `/passes/[pass]`, and `/.well-known/schemas/[file]` (while `/resorts/[slug]/snow-forecast` and `/resorts/[slug]/history` render on-demand with hourly ISR).
   - **CSV edits vs. live Supabase:** Editing CSVs under `data/` (`resorts.csv`, `cams.csv`, `resort-profiles.csv`, `resort-openings.csv`) and merging to `main` does **not** update production Supabase on Vercel. Live changes require an explicit, owner-approved importer/seed run (`npm run import-resorts:standalone`, `npm run seed-openings`, or `npx tsx scripts/import-profiles.ts`), plus a subsequent deploy so `dynamicParams = false` pages pick up any new slugs.
   - `/api/v1/*` routes use `Cache-Control: s-maxage=900` + `unstable_cache` (they export `OPTIONS`); the exceptions are `status` (300 s) and `resorts/search-index` and `openapi.json` (24 h). Per-route auth is summarised in `CLAUDE.md` ("Write path"). Open-Meteo data surfaces must retain CC BY 4.0 attribution (`"Weather data by Open-Meteo.com"`).
5. **Drop In Architecture & Lint Contract:** Drop In is a React client app (`components/drop-in/DropInGame.tsx` + `lib/game/`), **not** an iframe around `public/drop-in/engine.html` (the old iframe description in `CLAUDE.md` is historical). `eslint.config.mjs` enforces pure determinism inside `lib/game/{core,physics,terrain,replay}` by forbidding React, DOM, `three`, network, audio, analytics imports, and browser globals (`window`, `document`, `fetch`, etc.). `tests/drop-in-v1-parity.test.ts` guards v1 profile/fixture parity.
6. **Powder Threshold:** `POWDER_DAY_IN = 8` (in `lib/season-stats.ts`) and copy strings may appear in multiple places — grep before changing.
7. **Auth Flows:** `/auth` (email/password + Google OAuth) and `AuthModal` (magic link + Google OAuth) both route through `/auth/callback`.

## For Agents Working Here

- **Worktree hygiene:** Do feature and fix work in an isolated git worktree branched off `origin/main`, leaving the primary checkout on clean `main`.
- **Safe to change:** `app/`, `components/`, `lib/` (respecting `eslint.config.mjs` purity rules in `lib/game/core|physics|terrain|replay`), `data/` (remember CSV edits still require an owner-approved prod import + deploy as noted above), `scripts/`, `docs/`, tests, and new additive files under `supabase/migrations/`.
- **Do not edit carelessly / generated artifacts:** `CLAUDE.md` (owner's detailed reference — edit only when explicitly requested), historical audit/tracking docs (`TASKS.md`, `UX-AUDIT-PLAN.md`, `UX-AUDIT-PLAN-V2.md`, `qa-findings/`), `package-lock.json`, `next-env.d.ts`, `*.tsbuildinfo`, `node_modules/`, `.next/`, `.npm-cache/`, `public/game/terrain/*.height.u16` (raw intermediate; `.br` is committed), `plugins/*.plugin` (zip archives), and root PNG design references (`header-and-cards`, `resort-detail`, `filter-chips-closeup` — extensionless PNGs, not source text).
- **Never commit or print secrets:** `.env*`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `DROP_IN_TICKET_KEYS`, `CAM_REPORT_SALT`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, DOT API keys, or Slack tokens.
- **No unapproved production writes, pushes, or analytics pollution:** Never run write-capable sync/import scripts, DB mutations, Vercel changes against production, or push/merge to `main` without explicit owner confirmation. During read-only browser QA against `peakcam.io`, block analytics/ad hosts (`facebook.com`/`facebook.net`, `googletagmanager.com`, `google-analytics.com`, `googleadservices.com`, `doubleclick.net`, `posthog.com`, `redditstatic.com`, `reddit.com`, `vercel-insights.com`, `vercel-scripts.com`, `/_vercel/insights/*`, `/_vercel/speed-insights/*`, `/ingest`, `/api/csp-report`), and avoid calling `/api/v1/ask`, `/ask`, or the `ask` MCP tool unless testing Q&A logging.
- **Before finishing any change:** Run `npx tsc --noEmit && npm run lint && npm test`. Six GDAL terrain-bake tests skip (they do not fail) when `gdal_translate` is not on `PATH`; any failure is a real one.
