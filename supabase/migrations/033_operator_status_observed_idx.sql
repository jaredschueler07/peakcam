-- ─────────────────────────────────────────────────────────────
-- 033 — operator_status: index for the "last 30 hours, every resort" read.
--
-- lib/supabase.ts fetchRecentOperatorReadings() reads every resort's lift
-- readings from the last 30 h in one query (`observed_at >= now − 30 h`,
-- newest first) so the day rules in lib/operator-day.ts can see a resort's
-- whole local day. Migration 032's only index leads with resort_id, so that
-- filter cannot use it and scans the table. The table grows by about 1,900
-- rows a day (93 resorts × 20 runs); the scan is harmless for months but
-- would eventually press on the anon role's 3 s statement_timeout.
--
-- The read works without this index. CONCURRENTLY so the half-hourly
-- operator-sync inserts are not blocked; run it on its own (it cannot run
-- inside a transaction block).
--
-- APPLY. By hand (SQL Editor, as a single statement); safe to re-run.
-- ─────────────────────────────────────────────────────────────

create index concurrently if not exists operator_status_observed_idx
  on public.operator_status (observed_at desc);
