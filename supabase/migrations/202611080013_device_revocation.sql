-- ONE-OS AUTH-04: retain an auditable device record while excluding revoked
-- devices from new Snap delivery and recipient ciphertext reads.
-- Apply only in a disposable/non-production Supabase project first.

alter table public.device_crypto_keys
  add column if not exists revoked_at timestamptz;

create index if not exists device_crypto_keys_active_user_last_seen_idx
  on public.device_crypto_keys(user_id, last_seen_at desc)
  where revoked_at is null;

-- Only the authenticated owner may revoke one of their own registered devices.
-- The row is retained for audit; public key material is no longer discoverable.
create or replace function public.revoke_device_crypto_key(p_device_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if auth.jwt()->>'aal' <> 'aal2' then
    raise exception 'Multi-factor authentication (AAL2) is required';
  end if;
  if p_device_id is null or p_device_id !~ '^[0-9a-f]{32}$' then
    raise exception 'Invalid device identifier';
  end if;

  update public.device_crypto_keys
  set revoked_at = coalesce(revoked_at, now())
  where user_id = v_user_id
    and device_id = lower(p_device_id)
    and revoked_at is null;

  get diagnostics v_updated = row_count;
  if v_updated = 0 and not exists (
    select 1 from public.device_crypto_keys
    where user_id = v_user_id and device_id = lower(p_device_id)
  ) then
    raise exception 'Device not found';
  end if;
end;
$$;

revoke all on function public.revoke_device_crypto_key(text) from public, anon;
grant execute on function public.revoke_device_crypto_key(text) to authenticated;

comment on column public.device_crypto_keys.revoked_at is
  'Non-null means this device is revoked and must not receive new Snap keys or read Snap ciphertext.';
comment on function public.revoke_device_crypto_key(text) is
  'AAL2-only self-service device revocation. Retains the registry row for audit and never exposes another account device.';


-- A newly created delivery must target a currently active recipient device.
create or replace function public.require_active_recipient_device_for_snap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.device_crypto_keys k
    where k.user_id = new.recipient_id
      and k.device_id = new.recipient_device_id
      and k.revoked_at is null
  ) then
    raise exception 'Recipient device is unavailable or has been revoked';
  end if;
  return new;
end;
$$;

revoke all on function public.require_active_recipient_device_for_snap() from public, anon, authenticated;
drop trigger if exists require_active_recipient_device_for_snap on public.snap_deliveries;
create trigger require_active_recipient_device_for_snap
before insert on public.snap_deliveries
for each row execute function public.require_active_recipient_device_for_snap();
