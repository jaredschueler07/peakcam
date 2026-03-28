-- ─────────────────────────────────────────────────────────────
-- PeakCam — User Favorites
-- Allows authenticated users to save/bookmark resorts.
-- ─────────────────────────────────────────────────────────────

create table if not exists user_favorites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  resort_id  uuid not null references resorts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, resort_id)
);

create index if not exists user_favorites_user_idx
  on user_favorites (user_id, created_at desc);

-- ── Row Level Security ──────────────────────────────────────
-- Users can only see, add, and remove their own favorites.

alter table user_favorites enable row level security;

create policy "Users can read own favorites"
  on user_favorites for select
  using (auth.uid() = user_id);

create policy "Users can insert own favorites"
  on user_favorites for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own favorites"
  on user_favorites for delete
  using (auth.uid() = user_id);
