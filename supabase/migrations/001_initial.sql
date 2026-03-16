-- ─────────────────────────────────────────────────────────────
-- PeakCam — Initial Schema
-- Run in: Supabase → SQL Editor
-- ─────────────────────────────────────────────────────────────

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ── resorts ──────────────────────────────────────────────────
create table if not exists resorts (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  slug                text not null unique,
  state               text not null,           -- e.g. "CO", "UT", "CA"
  region              text not null,           -- e.g. "Colorado Rockies"
  lat                 numeric(9,6) not null,
  lng                 numeric(9,6) not null,
  website_url         text,
  cam_page_url        text,                    -- direct URL to resort's webcam page
  cond_rating         text not null default 'good'
                      check (cond_rating in ('great','good','fair','poor')),
  snotel_station_id   text,                    -- NRCS station ID for snowpack data
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);

create index if not exists resorts_slug_idx  on resorts (slug);
create index if not exists resorts_state_idx on resorts (state);
create index if not exists resorts_active_idx on resorts (is_active);

-- ── cams ─────────────────────────────────────────────────────
create table if not exists cams (
  id                  uuid primary key default gen_random_uuid(),
  resort_id           uuid not null references resorts(id) on delete cascade,
  name                text not null,
  elevation           text,                    -- display string e.g. "11,250 ft"
  embed_type          text not null
                      check (embed_type in ('youtube','iframe','link')),
  embed_url           text,                    -- iframe src or link-out URL
  youtube_id          text,                    -- YouTube video/stream ID only
  is_active           boolean not null default true,
  last_checked_at     timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists cams_resort_idx  on cams (resort_id);
create index if not exists cams_active_idx  on cams (is_active);

-- ── snow_reports ─────────────────────────────────────────────
create table if not exists snow_reports (
  id                  uuid primary key default gen_random_uuid(),
  resort_id           uuid not null references resorts(id) on delete cascade,
  base_depth          integer,                 -- inches
  new_snow_24h        integer,                 -- inches
  new_snow_48h        integer,                 -- inches
  trails_open         integer,
  trails_total        integer,
  lifts_open          integer,
  lifts_total         integer,
  conditions          text,                    -- "Powder Day", "Groomed", etc.
  source              text not null default 'manual'
                      check (source in ('snotel','manual','resort')),
  updated_at          timestamptz not null default now()
);

create index if not exists snow_reports_resort_idx   on snow_reports (resort_id);
create index if not exists snow_reports_updated_idx  on snow_reports (updated_at desc);

-- ── Row Level Security ────────────────────────────────────────
-- Public read-only access. Writes only via service role key.

alter table resorts      enable row level security;
alter table cams         enable row level security;
alter table snow_reports enable row level security;

-- Anyone can read active records
create policy "Public resorts read"
  on resorts for select
  using (is_active = true);

create policy "Public cams read"
  on cams for select
  using (is_active = true);

create policy "Public snow_reports read"
  on snow_reports for select
  using (true);

-- ── Helpful views ─────────────────────────────────────────────

-- Latest snow report per resort (used by the browse page)
create or replace view latest_snow_reports as
  select distinct on (resort_id) *
  from snow_reports
  order by resort_id, updated_at desc;
