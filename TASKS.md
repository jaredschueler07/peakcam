# PeakCam Tasks

> Last updated: 2026-03-28 | Sprint 4 (Polish & Launch Prep) | Week 2

## Active — Sprint 4

### P0 Critical
- [ ] Wire up alerts system — subscribers, preferences, powder alert triggers — **Engineering** (due 4/4)
- [ ] QA & cross-browser testing — mobile Safari, Chrome, Firefox — **Engineering** (due 4/4)
- [ ] Merge open feature branches (`feat/map-overhaul`, `feat/multi-source-data-pipeline`) or close — **Engineering** (due 3/31)

### P1 High
- [ ] Populate empty DB tables — `resort_metadata`, `data_source_readings`, `resort_conditions_summary` — **Data** (due 4/4)
- [ ] Performance optimization — Core Web Vitals audit, image lazy-loading, bundle size — **Engineering** (due 4/4)
- [ ] Soft launch & social media rollout (Product Hunt, social content ready in Notion) — **Marketing** (due 4/7)
- [ ] Analytics dashboard & baseline metrics — PostHog funnels, retention, key events — **Data** (due 4/7)

### P2 Medium
- [ ] Deployment runbook & incident response plan — **Operations** (due 4/7)
- [ ] Affiliate program research report — **Sales** (due 4/7)
- [ ] V0 cost analysis & revenue model report — **Finance** (due 4/10)
- [ ] V0 retrospective & V0.5 planning — **Product** (due 4/10)

## Backlog — V0.5

- [ ] Push notification support for powder alerts
- [ ] Resort photo gallery / user-submitted photos
- [ ] Historical snow data charts (SNOTEL normals vs actual)
- [ ] Lift status integration (Liftie API wired but not surfaced in UI)
- [ ] SNODAS snowmelt/runoff data visualization
- [ ] Multi-resort trip planner
- [ ] Embed widget for resort websites
- [ ] API for third-party integrations

## Done — Sprint 1 (Foundation, March 16–20)

- [x] All-hands meeting — all teams presented V0 plans (3/16)
- [x] Notion roadmap populated — 12 workstreams (3/16)
- [x] Notion sprint tasks created — 27 tasks across 4 sprints (3/16)
- [x] Slack bot infrastructure — 8 agents, all channels joined (3/16)
- [x] Agent plugin skills installed — 66 skills across 8 teams (3/16)
- [x] Vercel project setup & deployment pipeline (3/17)
- [x] Alpine Bold design tokens — Tailwind config + CSS custom properties (3/17)
- [x] Initial scaffold — phases 1–3, browse page, resort detail (3/16)
- [x] Fuse.js fuzzy search replacing naive string search (3/17)
- [x] Browse filters, powder alert threshold, custom 404 (3/17)
- [x] Agent loop service — polling, handoffs, rate limiting (3/17)
- [x] SNOTEL lib + COO agent + Day 1 planning docs (3/17)
- [x] Hosting infrastructure on Vercel (3/17)
- [x] Brand positioning & about page content (3/18)
- [x] Agent workflow documentation (3/17)

## Done — Sprint 2 (Core Features, March 20–27)

- [x] Summit Light UI redesign — hero, ticker, cards, webcams, footer (3/20)
- [x] SEO structured data, sitemap, robots.txt, PostHog integration (3/20)
- [x] Resort comparison page at /compare (3/20)
- [x] User-submitted conditions reports with auth + moderation (3/20)
- [x] Expanded to 128 resorts (from initial ~70) (3/21)
- [x] Dynamic OG share cards for social sharing (3/21)
- [x] Ops dashboard with auto-refresh and remote permissions (3/21)
- [x] Brand image generation system with versioning (3/21)
- [x] SNOTEL sync pipeline — quality checks, history, conditions engine (3/22)
- [x] SNOTEL normals seed script — 30-year medians (17,202 records) (3/22)
- [x] Conditions engine — rating, trend arrows, % of normal, outlook (3/22)
- [x] Snow data quality validation and water-year helpers (3/22)
- [x] Map overhaul — Leaflet → MapLibre GL JS with dark terrain tiles (3/22)
- [x] 301 real webcam URLs imported from resort research (3/22)
- [x] Social media links for all 128 resorts (3/22)
- [x] Monitoring & observability — cam health checker, dashboard (3/22)
- [x] Vercel Web Analytics + Speed Insights installed (3/22)
- [x] Domain updated to peakcam.io (3/23)
- [x] Snow report page implementation at /snow-report (3/22)
- [x] /about page implementation (3/22)
- [x] Content drafts: about page & resort descriptions (3/22)

## Done — Sprint 3 (Auth, Polish & SEO, March 23–28)

- [x] Email + password auth system at /auth (3/23)
- [x] Auth middleware for session refresh (3/23)
- [x] Favorites / saved resorts system (3/23)
- [x] Share button with PostHog tracking on resort detail (3/23)
- [x] SEO keyword optimization — structured data, sitemap coverage (3/23)
- [x] Canonical URL fix to prevent duplicate content indexing (3/24)
- [x] Google Search Console verification (3/24)
- [x] Agent loop bug fixes — silence bug, crash recovery (3/24)
- [x] Conditions engine UI — trend arrows, % of normal, outlook labels (3/25)
- [x] Cam health checker with proper headers, retries, architecture doc (3/25)
- [x] Snowing Now detection + badge on resort detail (3/26)
- [x] Snow Cams section — live cams from resorts with active snowfall (3/26)
- [x] Fixed 16 broken cam URLs with verified working sources (3/26)
- [x] User dashboard with drag-and-drop widget management (3/27)
- [x] Multi-source data pipeline (SNOTEL + NWS + Liftie + SNODAS) (3/27)
- [x] Mobile header improvements (3/27)
- [x] Auth UI page polish (3/28)
- [x] Core Web Vitals optimization, JSON-LD, routing improvements (3/28)
- [x] Launch readiness checklist completed in Notion (3/24)
- [x] SEO strategy doc written (3/23)
- [x] Launch content prepared — Product Hunt, social posts (3/21)
