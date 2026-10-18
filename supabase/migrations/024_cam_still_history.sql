-- 024: cam-still history archive with storm keepers.
--
-- Why: migration 022 gave every click-to-play cam a *latest* frame
-- (cams.still_url) but kept no history, so PeakCam could not show "what the
-- hill looked like 24 h ago" or "the last storm on tape". This adds
--   * cams.archive_allowed — the rights switch. Default false. Only cams
--     PeakCam already captures itself and operator-public snapshot endpoints
--     (brownrice snapshot, ipcamlive snapshot, Ozolio poster, image feeds) are
--     flipped on below. Player-only providers (Roundshot, YouTube, generic
--     iframes) stay link-only. Policy: docs/cams/still-archive-policy.md.
--   * cam_stills — one row per archived frame. Objects live in the existing
--     public bucket `cam-stills` under archive/<cam_id>/<stamp>.jpg; the
--     latest-frame objects under <cam_id>/ are untouched. `keeper` marks a
--     frame captured while the resort's latest 24 h number was >= 6 in; the
--     capture job prunes non-keepers after 30 days and keepers after a year.
--   * cam_still_timeline — the public read view. It only joins through
--     archive_allowed, active cams, so a frame archived for a cam that is
--     later switched off disappears from the site immediately (and the object
--     is pruned on the next run).
--
-- Drift note: 022's `cam_stills` table was never applied in production (only
-- the `cams` columns and the bucket exist), so this file creates the table
-- fresh with the column set the capture job writes today. Idempotent and
-- additive: safe to re-run; nothing is dropped or deleted.
--
-- Applied to production via the Supabase MCP on 2026-10-18.

-- ─── rights switch ──────────────────────────────────────────────────────
alter table cams add column if not exists archive_allowed boolean not null default false;
comment on column cams.archive_allowed is
  'true = scripts/cam-capture-stills.ts archives a frame every run and the site may show history for this cam. false = latest frame only (if PeakCam captures it) or link-only. See docs/cams/still-archive-policy.md.';

-- ─── history table ──────────────────────────────────────────────────────
create table if not exists cam_stills (
  id                  bigint generated always as identity primary key,
  cam_id              uuid not null references cams(id) on delete cascade,
  captured_at         timestamptz not null default now(),
  path                text not null unique,            -- storage object path in bucket cam-stills: archive/<cam_id>/<stamp>.jpg
  source              text,                            -- how the frame was obtained: provider-snapshot, hls, poster, page-m3u8, og:image, …
  width               integer,
  height              integer,
  bytes               integer,
  mean_luma           real,                            -- blank-frame stats at capture (lib/cam-stills frameStats)
  spread              real,
  snow_24h_at_capture real,                            -- resort's latest_snow_reports.new_snow_24h when the frame was taken; null when no report
  keeper              boolean not null default false   -- snow_24h_at_capture >= 6: kept for a year instead of 30 days
);
comment on table cam_stills is
  'Archived cam frames (one row per capture) for cams with archive_allowed = true. Written by scripts/cam-capture-stills.ts with the service role; read by the site through cam_still_timeline.';

create index if not exists cam_stills_cam_captured_idx on cam_stills (cam_id, captured_at desc);
-- Prune scans: "non-keepers older than X" and "keepers older than Y".
create index if not exists cam_stills_prune_idx on cam_stills (keeper, captured_at);

alter table cam_stills enable row level security;

-- Anyone may read a frame only when its cam is archive-allowed and active.
-- The service role bypasses RLS for writes; no insert/update/delete policy
-- is created, so anon and authenticated clients cannot write.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cam_stills' and policyname = 'Public cam_stills read for archive-allowed cams') then
    create policy "Public cam_stills read for archive-allowed cams" on cam_stills
      for select using (
        exists (
          select 1 from cams c
          where c.id = cam_stills.cam_id and c.archive_allowed and c.is_active and not c.auto_disabled
        )
      );
  end if;
end $$;

-- ─── public read view ───────────────────────────────────────────────────
-- security_invoker so the policy above still applies underneath the view.
-- Exposes nothing provider-specific: the object path, timing, size and the
-- snow number at capture. Public URL = <supabase url>/storage/v1/object/public/cam-stills/<path>.
create or replace view cam_still_timeline
  with (security_invoker = true) as
  select
    s.id,
    s.cam_id,
    c.resort_id,
    s.captured_at,
    s.path,
    s.source,
    s.width,
    s.height,
    s.snow_24h_at_capture,
    s.keeper
  from cam_stills s
  join cams c on c.id = s.cam_id
  where c.archive_allowed and c.is_active and not c.auto_disabled;

comment on view cam_still_timeline is
  'Public read surface for archived cam frames: only archive_allowed, active cams. lib/supabase.ts getCamTimeline() and the MCP get_cam_timeline tool read this.';

grant select on cam_still_timeline to anon, authenticated;
grant select on cam_stills to anon, authenticated;

-- ─── rights default (plan 2026-10-18 section 1, item 3) ─────────────────
-- Allowed: cams PeakCam already captures itself (still_url set by the capture
-- job), operator image feeds (embed_type = 'image'), and the snapshot
-- endpoints lib/cam-preview.ts already derives a still from (brownrice,
-- ipcamlive, Ozolio). Never: link-outs, YouTube, generic iframes, and any
-- Roundshot host (named player-only in the plan) or aggregator re-publishers
-- (windy.com, opensnow.com) whose image URLs are not the operator's own.
-- Mirrored in TypeScript by lib/cam-timeline.ts archiveAllowedByDefault().
--
-- Run on 2026-10-18 against production: 269 of 442 cams matched (249 active):
--   image-feed 125 · brownrice-snapshot 91 · ipcamlive-snapshot 26 ·
--   peakcam-captured 25 · ozolio-poster 2.
-- Additive only (never flips a cam back to false), so a hand-set false sticks.
update cams
set archive_allowed = true
where archive_allowed = false
  and embed_type <> 'link'
  and coalesce(split_part(embed_url, '/', 3), '') !~ '(^|\.)(roundshot\.com|windy\.com|opensnow\.com)$'
  and (
    still_url is not null
    or embed_type = 'image'
    or (embed_type = 'iframe' and coalesce(split_part(embed_url, '/', 3), '') ~ '^(player|live[0-9]{1,3}|tsvweather)\.brownrice\.com$')
    or (embed_type = 'iframe' and coalesce(split_part(embed_url, '/', 3), '') ~ '^(www|g[0-9]{1,2})\.ipcamlive\.com$')
    or (embed_type = 'iframe' and coalesce(split_part(embed_url, '/', 3), '') = 'relay.ozolio.com')
  );
