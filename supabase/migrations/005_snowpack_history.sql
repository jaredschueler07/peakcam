-- ─────────────────────────────────────────────────────────────
-- PeakCam — Snowpack History & Conditions Engine
-- Adds snowpack_daily, snotel_normals tables and new
-- columns on snow_reports for automated conditions.
-- ─────────────────────────────────────────────────────────────

-- ── snowpack_daily ──────────────────────────────────────────
create table if not exists snowpack_daily (
  resort_id       uuid not null references resorts(id) on delete cascade,
  station_id      text not null,
  date            date not null,
  snow_depth_in   integer,
  swe_in          numeric(6,1),
  precip_accum_in numeric(6,1),
  temp_obs_f      integer,
  temp_max_f      integer,
  temp_min_f      integer,
  qc_flag         text not null default 'valid'
                  check (qc_flag in ('valid','suspect','missing','corrected')),
  created_at      timestamptz not null default now(),
  primary key (resort_id, date)
);

alter table snowpack_daily enable row level security;
create policy "Public snowpack_daily read"
  on snowpack_daily for select using (true);

-- ── snotel_normals ──────────────────────────────────────────
create table if not exists snotel_normals (
  station_id        text not null,
  day_of_water_year integer not null check (day_of_water_year between 1 and 366),
  median_swe_in     numeric(6,1),
  median_depth_in   integer,
  pctile_10_swe_in  numeric(6,1),
  pctile_90_swe_in  numeric(6,1),
  refreshed_at      timestamptz not null default now(),
  primary key (station_id, day_of_water_year)
);

alter table snotel_normals enable row level security;
create policy "Public snotel_normals read"
  on snotel_normals for select using (true);

-- ── snow_reports additions ──────────────────────────────────
alter table snow_reports
  add column if not exists swe_in           numeric(6,1),
  add column if not exists pct_of_normal    integer,
  add column if not exists trend_7d         text
    check (trend_7d in ('rising','falling','stable')),
  add column if not exists outlook          text
    check (outlook in ('more_snow','stable','warming','melt_risk')),
  add column if not exists auto_cond_rating text
    check (auto_cond_rating in ('great','good','fair','poor'));
