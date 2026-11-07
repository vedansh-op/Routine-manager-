-- ONE-OS Phase 7: per-account, per-shared-space X25519 public-key directory.
-- Private keys never leave Android SecureStore. Public keys are safe to publish to the partner.

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
  on public.space_member_encryption_keys for select to authenticated
  using (public.is_space_member(space_id));

create or replace function public.register_space_encryption_key(
  p_space_id uuid,
  p_public_key_hex text
)
returns void
language plpgsql
security definer
set search_path = ''
as $
begin
  if auth.uid() is null or not public.is_space_member(p_space_id) then
    raise exception 'Not a member of this shared space';
  end if;
  if p_public_key_hex !~ '^[0-9a-f]{64}
comment on table public.space_member_encryption_keys is
  'Public X25519 keys only. Corresponding private keys remain in each member device SecureStore.';
 then
    raise exception 'Invalid X25519 public key';
  end if;
  insert into public.space_member_encryption_keys(space_id, user_id, public_key_hex)
  values (p_space_id, auth.uid(), p_public_key_hex)
  on conflict (space_id, user_id) do update
    set public_key_hex = excluded.public_key_hex,
        updated_at = now()
    where public.space_member_encryption_keys.public_key_hex is distinct from excluded.public_key_hex;
end;
$;
revoke all on function public.register_space_encryption_key(uuid,text) from public;
grant execute on function public.register_space_encryption_key(uuid,text) to authenticated;

comment on table public.space_member_encryption_keys is
  'Public X25519 keys only. Corresponding private keys remain in each member device SecureStore.';
