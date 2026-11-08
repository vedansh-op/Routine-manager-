-- ONE-OS: durable shared-history archive.
-- Additive migration. Run in a disposable Supabase project and review before production.
-- Archive rows deliberately have no FK to spaces/auth.users so identity deletion
-- or source-space cleanup cannot cascade-delete the retained shared history.

create table if not exists public.shared_archives (
  id uuid primary key default gen_random_uuid(),
  source_space_id uuid unique not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid,
  constraint shared_archives_ended_by_no_fk check (ended_by is null or ended_by::text <> '')
);

create table if not exists public.shared_archive_participants (
  archive_id uuid not null references public.shared_archives(id) on delete cascade,
  slot smallint not null check (slot in (1,2)),
  user_id uuid references auth.users(id) on delete set null,
  original_user_id uuid not null,
  joined_at timestamptz not null default now(),
  primary key (archive_id, slot),
  unique (archive_id, original_user_id)
);

create index if not exists shared_archive_participants_user_idx
  on public.shared_archive_participants(user_id, archive_id);

create table if not exists public.shared_archive_activities (
  archive_id uuid not null references public.shared_archives(id) on delete cascade,
  source_activity_id uuid not null,
  created_by_original_id uuid not null,
  title text not null,
  note text,
  starts_at timestamptz not null,
  timezone text not null,
  source_created_at timestamptz not null,
  source_updated_at timestamptz not null,
  source_deleted_at timestamptz,
  archived_at timestamptz not null default now(),
  primary key (archive_id, source_activity_id)
);

create index if not exists shared_archive_activities_time_idx
  on public.shared_archive_activities(archive_id, starts_at);

alter table public.shared_archives enable row level security;
alter table public.shared_archive_participants enable row level security;
alter table public.shared_archive_activities enable row level security;

revoke all on public.shared_archives from anon, authenticated;
revoke all on public.shared_archive_participants from anon, authenticated;
revoke all on public.shared_archive_activities from anon, authenticated;
grant select on public.shared_archives, public.shared_archive_participants,
  public.shared_archive_activities to authenticated;

create or replace function public.is_shared_archive_participant(p_archive_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $
  select exists (
    select 1 from public.shared_archive_participants p
    where p.archive_id=p_archive_id and p.user_id=(select auth.uid())
  );
$;
revoke all on function public.is_shared_archive_participant(uuid) from public;
grant execute on function public.is_shared_archive_participant(uuid) to authenticated;

drop policy if exists "Archive participants can read their shared archive" on public.shared_archives;
create policy "Archive participants can read their shared archive"
  on public.shared_archives for select to authenticated
  using (public.is_shared_archive_participant(id));

drop policy if exists "Archive participants can read archive membership" on public.shared_archive_participants;
create policy "Archive participants can read archive membership"
  on public.shared_archive_participants for select to authenticated
  using (public.is_shared_archive_participant(archive_id));

drop policy if exists "Archive participants can read shared history" on public.shared_archive_activities;
create policy "Archive participants can read shared history"
  on public.shared_archive_activities for select to authenticated
  using (public.is_shared_archive_participant(archive_id));

-- Ensure every shared space has a detached archive container.
insert into public.shared_archives(source_space_id)
select s.id from public.spaces s where s.space_type = 'shared'
on conflict (source_space_id) do nothing;

-- New shared spaces receive an archive container before the owner membership
-- row is inserted by create_shared_space().
create or replace function public.create_shared_archive_for_space()
returns trigger language plpgsql security definer set search_path = ''
as $
begin
  if new.space_type = 'shared' then
    insert into public.shared_archives(source_space_id)
    values (new.id)
    on conflict (source_space_id) do nothing;
  end if;
  return new;
end;
$;
revoke all on function public.create_shared_archive_for_space() from public;

drop trigger if exists create_shared_archive_after_space_insert on public.spaces;
create trigger create_shared_archive_after_space_insert
  after insert on public.spaces
  for each row execute function public.create_shared_archive_for_space();

-- Record both participant identities in stable slots. A user UUID is retained
-- as a non-FK audit identifier; user_id is the live authorization link.
insert into public.shared_archive_participants(
  archive_id, slot, user_id, original_user_id, joined_at
)
select a.id,
       row_number() over (partition by a.id order by m.joined_at, m.user_id)::smallint,
       m.user_id,
       m.user_id,
       m.joined_at
from public.shared_archives a
join public.space_members m on m.space_id = a.source_space_id
where not exists (
  select 1 from public.shared_archive_participants p
  where p.archive_id = a.id and p.original_user_id = m.user_id
)
on conflict do nothing;

-- Mirror existing shared calendar rows into detached history.
insert into public.shared_archive_activities(
  archive_id, source_activity_id, created_by_original_id, title, note,
  starts_at, timezone, source_created_at, source_updated_at
)
select a.id, e.id, e.created_by, e.title, e.note, e.starts_at, e.timezone,
       e.created_at, e.updated_at
from public.shared_activities e
join public.shared_archives a on a.source_space_id = e.space_id
on conflict (archive_id, source_activity_id) do nothing;

-- Keep the archive synchronized while the connection is active.
create or replace function public.mirror_shared_activity_to_archive()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_archive_id uuid;
begin
  select a.id into v_archive_id
  from public.shared_archives a
  where a.source_space_id = coalesce(new.space_id, old.space_id)
    and a.ended_at is null;
  if v_archive_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then
    update public.shared_archive_activities
      set source_deleted_at = now(), archived_at = now()
      where archive_id = v_archive_id and source_activity_id = old.id;
    return old;
  end if;

  insert into public.shared_archive_activities(
    archive_id, source_activity_id, created_by_original_id, title, note,
    starts_at, timezone, source_created_at, source_updated_at, source_deleted_at
  ) values (
    v_archive_id, new.id, new.created_by, new.title, new.note,
    new.starts_at, new.timezone, new.created_at, new.updated_at, null
  )
  on conflict (archive_id, source_activity_id) do update set
    created_by_original_id = excluded.created_by_original_id,
    title = excluded.title,
    note = excluded.note,
    starts_at = excluded.starts_at,
    timezone = excluded.timezone,
    source_updated_at = excluded.source_updated_at,
    source_deleted_at = null,
    archived_at = now();
  return new;
end;
$$;

drop trigger if exists mirror_shared_activity_to_archive on public.shared_activities;
create trigger mirror_shared_activity_to_archive
  after insert or update or delete on public.shared_activities
  for each row execute function public.mirror_shared_activity_to_archive();

-- Keep participant slots in sync during active membership. Never delete archive
-- participants when a live membership is removed.
create or replace function public.mirror_shared_member_to_archive()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_space uuid; v_user uuid; v_archive uuid; v_slot smallint;
begin
  v_space := coalesce(new.space_id, old.space_id);
  v_user := coalesce(new.user_id, old.user_id);
  select id into v_archive from public.shared_archives
    where source_space_id = v_space and ended_at is null;
  if v_archive is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.shared_archive_participants
      where archive_id=v_archive and original_user_id=v_user) then
      select (coalesce(max(slot),0)+1)::smallint into v_slot
      from public.shared_archive_participants where archive_id=v_archive;
      if v_slot <= 2 then
        insert into public.shared_archive_participants(archive_id,slot,user_id,original_user_id,joined_at)
        values (v_archive,v_slot,v_user,v_user,new.joined_at)
        on conflict do nothing;
      end if;
    end if;
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists mirror_shared_member_to_archive on public.space_members;
create trigger mirror_shared_member_to_archive
  after insert or delete on public.space_members
  for each row execute function public.mirror_shared_member_to_archive();

