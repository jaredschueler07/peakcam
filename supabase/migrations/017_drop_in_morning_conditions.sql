-- Apply manually before v3 Daily Line deployment. No historical run rows changed.
create table if not exists public.drop_in_morning_conditions (
  resort_slug text not null references public.resorts(slug),
  conditions_date date not null,
  snapshot jsonb not null,
  captured_at timestamptz not null,
  snow_report_id uuid not null references public.snow_reports(id),
  weather_available boolean not null,
  primary key (resort_slug, conditions_date)
);
alter table public.drop_in_morning_conditions enable row level security;
-- Service role only. Application inserts ON CONFLICT DO NOTHING and never updates.
create or replace function public.drop_in_immutable_morning() returns trigger
language plpgsql as $$ begin raise exception 'Morning conditions are immutable'; end $$;
create trigger drop_in_morning_no_update before update or delete
on public.drop_in_morning_conditions for each row execute function public.drop_in_immutable_morning();

alter table public.drop_in_runs add column if not exists conditions_date date;
alter table public.drop_in_runs add column if not exists conditions_snapshot jsonb;
alter table public.drop_in_runs add column if not exists input_tape bytea;
create index if not exists drop_in_daily_conditions_board on public.drop_in_runs
(resort_id, mode, trail_id, physics_version, course_version, conditions_date) where accepted;
