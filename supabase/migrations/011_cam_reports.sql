-- supabase/migrations/011_cam_reports.sql
-- ─────────────────────────────────────────────────────────────
-- PeakCam — Cam Reports
-- Anonymous user-submitted reports that a webcam is broken,
-- with optional suggested replacement URL. Admin-read only
-- (Supabase UI + notification email). Reports are server-trusted:
-- RLS denies all direct writes; the submit API route uses the
-- service role.
-- ─────────────────────────────────────────────────────────────

create table if not exists cam_reports (
  id                   uuid primary key default gen_random_uuid(),
  cam_id               uuid not null references cams(id) on delete cascade,
  session_id           uuid not null,
  reason               text not null
                       check (reason in ('broken','wrong_view','other')),
  resort_link_dead     boolean not null default false,
  suggested_url        text,
  user_agent           text,
  ip_hash              text,
  resolved             boolean not null default false,
  resolved_at          timestamptz,
  admin_note           text,
  created_at           timestamptz not null default now()
);

create index if not exists cam_reports_cam_idx
  on cam_reports (cam_id, created_at desc);
create index if not exists cam_reports_unresolved_idx
  on cam_reports (resolved) where resolved = false;
create index if not exists cam_reports_session_idx
  on cam_reports (session_id, cam_id, created_at);

alter table cam_reports enable row level security;
-- No policies = default deny for anon and authenticated.
-- The API route uses the service role and bypasses RLS.
