-- ONE-OS Snap boundary hardening.
-- Snap deliveries may only be created inside a real, active two-person shared
-- connection. This trigger also protects future elevated/server-side insert paths.

create or replace function public.require_active_shared_space_for_snap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_member_count integer;
begin
  if not exists (
    select 1
    from public.spaces s
    join public.shared_archives a on a.source_space_id = s.id
    where s.id = new.space_id
      and s.space_type = 'shared'
      and a.ended_at is null
  ) then
    raise exception 'Snap delivery requires an active shared connection';
  end if;

  select count(*) into v_member_count
  from public.space_members m
  where m.space_id = new.space_id;

  if v_member_count <> 2
     or not exists (
       select 1 from public.space_members m
       where m.space_id = new.space_id
         and m.user_id = new.sender_id
     )
     or not exists (
       select 1 from public.space_members m
       where m.space_id = new.space_id
         and m.user_id = new.recipient_id
     )
     or new.sender_id = new.recipient_id
  then
    raise exception 'Snap delivery requires exactly two distinct active participants';
  end if;

  return new;
end;
$$;

revoke all on function public.require_active_shared_space_for_snap() from public, anon, authenticated;

drop trigger if exists require_active_shared_space_for_snap on public.snap_deliveries;
create trigger require_active_shared_space_for_snap
  before insert on public.snap_deliveries
  for each row execute function public.require_active_shared_space_for_snap();

comment on function public.require_active_shared_space_for_snap() is
  'Rejects Snap inserts unless the source space is an active two-member shared connection with sender and recipient as its members.';
