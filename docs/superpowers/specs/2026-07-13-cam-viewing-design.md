# Cam Viewing Improvements — Design

> **Status: APPROVED 2026-07-13** (user delegated design decisions: "Brainstorm on your own. Then bring it to completion yourself.") Decisions below were made solo and are documented with rationale rather than left open.

## Goal

Make webcam viewing — the product's core identity — genuinely good, now that the Andes resorts are the site's in-season content: stop showing dead cams, make live feeds feel live, add an immersive viewing mode, and close the known South America cam-coverage gaps.

## Problem inventory (evidence-based, from the 2026-07 codebase audit + SA launch)

1. **45 of 298 cams are dead and still shown to users.** `scripts/cam-health-check.mjs` probes every cam daily but deliberately only stamps `cams.last_checked_at` — the consecutive-failure disable it references in comments was never implemented (`docs/cam-health-architecture.md` designed it; the code never landed). Broken tiles are the single worst trust-eroder on a webcam site.
2. **Image cams refresh blindly.** `ImageCam` (ResortDetailPage) swaps a cache-busted URL every 30s: no freshness indicator, no manual refresh, keeps refreshing in hidden tabs (wasted bandwidth), and a failed load shows the browser's broken-image icon — while `public/images/cam-placeholder.jpg` (a brand asset made for exactly this) sits unwired.
3. **No immersive viewing.** Cams render as aspect-video tiles only; no fullscreen/lightbox, no way to cycle a resort's cams.
4. **Coverage gaps from the SA launch:** Pillán/Volcán Villarrica (Pucón) omitted entirely (the research critic found it operating with multiple public webcams); snow-forecast.com cam leads exist for 3 cam-light SA resorts (Cerro Mirador, Batea Mahuida, Cerro Perito Moreno); 5 SA resorts' cams were imported with "unverifiable" status (headless CORS blocks, not confirmed dead).

## Decisions (with the alternatives considered)

- **Dead cams: disable in the DB, not filter in the UI.** `is_active` is already the universal filter across every query and the importer; a UI-side filter would fork the source of truth. *Rejected: client-side hiding.*
- **Binary active/auto-disabled, not the architecture doc's 3-state (ok/degraded/dead).** Nothing in the UI consumes a "degraded" state, and the doc's thresholds assumed 6-hourly checks (the job actually runs daily). Two new columns: `consecutive_failures int`, `auto_disabled boolean`. Threshold: **3 consecutive failed daily checks → `is_active=false, auto_disabled=true`**. A later successful check on an auto-disabled cam **auto-recovers it** (`is_active=true`, flags reset). Manually-disabled cams (`auto_disabled=false`) are never touched by the script. *Rejected: `health_status` enum — YAGNI until something displays it.*
- **Known, accepted edge:** re-running the CSV importer upserts `is_active=true` from the CSV and would re-enable auto-disabled cams; the next 3 daily checks re-disable them. Importer runs are rare; not worth engineering around.
- **One-time convergence:** after deploying the script change, run the health check 3× back-to-back so the 45 long-dead cams (dead since April) disappear immediately rather than in 3 days. Legitimate because these cams have months of failure history, not transient blips.
- **Lightbox as an in-page modal, not a route.** Per-cam URLs have no SEO value and a route adds complexity. Modal with keyboard nav (←/→ cycle, Esc close), cam counter, poster-styled chrome. Link-type cams are excluded (nothing to embed). *Rejected: `/resorts/[slug]/cams/[id]` routes.*
- **Extract a shared `CamEmbed` component.** The youtube/iframe/image embed logic currently lives inline in `CamPlayer` (ResortDetailPage); the lightbox needs the identical logic. Extracting once avoids the duplicate-embed-logic trap that already bit this codebase elsewhere. `CamPlayer` keeps its click-to-play/lazy-load behavior and gains an expand affordance on loaded tiles.
- **Image-cam polish lives in `CamEmbed`:** "LIVE · updated Xs ago" mono badge, manual refresh button, refresh paused while `document.hidden` (visibilitychange), `onError` → `cam-placeholder.jpg` + "Feed unavailable" label. Refresh cadence stays 30s in tiles, 15s in the lightbox (attention is focused there).
- **Scope fence (OUT for this release):** auto-discovery scraping of replacement cam URLs, provider-outage clustering, Slack alerts (all from the architecture doc's future ambitions); home-page LiveWebcams/SnowCams lightbox integration; changing featured-cam selection; PiP/HLS. *The resort detail page is where cam viewing happens; ship that first.*

## Components

1. **Migration 014** — `cams.consecutive_failures integer not null default 0`, `cams.auto_disabled boolean not null default false`. Applied live via MCP per repo convention.
2. **`scripts/cam-health-check.mjs`** — extract a pure, exported `computeCamUpdate(cam, isAlive)` returning the PATCH body + whether state changed (unit-testable, like the importer's Task-8 helpers); wire thresholds; log a summary of disables/recoveries per run.
3. **`components/cam/CamEmbed.tsx`** — shared embed renderer (youtube/iframe/image) with the image-cam polish above. Consumed by `CamPlayer` and `CamLightbox`.
4. **`components/cam/CamLightbox.tsx`** — modal viewer, keyboard navigation, counter, opened from resort-detail cam tiles.
5. **`ResortDetailPage.tsx`** — swap inline embed logic for `CamEmbed`, add lightbox state + expand buttons.
6. **Coverage data** — research pass (web) for Pillán (status/coords/elevation/cams) + the 3 snow-forecast.com leads + oEmbed re-verification of the 5 unverifiable sets; append verified rows to `data/resorts.csv`/`data/cams.csv`; run the importer (now a safe upsert per migration 012).

## Error handling

- Health script: per-cam try/catch (existing pattern) — one cam's probe failure never aborts the run; PATCH failures logged, not fatal.
- `CamEmbed` image errors fall back to placeholder, never broken-img; refresh timer cleans up on unmount; lightbox traps focus and restores it on close.
- Importer: unknown `resort_slug` rows are skipped-with-warning (existing behavior).

## Testing

- `scripts/cam-health-check.test.mjs` (node:test): `computeCamUpdate` state table — alive/dead × active/auto-disabled/manually-disabled × failure counts 0/2/3 (TDD).
- `npx tsc --noEmit` + `npm run build` for the component work.
- Live verification: 3× convergence runs → query prod for remaining active-but-dead cams (expect ~0); `npm start` + curl a resort page for lightbox markup; browser check within known hidden-tab limits (first-paint screenshots render images).
- Prod verification post-deploy: Vercel deployment READY + spot-check a resort page and the dead-cam counts.

## Success criteria

- Zero cams that have failed 3+ consecutive checks remain visible on the site.
- A previously-dead cam that comes back is automatically re-shown within one daily check.
- Resort-detail cams open in a keyboard-navigable lightbox; image feeds show freshness and never render a broken image.
- Pillán live (if research confirms operating + ≥1 working cam) and the 3 cam-light SA resorts gain cams where the leads pan out.
