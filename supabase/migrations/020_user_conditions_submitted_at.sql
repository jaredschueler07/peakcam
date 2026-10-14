-- ─────────────────────────────────────────────────────────────
-- Migration 020 — restore user_conditions.submitted_at
--
-- WHY: 004_user_conditions.sql:24 defines `submitted_at timestamptz
-- not null default now()`, but the live table drifted and never got it.
-- Confirmed read-only against project owsxnogvufankayfwczl on
-- 2026-09-19: public.user_conditions has exactly
-- id, resort_id, user_id, snow_quality, visibility, wind,
-- trail_conditions, notes, is_flagged, created_at — no submitted_at.
--
-- Six code paths select or order by it, and all three fail closed or
-- fail open silently:
--   lib/supabase.ts getUserConditions      → PostgREST 42703, warned and
--                                            swallowed, so community
--                                            reports never render on
--                                            /resorts/[slug]
--   lib/user-conditions/rate-limit.ts      → fails open, so the
--                                            1-report-per-hour cooldown in
--                                            app/api/user-conditions/submit
--                                            is never enforced
--   scripts/snotel-sync.ts                 → the user-report half of the
--                                            70/30 blend is always []
--
-- Backfilling from created_at is exact: created_at defaults to now() on
-- insert, which is what submitted_at would have recorded.
--
-- ROLLBACK:
--   drop index if exists public.user_conditions_resort_submitted_idx;
--   alter table public.user_conditions drop column if exists submitted_at;
-- ─────────────────────────────────────────────────────────────

alter table public.user_conditions
  add column if not exists submitted_at timestamptz not null default now();

update public.user_conditions
  set submitted_at = created_at
  where created_at is not null and submitted_at <> created_at;

create index if not exists user_conditions_resort_submitted_idx
  on public.user_conditions (resort_id, submitted_at desc);
