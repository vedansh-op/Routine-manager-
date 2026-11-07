-- ONE-OS Phase 3: compact weekly snapshots only.
-- Daily task, habit, note, and completion history remains on each user's device.
create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  time_zone text not null,
  report jsonb not null default '{}'::jsonb check (jsonb_typeof(report) = 'object'),
  shared_with_partner boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create index if not exists weekly_reports_user_week_idx
  on public.weekly_reports (user_id, week_start desc);

alter table public.weekly_reports enable row level security;

drop policy if exists "Users can read their own weekly reports" on public.weekly_reports;
create policy "Users can read their own weekly reports"
  on public.weekly_reports for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Partners can read explicitly shared weekly reports" on public.weekly_reports;
create policy "Partners can read explicitly shared weekly reports"
  on public.weekly_reports for select
  to authenticated
  using (
    shared_with_partner = true
    and exists (
      select 1
      from public.space_members mine
      join public.space_members partner
        on partner.space_id = mine.space_id
      where mine.user_id = auth.uid()
        and partner.user_id = weekly_reports.user_id
    )
  );

drop policy if exists "Users can create their own weekly reports" on public.weekly_reports;
create policy "Users can create their own weekly reports"
  on public.weekly_reports for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can update their own weekly reports" on public.weekly_reports;
create policy "Users can update their own weekly reports"
  on public.weekly_reports for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can delete their own weekly reports" on public.weekly_reports;
create policy "Users can delete their own weekly reports"
  on public.weekly_reports for delete
  to authenticated
  using (user_id = auth.uid());

drop trigger if exists set_weekly_reports_updated_at on public.weekly_reports;
create trigger set_weekly_reports_updated_at
  before update on public.weekly_reports
  for each row execute procedure public.set_updated_at();

comment on table public.weekly_reports is
  'Compact opt-in weekly summaries only. Raw daily personal activity belongs in device-local storage.';
comment on column public.weekly_reports.report is
  'Aggregated summary fields only; never store task titles, notes, daily event rows, or photo bytes here.';
