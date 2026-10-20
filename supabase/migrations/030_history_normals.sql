-- ─────────────────────────────────────────────────────────────
-- Migration 030 — season history: daily new snow, cumulative and
-- monthly normals, and the season_stats function.
-- Parity plan 2026-10-18, block P5.
--
-- WHY. `snowpack_daily` (005) holds one QC'd row per resort per day but no
-- daily new-snow value, and `snotel_normals` (005, prod shape: median_swe,
-- p10/p90_swe, median_depth, p10/p90_depth) describes the snowpack on a day,
-- not how much snow has fallen by that day. A season curve against a normal
-- band, monthly climatology and season-to-date stats need both. The backfill
-- (`scripts/snotel-backfill.ts`) fills ten water years of daily rows; the
-- normals seed (`scripts/seed-snotel-normals.ts`) fills the new columns and
-- the monthly table from the station's period of record.
--
-- The plan's `season_stats` view is a function instead: its powder-day
-- threshold is an editorial call (plan §4), so the TypeScript constant
-- `POWDER_DAY_IN` in lib/season-stats.ts is passed in as `powder_in` and the
-- number lives in exactly one place.
--
-- WRITERS. The two scripts above and `scripts/snotel-sync.ts` (new_snow_in on
-- today's row), all with the service role. Nothing in the app writes here.
--
-- APPLY. By hand (SQL Editor / MCP apply_migration). Idempotent and
-- additive: safe to re-run; nothing is dropped or deleted.
-- ─────────────────────────────────────────────────────────────

-- ── snowpack_daily.new_snow_in ──────────────────────────────
-- Positive day-over-day change in QC'd snow depth, inches (the same rule
-- snotel-sync uses for new_snow_24h). Null when either day is missing.
alter table public.snowpack_daily
  add column if not exists new_snow_in numeric(5,1);

comment on column public.snowpack_daily.new_snow_in is
  'Daily new snow, inches: max(0, depth today - depth yesterday) on QC''d depths. Null when either day is missing. Written by snotel-backfill and snotel-sync.';

-- The season_stats function and the history reads filter on date; the PK is
-- (resort_id, date) so a date-only predicate had no index.
create index if not exists snowpack_daily_date_idx on public.snowpack_daily (date desc);

-- ── snotel_normals: cumulative new-snow normal by day of water year ──
alter table public.snotel_normals
  add column if not exists cum_snow_mean_in        numeric(6,1),
  add column if not exists cum_snow_p25_in         numeric(6,1),
  add column if not exists cum_snow_p75_in         numeric(6,1),
  add column if not exists cum_snow_years          integer,
  add column if not exists cum_snow_recent_mean_in numeric(6,1),
  add column if not exists cum_snow_recent_years   integer;

comment on column public.snotel_normals.cum_snow_mean_in is
  'Mean cumulative new snow (inches) from Oct 1 to this day of the water year over the 30 most recent complete winters with a usable record (cum_snow_years says how many).';
comment on column public.snotel_normals.cum_snow_recent_mean_in is
  'Same, over the 10 most recent complete winters (cum_snow_recent_years).';

-- ── snotel_monthly_normals ──────────────────────────────────
create table if not exists public.snotel_monthly_normals (
  station_id       text not null,
  month            integer not null check (month between 1 and 12),
  -- '30yr' = the 30 most recent complete winters; '10yr' = the 10 most recent.
  "window"         text not null check ("window" in ('30yr', '10yr')),
  avg_snowfall_in  numeric(6,1),
  avg_snow_days    numeric(4,1),
  avg_depth_in     numeric(6,1),
  max_storm_in     numeric(6,1),
  max_storm_start  date,
  max_storm_end    date,
  years_tracked    integer not null default 0,
  refreshed_at     timestamptz not null default now(),
  primary key (station_id, month, "window")
);

comment on table public.snotel_monthly_normals is
  'Monthly snowfall climatology per SNOTEL station from PeakCam''s daily new-snow derivation: average monthly snowfall, snow days (>= 1 in), average depth and the biggest storm, over the 30 and 10 most recent complete winters. Written by seed-snotel-normals; public read.';

alter table public.snotel_monthly_normals enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'snotel_monthly_normals' and policyname = 'Public snotel_monthly_normals read'
  ) then
    create policy "Public snotel_monthly_normals read" on public.snotel_monthly_normals for select using (true);
  end if;
end $$;

grant select on public.snotel_monthly_normals to anon, authenticated;

-- ── season_stats(powder_in, season_start, week_start) ───────
-- Per-resort season-to-date aggregates over snowpack_daily, for the
-- leaderboards (/snow-report/season-snowfall, season-powder-days,
-- best-powder-this-week) and /api/v1/leaderboards/{kind}. Defaults: the
-- current Northern-hemisphere water year (Oct 1) and the last 7 days.
create or replace function public.season_stats(
  powder_in    numeric default 8,
  season_start date    default null,
  week_start   date    default null
)
returns table (
  resort_id        uuid,
  station_id       text,
  season_total_in  numeric,
  snow_days        integer,
  powder_days      integer,
  days_measured    integer,
  deepest_base_in  numeric,
  deepest_base_date date,
  week_total_in    numeric,
  last_date        date,
  latest_depth_in  numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      coalesce(
        season_start,
        make_date(
          (extract(year from current_date))::int - case when extract(month from current_date) >= 10 then 0 else 1 end,
          10, 1)
      ) as s0,
      coalesce(week_start, current_date - 6) as w0
  ),
  season as (
    select d.resort_id, d.station_id, d.date, d.snow_depth_in, d.new_snow_in
    from snowpack_daily d, params p
    where d.date >= p.s0
  ),
  agg as (
    select
      s.resort_id,
      coalesce(sum(s.new_snow_in), 0)                                            as season_total_in,
      count(*) filter (where s.new_snow_in >= 1)                                 as snow_days,
      count(*) filter (where s.new_snow_in >= powder_in)                         as powder_days,
      count(*) filter (where s.snow_depth_in is not null)                        as days_measured,
      max(s.snow_depth_in)                                                       as deepest_base_in,
      coalesce(sum(s.new_snow_in) filter (where s.date >= (select w0 from params)), 0) as week_total_in,
      max(s.date)                                                                as last_date
    from season s
    group by s.resort_id
  )
  select
    a.resort_id,
    l.station_id,
    a.season_total_in,
    a.snow_days::integer,
    a.powder_days::integer,
    a.days_measured::integer,
    a.deepest_base_in,
    (select min(x.date) from season x where x.resort_id = a.resort_id and x.snow_depth_in = a.deepest_base_in) as deepest_base_date,
    a.week_total_in,
    a.last_date,
    l.snow_depth_in as latest_depth_in
  from agg a
  join snowpack_daily l on l.resort_id = a.resort_id and l.date = a.last_date;
$$;

comment on function public.season_stats(numeric, date, date) is
  'Season-to-date snowfall, snow and powder days, days measured, deepest base and last-7-day total per resort from snowpack_daily. powder_in is passed by the caller (lib/season-stats.ts POWDER_DAY_IN) so the threshold lives in one place.';

grant execute on function public.season_stats(numeric, date, date) to anon, authenticated;
