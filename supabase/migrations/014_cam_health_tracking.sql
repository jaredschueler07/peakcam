-- ─────────────────────────────────────────────────────────────
-- Migration 014 — cam health tracking
-- Adds the failure-count state that lets cam-health-check.mjs
-- auto-disable dead cams (3 consecutive failed daily checks) and
-- auto-recover them on the next success. auto_disabled distinguishes
-- script-disabled cams (safe to auto-re-enable) from manually
-- disabled ones (never touched by the script).
-- ─────────────────────────────────────────────────────────────

alter table cams add column if not exists consecutive_failures integer not null default 0;
alter table cams add column if not exists auto_disabled boolean not null default false;
