-- ─────────────────────────────────────────────────────────────
-- Migration 034 — Supabase performance & security advisor remediation.
--
-- WHY. Live-database audit on 2026-11-07 (`pg_policies`, `pg_stat_user_indexes`,
-- `pg_constraint`, `pg_extension`) surfaced six classes of advisor findings. Five are handled here; the
-- sixth (`extension_in_public`) lives in `036_extensions_schema.sql` so it can
-- be applied, or held back, on its own:
--
--   1. `auth_rls_initplan` — RLS policies on `dashboard_layouts`,
--      `user_favorites` and `user_conditions` call bare `auth.uid()`, which
--      Postgres re-evaluates per row instead of once per statement as an
--      InitPlan `(select auth.uid())`.
--   2. `multiple_permissive_policies` on `user_conditions` — two permissive
--      policies exist per action (SELECT, INSERT, DELETE): the repo-tracked
--      trio from `004_user_conditions.sql` (`Public user_conditions read`,
--      `Authenticated user_conditions insert`, `Own user_conditions delete` on
--      `{public}`) alongside a trio that exists in no migration file
--      (`Anyone can read non-flagged conditions` on `{public}`,
--      `Authenticated users can insert own conditions` and `Users can delete
--      own conditions` on `{authenticated}`).
--      Note: `019_reconcile_user_conditions.sql` reconciled `submitted_at →
--      created_at`, `user_conditions_resort_idx`, and the `snow_quality` CHECK
--      constraint, but defined no RLS policies. We keep the repo-canonical
--      `004_user_conditions.sql` policy names, recreated with `(select
--      auth.uid())` and scoped `to authenticated` on INSERT/DELETE, and drop
--      the untracked hand-created duplicates. The INSERT policy is recreated
--      only while migration 035 has not been applied: 035 replaces it with
--      `"No direct client user_conditions insert"`, and a re-run of this file
--      must not reopen direct client inserts.
--   3. `multiple_permissive_policies` on `drop_in_runs` — `authenticated`
--      evaluated both `"Public accepted leaderboard runs"` (`to anon,
--      authenticated`) and `"Users can read their own rejected runs"` (`to
--      authenticated`). Collapsing to one SELECT policy per role (`anon`:
--      `accepted = true`; `authenticated`: `accepted = true or user_id =
--      (select auth.uid())`) preserves identical row visibility while
--      eliminating the duplicate permissive scan (`lib/game/server/handlers/
--      production-deps.ts:74` reads the public leaderboard with `anonClient`
--      and `lib/game/server/run-repository.ts:195,235` also filters `.eq(
--      "accepted", true)` explicitly).
--   4. `unindexed_foreign_keys` — three foreign keys lacked a covering B-tree
--      index: `bug_reports(updated_by) → auth.users(id)`,
--      `drop_in_morning_conditions(snow_report_id) → snow_reports(id)`, and
--      `powder_alert_log(resort_id) → resorts(id)`.
--   5. `unused_index` (29 indexes with `idx_scan = 0` over the project's
--      lifetime) — each is audited against every query in `app/`, `components/`,
--      `hooks/`, `lib/`, `scripts/`, `agents/`, and SQL views/functions, plus
--      foreign-key coverage requirements. 10 indexes with no matching query or
--      FK obligation are dropped (each only if any FK it covers stays covered
--      by another index, checked at apply time); 19 are kept: 18 whose query shape or FK coverage
--      matches live code on currently small/empty tables, plus
--      `resorts_state_idx`, which is in use (full per-index ledger in
--      Section 5 below).
--
-- APPLY. By hand (SQL Editor / MCP `apply_migration`), as one transaction:
-- there is no BEGIN/COMMIT or CONCURRENTLY here, so any error rolls back every
-- section. Paste the whole file in one go: `set local lock_timeout` below only
-- takes effect inside a transaction, which a single multi-statement run is.
-- With it, a statement that cannot get its lock within 3 s fails and rolls
-- the migration back instead of queueing behind (and blocking) site reads;
-- re-run it when that happens. Index builds/drops take brief table locks;
-- every table involved is a few kB. Idempotent: safe to run twice (`DROP POLICY IF EXISTS` + `CREATE
-- POLICY`, `CREATE INDEX IF NOT EXISTS`, and `DO` blocks gated on current
-- catalog state). Service-role writers (drop_in_runs via
-- lib/game/server/supabase-admin.ts, the rate-limit read in
-- lib/user-conditions/rate-limit.ts) bypass RLS and are unaffected by the
-- policy changes; user writes to user_conditions / user_favorites /
-- dashboard_layouts go through the signed-in (authenticated) client.
--
-- VERIFY.
--   1. Supabase Dashboard → Advisors → Performance Advisor & Security Advisor:
--      - `auth_rls_initplan`: 0 warnings on `dashboard_layouts`,
--        `user_favorites`, `user_conditions`.
--      - `multiple_permissive_policies`: 0 warnings on `user_conditions` and
--        `drop_in_runs`.
--      - `unindexed_foreign_keys`: 0 warnings on `bug_reports`,
--        `drop_in_morning_conditions`, `powder_alert_log` (and none newly
--        introduced by the index drops).
--   2. SQL spot checks:
--      ```sql
--      -- Policies on the four tables (expect 1 on dashboard_layouts, 3 on
--      -- user_favorites, 3 on user_conditions, 2 on drop_in_runs; after 035 the
--      -- user_conditions INSERT policy is "No direct client user_conditions insert"):
--      select tablename, policyname, roles, cmd, qual, with_check
--      from pg_policies
--      where schemaname = 'public'
--        and tablename in ('dashboard_layouts', 'user_favorites', 'user_conditions', 'drop_in_runs')
--      order by tablename, cmd, policyname;
--
--      -- New FK covering indexes present (expect 3 rows):
--      select indexname from pg_indexes
--      where schemaname = 'public'
--        and indexname in (
--          'bug_reports_updated_by_idx',
--          'drop_in_morning_conditions_snow_report_id_idx',
--          'powder_alert_log_resort_id_idx'
--        );
--
--      -- Dropped unused indexes absent (expect 0 rows; any row left is one
--      -- the guard KEPT because it was the only index covering an FK, and
--      -- the apply output carries a NOTICE naming it):
--      select indexname from pg_indexes
--      where schemaname = 'public'
--        and indexname in (
--          'powder_alert_log_subscriber_idx',
--          'agent_memory_agent_idx',
--          'agent_convos_thread_idx',
--          'cam_reports_unresolved_idx',
--          'drop_in_runs_created_idx',
--          'idx_user_conditions_resort',
--          'idx_user_conditions_created',
--          'user_conditions_flagged_idx',
--          'data_source_readings_resort_id_reading_date_idx',
--          'idx_user_favorites_user'
--        );
--      ```
-- ─────────────────────────────────────────────────────────────

