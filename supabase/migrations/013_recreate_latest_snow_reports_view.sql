-- ─────────────────────────────────────────────────────────────
-- Migration 013 — recreate the latest_snow_reports view
--
-- The view was created in 001 as `select distinct on (resort_id) *`,
-- and Postgres freezes a view's column list at creation time. Nine
-- columns added to snow_reports since (005: swe_in, pct_of_normal,
-- trend_7d, outlook, auto_cond_rating; 007: confidence, source_count,
-- sources_used; out-of-band/012: snowing_now) were therefore never
-- exposed through the view — the UI's trend arrows, % of normal, and
-- snowing-now badges have been silently receiving undefined.
--
-- NOTE FOR FUTURE MIGRATIONS: any migration that adds a column to
-- snow_reports MUST also drop and recreate this view, or the new
-- column will be invisible to every view consumer.
-- ─────────────────────────────────────────────────────────────

drop view if exists latest_snow_reports;

create view latest_snow_reports as
  select distinct on (resort_id) *
  from snow_reports
  order by resort_id, updated_at desc;
