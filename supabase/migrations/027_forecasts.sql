-- ─────────────────────────────────────────────────────────────
-- Migration 027 — multi-model forecasts and their verification.
-- Parity plan 2026-10-18, block P0 (tables) for block P4 (the jobs).
--
-- WHY. The forecast on a resort page today is NWS text heuristics plus one
-- Open-Meteo model, fetched at render time and never stored, so there is
-- nothing to verify against. These tables keep every model run per resort
-- and point (summit / base), the daily values of each run, and a rolling
-- score per model (MAE at day 1/3/7 and a snowfall bias ratio against the
-- measured station total) so the site can blend models by skill and say
-- how good its forecast has been.
--
-- WRITERS. P4 forecast-sync job on the mini (service role) writes
-- `forecast_runs` + `forecast_daily`; the P4 verification job writes
-- `forecast_scores`. Nothing in the app writes these tables.
--
-- APPLY. By hand (SQL Editor / MCP apply_migration). Idempotent and
-- additive: safe to re-run; nothing is dropped or deleted.
-- Applied to production via the Supabase MCP on 2026-10-18.
-- ─────────────────────────────────────────────────────────────

-- ── 1. forecast_runs ────────────────────────────────────────
create table if not exists public.forecast_runs (
  id           uuid primary key default gen_random_uuid(),
  resort_id    uuid not null references public.resorts(id) on delete cascade,
  -- The elevation the run was fetched for.
  point        text not null check (point in ('summit', 'base')),
  -- Model identifier as the provider names it, e.g. `gfs_seamless`, `ecmwf_ifs025`, `blend`.
  model        text not null,
  issued_at    timestamptz not null,
  horizon_days integer not null
);

comment on table public.forecast_runs is
  'One row per (resort, point, model, issue time). Daily values hang off forecast_daily. Written by the P4 forecast-sync job with the service role; public read.';

-- "Latest run per resort" and "runs for this resort in the last N days".
create index if not exists forecast_runs_resort_issued_idx
  on public.forecast_runs (resort_id, issued_at desc);

-- ── 2. forecast_daily ───────────────────────────────────────
create table if not exists public.forecast_daily (
  run_id       uuid not null references public.forecast_runs(id) on delete cascade,
  date         date not null,
  -- Snowfall in centimetres as the models report it; the API converts.
  snowfall_cm  numeric,
  -- Spread across members / models for the blend row; null for a single model.
  snowfall_lo  numeric,
  snowfall_hi  numeric,
  temp_max     numeric,
  temp_min     numeric,
  precip_prob  numeric,
  wind_gust    numeric,
  -- WMO weather interpretation code (Open-Meteo `weather_code`).
  weather_code integer,
  primary key (run_id, date)
);

comment on table public.forecast_daily is
  'Per-day values of a forecast run. Units follow the provider (cm, °C, km/h, %); the public API converts. Written with its run by the P4 job; public read.';

-- ── 3. forecast_scores ──────────────────────────────────────
create table if not exists public.forecast_scores (
  resort_id   uuid not null references public.resorts(id) on delete cascade,
  model       text not null,
  -- The trailing window the score covers, in days (e.g. 30, 90).
  period_days integer not null,
  -- Mean absolute error of the day-1/3/7 snowfall forecast against the
  -- measured station total, in the same unit as forecast_daily.snowfall_cm.
  day1_mae    numeric,
  day3_mae    numeric,
  day7_mae    numeric,
  -- Forecast/observation pairs the score is built on.
  samples     integer,
  -- Sum(forecast) / sum(observed) over the window; >1 = the model over-forecasts snow.
  bias_ratio  numeric,
  computed_at timestamptz not null default now(),
  primary key (resort_id, model, period_days)
);

comment on table public.forecast_scores is
  'Rolling verification per (resort, model, window): MAE at day 1/3/7 and bias ratio. Rewritten by the P4 verification job with the service role; public read.';

-- ── RLS: public read, service-role writes ───────────────────
alter table public.forecast_runs   enable row level security;
alter table public.forecast_daily  enable row level security;
alter table public.forecast_scores enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'forecast_runs' and policyname = 'Public forecast_runs read'
  ) then
    create policy "Public forecast_runs read" on public.forecast_runs for select using (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'forecast_daily' and policyname = 'Public forecast_daily read'
  ) then
    create policy "Public forecast_daily read" on public.forecast_daily for select using (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'forecast_scores' and policyname = 'Public forecast_scores read'
  ) then
    create policy "Public forecast_scores read" on public.forecast_scores for select using (true);
  end if;
end $$;

grant select on public.forecast_runs, public.forecast_daily, public.forecast_scores to anon, authenticated;