set local lock_timeout = '3s';

-- ── 1. RLS initplan: dashboard_layouts & user_favorites ─────
-- Wrap `auth.uid()` in `(select auth.uid())` so Postgres evaluates it once per
-- query as an InitPlan rather than per row.

drop policy if exists "Users can manage their own layouts" on public.dashboard_layouts;
create policy "Users can manage their own layouts"
  on public.dashboard_layouts for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can read own favorites" on public.user_favorites;
create policy "Users can read own favorites"
  on public.user_favorites for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own favorites" on public.user_favorites;
create policy "Users can insert own favorites"
  on public.user_favorites for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own favorites" on public.user_favorites;
create policy "Users can delete own favorites"
  on public.user_favorites for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ── 2. user_conditions: drop duplicate policies + initplan wrap ──
-- `004_user_conditions.sql` (lines 42–52) created `"Public user_conditions
-- read"`, `"Authenticated user_conditions insert"`, and `"Own user_conditions
-- delete"` (without `to authenticated`, so on `{public}`).
-- `019_reconcile_user_conditions.sql` reconciled `submitted_at → created_at`,
-- `user_conditions_resort_idx`, and `user_conditions_snow_quality_check`, but
-- created no policies; the second trio in live prod (`"Anyone can read
-- non-flagged conditions"`, `"Authenticated users can insert own conditions"`,
-- `"Users can delete own conditions"`) exists in no migration file (created by
-- hand in prod). We drop that untracked trio and recreate the
-- repo-tracked 004 policy names with `(select auth.uid())` and `to
-- authenticated` on insert/delete.

