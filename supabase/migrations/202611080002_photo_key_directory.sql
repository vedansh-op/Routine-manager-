-- ONE-OS Phase 7: per-account, per-shared-space X25519 public-key directory.
-- Private keys never leave the member's device SecureStore.

create table if not exists public.space_member_encryption_keys (
  space_id uuid not null,
  user_id uuid not null,
  public_key_hex text not null check (public_key_hex ~ '^[0-9a-f]{64}$'),
  key_version integer not null default 1 check (key_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (space_id, user_id),
  foreign key (space_id, user_id)
    references public.space_members(space_id, user_id) on delete cascade
);

alter table public.space_member_encryption_keys enable row level security;
drop policy if exists "Space members can read encryption public keys" on public.space_member_encryption_keys;
create policy "Space members can read encryption public keys"
  on public.space_member_encryption_keys
  for select to authenticated
  using (public.is_space_member(space_id));

create or replace function public.register_space_encryption_key(
  p_space_id uuid,
  p_public_key_hex text
)
returns void
language plpgsql
security definer
set search_path = ''
as $register_key$
begin
  if auth.uid() is null or not public.is_space_member(p_space_id) then
    raise exception 'Not a member of this shared space';
  end if;
  if p_public_key_hex is null or p_public_key_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid X25519 public key';
  end if;

  insert into public.space_member_encryption_keys(space_id, user_id, public_key_hex)
  values (p_space_id, auth.uid(), p_public_key_hex)
  on conflict (space_id, user_id) do update
    set public_key_hex = excluded.public_key_hex,
        updated_at = now()
    where public.space_member_encryption_keys.public_key_hex = excluded.public_key_hex;
end;
$register_key$;

revoke all on function public.register_space_encryption_key(uuid,text) from public;
grant execute on function public.register_space_encryption_key(uuid,text) to authenticated;

comment on table public.space_member_encryption_keys is
  'Public X25519 keys only. Corresponding private keys remain in each member device SecureStore.';

-- Refuse to create a delivery until the recipient has registered an encryption key.
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
as $create_delivery$
declare
  v_sender uuid := auth.uid();
  v_delivery uuid := gen_random_uuid();
  v_path text;
begin
  if v_sender is null then
    raise exception 'Authentication required';
  end if;
  if p_recipient_id = v_sender then
    raise exception 'Recipient must be your partner';
  end if;
  if not public.is_space_member(p_space_id) then
    raise exception 'Not a member of this shared space';
  end if;
  if not exists (
    select 1 from public.space_members m
    where m.space_id = p_space_id and m.user_id = p_recipient_id
  ) then
    raise exception 'Recipient is not in this shared space';
  end if;
  if not exists (
    select 1 from public.space_member_encryption_keys k
    where k.space_id = p_space_id and k.user_id = p_recipient_id
  ) then
    raise exception 'Recipient has not registered a photo encryption key';
  end if;
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
$create_delivery$;

revoke all on function public.create_photo_delivery(uuid,uuid,text,text,bigint) from public;
grant execute on function public.create_photo_delivery(uuid,uuid,text,text,bigint) to authenticated;
