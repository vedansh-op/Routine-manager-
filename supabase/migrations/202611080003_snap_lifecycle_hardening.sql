-- ONE-OS Snap lifecycle hardening.
-- Fixes the stale-presence snapshot race and makes acknowledgement non-destructive.
-- Apply only in non-production first.

alter table public.snap_deliveries
  drop constraint if exists snap_deliveries_status_check;
alter table public.snap_deliveries
  add constraint snap_deliveries_status_check
  check (status in ('uploading','pending','downloaded','permanent_copy_verified','received','expiring'));

alter table public.snap_deliveries
  drop constraint if exists snap_delivery_payload_state;
alter table public.snap_deliveries
  add constraint snap_delivery_payload_state check (
    (status in ('uploading','pending','downloaded','permanent_copy_verified','expiring')
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
  );

alter table public.snap_deliveries
  add column if not exists downloaded_at timestamptz,
  add column if not exists permanent_copy_verified_at timestamptz,
  add column if not exists upload_lease_expires_at timestamptz not null default (now() + interval '24 hours'),
  add column if not exists expiry_claimed_at timestamptz,
  add column if not exists destination_provider text,
  add column if not exists destination_object_id text,
  add column if not exists destination_sha256 text;

-- A sender may renew a long-running upload lease. The app must call this while
-- uploading; a missing heartbeat is not interpreted as proof that upload failed.
create or replace function public.renew_snap_upload_lease(p_delivery_id uuid)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_expiry timestamptz;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  update public.snap_deliveries
    set upload_lease_expires_at = now() + interval '24 hours'
    where id=p_delivery_id and sender_id=v_user and status='uploading'
    returning upload_lease_expires_at into v_expiry;
  if v_expiry is null then raise exception 'Active upload not found'; end if;
  return v_expiry;
end;
$$;
revoke all on function public.renew_snap_upload_lease(uuid) from public;
grant execute on function public.renew_snap_upload_lease(uuid) to authenticated;

-- Claim expirations in one DB transaction. Lock the presence row first and
-- re-check its timestamp after acquiring the lock; touch_my_presence serializes
-- against this claim. No stale pre-fetched inactive-member list is used.
create or replace function public.claim_expired_snap_deliveries(
  p_cutoff timestamptz,
  p_batch_size integer default 100
)
returns table(delivery_id uuid, object_path text)
language plpgsql security definer set search_path = ''
as $$
declare v_member record; v_row record; v_count integer := 0;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_cutoff is null or p_batch_size < 1 or p_batch_size > 500 then
    raise exception 'Invalid expiry claim parameters';
  end if;

  for v_member in
    select p.space_id,p.user_id,p.last_seen_at
    from public.member_presence p
    where p.last_seen_at < p_cutoff
    order by p.last_seen_at
    for update skip locked
  loop
    -- Re-read after obtaining the lock. A concurrent heartbeat that won first
    -- updates this value and prevents the pending-delivery claim.
    if v_member.last_seen_at < p_cutoff then
      for v_row in
        update public.snap_deliveries d
          set status='expiring', expiry_claimed_at=now()
          where d.space_id=v_member.space_id
            and d.recipient_id=v_member.user_id
            and d.status='pending'
          returning d.id,d.object_path
      loop
        delivery_id := v_row.id; object_path := v_row.object_path;
        return next;
        v_count := v_count + 1;
        if v_count >= p_batch_size then return; end if;
      end loop;
    end if;
  end loop;

  -- Uploads have a 24-hour renewable lease. Downloaded items are deliberately
  -- excluded: the temp ciphertext is retained until permanent-copy proof exists.
  for v_row in
    update public.snap_deliveries d
      set status='expiring', expiry_claimed_at=now()
      where d.status='uploading'
        and d.upload_lease_expires_at < now()
      order by d.upload_lease_expires_at
      limit greatest(0,p_batch_size-v_count)
      returning d.id,d.object_path
  loop
    delivery_id := v_row.id; object_path := v_row.object_path;
    return next;
  end loop;
end;
$$;

-- Called after the Edge Function attempts Storage deletion. On failure, restore
-- retryable state; on success, remove metadata only after object cleanup.
create or replace function public.finish_snap_expiry(
  p_delivery_id uuid,
  p_storage_deleted boolean
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_status text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Service role required';
  end if;
  select status into v_status from public.snap_deliveries
    where id=p_delivery_id and status='expiring' for update;
  if v_status is null then return; end if;

  if p_storage_deleted then
    delete from public.snap_deliveries where id=p_delivery_id and status='expiring';
  else
    update public.snap_deliveries
      set status=case when downloaded_at is not null then 'downloaded' else
        case when upload_lease_expires_at < now() then 'uploading' else 'pending' end end,
        expiry_claimed_at=null
      where id=p_delivery_id and status='expiring';
  end if;
end;
$$;

revoke all on function public.claim_expired_snap_deliveries(timestamptz,integer) from public, anon, authenticated;
revoke all on function public.finish_snap_expiry(uuid,boolean) from public, anon, authenticated;
grant execute on function public.claim_expired_snap_deliveries(timestamptz,integer) to service_role;
grant execute on function public.finish_snap_expiry(uuid,boolean) to service_role;

comment on column public.snap_deliveries.downloaded_at is
  'Recipient downloaded ciphertext. This is not proof of a permanent independent copy.';
comment on column public.snap_deliveries.permanent_copy_verified_at is
  'Reserved for a future verified Drive/vault receipt protocol; not set by client acknowledgement.';
comment on column public.snap_deliveries.upload_lease_expires_at is
  'Renewable 24-hour upload lease; unfinished uploads are not purged on a one-hour timer.';
