-- ─────────────────────────────────────────────────────────────
-- PeakCam — User-Verified Conditions
-- "Waze for ski conditions" — crowd-sourced snow quality and
-- comfort reports from skiers on the mountain.
-- ─────────────────────────────────────────────────────────────

-- ── condition_votes ─────────────────────────────────────────
-- Each row is one user's report from one resort at one point in time.

create table if not exists condition_votes (
  id              uuid primary key default gen_random_uuid(),
  resort_id       uuid not null references resorts(id) on delete cascade,
  session_id      text not null,                -- anonymous browser session identifier
  snow_quality    text
                  check (snow_quality in ('powder', 'packed', 'crud', 'ice', 'spring')),
  comfort         text
                  check (comfort in ('warm', 'perfect', 'cold', 'freezing')),
  comment         text,                         -- optional short note (max 280 chars enforced in app)
  created_at      timestamptz not null default now()
);

create index if not exists condition_votes_resort_idx
  on condition_votes (resort_id);
create index if not exists condition_votes_created_idx
  on condition_votes (created_at desc);
create index if not exists condition_votes_session_idx
  on condition_votes (session_id, resort_id);

-- ── Row Level Security ──────────────────────────────────────
-- Anyone can read votes. Anyone can insert (anonymous).
-- No updates or deletes — votes are immutable.

alter table condition_votes enable row level security;

create policy "Public condition_votes read"
  on condition_votes for select
  using (true);

create policy "Public condition_votes insert"
  on condition_votes for insert
  with check (true);

-- ── Aggregated view ─────────────────────────────────────────
-- Recent votes (last 12 hours) per resort, aggregated.
-- This is what the UI queries — not the raw votes table.

create or replace view resort_conditions_live as
  with recent_votes as (
    select
      resort_id,
      snow_quality,
      comfort,
      created_at,
      -- Weight: votes decay linearly over 12 hours (1.0 → 0.0)
      greatest(0, 1.0 - extract(epoch from (now() - created_at)) / 43200.0) as weight
    from condition_votes
    where created_at > now() - interval '12 hours'
  ),
  quality_ranked as (
    select
      resort_id,
      snow_quality,
      count(*) as vote_count,
      sum(weight) as weighted_score,
      row_number() over (
        partition by resort_id
        order by sum(weight) desc
      ) as rn
    from recent_votes
    where snow_quality is not null
    group by resort_id, snow_quality
  ),
  comfort_ranked as (
    select
      resort_id,
      comfort,
      count(*) as vote_count,
      sum(weight) as weighted_score,
      row_number() over (
        partition by resort_id
        order by sum(weight) desc
      ) as rn
    from recent_votes
    where comfort is not null
    group by resort_id, comfort
  )
  select
    r.resort_id,
    q.snow_quality as top_snow_quality,
    q.vote_count as snow_quality_votes,
    round(q.weighted_score::numeric, 2) as snow_quality_score,
    c.comfort as top_comfort,
    c.vote_count as comfort_votes,
    round(c.weighted_score::numeric, 2) as comfort_score,
    (select count(*) from recent_votes rv where rv.resort_id = r.resort_id) as total_votes_12h
  from (select distinct resort_id from recent_votes) r
  left join quality_ranked q on q.resort_id = r.resort_id and q.rn = 1
  left join comfort_ranked c on c.resort_id = r.resort_id and c.rn = 1;
