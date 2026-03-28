-- ─────────────────────────────────────────────────────────────
-- PeakCam — User Dashboard + Favorites Schema Evolution
-- Evolves user_favorites from resort-only to polymorphic
-- (resort, cam, region) and adds dashboard_layouts table.
-- ─────────────────────────────────────────────────────────────

-- ── Evolve user_favorites ────────────────────────────────────
-- Add polymorphic columns
alter table user_favorites
  add column if not exists item_type text default 'resort'
    check (item_type in ('resort', 'cam', 'region')),
  add column if not exists item_id uuid;

-- Backfill: copy resort_id into item_id for existing rows
update user_favorites set item_id = resort_id where item_id is null;

-- Make item_id not null now that backfill is done
alter table user_favorites alter column item_id set not null;
alter table user_favorites alter column item_type set not null;

-- Drop old unique constraint and add new polymorphic one
alter table user_favorites drop constraint if exists user_favorites_user_id_resort_id_key;
alter table user_favorites add constraint user_favorites_user_item_unique
  unique (user_id, item_type, item_id);

-- resort_id is now redundant — keep for backward compat but allow null
alter table user_favorites alter column resort_id drop not null;

-- ── dashboard_layouts ────────────────────────────────────────
-- Stores the custom grid configuration for a user's dashboard.
create table if not exists dashboard_layouts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade unique,
  config      jsonb not null default '{"widgets": []}',
  updated_at  timestamptz not null default now()
);

alter table dashboard_layouts enable row level security;

create policy "Users can manage their own layouts"
  on dashboard_layouts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
