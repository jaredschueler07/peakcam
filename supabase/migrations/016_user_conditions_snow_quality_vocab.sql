-- 016: align user_conditions.snow_quality with the vocabulary the app submits.
--
-- 004_user_conditions.sql constrained snow_quality to ('powder','packed','icy','slush'),
-- but lib/types.ts, the submit route and UserConditionsForm all use
-- ('powder','packed','crud','ice','spring') — the same set 002_condition_votes.sql uses.
-- Constraint name is the Postgres default for an inline column check.

alter table user_conditions
  drop constraint if exists user_conditions_snow_quality_check;

alter table user_conditions
  add constraint user_conditions_snow_quality_check
  check (snow_quality in ('powder', 'packed', 'crud', 'ice', 'spring'));
