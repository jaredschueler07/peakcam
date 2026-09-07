-- Supabase default privileges grant service_role ALL on new relations.
-- The application can look up membership but cannot enroll or remove reviewers.
revoke all on public.bug_report_reviewers from service_role;
grant select on public.bug_report_reviewers to service_role;
revoke all on public.bug_reports_inbox from service_role;
grant select on public.bug_reports_inbox to service_role;
