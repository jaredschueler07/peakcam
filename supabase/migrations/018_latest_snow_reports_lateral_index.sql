-- ─────────────────────────────────────────────────────────────
-- Migration 018 — make latest_snow_reports index-friendly, and
-- close the open security-advisor items.
--
-- WHY. The anon role runs with statement_timeout = 3s. The browse,
-- map and snow-report pages all read latest_snow_reports, which was
-- `SELECT DISTINCT ON (resort_id) … ORDER BY resort_id, updated_at DESC`
-- over the append-only snow_reports table (~70k rows, +~560/day).
-- That plan is a full index scan + incremental sort touching ~66k
-- buffers on every call; pg_stat_statements showed it averaging
-- 626ms with a 2.9s max over 12k calls, and Vercel logged hundreds
-- of "canceling statement due to statement timeout" / fetch-abort
-- errors on / , /map and /snow-report (Aug 4 → Sep 22 2026).
--
-- FIX. (1) A composite (resort_id, updated_at DESC) index, and
-- (2) rewrite the view as a per-resort LATERAL "latest row" lookup,
-- which the planner turns into ~148 index probes (≈1ms) instead of a
-- 70k-row sort. Column list is explicit and identical to the old view
-- (see migration 013's note: adding a column to snow_reports still
-- requires recreating this view).
--
-- SECURITY. Both views become security_invoker so RLS is evaluated
-- as the caller (Supabase advisor 0010). snow_reports, resorts and
-- condition_votes all carry public-read policies, so anon results
-- are unchanged. rls_auto_enable() is Supabase's own DDL event
-- trigger; it never needs to be callable over the REST API, so
-- EXECUTE is revoked from anon/authenticated/public (advisors 0028
-- and 0029). drop_in_immutable_morning() gets a pinned search_path
-- (advisor 0011).
--
-- APPLY. By hand (SQL Editor / MCP apply_migration), like every
-- other migration in this repo. Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- 1. Composite index: one probe per resort for "latest report".
create index if not exists snow_reports_resort_updated_idx
  on public.snow_reports (resort_id, updated_at desc);

-- 2. Rewrite the view. Rows come from resorts (all rows, active or
--    not — same set the old DISTINCT ON produced for any resort that
--    has at least one report).
drop view if exists public.latest_snow_reports;

create view public.latest_snow_reports
  with (security_invoker = true)
as
  select
    l.id,
    l.resort_id,
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

grant select on public.latest_snow_reports to anon, authenticated, service_role;

-- 3. The crowd-vote view only needs the invoker flag.
alter view public.resort_conditions_live set (security_invoker = true);

-- 4. Advisor cleanups.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
alter function public.drop_in_immutable_morning() set search_path = public;
