-- ─────────────────────────────────────────────────────────────
-- Migration 012 — South America expansion
-- Adds resorts.country (for Chile/Argentina resorts fed by the
-- new model-sync pipeline instead of SNOTEL), extends
-- snow_reports.source to admit 'open_meteo', and fixes the cams
-- table's missing unique constraint (import-resorts-standalone.mjs
-- previously could duplicate cam rows on re-run).
-- ─────────────────────────────────────────────────────────────

-- ── resorts.country ──────────────────────────────────────────
alter table resorts add column if not exists country text not null default 'US';

update resorts set country = 'CA' where state = 'BC';

create index if not exists resorts_country_idx on resorts (country);

-- ── snow_reports.source — admit 'open_meteo' ─────────────────
alter table snow_reports drop constraint if exists snow_reports_source_check;

alter table snow_reports add constraint snow_reports_source_check
  check (source in ('snotel','manual','resort','pipeline','open_meteo'));

-- ── cams — dedupe then add a real unique constraint ──────────
-- import-resorts-standalone.mjs previously inserted with
-- `Prefer: resolution=ignore-duplicates` and no on_conflict target,
-- which is a no-op without a unique constraint — re-running the
-- importer duplicated every cam row. Dedupe first (keep the
-- earliest row per resort_id + embed_url + name), then add the
-- constraint.
--
-- The key includes `name`, not just (resort_id, embed_url), because
-- `embed_type='link'` cams intentionally share one embed_url across
-- multiple distinct named cams at the same resort (the "embed" is a
-- link-out to the resort's one general webcams page — e.g. Red River
-- Ski Area has "The Face" and "Town", different named cams, both
-- pointing at the same page). A key of (resort_id, embed_url) alone
-- would wrongly treat those as duplicates. Adding `name` still catches
-- the real bug (exact re-insert of the same cam row on importer re-run)
-- while allowing legitimately distinct link-out cams to coexist.

delete from cams a using cams b
  where a.resort_id = b.resort_id
    and a.embed_url = b.embed_url
    and a.name = b.name
    and a.embed_url is not null
    and (a.created_at > b.created_at
         or (a.created_at = b.created_at and a.id > b.id));

-- Not partial: PostgREST's on_conflict= query parameter only accepts a
-- plain column list, and Postgres's ON CONFLICT inference requires the
-- conflict target's predicate to syntactically match a partial index's
-- predicate exactly — a bare column list can never infer a partial
-- index, so any upsert through the REST API would fail with "no unique
-- or exclusion constraint matching the ON CONFLICT specification"
-- (verified against the live DB). No predicate is needed anyway:
-- Postgres never treats NULL as equal to another NULL for uniqueness,
-- so rows with embed_url IS NULL already coexist freely under a plain
-- unique index.
create unique index if not exists cams_resort_embed_url_idx
  on cams (resort_id, embed_url, name);