drop policy if exists "Anyone can read non-flagged conditions" on public.user_conditions;
drop policy if exists "Authenticated users can insert own conditions" on public.user_conditions;
drop policy if exists "Users can delete own conditions" on public.user_conditions;

drop policy if exists "Public user_conditions read" on public.user_conditions;
create policy "Public user_conditions read"
  on public.user_conditions for select
  using (is_flagged = false);

-- Guarded: once migration 035 has replaced the INSERT policy with
-- "No direct client user_conditions insert" (inserts go through
-- /api/user-conditions/submit with the service role), a re-run of this file
-- leaves it alone instead of reopening direct client inserts.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_conditions'
      and policyname = 'No direct client user_conditions insert'
  ) then
    raise notice 'Migration 035 is applied: leaving the user_conditions INSERT policy as 035 set it';
  else
    drop policy if exists "Authenticated user_conditions insert" on public.user_conditions;
    create policy "Authenticated user_conditions insert"
      on public.user_conditions for insert
      to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
end
$$;

drop policy if exists "Own user_conditions delete" on public.user_conditions;
create policy "Own user_conditions delete"
  on public.user_conditions for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ── 3. drop_in_runs: one permissive SELECT policy per role ──
-- Previously `"Public accepted leaderboard runs"` applied to `{anon,
-- authenticated}` and `"Users can read their own rejected runs"` applied to
-- `{authenticated}`, giving `authenticated` two permissive SELECT policies.
-- Scoping the first to `anon` and combining the `authenticated` predicate into
-- `accepted = true or user_id = (select auth.uid())` gives each role a single
-- policy with identical row visibility.

drop policy if exists "Public accepted leaderboard runs" on public.drop_in_runs;
drop policy if exists "Users can read their own rejected runs" on public.drop_in_runs;
drop policy if exists "Users can read accepted or own runs" on public.drop_in_runs;

create policy "Public accepted leaderboard runs"
  on public.drop_in_runs for select
  to anon
  using (accepted = true);

create policy "Users can read accepted or own runs"
  on public.drop_in_runs for select
  to authenticated
  using (accepted = true or user_id = (select auth.uid()));

-- ── 4. Foreign keys without a covering index ────────────────
-- Unpredicated B-tree indexes on the three FK columns flagged by the advisor:
--   - bug_reports(updated_by) → auth.users(id) (20260907190912_bug_report_reviewers.sql:14)
--   - drop_in_morning_conditions(snow_report_id) → snow_reports(id) (017_drop_in_morning_conditions.sql:7)
--   - powder_alert_log(resort_id) → resorts(id) (004_powder_alerts.sql:34; also
--     serves per-resort forecast feed reads in lib/alerts/feed-data.ts:61 and
--     opening-day dedupe in app/api/alerts/trigger/route.ts:290)

create index if not exists bug_reports_updated_by_idx
  on public.bug_reports (updated_by);

create index if not exists drop_in_morning_conditions_snow_report_id_idx
  on public.drop_in_morning_conditions (snow_report_id);

create index if not exists powder_alert_log_resort_id_idx
  on public.powder_alert_log (resort_id);

