-- ─────────────────────────────────────────────────────────────
-- Migration 025 — resort profile columns, cam metadata, cam timelapses.
-- Parity plan 2026-10-18, block P0 (docs/research/ai-assistant-first/).
--
-- WHY. The identity fields SnowSure publishes per resort (runs, lifts, acres,
-- vertical, annual snowfall, longest run, a description, aliases, pass
-- membership, trail-map link) have no home in the schema: `resorts` carries
-- name, location and links only. `elevation_base_ft`/`elevation_summit_ft`
-- live on `resort_metadata` (007, the dormant pipeline's table) while the
-- importer reads them from data/resorts.csv. This migration gives the whole
-- profile one home on `resorts` and backfills the elevations from
-- `resort_metadata` so nothing is lost. `resort_metadata` is left as is;
-- consumers move over in later blocks (P2) and it can be retired afterwards.
--
-- Cams get the three metadata columns P8 needs (what the cam looks at, the
-- credit line and the operator's terms URL) and a `cam_timelapses` table for
-- the 24 h / storm clips the mini will render.
--
-- WRITERS. `resorts.*` profile columns: scripts/import-resorts-standalone.mjs
-- (CSV) and, later, the P2 enrichment job. `cams.kind/credit/source_terms_url`:
-- the same importer. `cam_timelapses`: the P8 timelapse job on the mini
-- (service role). Nothing in the app writes any of these.
--
-- APPLY. By hand (SQL Editor / MCP apply_migration) like every file here.
-- Idempotent and additive: safe to re-run; nothing is dropped or deleted.
-- Applied to production via the Supabase MCP on 2026-10-18.
-- ─────────────────────────────────────────────────────────────

-- ── 1. resorts: profile columns ─────────────────────────────
alter table public.resorts
  add column if not exists runs_total          integer,
  add column if not exists lifts_total         integer,
  add column if not exists skiable_acres       numeric,
  add column if not exists vertical_ft         integer,
  add column if not exists annual_snowfall_in  numeric,
  add column if not exists longest_run_mi      numeric,
  add column if not exists description         text,
  -- Who wrote `description`: the operator's own copy, a generated draft
  -- (labelled on the page), or an editor's hand-written text.
  add column if not exists description_source  text,
  add column if not exists trail_map_url       text,
  add column if not exists wikidata_id         text,
  -- Other names the resort is known by ("A-Basin", "Squaw"), for search and
  -- for matching an assistant's question to a slug.
  add column if not exists aliases             text[] not null default '{}',
  -- Multi-resort passes the resort is on.
  add column if not exists passes              text[] not null default '{}',
  add column if not exists elevation_base_ft   integer,
  add column if not exists elevation_summit_ft integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'resorts_description_source_check') then
    alter table public.resorts
      add constraint resorts_description_source_check
      check (description_source is null or description_source in ('operator', 'generated', 'editor'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'resorts_passes_check') then
    alter table public.resorts
      add constraint resorts_passes_check
      check (passes <@ array['ikon', 'epic', 'mountain-collective', 'indy', 'power']::text[]);
  end if;
end $$;

comment on column public.resorts.description_source is
  'operator = the resort''s own copy, generated = model-written draft (labelled on the page), editor = hand-written. Null when description is null.';
comment on column public.resorts.aliases is
  'Alternative names for search and assistant matching, e.g. {"A-Basin","Arapahoe Basin"}.';
comment on column public.resorts.passes is
  'Multi-resort passes: ikon | epic | mountain-collective | indy | power.';
comment on column public.resorts.elevation_base_ft is
  'Base elevation in feet. Canonical home from migration 025; resort_metadata.elevation_base_ft is the legacy copy.';
comment on column public.resorts.elevation_summit_ft is
  'Summit elevation in feet. Canonical home from migration 025; resort_metadata.elevation_summit_ft is the legacy copy.';

-- Backfill elevations from resort_metadata where resorts has none. Never
-- overwrites a value already on resorts, so a re-run is a no-op.
update public.resorts r
set elevation_base_ft   = coalesce(r.elevation_base_ft,   m.elevation_base_ft),
    elevation_summit_ft = coalesce(r.elevation_summit_ft, m.elevation_summit_ft)
from public.resort_metadata m
where m.resort_id = r.id
  and (
    (r.elevation_base_ft   is null and m.elevation_base_ft   is not null) or
    (r.elevation_summit_ft is null and m.elevation_summit_ft is not null)
  );

-- ── 2. cams: what the cam shows, credit, terms ──────────────
alter table public.cams
  add column if not exists kind             text,
  add column if not exists credit           text,
  add column if not exists source_terms_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cams_kind_check') then
    alter table public.cams
      add constraint cams_kind_check
      check (kind is null or kind in ('summit', 'mid', 'base', 'snow-stake', 'village', 'approach'));
  end if;
end $$;

comment on column public.cams.kind is
  'What the cam looks at: summit | mid | base | snow-stake | village | approach (road). Null = not classified.';
comment on column public.cams.credit is
  'Attribution line to show with the frame, e.g. "Courtesy Vail Resorts". Null = the resort name.';
comment on column public.cams.source_terms_url is
  'The operator''s terms page governing reuse of this feed, when known.';

-- ── 3. cam_timelapses ───────────────────────────────────────
create table if not exists public.cam_timelapses (
  id          uuid primary key default gen_random_uuid(),
  cam_id      uuid not null references public.cams(id) on delete cascade,
  -- Which clip this is: `24h` (rolling day), `storm` (one storm, see
  -- storm_date), or another label the render job defines. Quoted because
  -- WINDOW is a reserved word in Postgres; supabase-js/PostgREST quote it
  -- for you, raw SQL must write "window".
  "window"    text not null,
  -- Public object URL (Supabase Storage) of the rendered MP4.
  url         text not null,
  frames      integer,
  rendered_at timestamptz not null default now(),
  -- The storm day a `storm` clip covers; null for rolling clips.
  storm_date  date
);

comment on table public.cam_timelapses is
  'Rendered timelapse clips per cam (24 h rolling, storm reels). Written by the P8 timelapse job on the mini with the service role; public read.';

-- "Latest clip of each kind for this cam" is the only read.
create index if not exists cam_timelapses_cam_window_idx
  on public.cam_timelapses (cam_id, "window", rendered_at desc);

alter table public.cam_timelapses enable row level security;

-- Public read; the service role bypasses RLS for writes. No insert/update/
-- delete policy, so anon and authenticated clients cannot write.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'cam_timelapses' and policyname = 'Public cam_timelapses read'
  ) then
    create policy "Public cam_timelapses read" on public.cam_timelapses for select using (true);
  end if;
end $$;

grant select on public.cam_timelapses to anon, authenticated;
