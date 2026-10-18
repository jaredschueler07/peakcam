-- ─────────────────────────────────────────────────────────────
-- Migration 023 — powder alert run log + webhook destinations.
--
-- WHY. The daily alert cron (/api/alerts/trigger, 13:00 UTC) had no record
-- of its own runs: a run that never happened and a run that found nothing
-- looked identical. `powder_alert_runs` gets one row per invocation, opened
-- at the start and closed at the end, so a missing or unfinished row is
-- itself the alarm. `alert_destinations` adds where an alert goes besides
-- the subscriber's email: today only `webhook` rows are written (signed per
-- Standard Webhooks, see lib/alerts/webhooks.ts); `email` is reserved so a
-- later migration does not need a new CHECK.
--
-- APPLY. By hand (SQL Editor / MCP apply_migration) like every other file
-- here. Idempotent and additive only: no table or column here existed
-- before, nothing existing is altered or dropped. Applied to production
-- 2026-10-18 before the code that writes these tables was deployed; the
-- trigger tolerates a missing table (it logs and carries on), so ordering
-- is not load-bearing.
-- ─────────────────────────────────────────────────────────────

-- 1. One row per trigger run. `finished_at` null = still running or crashed.
create table if not exists public.powder_alert_runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  -- Distinct subscribers with at least one alert preference at run time.
  subscribers   integer,
  -- Powder alert emails delivered (the trigger's `sent`).
  alerts_sent   integer,
  -- Signed webhook deliveries that got a 2xx.
  webhooks_sent integer,
  -- Distinct failure reasons from every branch (email, log, openings,
  -- webhooks): the trigger response's `errors` plus a branch prefix.
  errors        jsonb not null default '[]'::jsonb,
  -- The full JSON the trigger returned, for the day someone asks "what did
  -- the cron see on the 3rd?" — freshness, openings, webhook counts.
  summary       jsonb
);

comment on table public.powder_alert_runs is
  'One row per /api/alerts/trigger invocation. finished_at null means the run did not complete.';

-- The ops question is always "the latest few runs".
create index if not exists powder_alert_runs_started_idx
  on public.powder_alert_runs (started_at desc);

-- 2. Extra delivery targets per subscriber. The email on alert_subscribers
--    stays the primary channel; these are additive.
create table if not exists public.alert_destinations (
  id                uuid primary key default gen_random_uuid(),
  subscriber_id     uuid not null references public.alert_subscribers(id) on delete cascade,
  kind              text not null check (kind in ('email', 'webhook')),
  -- A URL for kind = 'webhook', an address for kind = 'email'.
  target            text not null,
  -- Standard Webhooks signing secret (`whsec_` + base64 of 24 random bytes).
  -- Service-role readable only; shown to the subscriber once at creation.
  secret            text,
  created_at        timestamptz not null default now(),
  last_delivered_at timestamptz,
  -- Consecutive runs with a failed delivery; reset to 0 on success.
  failures          integer not null default 0,
  -- Set after ten consecutive failures; the trigger skips disabled rows.
  disabled_at       timestamptz,
  unique (subscriber_id, kind, target)
);

comment on table public.alert_destinations is
  'Per-subscriber delivery targets beyond the account email. Webhook secrets live here; deny-all RLS, service role only.';

-- The trigger's fan-out read: every live webhook for the subscribers it is
-- about to alert.
create index if not exists alert_destinations_subscriber_idx
  on public.alert_destinations (subscriber_id)
  where disabled_at is null;

-- ── RLS: deny-all like the other alert tables (004). Service role bypasses
-- RLS, so the trigger and the manage route need no policy of their own.
alter table public.powder_alert_runs  enable row level security;
alter table public.alert_destinations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'powder_alert_runs' and policyname = 'no public access'
  ) then
    create policy "no public access" on public.powder_alert_runs for all using (false);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'alert_destinations' and policyname = 'no public access'
  ) then
    create policy "no public access" on public.alert_destinations for all using (false);
  end if;
end $$;
