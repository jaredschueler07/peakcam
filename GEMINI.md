# PeakCam — Gemini CLI Context

This project, **PeakCam**, is a live mountain webcam and snow report aggregator for North American ski resorts. It provides real-time snow conditions, weather forecasts, and interactive maps for skiers and snowboarders.

## Project Overview

- **Core Purpose:** Aggregating live webcams, snow reports, and weather data for ski resorts.
- **Primary Tech Stack:**
  - **Framework:** Next.js 16 (App Router), React 19.
  - **Styling:** Tailwind CSS 4 (Alpha/Beta), CSS Custom Properties for dark theme.
  - **Database & Auth:** Supabase (PostgreSQL, Row Level Security).
  - **Maps:** MapLibre GL via `react-map-gl/maplibre`.
  - **Data Sources:** NWS API (Weather), SNOTEL (Snow Data), AWDB (Station Data).
  - **Infrastructure:** Vercel (Hosting/Analytics), Resend (Email), PostHog (Product Analytics).

## Architecture & Data Flow

### Data Layer
- **Supabase:** Primary data store for `resorts`, `cams`, and `snow_reports`.
- **Server Components:** Fetch data directly from Supabase via `lib/supabase.ts`.
- **ISR (Incremental Static Regeneration):** Pages use `revalidate = 3600` (1 hour) for high-performance static delivery with fresh data.
- **SNOTEL Integration:** Automated ingestion of snow depth and temperature from SNOTEL stations.

### Frontend Layers
- **`app/`**: Next.js App Router for page structure and server-side logic.
- **`components/`**: Modular React components organized by domain (e.g., `map/`, `resort/`, `browse/`).
- **`lib/`**: Business logic, API integrations, and shared utilities.
- **`agents/`**: A specialized AI agent system (COO, Engineering, Data, etc.) used for automated tasks and business operations.

## Key Commands

```bash
# Development
npm run dev              # Start development server on localhost:3000
npm run lint             # Run ESLint checks

# Build & Production
npm run build            # Create a production build
npm run start            # Start the production server

# Data & Sync Scripts
npm run import-resorts:standalone  # Import resorts/cams from CSV to Supabase
npm run snotel-sync                # Sync latest snow data from SNOTEL stations
npm run seed-normals               # Seed SNOTEL historical normal data
npm run cam-health                 # Run status checks on webcam streams
npm run powder-alerts              # Process and send powder alert notifications

# AI Agents
npm run agents           # Run the AI agent loop
npm run agents:dry-run   # Run agents without side effects
```

## Development Conventions

- **Typing:** Use TypeScript strictly. Core interfaces are defined in `lib/types.ts` and mirror the database schema.
- **Styling:** Adhere to the "Alpine Bold" design system. Use the dark-themed palette defined in `tailwind.config.ts` and `app/globals.css`.
  - Backgrounds: `bg`, `surface`, `surface2`.
  - Accents: `cyan` (#22D3EE) for interactivity and "powder" conditions.
- **Components:** Prefer Server Components for data fetching. Use "use client" only when client-side state or browser APIs (like MapLibre) are required.
- **Maps:** Use `react-map-gl/maplibre`. Coordinate with `lib/map-utils.ts` for GeoJSON conversions and bounds calculation.
- **Security:** Never expose the `SUPABASE_SERVICE_ROLE_KEY` to the browser. Use it only in server-side scripts.
- **Environment:** Maintain `.env.local` for local development. See `.env.local.example` for required keys.

## Key Files & Directories

- `app/resorts/[slug]/page.tsx`: Dynamic resort detail pages.
- `components/map/MapView.tsx`: Core interactive map implementation.
- `lib/snotel.ts`: Logic for fetching and processing snow data.
- `scripts/`: Critical maintenance and data ingestion scripts.
- `agents/manifests/`: Configuration for the various AI agents operating within the project.
