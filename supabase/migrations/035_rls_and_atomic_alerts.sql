-- ─────────────────────────────────────────────────────────────
-- Migration 035 — RLS hardening, atomic alert subscribe RPC,
-- and per-source snow_reports index.
--
-- Manual apply only (agents never mutate production Supabase), the whole
-- file in one run so it is one transaction and `set local lock_timeout`
-- applies (a statement that waits more than 3 s for a lock fails and rolls
-- the migration back; re-run it then).
--
-- ORDER. Apply only AFTER the code that writes with the service role is
-- live in both places: on Vercel (`/api/user-conditions/submit`, the `/ask`
-- unmatched-question log in `lib/mcp/data.ts`) and on the Mac Mini
-- (`agents/loop.mjs`, pulled and the agents job restarted). Applied earlier,
-- sections 1 and 2 make those writes fail: user condition reports are
-- rejected and unmatched questions and agent memory are silently lost.
-- The runtime code works both before and after this migration.
-- ─────────────────────────────────────────────────────────────

set local lock_timeout = '3s';

-- ── 1. Lock down agent_memory & agent_conversations (B-13) ───
-- Migration 003 exposed public anon SELECT/INSERT on both tables
-- (`using (true)`), leaking unmatched /ask queries + ipHashes.
-- Server callers (`lib/mcp/data.ts`, `agents/loop.mjs`) now use
-- `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS.

drop policy if exists "Agents read memory" on public.agent_memory;
drop policy if exists "Agents write memory" on public.agent_memory;
drop policy if exists "Agents read conversations" on public.agent_conversations;
drop policy if exists "Agents write conversations" on public.agent_conversations;

drop policy if exists "Deny public agent_memory access" on public.agent_memory;
create policy "Deny public agent_memory access"
  on public.agent_memory
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "Deny public agent_conversations access" on public.agent_conversations;
create policy "Deny public agent_conversations access"
  on public.agent_conversations
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- ── 2. Prevent unvalidated direct client user_conditions inserts (B-13) ─
-- Direct authenticated inserts let callers bypass /api/user-conditions/submit's
-- profanity filter (`is_flagged = false` spoofing) and hourly rate limit.
-- Keep public read of non-flagged rows and user-owned delete.

drop policy if exists "Authenticated user_conditions insert" on public.user_conditions;
drop policy if exists "Authenticated users can insert own conditions" on public.user_conditions;
drop policy if exists "No direct client user_conditions insert" on public.user_conditions;

create policy "No direct client user_conditions insert"
  on public.user_conditions
  for insert
  to anon, authenticated
  with check (false);

-- ── 3. Transactional alert subscription creation (B-32) ──────
-- Atomically creates a subscriber row and its initial alert_preferences
-- in one transaction so a partial failure never orphans a preference-less
-- subscriber row.

drop function if exists public.create_alert_subscription(text, jsonb);

create or replace function public.create_alert_subscription(
  p_email text,
  p_prefs jsonb
)
returns table (
  out_kind text,
  out_subscriber_id uuid,
  out_email text,
  out_manage_token text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_sub_id uuid;
  v_sub_email text;
  v_manage_token text;
begin
  insert into public.alert_subscribers (email)
  values (v_email)
  on conflict on constraint alert_subscribers_email_key do nothing
  returning
    alert_subscribers.id,
    alert_subscribers.email,
    alert_subscribers.manage_token
  into v_sub_id, v_sub_email, v_manage_token;

  if v_sub_id is null then
    select s.id, s.email, s.manage_token
      into v_sub_id, v_sub_email, v_manage_token
    from public.alert_subscribers s
    where s.email = v_email
    limit 1;

    if v_sub_id is null then
      raise exception 'alert_subscribers row missing after conflict';
    end if;

    return query select 'exists'::text, v_sub_id, v_sub_email, v_manage_token;
    return;
  end if;

  insert into public.alert_preferences (
    subscriber_id,
    resort_id,
    threshold_inches,
    opening_day
  )
  select
    v_sub_id,
    (pref->>'resort_id')::uuid,
    greatest(1, least(48, coalesce((pref->>'threshold_inches')::integer, 6))),
    coalesce((pref->>'opening_day')::boolean, false)
  from jsonb_array_elements(coalesce(p_prefs, '[]'::jsonb)) as pref
  on conflict on constraint alert_preferences_subscriber_id_resort_id_key do nothing;

  return query select 'created'::text, v_sub_id, v_sub_email, v_manage_token;
end;
$$;

revoke all on function public.create_alert_subscription(text, jsonb) from public, anon, authenticated;
grant execute on function public.create_alert_subscription(text, jsonb) to service_role;

-- ── 4. Per-source snow_reports index (B-38) ──────────────────

create index if not exists snow_reports_source_updated_idx
  on public.snow_reports (source, updated_at desc);
