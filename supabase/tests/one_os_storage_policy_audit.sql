-- ONE-OS read-only Storage security audit.
-- Run in a disposable/non-production Supabase project after applying migrations.
-- This script changes nothing. Review every returned policy: PostgreSQL
-- permissive policies are OR-combined, so an older broad policy can bypass a
-- newly added restrictive-looking policy for the same command/role.

-- 1) Show every policy on storage.objects, including permissive/restrictive
-- mode, command, roles, USING, and WITH CHECK expressions.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual as using_expression,
  with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by cmd, policyname;

-- 2) Show policies whose names are not the expected ONE-OS Snap policies.
-- This is a review queue, not an automatic vulnerability verdict: unrelated
-- application buckets may legitimately have their own policies.
select
  policyname,
  permissive,
  roles,
  cmd,
  qual as using_expression,
  with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname not in (
    'ONE-OS sender can upload encrypted snap',
    'ONE-OS recipient can download pending or downloaded encrypted snap'
  )
order by policyname;

-- 3) Verify the Snap bucket is private and has the intended size/MIME limits.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'oneos-private-snaps';

-- 4) Show effective table grants for authenticated/anon. Any unexpected
-- write grant must be assessed together with RLS policies and Storage behavior.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'storage'
  and table_name = 'objects'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;
