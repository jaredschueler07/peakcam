-- ─────────────────────────────────────────────────────────────
-- Migration 028 — daily resort score with components.
-- Parity plan 2026-10-18, block P0 (table) for block P7 (the scorer).
--
-- WHY. PeakCam rates conditions on a 4-tier `cond_rating` that is
-- overwritten in place, so there is no history and no explanation. This
-- table keeps one 0–100 score per resort per day with the components that
-- produced it (new snow, base, trend, forecast, open terrain, …) as JSON, so
-- the page can show "why 82" and a 30-day score history, and a leaderboard
-- can rank on it.
--
-- `season_stats` (the plan's view over snowpack_daily and resort_scores) is
-- deliberately not created here: its powder-day threshold is an editorial
-- call still open in the plan (section 4). It lands with P5/P7.
--
-- WRITERS. P7 scoring job on the mini (service role). Nothing in the app
-- writes this table.
--
-- APPLY. By hand (SQL Editor / MCP apply_migration). Idempotent and
-- additive: safe to re-run; nothing is dropped or deleted.
-- Applied to production via the Supabase MCP on 2026-10-18.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.resort_scores (
  resort_id  uuid not null references public.resorts(id) on delete cascade,
  date       date not null,
  score      integer not null check (score between 0 and 100),
  -- The 4-tier label the score maps to, so existing rating consumers can read it.
  rating     text check (rating is null or rating in ('great', 'good', 'fair', 'poor')),
  -- Named components and their contribution, e.g. {"newSnow24h": 32, "baseDepth": 18, ...}.
  components jsonb not null default '{}'::jsonb,
  -- Which scorer version produced the row, e.g. `score-v1`.
  scored_by  text,
  primary key (resort_id, date)
);

comment on table public.resort_scores is
  'Daily 0–100 conditions score per resort with its components. Written by the P7 scoring job with the service role; public read. Leaderboards read the latest date.';

-- "Today's leaderboard" scans one date across all resorts.
create index if not exists resort_scores_date_idx on public.resort_scores (date desc, score desc);

alter table public.resort_scores enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'resort_scores' and policyname = 'Public resort_scores read'
  ) then
    create policy "Public resort_scores read" on public.resort_scores for select using (true);
  end if;
end $$;

grant select on public.resort_scores to anon, authenticated;
