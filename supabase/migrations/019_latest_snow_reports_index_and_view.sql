-- ─────────────────────────────────────────────────────────────
-- Migration 019 — index snow_reports and rewrite latest_snow_reports
--
-- WHY: in the 7 days to 2026-09-18 production logged 399 client-side
-- `TimeoutError … aborted due to timeout` (the 8 s AbortSignal in
-- lib/supabase.ts) across 8 users and 90 Postgres 57014 statement
-- timeouts across 7 users, on /, /map, /snow-report, /alerts and ~40
-- /resorts/* routes. Cause: `latest_snow_reports` (created in 001,
-- recreated in 013) is a `DISTINCT ON (resort_id)` over the whole
-- snow_reports table — 68,610 rows and growing by ~148/day from the
-- 6-hourly snotel-sync — while snow_reports carries only the two
-- single-column indexes from 001_initial.sql. Every getAllResorts()
-- across 154 ISR routes pays for it, against anon's 3 s
-- statement_timeout.
--
-- Measured with EXPLAIN on prod (2026-09-19, PostgreSQL 17.6):
--   DISTINCT ON today  → Unique over Incremental Sort over Index Scan
--                        (snow_reports_resort_idx), 68,222 rows,
--                        cost 77.84..12504.06
--   LATERAL today      → Nested Loop, cost 0.29..1497.32 but with an
--                        unbounded Index Scan on snow_reports_updated_idx
--                        filtered by resort_id — fine for resorts that
--                        report often, pathological for stale ones
--   LATERAL + the index below → the Limit 1 becomes a one-row lookup on
--                        (resort_id, updated_at desc); no sort, no scan
--                        of the other ~68k rows.
--
-- The view's ORDER BY column is `updated_at` (confirmed via
-- pg_get_viewdef), so the composite index matches it exactly.
--
-- SEMANTICS: `select latest.*` keeps the SELECT * column list frozen at
-- creation time, exactly as 013 did — the 21 columns of snow_reports as
-- of today. The note from 013 still stands: any migration that adds a
-- column to snow_reports MUST drop and recreate this view.
--
-- Driving the LATERAL from `resorts` rather than from the distinct
-- resort_ids in snow_reports avoids a second full scan. Prod check
-- 2026-09-19: 0 orphan snow_reports rows, 148 distinct resort_ids in
-- snow_reports, all 148 belonging to active resorts — so the row set is
-- identical to the DISTINCT ON version today.
--
-- security_invoker = true resolves the Supabase security advisor
-- `security_definer_view` ERROR for this view. It is safe here: anon and
-- authenticated both hold SELECT on snow_reports and resorts, and
-- snow_reports' RLS policy "Public snow_reports read" is `using (true)`.
-- One consequence to know: under the invoker's RLS, `resorts`' policy
-- `using (is_active = true)` applies, so an anon reader would no longer
-- see a report belonging to a deactivated resort. No such row exists
-- today, and every app read path already filters resorts on is_active.
-- (`resort_conditions_live` is flagged by the same advisor and is left
-- alone here — it belongs to the dormant pipeline.)
--
-- ROLLBACK:
--   drop view if exists public.latest_snow_reports;
--   create view public.latest_snow_reports as
--     select distinct on (resort_id) *
--     from snow_reports
--     order by resort_id, updated_at desc;
--   grant select on public.latest_snow_reports to anon, authenticated, service_role;
--   drop index if exists public.snow_reports_resort_updated_idx;
-- ─────────────────────────────────────────────────────────────

create index if not exists snow_reports_resort_updated_idx
  on public.snow_reports (resort_id, updated_at desc);

drop view if exists public.latest_snow_reports;

create view public.latest_snow_reports
  with (security_invoker = true)
as
  select latest.*
  from public.resorts r
  cross join lateral (
    select s.*
    from public.snow_reports s
    where s.resort_id = r.id
    order by s.updated_at desc
    limit 1
  ) latest;

-- Supabase default privileges already cover a view created by `postgres`
-- in `public`; granted explicitly so a recreate can never silently drop
-- the anon read the whole site depends on.
grant select on public.latest_snow_reports to anon, authenticated, service_role;
