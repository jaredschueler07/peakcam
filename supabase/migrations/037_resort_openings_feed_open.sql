-- ─────────────────────────────────────────────────────────────
-- Migration 037 — feed-detected season openings.
--
-- WHY. A resort's season only "started" for the status rules
-- (lib/conditions-contract.ts) once someone typed a confirmed_open by hand.
-- Until then, every hour the lift feed did not decide (before first chair
-- with lifts listed as scheduled, the gap before the first lift turns, a
-- closed day) read UNKNOWN once the projected date had passed: Big Sky,
-- Crested Butte, Park City and Alta did so on the morning of 2026-11-26 after
-- running lifts all day on Nov 25.
--
-- WHAT. Two nullable columns on resort_openings:
--   feed_open           the resort-local day the operator lift feed showed a
--                       sustained, plausible lift day (lib/feed-opening.ts:
--                       two or more open readings at or after 08:00 local over
--                       30+ minutes; before the date on file, four over 90+
--                       minutes and under 80 % of the lifts, so the Beaver
--                       Creek glitch of 2026-11-23 never qualifies);
--   feed_open_evidence  what the feed showed, for a person to check.
-- Written by scripts/operator-sync.ts (service role) only while feed_open is
-- null, so a stored day is never moved.
--
-- EMAIL. When operator-sync stores a feed_open that is the resort's local
-- today, it calls app/api/alerts/feed-openings, which sends the opening-day
-- email to that resort's subscribers that same day, before 16:00 local, and
-- once per resort per season (lib/alerts/feed-opening-email.ts). A feed day
-- found after the fact mails nobody. The trigger cron still mails
-- confirmed_open days, now skipping a resort whose season feed_open started
-- earlier and deduping over the whole season. No schema change is needed for
-- the email: it logs to powder_alert_log with kind = 'opening' as before.
--
-- SEED. scripts/seed-resort-openings.mjs upserts with merge-duplicates and
-- sends only the CSV's columns, so a re-seed leaves feed_open alone. It does
-- still delete a row whose resort is not in the CSV, feed_open included.
--
-- APPLY. By hand (SQL Editor / MCP apply_migration); idempotent. The code
-- reads the columns softly: before this runs, operator-sync logs that it is
-- skipping feed openings and the site behaves exactly as before.
-- ─────────────────────────────────────────────────────────────

alter table public.resort_openings
  add column if not exists feed_open date,
  add column if not exists feed_open_evidence text;

comment on column public.resort_openings.feed_open is
  'Resort-local day the operator lift feed showed a sustained lift day (lib/feed-opening.ts). Starts the season for the status rules; mailed same-day only, via app/api/alerts/feed-openings.';
comment on column public.resort_openings.feed_open_evidence is
  'What the operator feed showed on feed_open, written by scripts/operator-sync.ts.';
