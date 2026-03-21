-- ─────────────────────────────────────────────────────────────
-- PeakCam — Powder Alert Email Notifications
-- Migration 004
-- ─────────────────────────────────────────────────────────────

-- One row per unique email address
create table if not exists alert_subscribers (
  id           uuid primary key default gen_random_uuid(),
  email        text unique not null,
  manage_token text unique not null default encode(gen_random_bytes(32), 'hex'),
  created_at   timestamptz not null default now()
);

create index if not exists alert_subscribers_email_idx        on alert_subscribers (email);
create index if not exists alert_subscribers_manage_token_idx on alert_subscribers (manage_token);

-- One row per (subscriber, resort) — the alert preference
create table if not exists alert_preferences (
  id               uuid primary key default gen_random_uuid(),
  subscriber_id    uuid not null references alert_subscribers(id) on delete cascade,
  resort_id        uuid not null references resorts(id) on delete cascade,
  threshold_inches integer not null default 6 check (threshold_inches > 0),
  created_at       timestamptz not null default now(),
  unique (subscriber_id, resort_id)
);

create index if not exists alert_preferences_subscriber_idx on alert_preferences (subscriber_id);
create index if not exists alert_preferences_resort_idx     on alert_preferences (resort_id);

-- Deduplication log — one alert per (subscriber, resort, calendar day)
create table if not exists powder_alert_log (
  id               uuid primary key default gen_random_uuid(),
  subscriber_id    uuid not null references alert_subscribers(id) on delete cascade,
  resort_id        uuid not null references resorts(id) on delete cascade,
  new_snow_inches  integer not null,
  alert_date       date not null default current_date,
  sent_at          timestamptz not null default now(),
  unique (subscriber_id, resort_id, alert_date)
);

create index if not exists powder_alert_log_subscriber_idx on powder_alert_log (subscriber_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- All three tables are write-only via service role key (no public reads)

alter table alert_subscribers  enable row level security;
alter table alert_preferences  enable row level security;
alter table powder_alert_log   enable row level security;

-- Service role bypasses RLS — no policies needed for server-side writes.
-- Deny all access via anon/authenticated keys:
create policy "no public access" on alert_subscribers  for all using (false);
create policy "no public access" on alert_preferences  for all using (false);
create policy "no public access" on powder_alert_log   for all using (false);
