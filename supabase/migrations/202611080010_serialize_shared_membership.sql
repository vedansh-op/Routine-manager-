-- ONE-OS membership concurrency hardening.
-- RPC-level per-user locks are not sufficient to serialize two different invitees
-- accepting the same final invitation slot. Enforce the two-person invariant at
-- the table boundary, including future trusted/elevated insert paths.

create or replace function public.enforce_shared_space_membership_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_space_type text;
  v_member_count integer;
begin
  -- Serialize all shared-space membership changes for this account, then for
  -- the target space. The same lock order is used for every insert.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

  select s.space_type into v_space_type
  from public.spaces s
  where s.id = new.space_id
  for update;

  if v_space_type is null then
    raise exception 'Space not found';
  end if;

  if v_space_type <> 'shared' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.space_id::text, 1));

  if exists (
    select 1
    from public.space_members existing_member
    join public.spaces existing_space on existing_space.id = existing_member.space_id
    where existing_member.user_id = new.user_id
      and existing_space.space_type = 'shared'
      and existing_member.space_id <> new.space_id
  ) then
    raise exception 'You are already in a shared space';
  end if;

  select count(*) into v_member_count
  from public.space_members m
  where m.space_id = new.space_id;

  if v_member_count >= 2 then
    raise exception 'This shared space already has two members';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_shared_space_membership_limit() from public, anon, authenticated;

drop trigger if exists enforce_shared_space_membership_limit on public.space_members;
create trigger enforce_shared_space_membership_limit
  before insert on public.space_members
  for each row execute function public.enforce_shared_space_membership_limit();

comment on function public.enforce_shared_space_membership_limit() is
  'Serializes shared membership inserts and enforces one active shared space per user and at most two members per shared space.';
