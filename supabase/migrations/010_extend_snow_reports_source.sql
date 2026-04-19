-- ─────────────────────────────────────────────────────────────
-- Migration 010 — extend snow_reports.source check constraint
--
-- The orchestrator (lib/pipeline/orchestrator.ts) writes blended
-- snow_reports rows with source='pipeline', but the initial
-- constraint from migration 001 only allowed ('snotel','manual','resort').
-- Extend the allowed set to include 'pipeline' so the multi-source
-- orchestrator can write to snow_reports.
-- ─────────────────────────────────────────────────────────────

alter table snow_reports drop constraint if exists snow_reports_source_check;

alter table snow_reports add constraint snow_reports_source_check
  check (source in ('snotel','manual','resort','pipeline'));
