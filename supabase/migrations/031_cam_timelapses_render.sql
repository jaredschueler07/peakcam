-- ─────────────────────────────────────────────────────────────
-- Migration 031 — cam timelapse clips: render metadata, read view, bucket.
-- Parity plan 2026-10-18, block P8 part 2 (timelapses and storm reels).
--
-- WHY. Migration 025 created `cam_timelapses` (cam_id, "window", url, frames,
-- rendered_at, storm_date) for the clips the mini renders from the still
-- archive. The renderer (scripts/cam-timelapse.ts) needs four more facts per
-- clip — the poster JPEG, the clip's time bounds and its size — and the site
-- needs a read surface that inherits the still archive's rights switch
-- (`cams.archive_allowed`, docs/cams/still-archive-policy.md): a clip is made
-- of archived frames, so a cam switched off must lose its clips at once, the
-- way `cam_still_timeline` hides its frames.
--
-- WRITERS. `cam_timelapses`: scripts/cam-timelapse.ts on the mini (service
-- role; `com.peakcam.cam-timelapse`, every 6 h). Nothing in the app writes it.
-- READERS. `cam_timelapse_current` ← lib/supabase.ts getResortTimelapses()
-- (webcams subpage, resort overview tile, /api/v1 cams + timelapses, MCP
-- get_timelapses, markdown alternates).
--
-- APPLY. By hand (SQL Editor / MCP apply_migration) like every file here,
-- before the renderer's first run (it writes the new columns). Idempotent
-- and additive: safe to re-run; nothing is dropped or deleted.
-- ─────────────────────────────────────────────────────────────

-- ── 1. render metadata ──────────────────────────────────────
alter table public.cam_timelapses
  add column if not exists poster_url text,
  add column if not exists starts_at  timestamptz,
  add column if not exists ends_at    timestamptz,
  add column if not exists bytes      integer;

comment on column public.cam_timelapses.poster_url is
  'Public JPEG next to the MP4 (the clip''s last frame, same size); the <video> poster and the card image.';
comment on column public.cam_timelapses.starts_at is
  'Capture time of the clip''s first frame.';
comment on column public.cam_timelapses.ends_at is
  'Capture time of the clip''s last frame.';
comment on column public.cam_timelapses.bytes is
  'Size of the MP4 object; the renderer keeps every clip at or under 3 MB.';

-- One current clip per cam per window; storm clips are one per storm day.
-- The renderer reads the existing row and PATCHes it (PostgREST cannot
-- upsert on an expression index); this index only guards against duplicates.
create unique index if not exists cam_timelapses_cam_window_storm_uidx
  on public.cam_timelapses (cam_id, "window", coalesce(storm_date, date '1970-01-01'));

-- ── 2. public read view (rights-aware) ──────────────────────
-- security_invoker so the table's public-read policy still applies
-- underneath. Joins through cams so a clip is visible only while its cam is
-- archive-allowed and active, exactly like cam_still_timeline (024).
create or replace view public.cam_timelapse_current
  with (security_invoker = true) as
  select
    t.id,
    t.cam_id,
    c.resort_id,
    t."window",
    t.url,
    t.poster_url,
    t.frames,
    t.starts_at,
    t.ends_at,
    t.bytes,
    t.rendered_at,
    t.storm_date
  from public.cam_timelapses t
  join public.cams c on c.id = t.cam_id
  where c.archive_allowed and c.is_active and not c.auto_disabled;

comment on view public.cam_timelapse_current is
  'Public read surface for rendered timelapse clips: only archive_allowed, active cams. lib/supabase.ts getResortTimelapses() and the MCP get_timelapses tool read this.';

grant select on public.cam_timelapse_current to anon, authenticated;

-- ── 3. storage bucket ───────────────────────────────────────
-- Public bucket for the MP4s and posters. Objects are written only by the
-- renderer (service role, bypasses RLS); public buckets are readable without
-- a policy via /storage/v1/object/public/. No insert/update/delete policy is
-- created on purpose, so anon and authenticated clients cannot write. The
-- renderer also creates this bucket itself when it is missing (same shape).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cam-timelapses', 'cam-timelapses', true, 4194304, array['video/mp4', 'image/jpeg'])
on conflict (id) do update set public = excluded.public;
