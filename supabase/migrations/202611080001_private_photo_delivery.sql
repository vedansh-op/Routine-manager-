-- ONE-OS Phase 6: private encrypted photo delivery queue.
-- The app encrypts photo bytes and wraps a per-photo key on-device.
-- Supabase stores ciphertext, an opaque wrapped key, and delivery metadata only.

create table if not exists public.space_member_presence (
  space_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (space_id, user_id),
  foreign key (space_id, user_id) references public.space_members(space_id, user_id) on delete cascade
);

insert into public.space_member_presence(space_id, user_id, last_seen_at)
select space_id, user_id, joined_at from public.space_members
on conflict (space_id, user_id) do nothing;

alter table public.space_member_presence enable row level security;
drop policy if exists "Members can read own presence" on public.space_member_presence;
create policy "Members can read own presence" on public.space_member_presence
  for select to authenticated using (user_id = auth.uid());

create or replace function public.oneos_heartbeat(p_space_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare v_now timestamptz := now();
begin
  if auth.uid() is null or not public.is_space_member(p_space_id) then
    raise exception 'Not a member of this shared space';
  end if;
  insert into public.space_member_presence(space_id, user_id, last_seen_at)
  values (p_space_id, auth.uid(), v_now)
  on conflict (space_id, user_id) do update set last_seen_at = excluded.last_seen_at;
  return v_now;
end;
$$;
revoke all on function public.oneos_heartbeat(uuid) from public;
grant execute on function public.oneos_heartbeat(uuid) to authenticated;

create table if not exists public.photo_deliveries (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  object_path text not null unique,
  wrapped_file_key text not null,
  encryption_version text not null default 'xchacha20poly1305+x25519-v1',
  content_type text not null default 'image/jpeg',
  byte_size bigint not null check (byte_size > 0 and byte_size <= 15728640),
  status text not null default 'pending' check (status in ('pending','delivered','expired')),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  constraint photo_deliveries_distinct_users check (sender_id <> recipient_id),
  constraint photo_deliveries_object_path check (object_path = recipient_id::text || '/' || id::text || '.bin')
);

create index if not exists photo_deliveries_recipient_pending_idx
  on public.photo_deliveries(recipient_id, created_at)
  where status = 'pending';

alter table public.photo_deliveries enable row level security;
drop policy if exists "Delivery participants can read metadata" on public.photo_deliveries;
create policy "Delivery participants can read metadata" on public.photo_deliveries
  for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

-- Metadata creation is only through the validation RPC; clients cannot forge participants.
revoke insert, update, delete on public.photo_deliveries from anon, authenticated;
grant select on public.photo_deliveries to authenticated;

create or replace function public.create_photo_delivery(
  p_space_id uuid,
  p_recipient_id uuid,
  p_wrapped_file_key text,
  p_content_type text,
  p_byte_size bigint
)
returns table(delivery_id uuid, object_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender uuid := auth.uid();
  v_delivery uuid := gen_random_uuid();
  v_path text;
begin
  if v_sender is null then raise exception 'Authentication required'; end if;
  if p_recipient_id = v_sender then raise exception 'Recipient must be your partner'; end if;
  if not public.is_space_member(p_space_id) then raise exception 'Not a member of this shared space'; end if;
  if not exists (
    select 1 from public.space_members m
    where m.space_id = p_space_id and m.user_id = p_recipient_id
  ) then raise exception 'Recipient is not in this shared space'; end if;
  if p_wrapped_file_key is null or length(p_wrapped_file_key) < 32 or length(p_wrapped_file_key) > 4096 then
    raise exception 'Invalid encrypted file key envelope';
  end if;
  if p_content_type not in ('image/jpeg','image/png','image/webp','image/heic') then
    raise exception 'Unsupported image type';
  end if;
  if p_byte_size is null or p_byte_size < 1 or p_byte_size > 15728640 then
    raise exception 'Image must be 15 MB or smaller';
  end if;

  v_path := p_recipient_id::text || '/' || v_delivery::text || '.bin';
  insert into public.photo_deliveries(
    id, space_id, sender_id, recipient_id, object_path,
    wrapped_file_key, content_type, byte_size
  ) values (
    v_delivery, p_space_id, v_sender, p_recipient_id, v_path,
    p_wrapped_file_key, p_content_type, p_byte_size
  );
  return query select v_delivery, v_path;
end;
$$;
revoke all on function public.create_photo_delivery(uuid,uuid,text,text,bigint) from public;
grant execute on function public.create_photo_delivery(uuid,uuid,text,text,bigint) to authenticated;

create or replace function public.acknowledge_photo_delivery(p_delivery_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.photo_deliveries
  set status = 'delivered', acknowledged_at = now()
  where id = p_delivery_id
    and recipient_id = auth.uid()
    and status = 'pending';
  return found;
end;
$$;
revoke all on function public.acknowledge_photo_delivery(uuid) from public;
grant execute on function public.acknowledge_photo_delivery(uuid) to authenticated;

-- Private bucket: only the addressed recipient may download; only the sender may upload.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('oneos-private-snaps', 'oneos-private-snaps', false, 15728640,
        array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update set public = false, file_size_limit = 15728640,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ONE-OS sender uploads pending ciphertext" on storage.objects;
create policy "ONE-OS sender uploads pending ciphertext"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'oneos-private-snaps'
  and exists (
    select 1 from public.photo_deliveries d
    where d.object_path = name
      and d.sender_id = auth.uid()
      and d.status = 'pending'
  )
);

drop policy if exists "ONE-OS recipient downloads ciphertext" on storage.objects;
create policy "ONE-OS recipient downloads ciphertext"
on storage.objects for select to authenticated
using (
  bucket_id = 'oneos-private-snaps'
  and exists (
    select 1 from public.photo_deliveries d
    where d.object_path = name
      and d.recipient_id = auth.uid()
      and d.status = 'pending'
  )
);

comment on table public.photo_deliveries is
  'Encrypted photo delivery metadata only. Photo bytes must be encrypted on-device; wrapped_file_key is an opaque recipient-only envelope.';
