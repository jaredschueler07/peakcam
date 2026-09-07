-- Only an operator can enroll a reviewer; membership is never user-editable.
create table public.bug_report_reviewers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.bug_report_reviewers enable row level security;
revoke all on public.bug_report_reviewers from public, anon, authenticated;
grant select on public.bug_report_reviewers to service_role;

alter table public.bug_reports
  add column duplicate_of uuid references public.bug_reports(id) on delete set null,
  add column revision integer not null default 0,
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid references auth.users(id) on delete set null,
  add constraint bug_report_not_self_duplicate check (duplicate_of is null or duplicate_of <> id),
  add constraint bug_report_duplicate_resolved check (duplicate_of is null or status = 'resolved');
create index bug_reports_duplicate_parent on public.bug_reports (duplicate_of) where duplicate_of is not null;
create function public.touch_bug_report() returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.revision := old.revision + 1; new.updated_at := now(); return new; end;
$$;
revoke all on function public.touch_bug_report() from public, anon, authenticated;
create trigger touch_bug_report before update on public.bug_reports for each row execute function public.touch_bug_report();

create view public.bug_reports_inbox with (security_invoker = true) as
select r.id, r.created_at, r.description, r.page_path, r.status, r.duplicate_of, r.revision,
  (select count(*) from public.bug_reports d where d.duplicate_of = r.id) as duplicate_count
from public.bug_reports r;
revoke all on public.bug_reports_inbox from public, anon, authenticated;
grant select on public.bug_reports_inbox to service_role;

-- Serialize grouping changes so simultaneous edits cannot create a cycle or nested groups.
create function public.triage_bug_report(p_id uuid, p_actor uuid, p_revision integer, p_status text, p_note text, p_duplicate_of uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare current_revision integer; next_revision integer;
begin
  if not exists (select 1 from public.bug_report_reviewers where user_id = p_actor) then raise exception 'reviewer_required'; end if;
  if p_status not in ('open','triaged','resolved') or p_status is null or p_note is null or char_length(p_note) > 4000 then raise exception 'invalid_triage'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bug-report-triage', 0));
  select revision into current_revision from public.bug_reports where id = p_id for update;
  if not found then raise exception 'report_not_found'; end if;
  if p_revision is null or current_revision <> p_revision then raise exception 'report_conflict'; end if;
  if p_duplicate_of is not null then
    if p_duplicate_of = p_id or p_status <> 'resolved'
      or not exists (select 1 from public.bug_reports where id = p_duplicate_of and duplicate_of is null)
      or exists (select 1 from public.bug_reports where duplicate_of = p_id)
    then raise exception 'invalid_duplicate'; end if;
  end if;
  update public.bug_reports set status = p_status, admin_note = nullif(p_note, ''), duplicate_of = p_duplicate_of, updated_by = p_actor
    where id = p_id returning revision into next_revision;
  return next_revision;
end;
$$;
revoke all on function public.triage_bug_report(uuid, uuid, integer, text, text, uuid) from public, anon, authenticated;
grant execute on function public.triage_bug_report(uuid, uuid, integer, text, text, uuid) to service_role;
