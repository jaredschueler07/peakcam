-- ─────────────────────────────────────────────────────────────
-- Migration 020 — resort opening dates + opening-day alerts.
--
-- WHY. /opening-dates is the pre-season landing page ("when does X open")
-- and the opening-day email is the alert it captures for. Both read from
-- one row per resort per season: a third-party projection (OnTheSnow) and,
-- once the resort announces it, a confirmed date. Southern-hemisphere rows
-- carry the end of their season in `closing_date` instead. The seed is
-- data/resort-openings.csv via `npm run seed-openings` (service role).
--
-- Only `confirmed_open` drives an email: the trigger cron sends
-- sendOpeningDayEmail to every subscriber with `opening_day` on a
-- preference for a resort whose confirmed_open is today (UTC). A wrong
-- "confirmed" therefore mails every subscriber of that resort — keep
-- projections in `projected_open`.
--
-- APPLY. By hand (SQL Editor / MCP apply_migration) like every other file
-- here — there is no Supabase CLI. Idempotent; safe to re-run. Apply BEFORE
-- deploying the code that reads these columns: the subscribe route writes
-- alert_preferences.opening_day on every new signup and the trigger writes
-- powder_alert_log.kind = 'opening'.
-- ─────────────────────────────────────────────────────────────

-- 1. One row per resort (per season, but the unique key is resort_id: a
--    new season overwrites the old row — the page only ever shows one).
create table if not exists public.resort_openings (
  id             uuid primary key default gen_random_uuid(),
  resort_id      uuid not null unique references public.resorts(id) on delete cascade,
  season         text not null default '2026-27',
  projected_open date,
  confirmed_open date,
  closing_date   date,
  source_url     text,
  notes          text,
  updated_at     timestamptz not null default now()
);

-- The trigger cron's daily probe: `where confirmed_open = current_date`.
create index if not exists resort_openings_confirmed_open_idx
  on public.resort_openings (confirmed_open);

-- Public read (the /opening-dates page uses the anon client); writes stay
-- service-role only — no insert/update/delete policy exists on purpose.
alter table public.resort_openings enable row level security;

drop policy if exists "public read" on public.resort_openings;
create policy "public read" on public.resort_openings
  for select to anon, authenticated using (true);

grant select on public.resort_openings to anon, authenticated;

-- 2. Opening-day opt-in lives on the preference row, so it is per resort
--    the way the threshold is (the UI sets it for every selected resort).
alter table public.alert_preferences
  add column if not exists opening_day boolean not null default false;

-- 3. Dedupe log. Migration 016 already added `kind text not null default
--    'live'` with a CHECK of ('live','forecast'); the column is re-added here
--    idempotently for a database built without 016, and the CHECK is widened
--    to admit the opening-day rows the cron writes. The 016 unique index
--    (subscriber_id, resort_id, alert_date, kind, coalesce(storm_start_date),
--    new_snow_inches) is what makes `resolution=ignore-duplicates` a
--    one-email-per-resort-per-day guarantee for kind = 'opening' too:
--    those rows are written with new_snow_inches = 0 and no storm date.
alter table public.powder_alert_log
  add column if not exists kind text not null default 'live';

alter table public.powder_alert_log
  drop constraint if exists powder_alert_log_kind_check;

alter table public.powder_alert_log
  add constraint powder_alert_log_kind_check
  check (kind in ('live', 'forecast', 'opening'));

-- The cron's dedupe read: `where kind = 'opening' and alert_date = today`.
create index if not exists powder_alert_log_kind_date_idx
  on public.powder_alert_log (kind, alert_date);
