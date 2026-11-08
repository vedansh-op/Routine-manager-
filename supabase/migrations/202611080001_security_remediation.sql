-- ONE-OS security remediation 1.
-- Safe, additive hardening for findings that do not require the unresolved
-- shared-history ownership or permanent Snap-copy protocol.
-- Apply only in a disposable/non-production Supabase project first.

-- SEC-02: invite tokens use 96 bits of entropy (12 random bytes, 24 hex chars).
-- The old RPCs are replaced so fresh installs and upgrades use the same rule.
create table if not exists public.invitation_attempt_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0)
);
alter table public.invitation_attempt_limits enable row level security;
revoke all on public.invitation_attempt_limits from anon, authenticated;

create or replace function public.create_shared_space(p_name text default 'Shared space')
returns table(space_id uuid, invite_code text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_code text;
  v_expiry timestamptz := now() + interval '7 days';
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_name is not null and char_length(trim(p_name)) > 80 then
    raise exception 'Space name is too long';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  if exists (
    select 1 from public.space_members m join public.spaces s on s.id=m.space_id
    where m.user_id=v_user and s.space_type='shared'
  ) then raise exception 'You are already in a shared space'; end if;

  insert into public.spaces(name,space_type,created_by)
  values (coalesce(nullif(trim(p_name),''),'Shared space'),'shared',v_user)
  returning id into v_space;
  insert into public.space_members(space_id,user_id,role)
  values (v_space,v_user,'owner');

  v_code := upper(encode(extensions.gen_random_bytes(12),'hex'));
  insert into public.space_invitations(space_id,code_hash,created_by,expires_at)
  values (v_space,encode(extensions.digest(v_code,'sha256'),'hex'),v_user,v_expiry);
  return query select v_space,v_code,v_expiry;
end;
$$;

create or replace function public.rotate_shared_invite()
returns table(invite_code text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
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
  from public.space_members m join public.spaces s on s.id=m.space_id
  where m.user_id=v_user and m.role='owner' and s.space_type='shared'
  for update of m;
  if v_space is null then raise exception 'Only the shared-space owner can renew its invitation'; end if;
  select count(*) into v_member_count from public.space_members m where m.space_id=v_space;
  if v_member_count >= 2 then raise exception 'This shared space already has two members'; end if;
  update public.space_invitations set expires_at=now()
  where space_id=v_space and accepted_at is null;
  v_code := upper(encode(extensions.gen_random_bytes(12),'hex'));
  insert into public.space_invitations(space_id,code_hash,created_by,expires_at)
  values (v_space,encode(extensions.digest(v_code,'sha256'),'hex'),v_user,v_expiry);
  return query select v_code,v_expiry;
end;
$$;

-- Per-account join throttling. A failed code guess consumes an attempt.
create or replace function public.join_shared_space(p_code text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_inv public.space_invitations%rowtype;
  v_count integer;
  v_attempts integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_code is null or char_length(trim(p_code)) <> 24
     or upper(trim(p_code)) !~ '^[0-9A-F]{24}$' then
    raise exception 'Invalid, expired, or already used invitation code';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  insert into public.invitation_attempt_limits(user_id,window_started_at,attempts)
  values (v_user,now(),1)
  on conflict (user_id) do update
    set window_started_at = case
          when public.invitation_attempt_limits.window_started_at < now()-interval '15 minutes' then now()
          else public.invitation_attempt_limits.window_started_at end,
        attempts = case
          when public.invitation_attempt_limits.window_started_at < now()-interval '15 minutes' then 1
          else public.invitation_attempt_limits.attempts+1 end
  returning attempts into v_attempts;
  if v_attempts > 10 then raise exception 'Too many invitation attempts; try again later'; end if;

  if exists (
    select 1 from public.space_members m join public.spaces s on s.id=m.space_id
    where m.user_id=v_user and s.space_type='shared'
  ) then raise exception 'You are already in a shared space'; end if;

  select * into v_inv from public.space_invitations i
  where i.code_hash=encode(extensions.digest(upper(trim(p_code)),'sha256'),'hex')
    and i.accepted_at is null and i.expires_at>now()
  for update;
  if not found then raise exception 'Invalid, expired, or already used invitation code'; end if;
  select count(*) into v_count from public.space_members m where m.space_id=v_inv.space_id;
  if v_count >= 2 then raise exception 'This shared space is already full'; end if;
  insert into public.space_members(space_id,user_id,role) values (v_inv.space_id,v_user,'member');
  update public.space_invitations set accepted_by=v_user,accepted_at=now() where id=v_inv.id;
  return v_inv.space_id;
end;
$$;

revoke all on function public.create_shared_space(text) from public;
revoke all on function public.join_shared_space(text) from public;
revoke all on function public.rotate_shared_invite() from public;
grant execute on function public.create_shared_space(text) to authenticated;
grant execute on function public.join_shared_space(text) to authenticated;
grant execute on function public.rotate_shared_invite() to authenticated;

-- SEC-03 partial mitigation: bound report size. The exact allow-list still needs
-- to be aligned with the app's canonical aggregate schema before release.
alter table public.weekly_reports
  drop constraint if exists weekly_reports_report_size_limit;
alter table public.weekly_reports
  add constraint weekly_reports_report_size_limit
  check (octet_length(report::text) <= 16384);

-- SEC-04: normal registration is insert-only. Reusing a device ID with a
-- different key now fails; key rotation must use a separate audited ceremony.
create or replace function public.register_device_crypto_key(
  p_device_id text, p_public_key text
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_device_id is null or p_device_id !~ '^[0-9a-f]{32}$' then
    raise exception 'Invalid device identifier';
  end if;
  if p_public_key is null or p_public_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid X25519 public key';
  end if;
  insert into public.device_crypto_keys(user_id,device_id,public_key,last_seen_at)
  values (v_user,lower(p_device_id),lower(p_public_key),now())
  on conflict (user_id,device_id) do nothing;
  if not found then
    if not exists (
      select 1 from public.device_crypto_keys
      where user_id=v_user and device_id=lower(p_device_id)
        and public_key=lower(p_public_key)
    ) then
      raise exception 'Device ID is already registered to a different key; use verified recovery';
    end if;
    update public.device_crypto_keys set last_seen_at=now()
    where user_id=v_user and device_id=lower(p_device_id);
  end if;
end;
$$;
revoke all on function public.register_device_crypto_key(text,text) from public;
grant execute on function public.register_device_crypto_key(text,text) to authenticated;

-- SEC-08: partner report visibility requires the intended two-member shared space.
drop policy if exists "Partners can read explicitly shared weekly reports" on public.weekly_reports;
create policy "Partners can read explicitly shared weekly reports"
  on public.weekly_reports for select to authenticated
  using (
    shared_with_partner = true
    and exists (
      select 1
      from public.space_members mine
      join public.space_members partner on partner.space_id=mine.space_id
      join public.spaces s on s.id=mine.space_id
      where mine.user_id=auth.uid()
        and partner.user_id=weekly_reports.user_id
        and s.space_type='shared'
        and (select count(*) from public.space_members members where members.space_id=s.id)=2
    )
  );

-- SEC-10: enforce bounded user-controlled text at the database boundary.
alter table public.spaces
  drop constraint if exists spaces_name_length_limit;
alter table public.spaces
  add constraint spaces_name_length_limit
  check (char_length(trim(name)) between 1 and 80);

alter table public.shared_activities
  drop constraint if exists shared_activities_note_length_limit;
alter table public.shared_activities
  add constraint shared_activities_note_length_limit
  check (note is null or char_length(note) <= 1000);

comment on table public.invitation_attempt_limits is
  'Server-side per-account invite-guess throttling; not readable or writable by clients.';
