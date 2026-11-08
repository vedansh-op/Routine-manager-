-- Device revocation metadata must exist before this migration updates
-- Storage authorization to exclude revoked recipient devices.
alter table public.device_crypto_keys
  add column if not exists revoked_at timestamptz;

-- ONE-OS Snap recovery: allow the intended recipient device to re-download
-- retained ciphertext after a previous download acknowledgement.
-- The downloaded state is deliberately retained until permanent-copy proof exists.

drop policy if exists "ONE-OS recipient can download pending encrypted snap"
  on storage.objects;

create policy "ONE-OS recipient can download pending or downloaded encrypted snap"
on storage.objects for select
to authenticated
using (
  bucket_id = 'oneos-private-snaps'
  and exists (
    select 1
    from public.snap_deliveries d
    where d.object_path = storage.objects.name
      and d.recipient_id = (select auth.uid())
      and d.recipient_device_id in (
        select k.device_id
        from public.device_crypto_keys k
        where k.user_id = (select auth.uid())
          and k.revoked_at is null
      )
      and d.status in ('pending', 'downloaded')
  )
);
