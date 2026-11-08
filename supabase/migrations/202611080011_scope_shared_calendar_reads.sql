-- ONE-OS shared-calendar read boundary.
-- A shared_activities row must never become visible merely because a user is
-- a member of a personal space. Ended shared connections remain readable;
-- their detached archive and existing shared history are intentionally retained.

drop policy if exists "Shared space members can read activities"
  on public.shared_activities;

create policy "Members can read activities in shared spaces"
  on public.shared_activities
  for select
  to authenticated
  using (
    public.is_space_member(space_id)
    and exists (
      select 1
      from public.spaces s
      where s.id = shared_activities.space_id
        and s.space_type = 'shared'
    )
  );

comment on policy "Members can read activities in shared spaces"
  on public.shared_activities is
  'Restricts calendar rows to actual shared spaces while preserving read access to history after a connection ends.';
