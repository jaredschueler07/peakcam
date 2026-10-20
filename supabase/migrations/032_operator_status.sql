-- ─────────────────────────────────────────────────────────────
-- Migration 032 — operator status (parity plan block P6).
--
-- WHY A NEW TABLE. `snow_reports` has had lifts_open / lifts_total /
-- trails_open / trails_total columns since 001, but `latest_snow_reports`
-- returns the single newest row per resort whatever its source. Appending
-- an `operator` row with lift counts and no snow numbers would make that
-- row the resort's "latest report" and blank the base depth on every page
-- and API document until the next SNOTEL sync. Operator reports therefore
-- get their own append-only table and their own latest-row view, and the
-- conditions contract (lib/conditions-contract.ts) joins the two on read.
--
-- WHAT. One row per fetch of an operator feed: lift counts by state
-- (open / hold / scheduled / closed) as Liftie reports them, trail counts,
-- base depth and surface where a feed carries them, the operator's own
-- published opening date, and the provider's record. `observed_at` is the
-- provider's timestamp for the lift status, not the fetch time, so the
-- freshness tier on the contract reflects the operator, not the job.
-- Idempotent per (resort, source, observed_at): a re-run inside the same
-- provider minute is a no-op.
--
-- RLS: public select, no insert / update / delete policy — only the service
-- role (scripts/operator-sync.ts on the Mac mini) writes.
--
-- APPLY. By hand (SQL Editor / MCP apply_migration); safe to re-run.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.operator_status (
  id               uuid primary key default gen_random_uuid(),
  resort_id        uuid not null references public.resorts(id) on delete cascade,
  -- Which feed: `liftie` today; add values to the check as feeds are added.
  source           text not null check (source in ('liftie')),
  -- The provider's own id for the resort (Liftie's slug).
  source_id        text not null,
  observed_at      timestamptz not null,
  fetched_at       timestamptz not null default now(),
  lifts_open       integer,
  lifts_hold       integer,
  lifts_scheduled  integer,
  lifts_closed     integer,
  lifts_total      integer,
  trails_open      integer,
  trails_total     integer,
  base_depth_in    numeric(6,1),
  surface          text,
  opening_date     date,
  -- The page the provider parsed, for attribution and for a person to check.
  source_url       text,
  -- False for a third-party parser (Liftie); true only for an operator's own API.
  verified         boolean not null default false,
  payload          jsonb,
  unique (resort_id, source, observed_at)
);

create index if not exists operator_status_resort_observed_idx
  on public.operator_status (resort_id, observed_at desc);

comment on table public.operator_status is
  'Operator-published lift / trail status per resort, one row per fetch (P6). Read through latest_operator_status; written by scripts/operator-sync.ts.';

-- Newest row per resort, with resort_id taken from resorts.id so a
-- per-resort filter pushes down to one index probe (the 029 pattern).
create or replace view public.latest_operator_status
with (security_invoker = true) as
select
  r.id as resort_id,
  l.id,
  l.source,
  l.source_id,
  l.observed_at,
  l.fetched_at,
  l.lifts_open,
  l.lifts_hold,
  l.lifts_scheduled,
  l.lifts_closed,
  l.lifts_total,
  l.trails_open,
  l.trails_total,
  l.base_depth_in,
  l.surface,
  l.opening_date,
  l.source_url,
  l.verified
from public.resorts r
cross join lateral (
  select s.*
  from public.operator_status s
  where s.resort_id = r.id
  order by s.observed_at desc
  limit 1
) l;

comment on view public.latest_operator_status is
  'Latest operator_status row per resort (P6). resort_id comes from resorts.id so a per-resort filter is one index probe.';

alter table public.operator_status enable row level security;

drop policy if exists "operator_status public read" on public.operator_status;
create policy "operator_status public read"
  on public.operator_status for select
  using (true);

grant select on public.operator_status to anon, authenticated;
grant select on public.latest_operator_status to anon, authenticated;
