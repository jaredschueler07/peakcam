# PeakCam — Agent Quick Reference

PeakCam (`https://www.peakcam.io`) is a live mountain webcam, snow telemetry, and multi-model snow forecast aggregator for ski resorts across the Americas (318 active resorts across US/CA/CL/AR, 1,040 cam rows, 699 weather stations, 9-model 14-day forecast blend, 10-season SNOTEL history, Snow Score 0–100, 37 route handlers under `app/api/`; the public MCP server was retired on 2026-11-21).

## Primary Tech Stack

- **Framework / Language:** Next.js 16 (App Router), React 19, TypeScript strict (`@/*` → repo root).
- **Styling:** Tailwind CSS 4 (`@tailwindcss/postcss`) with a **light-only retro ski-poster** theme (`tailwind.config.ts`, `app/globals.css`).
- **Database & Auth:** Supabase Postgres + Auth via `@supabase/ssr` (`lib/supabase.ts`, `lib/supabase-browser.ts`, `lib/supabase-server.ts`, `proxy.ts`).
- **Maps & 3D:** MapLibre GL (`react-map-gl/maplibre`, mount with `dynamic(..., { ssr: false })`) and Three.js WebGPU/WebGL for Drop In (`components/drop-in/`, `lib/game/`).
- **Data & Infra:** NRCS AWDB/SNOTEL, NWS, NCEI GHCN, ECCC/BC ASWS, Open-Meteo (CC BY 4.0 attribution required), Vercel, Resend, PostHog.

## Key Commands

```bash
# Development & verification
npm run dev                 # Next dev server on localhost:3000 (requires .env.local)
npm run build               # Production build (prerenders resort pages against live Supabase)
npm run start               # Start production server
npx tsc --noEmit            # Type check
npm run lint                # ESLint (flat config in eslint.config.mjs)
npm test                    # node --import tsx --test across lib/, scripts/, tests/

# Playwright E2E
npx playwright test drop-in                        # Drop In specs only, on :3113 (runs `npm run start` — run `npm run build` first)
# A bare `npx playwright test` runs every spec in tests/e2e (auth, mobile, signup, Meta Pixel); use the configs below for those.
PLAYWRIGHT_WEBGPU=1 npx playwright test --project=chromium-webgpu --headed
npx playwright test -c playwright.meta-pixel.config.ts # Meta Pixel replay on :3128 (runs `npm run start` — run `npm run build` first; skips unless NEXT_PUBLIC_META_PIXEL_ID was set at build time)
npx playwright test -c playwright.auth.config.ts   # Auth/account flows (runs `npm run dev` + fixture auth server)
npx playwright test -c playwright.mobile.config.ts # Mobile flows (targets running server at MOBILE_TEST_URL, default 127.0.0.1:3116)

# Data & ops scripts (read .env.local; write via service-role key — never run against prod without approval)
npm run import-resorts:standalone   # Maintained CSV importer (data/*.csv -> Supabase)
npm run seed-openings               # Seed data/resort-openings.csv
npm run snotel-sync                 # Production SNOTEL snow report sync
npm run model-sync                  # Open-Meteo sync for non-SNOTEL resorts
npm run stations-sync               # Multi-network station observations
npm run forecast-sync               # 9-model 14-day Open-Meteo forecast sync
npm run forecast-score              # Daily model verification scoring
npm run score-sync                  # Daily Snow Score (0-100) sync
npm run cam-health                  # Probe camera streams/images
npm run cam-stills                  # Capture camera still archives
npm run cam-timelapse               # Render 24h MP4 timelapses & storm reels
```

## Design System Rules (Light Theme Only)

- **Always use the retro ski-poster `--pc-*` / Tailwind poster tokens** (`cream` `#f1e7cf`, `cream-50` `#faf4e6`, `cream-dk` `#e3d5b2`, `ink` `#2a1f14`, `bark` `#63482d`, `bark-50` `#b59b74`, `forest` `#3c5a3a`, `alpen` `#d9552f`; Fraunces display, DM Sans body, JetBrains Mono readouts).
- **Never** use or extend legacy dark-theme alias tokens (`bg`, `surface*`, `cyan` — `tailwind.config.ts` only aliases old names so un-migrated components still render).

## Architecture Highlights

- **Server + ISR Read Path:** Data-bearing pages are thin Server Components (`export const revalidate = 3600`) fetching via `lib/supabase.ts` and passing props to `"use client"` views. `dynamicParams = false` applies to `/resorts/[slug]`, `/resorts/[slug]/snow-report`, `/resorts/[slug]/webcams`, `/snow-report/[hub]`, `/ski-cams/[hub]`, `/passes/[pass]`, and `/.well-known/schemas/[file]` (while `/resorts/[slug]/snow-forecast` and `/resorts/[slug]/history` render on-demand with hourly ISR). `snow_reports` is append-only and queried through `latest_snow_reports` (keep index-friendly under the anon 3s `statement_timeout`).
- **CSV → Supabase Split:** Merging edits to `data/*.csv` (`resorts.csv`, `cams.csv`, `resort-profiles.csv`, `resort-openings.csv`) does **not** update live Supabase on Vercel — run the corresponding owner-approved importer/seed script (`npm run import-resorts:standalone`, `npm run seed-openings`, `npx tsx scripts/import-profiles.ts`) and redeploy so `dynamicParams = false` routes pick up new slugs.
- **Markdown & Agent Surface:** Resort pages, hubs, and `/` expose `…/index.md` markdown alternates, structured JSON-LD, `/api/v1/*` JSON endpoints (with provenance envelopes and Open-Meteo attribution), and the deterministic `/api/v1/ask` + `/ask`. `/api/mcp` answers 410 since 2026-11-21; `lib/mcp/` is the internal tool layer those answer endpoints call.
- **Drop In (`lib/game/`):** Deterministic simulation lives in `lib/game/{core,physics,terrain,replay}` — `eslint.config.mjs` forbids React, DOM, `three`, network, audio, analytics, and browser globals there. `tests/drop-in-v1-parity.test.ts` guards v1 parity.

## Safety & Verification Guardrails

- **Worktree hygiene:** Do feature/fix work in an isolated git worktree branched off `origin/main` so the primary checkout stays on clean `main`.
- **Never expose secrets:** Never read/print `.env*` or ship `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `DROP_IN_TICKET_KEYS`, `CAM_REPORT_SALT`, `RESEND_API_KEY`, or API keys to client code or logs.
- **No unapproved production mutations:** Never mutate production Supabase, Vercel env/deployments, or push/merge to `main` without explicit owner confirmation.
- **Automated Browser Analytics Hygiene:** When testing `https://www.peakcam.io` with Playwright or headless browsers, abort analytics and ad-pixel requests (`facebook.com`/`facebook.net`, `googletagmanager.com`, `google-analytics.com`, `googleadservices.com`, `doubleclick.net`, `posthog.com`, `redditstatic.com`, `reddit.com`, `vercel-insights.com`, `vercel-scripts.com`, `/_vercel/insights/*`, `/_vercel/speed-insights/*`, `/ingest`, `/api/csp-report`) before first navigation, and avoid `/api/v1/ask`, `/ask`, or the `ask` MCP tool during read-only audits.
- **Pre-commit Gate:** Run `npx tsc --noEmit && npm run lint && npm test` (note: six GDAL terrain-bake tests skip, they do not fail, when `gdal_translate` is missing from `PATH`).
