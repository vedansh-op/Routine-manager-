-- ONE-OS shared calendar integrity: an activity cannot be moved between
-- spaces or have its creator reassigned after creation. Without this guard,
-- the archive mirror could leave a live copy in the old archive when an UPDATE
-- changes space_id, potentially exposing it to a different former partner.

create or replace function public.prevent_shared_activity_scope_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.space_id is distinct from old.space_id
     or new.created_by is distinct from old.created_by then
    raise exception 'Shared activity identity and space cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_shared_activity_scope_change
  on public.shared_activities;

create trigger prevent_shared_activity_scope_change
  before update on public.shared_activities
  for each row execute function public.prevent_shared_activity_scope_change();

comment on function public.prevent_shared_activity_scope_change() is
  'Prevents moving a shared calendar activity between archives or changing its original creator.';
