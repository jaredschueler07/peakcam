-- ─────────────────────────────────────────────────────────────
-- Migration 029 — let a per-resort filter on latest_snow_reports
-- push down to one index probe.
--
-- WHY. Migration 018 rewrote the view as resorts CROSS JOIN LATERAL
-- (latest snow_reports row per resort), which made the all-resorts
-- read ~148 index probes. But the view exposed the LATERAL side's
-- `s.resort_id`, so `WHERE resort_id = $1` (the resort page, the v1
-- resort route, the MCP tools, the alert trigger's `resort_id=in.(…)`)
-- could not be pushed into the resorts scan: Postgres probed all 148
-- resorts and filtered afterwards. pg_stat_statements on 2026-10-18:
-- 12,045 calls, mean 626 ms, max 2.9 s. Under build-time concurrency
-- (nine prerender workers × 148 pages) that became 8 s fetch timeouts
-- in `generateStaticParams`/page data collection and failed Vercel
-- builds for commits that changed nothing on the page.
--
-- FIX. Expose `r.id AS resort_id` (the resorts side) instead of
-- `l.resort_id`. Same values, same column list, same order, same
-- types; the planner now turns `resort_id = $1` into one resorts_pkey
-- probe plus one snow_reports_resort_updated_idx probe (8 buffers,
-- EXPLAIN ANALYZE 20 ms under load vs 1,022 ms before). The
-- all-resorts plan is unchanged.
--
-- APPLY. By hand (SQL Editor / MCP apply_migration). Safe to re-run.
-- security_invoker stays on (migration 018); grants survive
-- CREATE OR REPLACE VIEW.
-- ─────────────────────────────────────────────────────────────

create or replace view public.latest_snow_reports
with (security_invoker = true) as
select
  l.id,
  r.id as resort_id,
  l.base_depth,
  l.new_snow_24h,
  l.new_snow_48h,
  l.trails_open,
  l.trails_total,
  l.lifts_open,
  l.lifts_total,
  l.conditions,
  l.source,
  l.updated_at,
  l.swe_in,
  l.pct_of_normal,
  l.trend_7d,
  l.outlook,
  l.auto_cond_rating,
  l.snowing_now,
  l.confidence,
  l.source_count,
  l.sources_used
from public.resorts r
cross join lateral (
  select s.*
  from public.snow_reports s
  where s.resort_id = r.id
  order by s.updated_at desc
  limit 1
) l;

comment on view public.latest_snow_reports is
  'Latest snow_reports row per resort. resort_id comes from resorts.id so a per-resort filter pushes down to one index probe (migration 029).';
