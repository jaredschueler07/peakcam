-- ─────────────────────────────────────────────────────────────
-- Migration 021 — per-resort WeatherNext 3 powder probabilities.
--
-- WHY. PeakCam's long-range product is a *derived* probability that a
-- resort receives at least 6 / 8 / 12 inches of new snow in (a) the
-- next 72 hours and (b) the single best fixed 72-hour storm window
-- within 7 days, computed by accumulating hourly snowfall per
-- ensemble member from the full 64-member WeatherNext 3 Zarr store
-- (scripts/weathernext/). Per-hour percentile marginals (BigQuery /
-- statistics bucket) must NEVER be summed into storm totals — only
-- per-member accumulations are stored here, as raw member
-- frequencies with their counts, so forecast history stays joinable
-- to realized SNOTEL snow for calibration.
--
-- GATE. Public display is blocked until (1) calibration against
-- SNOTEL beats both climatology and deterministic baselines and
-- (2) a WeatherNext real-time terms review passes. RLS below is the
-- hard gate: denies every row to anon/authenticated; only the
-- service role (Mac Studio writer, calibration readers) sees data.
-- The later gate is a separate small migration that swaps in the
-- resort_openings public-read posture (migration 020) — nothing
-- else changes. NO raw WeatherNext fields (per-member precipitation
-- or temperature) are ever stored: derived values only.
--
-- APPLY. By hand (SQL Editor / MCP apply_migration) like every file
-- here — no Supabase CLI. Idempotent; safe to re-run. Code deploys
-- safely BEFORE this is applied: getPowderProbabilities() in
-- lib/supabase.ts returns null on a missing table, and pre-gate RLS
-- returns zero rows, so nothing renders either way.
-- ─────────────────────────────────────────────────────────────

-- 1. Append-only: one row per resort x model run x window x method.
--    method_version is part of the primary key so reprocessing a run
--    under a new derivation never overwrites the rows calibration
--    already scored. Re-running the same method is idempotent via
--    ignore-duplicates on the PK.
--
--    Time anchors: model_init_at is the WeatherNext run time;
--    horizon_start_at is t0, the first issuable hour
--    (>= init + ~7h45m dissemination latency) that both windows are
--    anchored to; valid_start/valid_end are the 72-hour window
--    itself (for next_72h, valid_start = horizon_start_at).
create table if not exists public.powder_probabilities (
  resort_id        uuid not null references public.resorts(id) on delete cascade,
  model_init_at    timestamptz not null,
  horizon_start_at timestamptz not null,
  window_kind      text not null check (window_kind in ('next_72h', 'best_7d')),
  valid_start      timestamptz not null,
  valid_end        timestamptz not null
    check (valid_end = valid_start + interval '72 hours'
           and valid_start >= horizon_start_at
           and valid_end <= horizon_start_at + interval '168 hours'),
  -- Raw ensemble frequencies (count / n_valid) until a calibrated
  -- variant exists; probability_kind says which. Never enforce
  -- p = count/total in the DB: a calibrated probability will not
  -- equal the raw frequency, and counts stay as the audit trail.
  probability_kind   text not null default 'raw_frequency'
    check (probability_kind in ('raw_frequency', 'calibrated')),
  calibration_version text,
  p_ge_6in         numeric(5,4) not null check (p_ge_6in between 0 and 1),
  p_ge_8in         numeric(5,4) not null check (p_ge_8in between 0 and 1),
  p_ge_12in        numeric(5,4) not null check (p_ge_12in between 0 and 1),
  check (p_ge_6in >= p_ge_8in and p_ge_8in >= p_ge_12in),
  members_total    smallint not null check (members_total > 0),
  members_valid    smallint not null check (members_valid > 0 and members_valid <= members_total),
  degraded         boolean not null default false,
  members_ge_6in   smallint not null check (members_ge_6in between 0 and members_valid),
  members_ge_8in   smallint not null check (members_ge_8in between 0 and members_valid),
  members_ge_12in  smallint not null check (members_ge_12in between 0 and members_valid),
  check (members_ge_6in >= members_ge_8in and members_ge_8in >= members_ge_12in),
  -- Distribution of per-member window totals (inches of snow).
  p10_snow_in      numeric(6,2) not null,
  p25_snow_in      numeric(6,2) not null,
  p50_snow_in      numeric(6,2) not null,
  p75_snow_in      numeric(6,2) not null,
  p90_snow_in      numeric(6,2) not null,
  mean_snow_in     numeric(6,2) not null,
  check (p10_snow_in <= p25_snow_in and p25_snow_in <= p50_snow_in
         and p50_snow_in <= p75_snow_in and p75_snow_in <= p90_snow_in),
  horizon_truncated boolean not null default false,
  source           text not null default 'weathernext3',
  model_version    text,
  -- Derivation version: precipitation variable, phase/SLR scheme,
  -- lapse rates, best-window rule (see derive.METHOD_VERSION in
  -- scripts/weathernext/).
  method_version   text not null,
  computed_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  primary key (resort_id, model_init_at, window_kind, method_version)
);

-- Latest-run lookups and calibration joins by resort.
create index if not exists powder_probabilities_resort_init_idx
  on public.powder_probabilities (resort_id, model_init_at desc);

-- 2. Latest row per resort per window, copying the LATERAL pattern
--    from migration 018. security_invoker so the table RLS gate
--    below applies to view readers exactly as to table readers.
drop view if exists public.latest_powder_probabilities;

create view public.latest_powder_probabilities
  with (security_invoker = true)
as
  select
    l.resort_id,
    l.model_init_at,
    l.horizon_start_at,
    l.window_kind,
    l.valid_start,
    l.valid_end,
    l.probability_kind,
    l.calibration_version,
    l.p_ge_6in,
    l.p_ge_8in,
    l.p_ge_12in,
    l.members_total,
    l.members_valid,
    l.degraded,
    l.members_ge_6in,
    l.members_ge_8in,
    l.members_ge_12in,
    l.p10_snow_in,
    l.p25_snow_in,
    l.p50_snow_in,
    l.p75_snow_in,
    l.p90_snow_in,
    l.mean_snow_in,
    l.horizon_truncated,
    l.source,
    l.model_version,
    l.method_version,
    l.computed_at,
    l.created_at
  from public.resorts r
  cross join (values ('next_72h'), ('best_7d')) as w(window_kind)
  cross join lateral (
    select p.*
    from public.powder_probabilities p
    where p.resort_id = r.id
      and p.window_kind = w.window_kind
    order by p.model_init_at desc, p.computed_at desc
    limit 1
  ) l;

-- 3. RLS — the pre-gate posture (migration 004): RLS on, every row
--    denied to anon/authenticated. The SELECT grants exist only so
--    anon reads return zero rows (not permission errors) through
--    the security_invoker view; the policy is what denies. Writes
--    are service-role only (BYPASSRLS); there is deliberately no
--    insert/update/delete policy. The future gate migration
--    replaces the policy with migration 020's "public read".
alter table public.powder_probabilities enable row level security;

drop policy if exists "no public access" on public.powder_probabilities;
create policy "no public access" on public.powder_probabilities
  for all using (false);

grant select on public.powder_probabilities to anon, authenticated, service_role;
grant insert on public.powder_probabilities to service_role;
grant select on public.latest_powder_probabilities to anon, authenticated, service_role;
