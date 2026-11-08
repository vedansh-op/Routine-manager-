-- ONE-OS final source-level bounds for weekly aggregate reports and shared writes.
-- Non-production validation required before deployment.

create or replace function public.is_valid_weekly_aggregate(p_report jsonb)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare v_item record; v_allowed text[] := array[
  'tasks_total',
  'tasks_completed',
  'habits_total',
  'habit_checkins_last_7_days'
];
begin
  if p_report is null or jsonb_typeof(p_report) <> 'object' then return false; end if;
  if octet_length(p_report::text) > 16384 then return false; end if;
  for v_item in select key,value from jsonb_each(p_report)
  loop
    if not (v_item.key = any(v_allowed)) then return false; end if;
    if jsonb_typeof(v_item.value) <> 'number' then return false; end if;
    if (v_item.value #>> '{}') !~ '^[0-9]+
    if (v_item.value #>> '{}')::numeric < 0
       or (v_item.value #>> '{}')::numeric > 1000000 then return false; end if;
  end loop;
  if not (p_report ?& array['tasks_total','tasks_completed','habits_total','habit_checkins_last_7_days']) then
    return false;
  end if;
  if (p_report->>'tasks_completed')::numeric > (p_report->>'tasks_total')::numeric then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.is_valid_weekly_aggregate(jsonb) from public;
grant execute on function public.is_valid_weekly_aggregate(jsonb) to authenticated;

alter table public.weekly_reports
  drop constraint if exists weekly_reports_aggregate_schema;
alter table public.weekly_reports
  add constraint weekly_reports_aggregate_schema
  check (public.is_valid_weekly_aggregate(report));

-- Per-user daily write budget for shared calendar creation.
create table if not exists public.shared_activity_daily_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  day_utc date not null,
  writes integer not null default 0 check (writes between 0 and 100),
  primary key (user_id, day_utc)
);
alter table public.shared_activity_daily_limits enable row level security;
revoke all on public.shared_activity_daily_limits from anon, authenticated;

create or replace function public.enforce_shared_activity_daily_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  if new.created_by is null then raise exception 'Activity creator required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.created_by::text || ':shared-activity',0));
  insert into public.shared_activity_daily_limits(user_id,day_utc,writes)
  values (new.created_by,(now() at time zone 'utc')::date,1)
  on conflict (user_id,day_utc) do update
    set writes=public.shared_activity_daily_limits.writes+1
  returning writes into v_count;
  if v_count > 100 then
    raise exception 'Daily shared calendar creation limit reached';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_shared_activity_daily_limit() from public;

drop trigger if exists enforce_shared_activity_daily_limit on public.shared_activities;
create trigger enforce_shared_activity_daily_limit
  before insert on public.shared_activities
  for each row execute function public.enforce_shared_activity_daily_limit();

comment on function public.is_valid_weekly_aggregate(jsonb) is
  'Strict allow-list of numeric aggregate counters only; raw titles, notes, strings, arrays and daily records are rejected.';
 then return false; end if;
    if (v_item.value #>> '{}')::numeric < 0
       or (v_item.value #>> '{}')::numeric > 1000000 then return false; end if;
    if v_item.key = 'completion_percent'
       and (v_item.value #>> '{}')::numeric > 100 then return false; end if;
  end loop;
  if not (p_report ?& array['tasks_total','tasks_completed','habits_total','habit_checkins_last_7_days']) then
    return false;
  end if;
  if (p_report->>'tasks_completed')::numeric > (p_report->>'tasks_total')::numeric then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.is_valid_weekly_aggregate(jsonb) from public;
grant execute on function public.is_valid_weekly_aggregate(jsonb) to authenticated;

alter table public.weekly_reports
  drop constraint if exists weekly_reports_aggregate_schema;
alter table public.weekly_reports
  add constraint weekly_reports_aggregate_schema
  check (public.is_valid_weekly_aggregate(report));

-- Per-user daily write budget for shared calendar creation.
create table if not exists public.shared_activity_daily_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  day_utc date not null,
  writes integer not null default 0 check (writes between 0 and 100),
  primary key (user_id, day_utc)
);
alter table public.shared_activity_daily_limits enable row level security;
revoke all on public.shared_activity_daily_limits from anon, authenticated;

create or replace function public.enforce_shared_activity_daily_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  if new.created_by is null then raise exception 'Activity creator required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.created_by::text || ':shared-activity',0));
  insert into public.shared_activity_daily_limits(user_id,day_utc,writes)
  values (new.created_by,(now() at time zone 'utc')::date,1)
  on conflict (user_id,day_utc) do update
    set writes=public.shared_activity_daily_limits.writes+1
  returning writes into v_count;
  if v_count > 100 then
    raise exception 'Daily shared calendar creation limit reached';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_shared_activity_daily_limit() from public;

drop trigger if exists enforce_shared_activity_daily_limit on public.shared_activities;
create trigger enforce_shared_activity_daily_limit
  before insert on public.shared_activities
  for each row execute function public.enforce_shared_activity_daily_limit();

comment on function public.is_valid_weekly_aggregate(jsonb) is
  'Strict allow-list of numeric aggregate counters only; raw titles, notes, strings, arrays and daily records are rejected.';
