-- ONE-OS Phase 6: encrypted, short-lived shared photo delivery.
-- Only ciphertext enters Supabase Storage. Private keys remain on each device.
create table if not exists public.device_crypto_keys (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (device_id ~ '^[0-9a-f]{32}$'),
  public_key text not null check (public_key ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create table if not exists public.member_presence (
  space_id uuid not null,
  user_id uuid not null,
  last_seen_at timestamptz not null default now(),
  primary key (space_id, user_id),
  foreign key (space_id, user_id)
    references public.space_members(space_id, user_id) on delete cascade
);

create table if not exists public.snap_deliveries (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  object_path text unique,
  status text not null default 'uploading'
    check (status in ('uploading', 'pending', 'received')),
  ephemeral_public_key text,
  wrap_salt text,
  wrap_nonce text,
  wrapped_file_key text,
  content_nonce text,
  mime_type text not null
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  file_size_bytes integer not null check (file_size_bytes between 1 and 20971520),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  received_at timestamptz,
  constraint snap_delivery_not_self check (sender_id <> recipient_id),
  constraint snap_delivery_payload_state check (
    (status in ('uploading', 'pending')
      and object_path is not null
      and ephemeral_public_key is not null
      and wrap_salt is not null
      and wrap_nonce is not null
      and wrapped_file_key is not null
      and content_nonce is not null)
    or
    (status = 'received'
      and object_path is null
      and ephemeral_public_key is null
      and wrap_salt is null
      and wrap_nonce is null
      and wrapped_file_key is null
      and content_nonce is null)
  )
);

create index if not exists snap_deliveries_recipient_status_idx
  on public.snap_deliveries(recipient_id, status, created_at);
create index if not exists member_presence_last_seen_idx
  on public.member_presence(last_seen_at);

alter table public.device_crypto_keys enable row level security;
alter table public.member_presence enable row level security;
alter table public.snap_deliveries enable row level security;

drop policy if exists "Users can read own and shared device public keys" on public.device_crypto_keys;
create policy "Users can read own and shared device public keys"
  on public.device_crypto_keys for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.space_members mine
      join public.space_members theirs on theirs.space_id = mine.space_id
      where mine.user_id = (select auth.uid())
        and theirs.user_id = device_crypto_keys.user_id
    )
  );

drop policy if exists "Participants can read snap delivery metadata" on public.snap_deliveries;
create policy "Participants can read snap delivery metadata"
  on public.snap_deliveries for select to authenticated
  using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));

-- No client policies are created for member_presence or snap_deliveries writes.
-- All writes go through narrow SECURITY DEFINER RPCs or trusted Edge Functions.
grant select on public.device_crypto_keys to authenticated;
grant select on public.snap_deliveries to authenticated;
revoke insert, update, delete on public.device_crypto_keys from anon, authenticated;
revoke insert, update, delete on public.member_presence from anon, authenticated;
revoke insert, update, delete on public.snap_deliveries from anon, authenticated;

