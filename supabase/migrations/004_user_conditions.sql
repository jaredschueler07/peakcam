-- ─────────────────────────────────────────────────────────────
-- PeakCam — User-Submitted Conditions Reports (Sprint 2, s2-5)
-- Rich, auth-gated conditions reports with profanity moderation.
-- Distinct from condition_votes (anonymous quick-vote widget).
-- ─────────────────────────────────────────────────────────────

-- ── user_conditions ─────────────────────────────────────────
-- One row per submitted conditions report from an authenticated user.

create table if not exists user_conditions (
  id                uuid primary key default gen_random_uuid(),
  resort_id         uuid not null references resorts(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  snow_quality      text not null
                    check (snow_quality in ('powder', 'packed', 'icy', 'slush')),
  visibility        text not null
                    check (visibility in ('clear', 'foggy', 'whiteout')),
  wind              text not null
                    check (wind in ('calm', 'breezy', 'gusty', 'high')),
  trail_conditions  text not null
                    check (trail_conditions in ('groomed', 'ungroomed', 'moguls', 'variable')),
  notes             text,                       -- optional free-text (max 500 chars enforced in app)
  is_flagged        boolean not null default false,  -- profanity / moderation flag
  submitted_at      timestamptz not null default now()
);

create index if not exists user_conditions_resort_idx
  on user_conditions (resort_id, submitted_at desc);
create index if not exists user_conditions_user_idx
  on user_conditions (user_id);
create index if not exists user_conditions_flagged_idx
  on user_conditions (is_flagged) where is_flagged = true;

-- ── Row Level Security ──────────────────────────────────────
-- Public can read non-flagged reports.
-- Authenticated users can insert their own reports.
-- Users can delete their own reports.
-- No updates (reports are immutable after submission).

alter table user_conditions enable row level security;

create policy "Public user_conditions read"
  on user_conditions for select
  using (is_flagged = false);

create policy "Authenticated user_conditions insert"
  on user_conditions for insert
  with check (auth.uid() = user_id);

create policy "Own user_conditions delete"
  on user_conditions for delete
  using (auth.uid() = user_id);
