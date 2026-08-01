-- supabase/migrations/012_drop_in_runs.sql
-- ─────────────────────────────────────────────────────────────
-- PeakCam — Drop In v2 competitive runs (`drop_in_runs`)
--
-- APPLIED BY HAND. Per house convention there is no Supabase CLI in this
-- repo: migrations are applied through the SQL Editor (or the Supabase MCP
-- `apply_migration` tool) and the file numbering is documentation only. This
-- file has NOT been applied — running it is a deliberate, manual step.
--
-- Numbering note: `012_south_america.sql` already exists. The `012_` prefix
-- here matches the Drop In v2 plan (PLAN.md Phase 8 "Migration 012") and the
-- architecture report's file layout; duplicate numbers already have precedent
-- in this directory (004 and 005 each have two files).
--
-- Schema is the Drop In v2 architecture report §9, adopted wholesale by
-- DESIGN.md §3.7. Runs are server-trusted: RLS grants SELECT only (public sees
-- accepted rows; a signed-in user additionally sees their own rejected rows)
-- and defines NO client INSERT/UPDATE/DELETE policy. The `/api/drop-in/runs`
-- Route Handler verifies the HMAC run ticket, validates the submission, and
-- inserts with the service-role key.
-- ─────────────────────────────────────────────────────────────

create table if not exists drop_in_runs (
  id                  uuid primary key default gen_random_uuid(),
  resort_id           uuid not null references resorts(id) on delete restrict,
  user_id             uuid references auth.users(id) on delete set null,

  mode                text not null
                      check (mode in ('time_trial', 'score_attack')),
  trail_id            text not null,
  time_ms             integer not null
                      check (time_ms between 1000 and 1800000),
  score               integer not null
                      check (score between 0 and 100000000),

  physics_version     smallint not null,
  course_version      integer not null,
  ghost_version       smallint not null,
  tick_hz             smallint not null
                      check (tick_hz between 10 and 240),

  -- One-time use: the ticket nonce the server issued for this run.
  run_nonce           uuid not null unique,
  -- PCGH blob (lib/game/replay/codec.ts). ~25–32 KB for a 3-minute run, so
  -- bytea keeps it transactionally tied to the row; revisit Storage only if
  -- blobs or egress grow materially.
  ghost_data          bytea not null,
  ghost_sha256        bytea not null,
  ghost_keyframes     integer not null
                      check (ghost_keyframes between 2 and 20000),

  -- Rejected runs are retained for anti-cheat telemetry, never ranked.
  accepted            boolean not null default false,
  rejection_code      text,
  validation_metrics  jsonb not null default '{}'::jsonb,

  started_at          timestamptz not null,
  finished_at         timestamptz not null,
  created_at          timestamptz not null default now(),

  check (finished_at >= started_at),
  check (
    (accepted and rejection_code is null)
    or
    (not accepted and rejection_code is not null)
  )
);

-- Leaderboard reads are always scoped to one comparable course. The ordering
-- columns serve score_attack directly; time_trial queries must still ask for
-- `order by time_ms asc, score desc` explicitly — one index ordering cannot be
-- semantically correct for both modes.
create index if not exists drop_in_runs_leaderboard_idx
  on drop_in_runs
  (resort_id, mode, trail_id, physics_version, course_version,
   score desc, time_ms asc)
  where accepted;

create index if not exists drop_in_runs_user_idx
  on drop_in_runs (user_id, created_at desc)
  where user_id is not null;

create index if not exists drop_in_runs_created_idx
  on drop_in_runs (created_at desc);

-- ─── RLS ─────────────────────────────────────────────────────
-- Read-only for clients. Writes are service-role only (which bypasses RLS);
-- deliberately no INSERT/UPDATE/DELETE policy exists for anon or authenticated.

alter table drop_in_runs enable row level security;

drop policy if exists "Public accepted leaderboard runs" on drop_in_runs;
create policy "Public accepted leaderboard runs"
  on drop_in_runs for select
  to anon, authenticated
  using (accepted = true);

drop policy if exists "Users can read their own rejected runs" on drop_in_runs;
create policy "Users can read their own rejected runs"
  on drop_in_runs for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Row-level SELECT still exposes every column to a client that can see the
-- row. The public leaderboard API must project only the fields in
-- `publicLeaderboardRowSchema` (lib/game/server/run-schema.ts) — never
-- validation_metrics, run_nonce, rejection_code, ghost bytes, or user_id.
comment on table drop_in_runs is
  'Drop In v2 competitive runs. Inserted only by the server after ticket + replay validation; clients have SELECT only.';
comment on column drop_in_runs.run_nonce is
  'Nonce from the server-issued HMAC run ticket; unique constraint enforces one submission per ticket.';
comment on column drop_in_runs.ghost_data is
  'PCGH binary ghost replay (see lib/game/replay/codec.ts).';
comment on column drop_in_runs.validation_metrics is
  'Server-side validator output. Never exposed to clients.';
