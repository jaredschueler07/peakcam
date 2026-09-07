-- Private support inbox. Anonymous reports enter only through the server route.
create table public.bug_reports (
  id uuid primary key,
  created_at timestamptz not null default now(),
  description text not null check (char_length(description) between 10 and 4000),
  page_path text not null check (char_length(page_path) <= 300),
  diagnostics jsonb check (diagnostics is null or (jsonb_typeof(diagnostics) = 'object' and octet_length(diagnostics::text) <= 30000)),
  session_hash text not null check (session_hash ~ '^[a-f0-9]{64}$'),
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{64}$'),
  server_release text not null,
  status text not null default 'open' check (status in ('open', 'triaged', 'resolved')),
  admin_note text
);
create index bug_reports_session_recent on public.bug_reports (session_hash, created_at desc);
create index bug_reports_ip_recent on public.bug_reports (ip_hash, created_at desc);
create index bug_reports_open on public.bug_reports (created_at desc) where status = 'open';
alter table public.bug_reports enable row level security;
revoke all on public.bug_reports from public, anon, authenticated;
grant select, insert, update, delete on public.bug_reports to service_role;

-- The insert and limits share one transaction, including concurrent retries.
-- SECURITY INVOKER + service-role-only EXECUTE, never a public privileged RPC.
create function public.submit_bug_report(
  p_id uuid, p_description text, p_page_path text, p_diagnostics jsonb,
  p_session_hash text, p_ip_hash text, p_server_release text
) returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  -- Always acquire locks in the same order: IP first, session second.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bug-ip:' || p_ip_hash, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bug-session:' || p_session_hash, 0));
  if exists (select 1 from public.bug_reports where id = p_id and session_hash = p_session_hash) then
    return p_id;
  end if;
  if (select count(*) from public.bug_reports where session_hash = p_session_hash and created_at > now() - interval '10 minutes') >= 3
     or (select count(*) from public.bug_reports where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'bug_report_rate_limited';
  end if;
  insert into public.bug_reports (id, description, page_path, diagnostics, session_hash, ip_hash, server_release)
    values (p_id, p_description, p_page_path, p_diagnostics, p_session_hash, p_ip_hash, p_server_release);
  return p_id;
end;
$$;
revoke all on function public.submit_bug_report(uuid, text, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_bug_report(uuid, text, text, jsonb, text, text, text) to service_role;
