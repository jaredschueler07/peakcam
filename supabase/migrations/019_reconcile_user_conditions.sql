-- ─────────────────────────────────────────────────────────────
-- Migration 019 — reconcile `user_conditions` with production.
--
-- WHY. Migration 004_user_conditions.sql declared the timestamp column as
-- `submitted_at`, but the live table (verified against
-- information_schema.columns in prod, Sep 2026) has `created_at`. Every
-- consumer in the repo — lib/supabase.ts getUserConditions(), the submit
-- route's rate limit (lib/user-conditions/rate-limit.ts), and the two sync
-- scripts' user-report blend (scripts/snotel-sync.ts, scripts/model-sync.ts)
-- — filtered/ordered on the non-existent `submitted_at`, so PostgREST
-- returned 400 and the site silently showed "No recent reports" while the
-- sync jobs blended zero user reports and the rate limit failed open. The
-- code now reads `created_at`; this file makes the migrations say the same
-- thing so a fresh database matches prod.
--
-- SAFETY. Idempotent: a no-op on prod (column already named `created_at`,
-- index recreated with IF NOT EXISTS), a rename on any database that was
-- built from 004 as written. Applied by hand (SQL Editor / MCP
-- apply_migration) like every other file here — there is no Supabase CLI.
--
-- ALSO DOCUMENTS (no DDL needed). The `snow_quality` CHECK constraint in
-- prod (`user_conditions_snow_quality_check`) is
--   snow_quality in ('powder', 'packed', 'crud', 'ice', 'spring')
-- which matches lib/types.ts UserSnowQuality and the form/list UI. The 004
-- file's `('powder', 'packed', 'icy', 'slush')` is stale — the constraint was
-- changed by hand in prod and never recorded. A fresh database built from
-- these files should apply the block at the bottom to get the prod
-- constraint; on prod it is a no-op because the definition already matches.
-- ─────────────────────────────────────────────────────────────

-- 1. submitted_at → created_at (only where the old name still exists).
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'user_conditions'
      and column_name  = 'submitted_at'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'user_conditions'
      and column_name  = 'created_at'
  ) then
    alter table public.user_conditions rename column submitted_at to created_at;
  end if;
end
$$;

-- 2. The (resort_id, created_at desc) index that getUserConditions() and the
--    sync scripts' 24h/48h window rely on. `rename column` carries an
--    existing index along, so on prod this is a no-op.
create index if not exists user_conditions_resort_idx
  on public.user_conditions (resort_id, created_at desc);

-- 3. snow_quality CHECK — bring a 004-built database up to the prod
--    definition. Skipped when the constraint already allows 'crud' (prod).
do $$
declare
  current_def text;
begin
  select pg_get_constraintdef(c.oid)
    into current_def
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'user_conditions'
    and c.conname = 'user_conditions_snow_quality_check';

  if current_def is not null and position('crud' in current_def) = 0 then
    alter table public.user_conditions
      drop constraint user_conditions_snow_quality_check;
    alter table public.user_conditions
      add constraint user_conditions_snow_quality_check
      check (snow_quality in ('powder', 'packed', 'crud', 'ice', 'spring'));
  end if;
end
$$;
