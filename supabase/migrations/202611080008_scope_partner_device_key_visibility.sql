-- ONE-OS least-privilege public-key discovery.
-- A user's device public keys are visible to a partner only through an active,
-- exactly-two-member shared space. Personal spaces and malformed/overfull
-- memberships must not create cross-account key-discovery paths.

drop policy if exists "Users can read own and shared device public keys"
  on public.device_crypto_keys;

create policy "Users can read own and active two-person shared device public keys"
  on public.device_crypto_keys
  for select
  to authenticated
  using (
    (user_id = (select auth.uid()) and revoked_at is null)
    or exists (
      select 1
      from public.space_members mine
      join public.spaces s on s.id = mine.space_id
      join public.space_members partner
        on partner.space_id = mine.space_id
       and partner.user_id = device_crypto_keys.user_id
      where mine.user_id = (select auth.uid())
        and mine.user_id <> device_crypto_keys.user_id
        and s.space_type = 'shared'
        and (
          select count(*)
          from public.space_members members
          where members.space_id = s.id
        ) = 2
        and exists (
          select 1
          from public.shared_archives a
          where a.source_space_id = s.id
            and a.ended_at is null
        )
    )
  );
