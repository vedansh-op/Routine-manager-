-- ONE-OS Phase 2: two-person shared spaces with code-only invitations.
-- Invitation codes are stored as hashes and are single-use.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Shared space',
  space_type text not null check (space_type in ('personal', 'shared')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create table if not exists public.space_invitations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  code_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.space_invitations enable row level security;

create or replace function public.is_space_member(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.space_members m
    where m.space_id = p_space_id and m.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_space_member(uuid) from public;
grant execute on function public.is_space_member(uuid) to authenticated;

drop policy if exists "Members can view their spaces" on public.spaces;
create policy "Members can view their spaces" on public.spaces
  for select using (public.is_space_member(id));

drop policy if exists "Members can view space membership" on public.space_members;
create policy "Members can view space membership" on public.space_members
  for select using (public.is_space_member(space_id));

-- No direct client insert/update/delete policies for invitations or memberships.
-- All membership changes happen through the security-definer RPCs below.

create or replace function public.create_shared_space(p_name text default 'Shared space')
returns table(space_id uuid, invite_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_code text;
  v_expiry timestamptz := now() + interval '7 days';
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  -- Serialize membership changes per account across multiple phones/sessions.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  if exists (
    select 1 from public.space_members m
    join public.spaces s on s.id = m.space_id
    where m.user_id = v_user and s.space_type = 'shared'
  ) then
    raise exception 'You are already in a shared space';
  end if;

  insert into public.spaces(name, space_type, created_by)
  values (coalesce(nullif(trim(p_name), ''), 'Shared space'), 'shared', v_user)
  returning id into v_space;

  insert into public.space_members(space_id, user_id, role)
  values (v_space, v_user, 'owner');

  v_code := upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12));
  insert into public.space_invitations(space_id, code_hash, created_by, expires_at)
  values (v_space, encode(extensions.digest(v_code, 'sha256'), 'hex'), v_user, v_expiry);

  return query select v_space, v_code, v_expiry;
end;
$$;

create or replace function public.join_shared_space(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_inv public.space_invitations%rowtype;
  v_count integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  -- Prevent simultaneous joins/creates from placing one account in two shared spaces.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  if exists (
    select 1 from public.space_members m
    join public.spaces s on s.id = m.space_id
    where m.user_id = v_user and s.space_type = 'shared'
  ) then
    raise exception 'You are already in a shared space';
  end if;

  select * into v_inv
  from public.space_invitations i
  where i.code_hash = encode(extensions.digest(upper(trim(p_code)), 'sha256'), 'hex')
    and i.accepted_at is null
    and i.expires_at > now()
  for update;

  if not found then raise exception 'Invalid, expired, or already used invitation code'; end if;

  select count(*) into v_count from public.space_members m where m.space_id = v_inv.space_id;
  if v_count >= 2 then raise exception 'This shared space is already full'; end if;

  insert into public.space_members(space_id, user_id, role)
  values (v_inv.space_id, v_user, 'member');

  update public.space_invitations
  set accepted_by = v_user, accepted_at = now()
  where id = v_inv.id;

  return v_inv.space_id;
end;
$$;

create or replace function public.rotate_shared_invite()
returns table(invite_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_member_count integer;
  v_code text;
  v_expiry timestamptz := now() + interval '7 days';
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select m.space_id into v_space
  from public.space_members m
  join public.spaces s on s.id = m.space_id
  where m.user_id = v_user
    and m.role = 'owner'
    and s.space_type = 'shared'
  for update of m;

  if v_space is null then
    raise exception 'Only the shared-space owner can renew its invitation';
  end if;

  select count(*) into v_member_count
  from public.space_members m
  where m.space_id = v_space;

  if v_member_count >= 2 then
    raise exception 'This shared space already has two members';
  end if;

  -- Invalidate any older unused invite before issuing a replacement.
  update public.space_invitations
  set expires_at = now()
  where space_id = v_space and accepted_at is null;

  v_code := upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12));
  insert into public.space_invitations(space_id, code_hash, created_by, expires_at)
  values (v_space, encode(extensions.digest(v_code, 'sha256'), 'hex'), v_user, v_expiry);

  return query select v_code, v_expiry;
end;
$$;

revoke all on function public.create_shared_space(text) from public;
revoke all on function public.join_shared_space(text) from public;
revoke all on function public.rotate_shared_invite() from public;
grant execute on function public.create_shared_space(text) to authenticated;
grant execute on function public.join_shared_space(text) to authenticated;
grant execute on function public.rotate_shared_invite() to authenticated;