-- ── 5. Never-used indexes (29 audited: 10 DROP, 19 KEEP) ────
-- Decision rule: DROP only when no code path filters/sorts by those columns
-- AND no foreign key relies on the index for coverage; KEEP when the code's
-- query shape or a foreign key matches (many tables are currently empty or
-- have ≤4 rows in prod, so the planner has not needed an index scan yet).
--
-- Full 29-index ledger:
--
-- [resorts — 319 rows]
--   1. resorts_state_idx (state) → KEEP.
--      Taken off the drop list on 2026-11-21: the index is in use, so the
--      2026-11-07 `idx_scan = 0` reading is no reason to drop it.
--
-- [powder_alert_log — 1 row]
--   2. powder_alert_log_kind_date_idx (kind, alert_date) → KEEP.
--      Matches the opening-day deduplication query
--      `/powder_alert_log?kind=eq.opening&alert_date=eq.${today}&resort_id=in.(...)`
--      in app/api/alerts/trigger/route.ts:290 (0 scans only because no resort
--      has hit `confirmed_open = today` yet).
--   3. powder_alert_log_subscriber_idx (subscriber_id) → DROP.
--      Strict left-prefix duplicate of `powder_alert_log_forecast_idx
--      (subscriber_id, resort_id, kind, storm_start_date, alert_date)` and
--      `powder_alert_log_event_key (subscriber_id, resort_id, alert_date, ...)`.
--      No query filters `powder_alert_log` on `subscriber_id` alone
--      (app/api/alerts/trigger/route.ts:151 filters by `alert_date`;
--      lib/alerts/feed-data.ts:61 filters by `subscriber_id`, `resort_id`,
--      `kind`, and `alert_date`), and the `subscriber_id → alert_subscribers(id)`
--      FK (supabase/migrations/004_powder_alerts.sql:33) remains covered by
--      the leading column of `powder_alert_log_forecast_idx`.
--   4. powder_alert_log_forecast_idx (subscriber_id, resort_id, kind, storm_start_date, alert_date) → KEEP.
--      Leading columns `(subscriber_id, resort_id, kind)` serve the
--      per-subscriber forecast feed query in lib/alerts/feed-data.ts:61
--      (called from app/alerts/feed/[token]/route.ts:56,92) and cover the
--      `powder_alert_log.subscriber_id → alert_subscribers.id ON DELETE CASCADE`
--      FK used by app/api/alerts/unsubscribe/route.ts:14.
--
-- [condition_votes — empty]
--   5. condition_votes_resort_idx (resort_id) → KEEP.
--      Covers the `condition_votes.resort_id → resorts.id ON DELETE CASCADE` FK
--      (supabase/migrations/002_condition_votes.sql:12) and per-resort reads
--      through `resort_conditions_live` in `getLiveConditions()`
--      (lib/supabase.ts:386-389, called at app/resorts/[slug]/page.tsx:179).
--   6. condition_votes_created_idx (created_at desc) → KEEP.
--      Serves `WHERE created_at > now() - interval '12 hours'` in the
--      `resort_conditions_live` view (supabase/migrations/002_condition_votes.sql:56-57),
--      read by `getLiveConditions()` (lib/supabase.ts:386-389).
--   7. condition_votes_session_idx (session_id, resort_id) → KEEP.
--      Serves the hourly per-session rate-limit check
--      `.eq("resort_id", resortId).eq("session_id", sessionId).gte("created_at", ...)`
--      in `submitConditionVote()` (lib/supabase.ts:407-413, called from
--      app/api/conditions/vote/route.ts:35).
--
-- [agent_memory — empty]
--   8. agent_memory_entity_idx (entity) → KEEP.
--      Serves the unmatched-question review query
--      `WHERE entity = 'ask:unmatched' ORDER BY created_at DESC LIMIT 50`
--      for rows written by `logUnmatchedQuestion()` (lib/mcp/data.ts:50-65;
--      query documented in docs/runbook.md:540).
--   9. agent_memory_agent_idx (source_agent) → DROP.
--      No code path filters or sorts `agent_memory` by `source_agent`
--      (agents/loop.mjs:137 filters on `entity.ilike` + `expires_at` and
--      orders by `created_at desc`; lib/mcp/data.ts:57 only inserts).
--  10. agent_memory_created_idx (created_at desc) → KEEP.
--      Serves `order=created_at.desc&limit=10` in `recallMemories()`
--      (agents/loop.mjs:137) and `order by created_at desc limit 50` in
--      docs/runbook.md:540.
--
-- [agent_conversations — empty]
--  11. agent_convos_agent_idx (agent_key) → KEEP.
--      Serves `agent_conversations?agent_key=eq.${agentKey}&order=created_at.desc&limit=${limit}`
--      in `getRecentConversations()` (agents/loop.mjs:196).
--  12. agent_convos_thread_idx (thread_ts) → DROP.
--      No code path filters or sorts `agent_conversations` by `thread_ts`
--      (agents/loop.mjs:181 only inserts; agents/loop.mjs:196 is the sole
--      SELECT and filters by `agent_key`).
--  13. agent_convos_created_idx (created_at desc) → KEEP.
--      Serves `order=created_at.desc&limit=${limit}` in
--      `getRecentConversations()` (agents/loop.mjs:196).
--
-- [cam_reports — empty]
--  14. cam_reports_unresolved_idx (resolved) where resolved=false → DROP.
--      No code path filters or sorts `cam_reports` by `resolved`
--      (app/api/cam-reports/submit/route.ts:82-87 filters by `cam_id`,
--      `session_id`, `created_at`, and lines 126-136 filter by `cam_id`,
--      `created_at`; lib/cam-reports/email.ts:85 links to the Supabase table
--      filtered by `cam_id`).
--
-- [drop_in_runs — empty]
--  15. drop_in_runs_leaderboard_idx (resort_id, mode, trail_id, physics_version, course_version, score desc, time_ms) where accepted → KEEP.
--      Matches `topRuns()` in lib/game/server/run-repository.ts:188-207 and
--      covers the `drop_in_runs.resort_id → resorts.id` FK
--      (supabase/migrations/015_drop_in_runs.sql:25).
--  16. drop_in_runs_user_idx (user_id, created_at desc) where user_id is not null → KEEP.
--      Covers the `drop_in_runs.user_id → auth.users.id ON DELETE SET NULL` FK
--      (supabase/migrations/015_drop_in_runs.sql:26) and the `authenticated`
--      SELECT RLS policy predicate `user_id = (select auth.uid())`.
--  17. drop_in_runs_created_idx (created_at desc) → DROP.
--      No code path filters or sorts `drop_in_runs` by `created_at`
--      (lib/game/server/run-repository.ts:188-253 queries only by the course
--      tuple + `score`/`time_ms` or by primary key `id`).
--
-- [user_conditions — 1 row]
--  18. idx_user_conditions_resort (resort_id) → DROP.
--      Untracked hand-created index in prod; strict left-prefix duplicate of
--      `user_conditions_resort_idx (resort_id, created_at desc)`
--      (supabase/migrations/019_reconcile_user_conditions.sql:55-56).
--  19. idx_user_conditions_created (created_at desc) → DROP.
--      Untracked hand-created index in prod; every read on `user_conditions`
--      filters by `resort_id` first (lib/supabase.ts:439-446,
--      scripts/snotel-sync.ts:341, scripts/model-sync.ts:132,
--      lib/user-conditions/rate-limit.ts:31-38), which is served by
--      `user_conditions_resort_idx (resort_id, created_at desc)`.
--  20. user_conditions_resort_idx (resort_id, created_at desc) → KEEP.
--      Serves `getUserConditions()` (lib/supabase.ts:439-446), the 24h/48h
--      sync blends (scripts/snotel-sync.ts:341, scripts/model-sync.ts:132),
--      the submit rate limit (lib/user-conditions/rate-limit.ts:31-38), and
--      covers the `user_conditions.resort_id → resorts.id` FK
--      (supabase/migrations/004_user_conditions.sql:12).
--  21. user_conditions_user_idx (user_id) → KEEP.
--      Serves the submit rate-limit check `user_id=eq.${userId}`
--      (lib/user-conditions/rate-limit.ts:31-38), the DELETE RLS policy
--      `(select auth.uid()) = user_id`, and covers the
--      `user_conditions.user_id → auth.users.id ON DELETE CASCADE` FK
--      (supabase/migrations/004_user_conditions.sql:13).
--  22. user_conditions_flagged_idx (is_flagged) where is_flagged=true → DROP.
--      No code path queries `WHERE is_flagged = true`; all readers filter
--      `is_flagged = false` scoped to a `resort_id` (lib/supabase.ts:443,
--      scripts/snotel-sync.ts:341, scripts/model-sync.ts:132).
--
-- [cam_timelapses — 587 rows]
--  23. cam_timelapses_cam_window_idx (cam_id, "window", rendered_at desc) → KEEP.
--      Serves the `cam_timelapses.cam_id = cams.id` join and `rendered_at desc`
--      sort in `cam_timelapse_current` (supabase/migrations/031_cam_timelapses_render.sql:51-68),
--      queried by `getResortTimelapses()` (lib/supabase.ts:1037-1042), and is
--      the non-expression index covering the `cam_timelapses.cam_id → cams.id`
--      FK (supabase/migrations/025_resort_profile.sql:113).
--
-- [data_source_readings — 247 rows, dormant pipeline]
--  24. data_source_readings_resort_id_reading_date_idx (resort_id, reading_date) → DROP.
--      No code path filters or sorts `data_source_readings` by `(resort_id,
--      reading_date)`: `lib/pipeline/orchestrator.ts:155` only upserts on
--      `unique (resort_id, source, reading_date)`, and
--      `scripts/pipeline-inspect.mjs:39` orders by `fetched_at desc limit 1`.
--      The `resort_id → resorts.id` FK remains covered by the leading column of
--      `data_source_readings_resort_id_source_reading_date_key`
--      (supabase/migrations/007_data_pipeline.sql:56).
--
-- [user_favorites — 2 rows]
--  25. idx_user_favorites_user (user_id) → DROP.
--      Untracked hand-created index in prod; strict left-prefix duplicate of
--      `user_favorites_user_item_unique (user_id, item_type, item_id)`
--      (supabase/migrations/009_user_dashboard.sql:23-24) and
--      `user_favorites_user_idx (user_id, created_at desc)`
--      (supabase/migrations/008_user_favorites.sql:14-15), which already serve
--      every `.eq("user_id", user.id)` query (hooks/useDashboard.ts:194,
--      lib/favorites.ts:18-24, lib/lineup-favorites.ts:88-90,
--      components/ui/FavoriteButton.tsx:72-77, 119-123) and cover the
--      `user_favorites.user_id → auth.users.id` FK.
--  26. idx_user_favorites_resort (resort_id) → KEEP.
--      Although application queries now use `(user_id, item_type, item_id)`
--      (components/ui/FavoriteButton.tsx:72-77, lib/favorites.ts:18-24), the
--      nullable legacy column `user_favorites.resort_id` still carries the
--      foreign key `references resorts(id) on delete cascade`
--      (supabase/migrations/008_user_favorites.sql:9, retained by
--      009_user_dashboard.sql:26-27), and `idx_user_favorites_resort` is the
--      sole index covering that FK.
--
-- [alert_preferences]
--  27. alert_preferences_resort_idx (resort_id) → KEEP.
--      Serves the opening-day preference lookup
--      `/alert_preferences?resort_id=in.(${idList})&opening_day=is.true` in
--      app/api/alerts/trigger/route.ts:288 and covers the
--      `alert_preferences.resort_id → resorts.id ON DELETE CASCADE` FK
--      (supabase/migrations/004_powder_alerts.sql:21).
--
-- [bug_reports — 4 rows]
--  28. bug_reports_open (created_at desc) where status='open' → KEEP.
--      Matches the default admin inbox query
--      `db.from("bug_reports_inbox").select("*").order("created_at", { ascending: false })...eq("status", status)`
--      in app/api/admin/bug-reports/route.ts:10-12 (`status` defaults to
--      `'open'` in lib/bug-reports/review-schema.ts:3). 0 scans only because
--      the table has 4 rows.
--  29. bug_reports_duplicate_parent (duplicate_of) where duplicate_of is not null → KEEP.
--      Serves the `duplicate_count` correlated subquery in `bug_reports_inbox`
--      (supabase/migrations/20260907190912_bug_report_reviewers.sql:26), the
--      duplicate guard in `triage_bug_report()`
--      (20260907190912_bug_report_reviewers.sql:45), the group filter in
--      app/api/admin/bug-reports/route.ts:11, and covers the self-FK
--      `bug_reports.duplicate_of → bug_reports.id ON DELETE SET NULL`
--      (20260907190912_bug_report_reviewers.sql:11).

