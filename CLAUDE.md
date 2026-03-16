# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PeakCam is a live mountain webcam and snow report aggregator for North American ski resorts. Built with Next.js 16 (App Router), React 19, Supabase, Tailwind CSS 4, and Leaflet. Dark-themed UI with a midnight navy palette.

## Commands

```bash
npm run dev              # Start dev server (localhost:3000)
npm run build            # Production build
npm run lint             # ESLint (flat config, Next.js core-web-vitals + TS)
npm run import-resorts:standalone  # Import resorts/cams from CSV into Supabase (no deps beyond Node 18+)
```

## Architecture

### Data Flow

Server Components (`app/page.tsx`, `app/resorts/[slug]/page.tsx`) fetch data from Supabase, then pass it as props to Client Components. All Supabase queries are server-side only. Weather data comes from the NWS API (no key required). Pages use ISR with `revalidate = 3600` (1 hour).

### Key Layers

- **`lib/supabase.ts`** — Supabase client + all DB queries (`getAllResorts`, `getResortBySlug`, `getAllResortSlugs`). Manually joins resorts with their latest snow_report and cams (no DB views used in queries).
- **`lib/types.ts`** — TypeScript interfaces mirroring the Supabase schema. `ResortWithData` is the primary composite type (resort + snow_report + cams[]).
- **`lib/weather.ts`** — NWS API integration. Two-step fetch: resolve grid point, then get forecast. Collapses day/night periods into `WeatherPeriod[]`. Snow amounts are heuristic estimates from forecast strings.

### Database (Supabase/Postgres)

Three tables: `resorts`, `cams`, `snow_reports`. Schema in `supabase/migrations/001_initial.sql`. RLS enabled — public read-only via anon key, writes via service role key only. A `latest_snow_reports` view exists but queries currently do manual dedup instead.

### Pages

- **`/`** — Browse page. Server component fetches all resorts, renders `BrowsePage` (client). Has search, state filter chips, condition filter, sort (name/snow/conditions), powder alert banner, and a Leaflet map sidebar.
- **`/resorts/[slug]`** — Resort detail. Uses `generateStaticParams` for SSG. Shows snow report, 5-day NWS forecast, and click-to-play cam embeds (YouTube/iframe/link-out).

### Components

- `components/browse/` — `BrowsePage` (main browse UI), `ResortMap` (Leaflet, dynamically imported with `ssr: false`, uses `require("leaflet")` internally)
- `components/resort/` — `ResortDetailPage` with `CamPlayer` (click-to-play embed), `WeatherStrip`, `ConditionsStrip`
- `components/layout/` — `Header` (sticky, with search input and nav)
- `components/ui/` — `Badge`, `Button`, `Chip`, `Modal` (reusable primitives)

### Data Import

CSV seed data lives in `data/resorts.csv` and `data/cams.csv`. The standalone import script (`scripts/import-resorts-standalone.mjs`) reads these CSVs, loads `.env.local` manually, and upserts into Supabase via REST API using the service role key. Resorts upsert on `slug`; cams insert with ignore-duplicates.

### Path Aliases

`@/*` maps to the project root (configured in `tsconfig.json`).

## Design System

Dark theme defined in `tailwind.config.ts` and CSS custom properties in `globals.css`. Key tokens:
- Background hierarchy: `bg` → `surface` → `surface2` → `surface3`
- Text hierarchy: `text-base` → `text-subtle` → `text-muted`
- Accent: `cyan` (#22D3EE) — used for interactive elements, glow effects, brand accent
- Condition colors: `powder`/cyan (great), `good`/blue, `fair`/yellow, `poor`/red
- Font: Inter, loaded via Google Fonts CSS import
- Transitions default to 220ms

## Environment Variables

Copy `.env.local.example` to `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL (exposed to browser)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key (exposed to browser)
- `SUPABASE_SERVICE_ROLE_KEY` — For import scripts only (never in browser)

## Key Patterns

- Leaflet requires `dynamic(() => import(...), { ssr: false })` — it depends on `window`/`document`
- Cam embeds are click-to-play (lazy loaded iframes) to avoid loading all streams at once
- The `ResortMap` component uses Leaflet's imperative API via refs, not a React wrapper
- Snow report source can be `snotel`, `manual`, or `resort` — anticipates future automated ingestion
- Condition ratings (`great`/`good`/`fair`/`poor`) are stored on the resort row, not derived
