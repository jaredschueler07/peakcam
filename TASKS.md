# PeakCam Tasks

> Last updated: 2026-06-10 | Phase: Soft Launch (sub-project #2) | Sources: Linear (RUN-63…73), Notion roadmap, Slack #all-peakcam, repo docs
> Site: live at peakcam.io (128 resorts, latest deploy 2026-04-21). Project idle since 4/21 — this file reflects actual state, replacing the stale March sprint plan.

## Active — Soft Launch Rollout

### P0 Critical
- [ ] Soft launch & social media rollout — **Marketing/Jared** (Linear RUN-68, overdue since 4/7)
  - Launch content ready in Notion (Product Hunt copy, social posts). Final checklist → submit → monitor PostHog 48h.
- [ ] Finish cross-browser QA smoke — **Engineering/Jared** (residual from launch gate)
  - Chromium desktop done 4/19 (0 P0/P1). Remaining: mobile Safari, Chrome mobile, Firefox — checklist in `docs/qa-smoke-2026-04-17.md`.
- [ ] Set cam-reports env vars in Vercel — **Operations** (PR #8 follow-up)
  - Admin notification email + IP salt per `.env.local.example`; feature is deployed but silent without them.

### P1 High
- [ ] Analytics baseline & retention cohorts — **Data** (Linear RUN-69, partially done)
  - PostHog dashboard live since 4/17 (4 funnels + 3 trends). Remaining: retention cohorts, documented pre-launch baseline.
- [ ] Verify data pipeline still populating — **Data**
  - Migration 010 applied + pipeline enabled 4/17. Confirm `snow_reports`/`resort_metadata` have fresh rows after 7 idle weeks; check launchd job on host.
- [ ] Merge or close stale feature branches — **Engineering** (Linear RUN-65)
  - `origin/feat/launch-readiness` still exists (merged); check `feat/map-overhaul`, `feat/multi-source-data-pipeline`, Claude worktree branches.

### P2 Medium
- [ ] Fix 3 P2s from Chromium smoke (map marker popup, `submitted_at` column, SNOTEL upstream) — **Engineering** (filed 4/19)
- [ ] Lint cleanup — 36 errors / 48 warnings, mostly `no-explicit-any` + unused vars in `scripts/` — **Engineering**
- [ ] Populate remaining empty DB tables (`data_source_readings`, `resort_conditions_summary`) — **Data** (Linear RUN-66, partial)

## Backlog — Post-Launch (V0.5)
- [ ] V0 cost analysis & revenue model report — **Finance** (Linear RUN-72)
- [ ] V0 retrospective & V0.5 planning — **Product** (Linear RUN-73)
  - Candidate themes: alerts expansion, lift status, historical charts, trip planner.
- [ ] Affiliate program: act on research — **Sales** (Linear RUN-71; research doc already in Notion)
- [ ] Update Linear: close RUN-70 (runbook done — `docs/runbook.md`), reconcile RUN-66/69 partials

## Done (high-water mark)
- [x] Sprints 1–2: site live at peakcam.io, 145 pages, auth, favorites, SEO, OG cards, PostHog (3/23)
- [x] Sprint 3: map UX overhaul, weather forecast overhaul, perf optimization, alerts cron (RUN-63/64/67) (4/4)
- [x] Launch readiness sub-project #1: alerts E2E verified, migration 010 + 128 resorts seeded, PostHog dashboard, Chromium smoke, runbook (4/17)
- [x] Retro ski-poster design system across 22 components (PR #7) (4/19)
- [x] Cam reports: users flag broken cams + suggest replacements (PR #8) (4/21)
- [x] Popular sort default — curated 12-resort list (4/21)
- [x] Local repo synced with origin/main, deps reinstalled (6/10)
