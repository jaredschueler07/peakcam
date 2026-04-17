# V0 Launch Gate Check — 2026-04-17

Autonomous phase of Sprint 4 complete. 4 items remain, all requiring human action. No code work blocks launch.

## Gate Status

| Gate | Status | Evidence |
|---|---|---|
| Alerts verified end-to-end | 🟡 PARTIAL | Provider (Resend) identified, E2E script written, failed-send behavior verified correct (`docs/alerts-verification.md`). **Blocked on inbox E2E run (human).** |
| QA smoke on 3 browsers | 🟡 SCAFFOLD READY | Template at `docs/qa-smoke-2026-04-17.md`. **Blocked on cross-browser runs (human).** |
| Data pipeline populating | 🔴 BLOCKED | Empty tables confirmed. Orchestrator wired, entry point identified, launchd plist prepared (Disabled). **Blocked on migration 010 apply (human) + seed-openskistats run (human).** |
| PostHog funnels firing | 🟡 EVENTS WIRED | 9 events instrumented via `lib/analytics-events.ts`; TDD test passes. **Blocked on dashboard configuration in PostHog UI (human).** |
| Runbook written | 🟢 DONE | `docs/runbook.md` — 5 incident scenarios, secrets map, known issues backlog. PostHog dashboard URL TBD pending gate 4. |

## Human Actions to Unblock

All four items require human hands-on-keyboard. None depends on the others.

1. **Apply migration 010** — Supabase MCP `apply_migration` or SQL editor:
   ```sql
   -- File: supabase/migrations/010_extend_snow_reports_source.sql
   ```
   Then run `npx tsx scripts/seed-openskistats.ts` to populate `resort_metadata`.
   Then `launchctl load ~/Library/LaunchAgents/com.peakcam.pipeline.plist` (after editing out `Disabled=true`).

2. **Inbox E2E (Task 1.3)** — run:
   ```bash
   node scripts/alert-e2e-test.mjs --email you+test@domain.com --resort-slug <slug>
   ```
   Tick the checklist in `docs/alerts-verification.md`.

3. **Cross-browser smoke (Task 2.2–2.4)** — walk the 13-interaction checklist in `docs/qa-smoke-2026-04-17.md` on mobile Safari, Chrome (desktop + mobile), Firefox. Fix P0/P1, file P2s to TASKS.md V0.5.

4. **PostHog dashboard (Task 4.7)** — build the 4 funnels + 3 trends tiles in PostHog UI. Paste the dashboard URL into `docs/runbook.md` (replace `**TBD**`).

## Ship Decision

☐ All five gates green → SHIP (proceed to sub-project #2 Soft Launch Rollout)
☒ Blockers remain → 4 human actions above

## Estimated Time to Green

- Migration apply + seed + launchd enable: ~10 minutes
- Inbox E2E: ~5 minutes
- Cross-browser smoke: ~60–90 minutes (real work — needs physical devices)
- PostHog dashboard: ~20 minutes

**Realistic ship window:** 2–3 hours of focused human work.

## What Landed in This Sprint (Autonomous)

- 24 commits on branch `feat/launch-readiness`
- 2 new scripts: `pipeline-inspect.mjs`, `pipeline-backfill.ts`, `alert-e2e-test.mjs`
- 1 new lib module: `lib/analytics-events.ts` (+ test)
- 9 PostHog events wired across 5 component files
- 1 migration pending: `010_extend_snow_reports_source.sql`
- 1 launchd plist prepared: `com.peakcam.pipeline.plist` (Disabled)
- 4 new docs: alerts-verification, qa-smoke, data-pipeline-status, runbook, launch-gate-check
- 3 secondary bugs surfaced in pipeline discovery (filed to fast-follow)
