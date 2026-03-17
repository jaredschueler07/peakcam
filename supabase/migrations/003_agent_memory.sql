-- ─────────────────────────────────────────────────────────────
-- PeakCam — Agent Shared Memory & Conversation Persistence
-- Transforms agents from independent chatbots into a team
-- with collective knowledge.
-- ─────────────────────────────────────────────────────────────

-- ── agent_memory ────────────────────────────────────────────
-- Shared knowledge base that all agents read from and write to.
-- Stores facts, decisions, and learnings from conversations.

create table if not exists agent_memory (
  id              uuid primary key default gen_random_uuid(),
  entity          text not null,           -- e.g. "resort:vail", "decision:hosting", "feature:snotel-pipeline"
  fact            text not null,           -- the knowledge being stored
  source_agent    text not null,           -- which agent created this memory
  source_thread   text,                    -- slack thread_ts for provenance
  confidence      real not null default 1.0,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz              -- optional TTL for time-sensitive facts
);

create index if not exists agent_memory_entity_idx on agent_memory (entity);
create index if not exists agent_memory_agent_idx on agent_memory (source_agent);
create index if not exists agent_memory_created_idx on agent_memory (created_at desc);

-- ── agent_conversations ─────────────────────────────────────
-- Summaries of completed conversations for long-term recall.

create table if not exists agent_conversations (
  id              uuid primary key default gen_random_uuid(),
  agent_key       text not null,
  channel         text not null,
  thread_ts       text not null,
  user_id         text,
  summary         text not null,           -- AI-generated conversation summary
  outcome         text,                    -- what was decided or delivered
  entities        text[] default '{}',     -- entities discussed (for search)
  created_at      timestamptz not null default now()
);

create index if not exists agent_convos_agent_idx on agent_conversations (agent_key);
create index if not exists agent_convos_thread_idx on agent_conversations (thread_ts);
create index if not exists agent_convos_created_idx on agent_conversations (created_at desc);

-- ── Row Level Security ──────────────────────────────────────
-- Agents read/write via anon key (memory is team-internal, not user-facing)

alter table agent_memory enable row level security;
alter table agent_conversations enable row level security;

create policy "Agents read memory"
  on agent_memory for select using (true);

create policy "Agents write memory"
  on agent_memory for insert with check (true);

create policy "Agents read conversations"
  on agent_conversations for select using (true);

create policy "Agents write conversations"
  on agent_conversations for insert with check (true);
