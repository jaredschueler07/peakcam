-- ─────────────────────────────────────────────────────────────
-- PeakCam — Multi-Source Data Pipeline
-- Adds data_source_readings (raw evidence), resort_conditions_summary
-- (blended output), and resort_metadata (static geo/ops data).
-- ─────────────────────────────────────────────────────────────

-- ── data_source_readings ────────────────────────────────────
-- Every source writes here in a uniform shape. This is the
-- "raw evidence" table — one row per source per resort per day.

create table if not exists data_source_readings (
  id                uuid primary key default gen_random_uuid(),
  resort_id         uuid not null references resorts(id) on delete cascade,
  source            text not null
                    check (source in ('snotel','nws','liftie','snodas','weather_unlocked','openskistats','user_reports')),
  reading_date      date not null,
  fetched_at        timestamptz not null default now(),

  -- Snow measurements (inches)
  snow_depth_in     numeric(7,1),
  swe_in            numeric(6,1),
  new_snow_24h_in   numeric(5,1),
  new_snow_48h_in   numeric(5,1),

  -- Temperature (Fahrenheit)
  temp_f            numeric(5,1),
  temp_high_f       numeric(5,1),
  temp_low_f        numeric(5,1),

  -- Forecast / outlook
  forecast_snow_48h_in  numeric(5,1),
  forecast_high_48h_f   numeric(5,1),

  -- Lift / trail ops
  lifts_open        integer,
  lifts_total       integer,
  trails_open       integer,
  trails_total      integer,

  -- Qualitative signals (normalized 0.0–1.0)
  quality_score     numeric(3,2),
  visibility_score  numeric(3,2),
  wind_score        numeric(3,2),

  -- Weather observations
  sky_cover_pct     integer,
  wind_gust_mph     numeric(5,1),
  snow_level_ft     integer,

  -- Source confidence (0.0–1.0, set by the fetcher)
  source_confidence numeric(3,2) not null default 1.0,

  -- Raw payload for debugging
  raw_json          jsonb,

  unique (resort_id, source, reading_date)
);

create index on data_source_readings (resort_id, reading_date);
create index on data_source_readings (source, fetched_at);

alter table data_source_readings enable row level security;
create policy "Public readings read"
  on data_source_readings for select using (true);

-- ── resort_conditions_summary ───────────────────────────────
-- The blended output. One row per resort, updated by the
-- synthesis engine after each sync. This is what the UI reads.

create table if not exists resort_conditions_summary (
  resort_id             uuid primary key references resorts(id) on delete cascade,
  updated_at            timestamptz not null default now(),

  -- Blended snow measurements
  snow_depth_in         numeric(7,1),
  swe_in                numeric(6,1),
  new_snow_24h_in       numeric(5,1),
  new_snow_48h_in       numeric(5,1),
  pct_of_normal         integer,

  -- Blended forecast
  forecast_snow_48h_in  numeric(5,1),
  forecast_high_48h_f   numeric(5,1),

  -- Operations
  lifts_open            integer,
  lifts_total           integer,
  trails_open           integer,
  trails_total          integer,

  -- Conditions engine output
  cond_rating           text check (cond_rating in ('great','good','fair','poor')),
  trend_7d              text check (trend_7d in ('rising','falling','stable')),
  outlook               text check (outlook in ('more_snow','stable','warming','melt_risk')),
  outlook_label         text,
  tags                  text[],
  narrative             text,

  -- Confidence
  confidence_score      numeric(3,2),
  source_count          integer,
  sources_used          text[],

  -- Per-dimension confidence
  snow_depth_confidence numeric(3,2),
  forecast_confidence   numeric(3,2),
  ops_confidence        numeric(3,2)
);

alter table resort_conditions_summary enable row level security;
create policy "Public summary read"
  on resort_conditions_summary for select using (true);

-- ── resort_metadata ─────────────────────────────────────────
-- Static geospatial data from OpenSkiStats + manual mapping.
-- Links resorts to external source IDs (Liftie, Weather Unlocked, SNODAS grid).

create table if not exists resort_metadata (
  resort_id           uuid primary key references resorts(id) on delete cascade,
  openskistats_id     text,
  elevation_base_ft   integer,
  elevation_summit_ft integer,
  vertical_drop_ft    integer,
  run_count           integer,
  lift_count          integer,
  liftie_slug         text,
  weather_unlocked_id text,
  snodas_grid_x       integer,
  snodas_grid_y       integer,
  updated_at          timestamptz not null default now()
);

alter table resort_metadata enable row level security;
create policy "Public metadata read"
  on resort_metadata for select using (true);

-- ── snow_reports additions ──────────────────────────────────
-- Add confidence and source tracking to existing snow_reports.

alter table snow_reports
  add column if not exists confidence    numeric(3,2),
  add column if not exists source_count  integer,
  add column if not exists sources_used  text[];
