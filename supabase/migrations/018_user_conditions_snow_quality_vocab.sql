-- ─────────────────────────────────────────────────────────────
-- Migration 018 — user_conditions.snow_quality vocabulary
--
-- ALREADY APPLIED TO PROD (~2026-09-02, by hand, out of band).
-- This file exists only to record the change; the drop/add pair is
-- idempotent, so re-running it is a no-op. Verified against project
-- owsxnogvufankayfwczl on 2026-09-19 (live CHECK already lists
-- powder/packed/crud/ice/spring).
--
-- 004_user_conditions.sql constrained snow_quality to
-- ('powder','packed','icy','slush'), but lib/types.ts, the submit
-- route and UserConditionsForm all use
-- ('powder','packed','crud','ice','spring') — the same set
-- 002_condition_votes.sql uses. Constraint name is the Postgres
-- default for an inline column check.
--
-- Rollback:
--   alter table user_conditions drop constraint if exists user_conditions_snow_quality_check;
--   alter table user_conditions add constraint user_conditions_snow_quality_check
--     check (snow_quality in ('powder', 'packed', 'icy', 'slush'));
-- ─────────────────────────────────────────────────────────────

alter table user_conditions
  drop constraint if exists user_conditions_snow_quality_check;

alter table user_conditions
  add constraint user_conditions_snow_quality_check
  check (snow_quality in ('powder', 'packed', 'crud', 'ice', 'spring'));
