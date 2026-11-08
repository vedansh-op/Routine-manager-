-- ONE-OS AUTH-06: enforce MFA assurance at the database write boundary.
-- Client routing alone is not a security boundary: direct RPC calls can bypass it.
-- Authenticated writes to sensitive shared-space, key, Snap, calendar and report
-- tables require an AAL2 JWT. Trusted service-role jobs and SQL migration/admin
-- sessions (which have no Supabase JWT role) remain able to perform maintenance.

create or replace function public.require_aal2_for_sensitive_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text := coalesce(auth.role(), '');
  v_space_id uuid;
  v_space_type text;
begin
  -- Trusted backend jobs use service_role. SQL editor/migration sessions have
  -- no end-user JWT role; neither is a client-authenticated request.
  if v_role in ('service_role', '') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- Personal spaces are outside this shared-feature AAL2 guard.
  if tg_table_name = 'spaces' then
    if tg_op = 'DELETE' then
      if old.space_type <> 'shared' then return old; end if;
    elsif tg_op = 'UPDATE' then
      if old.space_type <> 'shared' and new.space_type <> 'shared' then return new; end if;
    else
      if new.space_type <> 'shared' then return new; end if;
    end if;
  elsif tg_table_name = 'space_members' then
    if tg_op = 'DELETE' then
      v_space_id := old.space_id;
      select s.space_type into v_space_type from public.spaces s where s.id = v_space_id;
    elsif tg_op = 'UPDATE' then
      select s.space_type into v_space_type
      from public.spaces s
      where s.id in (old.space_id, new.space_id) and s.space_type = 'shared'
      limit 1;
    else
      v_space_id := new.space_id;
      select s.space_type into v_space_type from public.spaces s where s.id = v_space_id;
    end if;
    if v_space_type is distinct from 'shared' then
      if tg_op = 'DELETE' then return old; else return new; end if;
    end if;
  end if;

  if v_role <> 'authenticated' then
    raise exception 'Authenticated session required for this operation';
  end if;

  if coalesce(auth.jwt()->>'aal', '') <> 'aal2' then
    raise exception 'Multi-factor authentication (AAL2) is required for this operation';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.require_aal2_for_sensitive_write() from public, anon, authenticated;

-- Shared-space lifecycle and membership.
drop trigger if exists require_aal2_spaces_write on public.spaces;
create trigger require_aal2_spaces_write
before insert or update or delete on public.spaces
for each row
execute function public.require_aal2_for_sensitive_write();

drop trigger if exists require_aal2_space_members_write on public.space_members;
create trigger require_aal2_space_members_write
before insert or update or delete on public.space_members
for each row
execute function public.require_aal2_for_sensitive_write();

drop trigger if exists require_aal2_space_invitations_write on public.space_invitations;
create trigger require_aal2_space_invitations_write
before insert or update or delete on public.space_invitations
for each row
execute function public.require_aal2_for_sensitive_write();

-- Device identity/key changes and encrypted Snap lifecycle.
drop trigger if exists require_aal2_device_crypto_keys_write on public.device_crypto_keys;
create trigger require_aal2_device_crypto_keys_write
before insert or update or delete on public.device_crypto_keys
for each row
execute function public.require_aal2_for_sensitive_write();

drop trigger if exists require_aal2_snap_deliveries_write on public.snap_deliveries;
create trigger require_aal2_snap_deliveries_write
before insert or update or delete on public.snap_deliveries
for each row
execute function public.require_aal2_for_sensitive_write();

-- Shared calendar and explicitly shared aggregate reports.
drop trigger if exists require_aal2_shared_activities_write on public.shared_activities;
create trigger require_aal2_shared_activities_write
before insert or update or delete on public.shared_activities
for each row
execute function public.require_aal2_for_sensitive_write();

drop trigger if exists require_aal2_weekly_reports_write on public.weekly_reports;
create trigger require_aal2_weekly_reports_write
before insert or update or delete on public.weekly_reports
for each row
execute function public.require_aal2_for_sensitive_write();

comment on function public.require_aal2_for_sensitive_write() is
  'Database trigger guard requiring an AAL2 JWT for authenticated client writes to sensitive ONE-OS tables; service-role and trusted SQL maintenance sessions are allowed.';