-- The drops run in a guarded loop rather than as bare `drop index` lines
-- because the live DB drifts from the repo files: an index is dropped only if
-- every foreign key it covers is still covered by another valid, non-partial
-- index on the same table (the shape the `unindexed_foreign_keys` lint
-- accepts). Four drops rely on that: `powder_alert_log_subscriber_idx`
-- (→ `powder_alert_log_forecast_idx`), `idx_user_conditions_resort`
-- (→ `user_conditions_resort_idx`), `data_source_readings_resort_id_reading_date_idx`
-- (→ the `unique (resort_id, source, reading_date)` index) and
-- `idx_user_favorites_user` (→ `user_favorites_user_idx` /
-- `user_favorites_user_item_unique`). If that covering index is missing in
-- prod, the index is KEPT and a NOTICE names it; nothing else changes.

do $$
declare
  idx_name  text;
  idx_oid   oid;
  tbl_oid   oid;
  blocking  text;
begin
  foreach idx_name in array array[
    'powder_alert_log_subscriber_idx',
    'agent_memory_agent_idx',
    'agent_convos_thread_idx',
    'cam_reports_unresolved_idx',
    'drop_in_runs_created_idx',
    'idx_user_conditions_resort',
    'idx_user_conditions_created',
    'user_conditions_flagged_idx',
    'data_source_readings_resort_id_reading_date_idx',
    'idx_user_favorites_user'
  ] loop
    idx_oid := to_regclass(format('public.%I', idx_name));
    if idx_oid is null then
      continue;  -- already dropped (re-run) or never existed in this DB
    end if;

    select i.indrelid into tbl_oid from pg_index i where i.indexrelid = idx_oid;

    -- FKs on the table whose columns are exactly the leading columns of this
    -- index and of no other valid, non-partial index.
    select string_agg(con.conname, ', ')
      into blocking
    from pg_constraint con
    join pg_index self on self.indexrelid = idx_oid
    where con.contype = 'f'
      and con.conrelid = tbl_oid
      and (string_to_array(self.indkey::text, ' ')::int2[])[1:cardinality(con.conkey)] @> con.conkey
      and (string_to_array(self.indkey::text, ' ')::int2[])[1:cardinality(con.conkey)] <@ con.conkey
      and not exists (
        select 1
        from pg_index other
        where other.indrelid = tbl_oid
          and other.indexrelid <> idx_oid
          and other.indisvalid
          and other.indpred is null
          and (string_to_array(other.indkey::text, ' ')::int2[])[1:cardinality(con.conkey)] @> con.conkey
          and (string_to_array(other.indkey::text, ' ')::int2[])[1:cardinality(con.conkey)] <@ con.conkey
      );

    if blocking is not null then
      raise notice 'Keeping public.%: it is the only index covering foreign key(s) %', idx_name, blocking;
      continue;
    end if;

    execute format('drop index public.%I', idx_name);
  end loop;
end
$$;
