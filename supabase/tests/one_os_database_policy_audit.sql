-- ONE-OS read-only database security inventory.
-- Run only in a disposable/non-production Supabase project during validation.
-- This script performs SELECTs only; it does not alter schema, grants, or data.

-- 1) RLS enabled/forced state for application tables in public schema.
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  c.relkind as relation_kind
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relname;

-- 2) Every public-schema RLS policy. Remember: permissive policies combine
-- with OR; restrictive policies combine with AND.
select
  schemaname, tablename, policyname, permissive, roles, cmd,
  qual as using_expression,
  with_check as with_check_expression
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 3) Effective table privileges granted to client-facing roles.
select
  grantee, table_schema, table_name, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

-- 4) SECURITY DEFINER routines and their effective EXECUTE access.
-- A SECURITY DEFINER function exposed to a client role needs a deliberate
-- review of its body, caller checks, search_path, and granted role list.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind in ('f', 'p')
  and p.prosecdef
order by p.proname, identity_arguments;

-- 5) Explicit inventory of the core ONE-OS authorization tables.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles', 'spaces', 'space_members', 'space_invitations',
    'invitation_attempt_limits', 'weekly_reports', 'shared_activities',
    'device_crypto_keys', 'member_presence', 'snap_deliveries',
    'shared_archives', 'shared_archive_participants',
    'shared_archive_activities', 'shared_activity_daily_limits'
  )
order by c.relname;


-- 6) Verify the AAL2 write-guard trigger is attached to every intended table.
-- A missing row or disabled trigger is a release blocker. Also inspect any
-- additional user-writable shared table not represented in this list.
select
  n.nspname as schema_name,
  c.relname as table_name,
  t.tgname as trigger_name,
  t.tgenabled as trigger_enabled,
  pg_get_triggerdef(t.oid) as trigger_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and n.nspname = 'public'
  and t.tgname like 'require_aal2_%'
order by c.relname, t.tgname;

-- 7) Inventory all user-facing public tables and their non-internal triggers.
-- Use this alongside policies and grants to identify unguarded write paths.
select
  c.relname as table_name,
  t.tgname as trigger_name,
  t.tgenabled as trigger_enabled,
  p.proname as trigger_function,
  p.prosecdef as trigger_function_security_definer
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_trigger t on t.tgrelid = c.oid and not t.tgisinternal
left join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relname, t.tgname;
