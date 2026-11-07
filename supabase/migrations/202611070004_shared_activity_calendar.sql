-- ONE-OS Phase 4: shared activity calendar.
-- Only records explicitly created in the shared space are stored in the cloud.
create table if not exists public.shared_activities (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  note text,
  starts_at timestamptz not null,
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shared_activities_space_starts_idx
  on public.shared_activities (space_id, starts_at);

alter table public.shared_activities enable row level security;

drop policy if exists "Shared space members can read activities" on public.shared_activities;
create policy "Shared space members can read activities"
  on public.shared_activities for select
  to authenticated
  using (public.is_space_member(space_id));

drop policy if exists "Members can add shared activities" on public.shared_activities;
create policy "Members can add shared activities"
  on public.shared_activities for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_space_member(space_id)
  );

drop policy if exists "Creators can edit their shared activities" on public.shared_activities;
create policy "Creators can edit their shared activities"
  on public.shared_activities for update
  to authenticated
  using (created_by = auth.uid() and public.is_space_member(space_id))
  with check (created_by = auth.uid() and public.is_space_member(space_id));

drop policy if exists "Creators can delete their shared activities" on public.shared_activities;
create policy "Creators can delete their shared activities"
  on public.shared_activities for delete
  to authenticated
  using (created_by = auth.uid() and public.is_space_member(space_id));

drop trigger if exists set_shared_activities_updated_at on public.shared_activities;
create trigger set_shared_activities_updated_at
  before update on public.shared_activities
  for each row execute procedure public.set_updated_at();

comment on table public.shared_activities is
  'Explicitly shared calendar events only. Private personal tasks and daily history stay on-device.';
