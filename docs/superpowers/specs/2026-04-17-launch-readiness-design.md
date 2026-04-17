# PeakCam V0 Launch Readiness — Design Spec

**Date:** 2026-04-17
**Status:** Design (pre-implementation)
**Scope:** Sub-project #1 of three (Launch Readiness → Soft Launch Rollout → V0.5 Backlog)

## Problem

Production is live at `www.peakcam.io`. Sprint 4 stalled on 2026-04-04 after the map UX overhaul and weather forecast enhancement commits. Five workstreams stand between today and a confident soft launch. TASKS.md is stale — several items listed as "P0 open" are actually shipped but unverified end-to-end. This spec defines what "launch-ready" means, confirms current wiring, and decomposes the remaining work into parallel streams.

## Success Criteria (Launch Gates)

All five must be green before soft launch:

| Gate | Definition of Done |
|---|---|
| **Alerts verified** | Real test email delivered via prod Vercel cron; manage link edits preferences; unsubscribe removes subscriber |
| **QA smoke** | Golden path tested on mobile Safari, Chrome, Firefox; zero P0 bugs; P1 bugs fixed; P2 triaged to V0.5 |
| **Data pipeline** | `data_source_readings` and `resort_conditions_summary` populating daily; `resort_metadata` either populated or formally removed |
| **PostHog funnels** | Four named-event funnels firing; baseline dashboard shows DAU, pageviews, top resorts |
| **Runbook** | Five incident scenarios documented with recovery steps; logs/secrets/dashboards map written |

## Current State (verified 2026-04-17)

