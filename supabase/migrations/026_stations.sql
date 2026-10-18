-- ─────────────────────────────────────────────────────────────
-- Migration 026 — the station layer: observation stations, their link to
-- resorts, and raw observations. Parity plan 2026-10-18, block P0 (tables)
-- for block P3 (the jobs that fill them).
--
-- WHY. Today a resort has at most one measured source: `resorts.
-- snotel_station_id` plus `snowpack_daily`, both SNOTEL-only and daily.
-- SnowSure publishes up to three observation sources per resort (METAR, NWS
-- obs, road cams, SNOTEL, ECCC, …) at their own cadence. These tables hold
-- any station of any kind, which resorts it serves and in what role, and the
-- sub-daily observations as they arrive. `snowpack_daily` stays the daily QC
-- product; nothing here replaces it.
--
-- WRITERS. P3 sync jobs on the mini (service role): station discovery writes
-- `stations` and `resort_stations`; per-source fetchers append
-- `station_observations`. Nothing in the app writes these tables.
--
-- APPLY. By hand (SQL Editor / MCP apply_migration). Idempotent and
-- additive: safe to re-run; nothing is dropped or deleted.
-- Applied to production via the Supabase MCP on 2026-10-18.
-- ─────────────────────────────────────────────────────────────

-- ── 1. stations ─────────────────────────────────────────────
create table if not exists public.stations (
  id           uuid primary key default gen_random_uuid(),
  -- Network / provider the station belongs to, e.g. `nrcs`, `nws`, `eccc`, `udot`.
  source       text not null,
  -- The provider's own identifier (SNOTEL triplet, ICAO code, GHCN id, cam id).
  source_id    text not null,
  name         text,
  lat          double precision,
  lng          double precision,
  elevation_ft integer,
  kind         text not null
               check (kind in ('snotel', 'scan', 'nws_obs', 'metar', 'ghcn', 'bc_asws', 'eccc', 'road_cam')),
  unique (source, source_id)
);

comment on table public.stations is
  'Observation stations of every kind (SNOTEL, SCAN, NWS obs, METAR, GHCN, BC ASWS, ECCC, road cams). Written by the P3 station-discovery job with the service role; public read.';

-- ── 2. resort_stations ──────────────────────────────────────
create table if not exists public.resort_stations (
  resort_id   uuid not null references public.resorts(id)  on delete cascade,
  station_id  uuid not null references public.stations(id) on delete cascade,
  -- Where the station sits relative to the resort.
  role        text not null check (role in ('summit', 'mid', 'base', 'approach')),
  distance_km numeric,
  -- 1 = the preferred station for this role; the API shows the lowest rank.
  rank        integer not null default 1,
  primary key (resort_id, station_id)
);

comment on table public.resort_stations is
  'Which stations serve which resort and in what role (summit | mid | base | approach), ranked. Written by the P3 station-discovery job; public read.';

create index if not exists resort_stations_station_idx on public.resort_stations (station_id);

-- ── 3. station_observations ─────────────────────────────────
create table if not exists public.station_observations (
  station_id     uuid not null references public.stations(id) on delete cascade,
  observed_at    timestamptz not null,
  snow_depth_in  numeric,
  swe_in         numeric,
  new_snow_in    numeric,
  temp_f         numeric,
  wind_mph       numeric,
  -- The provider's record as fetched, for re-parsing without a re-fetch.
  source_payload jsonb,
  primary key (station_id, observed_at)
);

comment on table public.station_observations is
  'Raw observations per station, sub-daily. The primary key (station_id, observed_at) is the index every read uses ("latest N for this station", a backward scan); no separate desc index is needed. Appended by the P3 fetchers with the service role; public read.';

-- ── RLS: public read, service-role writes ───────────────────
alter table public.stations             enable row level security;
alter table public.resort_stations      enable row level security;
alter table public.station_observations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stations' and policyname = 'Public stations read'
  ) then
    create policy "Public stations read" on public.stations for select using (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'resort_stations' and policyname = 'Public resort_stations read'
  ) then
    create policy "Public resort_stations read" on public.resort_stations for select using (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'station_observations' and policyname = 'Public station_observations read'
  ) then
    create policy "Public station_observations read" on public.station_observations for select using (true);
  end if;
end $$;

grant select on public.stations, public.resort_stations, public.station_observations to anon, authenticated;
