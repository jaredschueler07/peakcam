-- 022: card-preview ranking and captured stills for cams.
--
-- Why: the home/browse card shows one still per resort. Some cams return a
-- usable image but a bad view (night frame, snow stake close-up, vendor
-- placeholder), and click-to-play players (HLS/iframe providers with no
-- snapshot endpoint) return no still at all. This adds
--   * an editorial order for which cam fronts the card (preview_rank), and a
--     hard exclude (card_preview = false) for cams that must never front it;
--   * a slot for a frame captured server-side by scripts/cam-capture-stills.ts
--     (still_url / still_captured_at / still_source). The capture job only
--     moves still_url forward when a new frame passes its blank-frame check,
--     so a cam that is offline tonight keeps this afternoon's still.
--
-- Read path: lib/cam-preview.ts prefers the provider-published still, then
-- still_url. cams is public-read (001), so the new columns are visible to the
-- anon key; nothing sensitive lives here (no provider tokens, no error text).

alter table cams add column if not exists preview_rank      smallint;
alter table cams add column if not exists card_preview      boolean not null default true;
alter table cams add column if not exists still_url         text;
alter table cams add column if not exists still_captured_at timestamptz;
alter table cams add column if not exists still_source      text;

comment on column cams.preview_rank is
  'Card-preview order within a resort; lower first, null after every ranked cam. Set from the grading pass, not by the health check.';
comment on column cams.card_preview is
  'false = never use as the resort card preview (dead feed, placeholder art, wrong view). Still listed on the resort page.';
comment on column cams.still_url is
  'Most recent captured frame that passed the blank-frame check (Supabase Storage public URL, bucket cam-stills). Null until the capture job has a good frame.';
comment on column cams.still_captured_at is
  'When still_url was captured. Shown on the card as "Still from …".';
comment on column cams.still_source is
  'How the frame was obtained: hls, poster, page-m3u8, og:image, …';

-- Public bucket for captured frames. Objects are written only by the capture
-- job (service role, bypasses RLS); public buckets are readable without a
-- policy via /storage/v1/object/public/. No insert/update/delete policy is
-- created on purpose, so anon and authenticated clients cannot write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cam-stills', 'cam-stills', true, 2097152, array['image/jpeg', 'image/webp'])
on conflict (id) do update set public = excluded.public;