- Production: `www.peakcam.io` returning 200, behind Vercel
- Agent loop: `com.peakcam.agents` running, cycle 142,691, 9 agents alive
- Alerts system: DB migration `004_powder_alerts.sql` applied; routes `/api/alerts/{subscribe,manage,unsubscribe,trigger}` exist; signup + manage UI exist; Vercel cron scheduled daily 13:00 UTC; `sendPowderAlertEmail` wired
- PostHog: provider and key live in `.env.local` (`phc_2T8StLuF0P4LQByPgwMI9tpi2YdsrxXs7Jk6aMeyfa8`); pageviews captured on route change; no custom funnel events yet
- Data pipeline: `lib/pipeline/orchestrator.ts` with 6 fetchers (snotel, nws, liftie, snodas, weather-unlocked, user-reports) and blender — scheduling state unconfirmed
- Branches: `feat/map-overhaul` and `feat/multi-source-data-pipeline` already merged (PRs #1, #5)
- Uncommitted: `TASKS.md` updates, `docs/ad-creative-kit.md`, image concept dirs

## Architecture — Five Parallel Streams

```
┌─────────────────────────────────────────────────────────┐
│                    LAUNCH READINESS                      │
└─────────────────────────────────────────────────────────┘
      │              │            │            │           │
   Stream 1       Stream 2     Stream 3     Stream 4    Stream 5
   ALERTS         QA SMOKE     DATA PIPE    POSTHOG     RUNBOOK
      │              │            │            │           │
   verifier      qa-tester     data-eng     analytics    lead
   (teammate)    (teammate)    (teammate)   (teammate)   (lead)
```

Each stream is independently verifiable and owns distinct files/systems. No shared mutable state between streams, so parallel execution is safe.

### Stream 1 — Alerts End-to-End Verification

**Owner:** `alerts-verifier` teammate
**Files touched:** `scripts/powder-alert-check.mjs`, potentially `lib/email.ts`, possibly new `scripts/alert-e2e-test.mjs`

**Work:**
1. Confirm `CRON_SECRET` set in Vercel env
2. Confirm Resend (or equivalent) API key set and `from` domain verified
3. Subscribe a test email to a real resort via `POST /api/alerts/subscribe`
4. Manually trigger `POST /api/alerts/trigger` against prod with `CRON_SECRET`
5. Verify inbox receives email; click manage link → page renders preferences; unsubscribe works
6. Simulate threshold miss (low snow) → verify no email sent
7. Simulate dedup (rerun trigger same day) → verify no duplicate email
8. Document findings in `docs/alerts-verification.md`

**Acceptance:** checklist above fully green, recorded in doc.

### Stream 2 — QA Cross-Browser Smoke

**Owner:** `qa-tester` teammate
**Files touched:** `docs/qa-smoke-2026-04-17.md` (new), bug-fix PRs in existing files

**Golden path routes:**
`/` → `/browse` → `/[resort]` → `/snow-report` → `/compare` → `/auth` → `/dashboard` → `/alerts/manage` → `/about`

**Interactions per browser (mobile Safari, Chrome, Firefox):**
- Fuzzy search on `/browse`
- Filter chips on `/browse` and `/snow-report`
- Tap resort card → detail page
- Condition vote on resort detail
- Alert signup on resort detail
- Auth: signup new account, logout, login
- Favorite toggle
- Compare: add 2+ resorts, verify layout
- Map interactions: pan, zoom, cluster expand, marker tap

**Triage rules:**
- P0 = broken core flow (signup fails, map blank, alerts 500) — fix before launch
- P1 = visible regression (layout break, wrong data) — fix before launch if ≤4h
- P2 = polish (copy, a11y edge case) — file to V0.5 backlog

**Acceptance:** smoke doc committed, zero P0s, P1s fixed or explicitly accepted.

### Stream 3 — Data Pipeline Table Population

**Owner:** `data-engineer` teammate
**Files touched:** possibly `vercel.json` (cron), possibly `scripts/` (new backfill script), possibly migration to drop unused columns

**Work:**
1. Query prod Supabase — row counts in `data_source_readings`, `resort_conditions_summary`, `resort_metadata`
2. If empty: inspect `lib/pipeline/orchestrator.ts` for entry point; determine whether it's scheduled anywhere
3. If unscheduled: add Vercel cron entry or launchd job on the Mac Mini, whichever is the better fit for this workload (launchd preferred for network-heavy jobs — already how SNOTEL sync runs)
4. Run one full backfill cycle; verify rows land
5. For `resort_metadata`: inspect schema, determine if any reader depends on it; if not, drop in a new migration `010_drop_resort_metadata.sql`
6. Document in `docs/data-pipeline-status.md`

**Acceptance:** tables populating daily OR formally removed; doc committed.

### Stream 4 — PostHog Funnels + Baseline Dashboard

**Owner:** `analytics-engineer` teammate
**Files touched:** `lib/posthog.tsx` helpers, component-level `capture()` calls on signup/favorite/vote/pageview, possibly new `lib/analytics-events.ts` to centralize event names

**Events to add (constants in `lib/analytics-events.ts`):**
- `browse_opened` (auto on route)
- `resort_viewed` (auto on route, resort slug as prop)
- `alert_signup_submitted` (on POST to `/api/alerts/subscribe`)
- `alert_confirmed` (on manage-page load)
- `auth_signup_started`, `auth_signup_completed`
- `favorite_added`, `favorite_removed`
- `condition_voted`
- `snow_report_opened` (auto on route)

**PostHog dashboard (via PostHog UI, not code):**
- Funnel: Browse → Resort → Alert submit → Alert confirm
- Funnel: Auth started → Auth completed
- Funnel: Resort viewed → Favorite added
- Funnel: Snow report → Resort viewed
- Trends: DAU, pageviews by route, top-10 resorts by views

**Acceptance:** events fire in PostHog live; dashboard URL pasted into runbook.

### Stream 5 — Deployment + Incident Runbook

**Owner:** lead (me)
**Files touched:** `docs/runbook.md` (new)

**Sections:**
1. **Environments & URLs** — prod, staging (if any), Supabase project URL, Vercel project URL, PostHog dashboard URL
2. **Secrets inventory** — which keys exist, where they live (env var name + location), rotation procedure. Reference `reference_env_keys.md` memory for pointers, not content.
3. **Deploy & rollback** — how to deploy (git push main), how to roll back via Vercel UI, how to verify deploy health
4. **Incident scenarios** (five):
   - Agent loop crashed → `launchctl start com.peakcam.agents`, logs at `agents/loop.log`
   - SNOTEL sync failing → station ID check, manual rerun
   - Vercel deploy broken → UI rollback
   - Supabase outage → what degrades (auth, favorites, votes, alerts queue), what still works (static cams, cached resort pages)
   - Powder alerts not firing → CRON_SECRET check, Resend dashboard, manual trigger
5. **Where to look** — Vercel logs, PostHog, Supabase logs, agents/loop.log, launchd logs
6. **Known issues / workarounds** — any open P2 bugs from Stream 2

**Acceptance:** doc committed; a non-Jared reader can execute any scenario.

## Data Flow (Alerts — critical path)

```
Vercel Cron (13:00 UTC daily)
  → POST /api/alerts/trigger (Bearer CRON_SECRET)
    → Load alert_preferences JOIN subscribers JOIN resorts
    → Load latest_snow_reports (view) for resort_ids
    → Group subscribers whose new_snow_24h ≥ threshold_inches
    → Dedup against powder_alert_log (subscriber, resort, today)
    → sendPowderAlertEmail(email, alerts, manage_token)
    → INSERT INTO powder_alert_log (subscriber, resort, today)
  → Respond { sent, failed }
```

Existing implementation is sound; Stream 1 is verification, not reconstruction.

## Error Handling

- **Stream 1:** if email fails, the existing try/catch in `trigger/route.ts` logs and increments `failed` count without rolling back the iteration. Verification must confirm a failed send does NOT write to `powder_alert_log` (otherwise dedup would suppress a retry). *Open question surfaced by this spec — verifier to confirm.*
- **Stream 3:** pipeline orchestrator already has per-source error isolation. Backfill should log failures per resort, not abort the run.
- **Stream 4:** PostHog events are fire-and-forget; no user-visible error on capture failure.

## Testing

This is a verification sprint, not a greenfield build. Tests are:
- **Stream 1:** manual E2E script against prod with a throwaway email
- **Stream 2:** manual cross-browser smoke with doc
- **Stream 3:** row count queries + one backfill dry-run
- **Stream 4:** PostHog live-events tab inspection
- **Stream 5:** doc review by lead

No new unit tests required unless Stream 2 surfaces a regression that warrants one.

## Out of Scope

- Push notifications (V0.5)
- Historical snow charts (V0.5)
- Product Hunt rollout execution (sub-project #2)
- V0 cost analysis and retrospective (sub-project #2)
- Lift status UI surfacing (V0.5)

## Open Questions

1. **Email provider identity** — `lib/email.ts` is imported but not yet inspected in this spec. Stream 1 to verify whether it's Resend, Postmark, or something else, and whether the `from` domain is verified.
2. **`resort_metadata` consumers** — Stream 3 must grep all callers before dropping.
3. **Failed-send log behavior** — confirm `powder_alert_log` is only written on success, not after catch.

## Dependencies Between Streams

- Stream 5 runbook imports findings from Streams 1–4 (scenario 5 needs Stream 1's email provider identity; "where to look" needs Stream 4's dashboard URL). Runbook is written *last* even though the lead starts framing it early.
- Streams 1–4 are fully independent.

## Timeline (estimate)

Parallel execution via Agent Team:
- Streams 1–4 in parallel: ~1 working session
- Stream 5 follows (depends on outputs): ~0.5 working session
- Total: **~1.5 sessions** vs ~4 sessions serial

## Post-Launch

Once all gates green, sub-project #2 (Soft Launch Rollout) kicks off: Product Hunt submission, social media execution, V0 cost analysis, V0 retrospective → V0.5 planning. That gets its own brainstorming cycle.