create or replace function public.seed_member_presence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.member_presence(space_id, user_id, last_seen_at)
  values (new.space_id, new.user_id, now())
  on conflict (space_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists seed_member_presence_after_join on public.space_members;
create trigger seed_member_presence_after_join
  after insert on public.space_members
  for each row execute function public.seed_member_presence();

insert into public.member_presence(space_id, user_id, last_seen_at)
select m.space_id, m.user_id, now()
from public.space_members m
on conflict (space_id, user_id) do nothing;

create or replace function public.touch_my_presence()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  update public.member_presence
  set last_seen_at = now()
  where user_id = v_user;

  update public.device_crypto_keys
  set last_seen_at = now()
  where user_id = v_user;
end;
$$;

create or replace function public.register_device_crypto_key(
  p_device_id text,
  p_public_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_device_id !~ '^[0-9a-f]{32}$' then raise exception 'Invalid device identifier'; end if;
  if p_public_key !~ '^[0-9a-f]{64}$' then raise exception 'Invalid X25519 public key'; end if;

  insert into public.device_crypto_keys(user_id, device_id, public_key, last_seen_at)
  values (v_user, lower(p_device_id), lower(p_public_key), now())
  on conflict (user_id, device_id)
  do update set public_key = excluded.public_key, last_seen_at = now();
end;
$$;

create or replace function public.create_snap_delivery(
  p_space_id uuid,
  p_recipient_id uuid,
  p_ephemeral_public_key text,
  p_wrap_salt text,
  p_wrap_nonce text,
  p_wrapped_file_key text,
  p_content_nonce text,
  p_mime_type text,
  p_file_size_bytes integer,
  p_captured_at timestamptz default now()
)
returns table(delivery_id uuid, object_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_recipient_id = v_user then raise exception 'A snap must be sent to your partner'; end if;
  if not public.is_space_member(p_space_id) then raise exception 'Shared space membership required'; end if;

  select count(*) into v_count
  from public.space_members m where m.space_id = p_space_id;
  if v_count <> 2 or not exists (
    select 1 from public.space_members m
    where m.space_id = p_space_id and m.user_id = p_recipient_id
  ) then raise exception 'The shared space must have exactly two members'; end if;

  if p_ephemeral_public_key !~ '^[0-9a-f]{64}$'
    or p_wrap_salt !~ '^[0-9a-f]{32}$'
    or p_wrap_nonce !~ '^[0-9a-f]{48}$'
    or p_wrapped_file_key !~ '^[0-9a-f]{96}$'
    or p_content_nonce !~ '^[0-9a-f]{48}$'
  then raise exception 'Invalid encrypted snap envelope'; end if;

  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')
    or p_file_size_bytes < 1 or p_file_size_bytes > 20971520
  then raise exception 'Unsupported image or file size'; end if;

  v_path := p_space_id::text || '/' || v_id::text || '.enc';
  insert into public.snap_deliveries(
    id, space_id, sender_id, recipient_id, object_path, status,
    ephemeral_public_key, wrap_salt, wrap_nonce, wrapped_file_key,
    content_nonce, mime_type, file_size_bytes, captured_at
  ) values (
    v_id, p_space_id, v_user, p_recipient_id, v_path, 'uploading',
    lower(p_ephemeral_public_key), lower(p_wrap_salt), lower(p_wrap_nonce),
    lower(p_wrapped_file_key), lower(p_content_nonce), p_mime_type,
    p_file_size_bytes, coalesce(p_captured_at, now())
  );

  return query select v_id, v_path;
end;
$$;

create or replace function public.finalize_snap_upload(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
declare v_path text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select d.object_path into v_path
  from public.snap_deliveries d
  where d.id = p_delivery_id
    and d.sender_id = v_user
    and d.status = 'uploading'
  for update;

  if v_path is null then raise exception 'Snap upload was not found or is already finalized'; end if;

  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'oneos-private-snaps' and o.name = v_path
  ) then raise exception 'Encrypted file is not present in private storage'; end if;

  update public.snap_deliveries
  set status = 'pending'
  where id = p_delivery_id and sender_id = v_user;
end;
$$;

revoke all on function public.touch_my_presence() from public;
revoke all on function public.register_device_crypto_key(text, text) from public;
revoke all on function public.create_snap_delivery(uuid, uuid, text, text, text, text, text, text, integer, timestamptz) from public;
revoke all on function public.finalize_snap_upload(uuid) from public;
grant execute on function public.touch_my_presence() to authenticated;
grant execute on function public.register_device_crypto_key(text, text) to authenticated;
grant execute on function public.create_snap_delivery(uuid, uuid, text, text, text, text, text, text, integer, timestamptz) to authenticated;
grant execute on function public.finalize_snap_upload(uuid) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('oneos-private-snaps', 'oneos-private-snaps', false, 20971520, array['application/octet-stream'])
on conflict (id) do update
set public = false, file_size_limit = 20971520,
    allowed_mime_types = array['application/octet-stream'];

drop policy if exists "ONE-OS sender can upload encrypted snap" on storage.objects;
create policy "ONE-OS sender can upload encrypted snap"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'oneos-private-snaps'
  and exists (
    select 1 from public.snap_deliveries d
    where d.object_path = storage.objects.name
      and d.sender_id = (select auth.uid())
      and d.status = 'uploading'
  )
);

drop policy if exists "ONE-OS recipient can download pending encrypted snap" on storage.objects;
create policy "ONE-OS recipient can download pending encrypted snap"
on storage.objects for select to authenticated
using (
  bucket_id = 'oneos-private-snaps'
  and exists (
    select 1 from public.snap_deliveries d
    where d.object_path = storage.objects.name
      and d.recipient_id = (select auth.uid())
      and d.status = 'pending'
  )
);

comment on table public.snap_deliveries is
  'Only encrypted file envelopes and delivery metadata. Plaintext images and private keys never belong in this table.';
comment on table public.member_presence is
  'Server-observed authenticated activity, used to expire only pending encrypted snaps after 72 hours offline.';