-- Connection end is a one-way state transition. Require recent MFA (aal2)
-- and the exact confirmation phrase. Existing archive rows remain readable.
create or replace function public.end_shared_connection(
  p_space_id uuid,
  p_confirmation text
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_archive uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if coalesce(auth.jwt()->>'aal','') <> 'aal2' then
    raise exception 'Recent multi-factor authentication is required';
  end if;
  if p_confirmation is distinct from 'END CONNECTION' then
    raise exception 'Explicit confirmation required';
  end if;

  select a.id into v_archive
  from public.shared_archives a
  join public.space_members m on m.space_id=a.source_space_id
  where a.source_space_id=p_space_id and m.user_id=v_user and a.ended_at is null
  for update of a;
  if v_archive is null then raise exception 'Active shared connection not found'; end if;

  update public.shared_archives
    set ended_at=now(), ended_by=v_user
    where id=v_archive and ended_at is null;
end;
$$;

revoke all on function public.end_shared_connection(uuid,text) from public;
grant execute on function public.end_shared_connection(uuid,text) to authenticated;

-- Once ended, no further shared calendar writes are accepted. Existing source
-- rows may still be readable by current members; detached archive access remains.
drop policy if exists "Members can add shared activities" on public.shared_activities;
create policy "Members can add shared activities"
  on public.shared_activities for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.is_space_member(space_id)
    and exists (
      select 1 from public.shared_archives a
      where a.source_space_id=shared_activities.space_id and a.ended_at is null
    )
  );

drop policy if exists "Creators can edit their shared activities" on public.shared_activities;
create policy "Creators can edit their shared activities"
  on public.shared_activities for update to authenticated
  using (
    created_by = auth.uid()
    and public.is_space_member(space_id)
    and exists (select 1 from public.shared_archives a
      where a.source_space_id=shared_activities.space_id and a.ended_at is null)
  )
  with check (
    created_by = auth.uid()
    and public.is_space_member(space_id)
    and exists (select 1 from public.shared_archives a
      where a.source_space_id=shared_activities.space_id and a.ended_at is null)
  );

drop policy if exists "Creators can delete their shared activities" on public.shared_activities;
create policy "Creators can delete their shared activities"
  on public.shared_activities for delete to authenticated
  using (
    created_by = auth.uid()
    and public.is_space_member(space_id)
    and exists (select 1 from public.shared_archives a
      where a.source_space_id=shared_activities.space_id and a.ended_at is null)
  );

comment on table public.shared_archives is
  'Detached shared-history container. Intentionally survives deletion of the source space or either Auth account.';
comment on table public.shared_archive_activities is
  'Independent read-only history snapshots for both participants; no Auth-user or live-space foreign keys.';
