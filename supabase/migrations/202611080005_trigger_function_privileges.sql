-- ONE-OS security hardening: trigger-only SECURITY DEFINER functions.
-- Trigger functions do not need client EXECUTE privileges after their triggers
-- have been created. Remove default PUBLIC and any explicit client grants.

revoke all on function public.handle_new_user()
  from public, anon, authenticated;

revoke all on function public.seed_member_presence()
  from public, anon, authenticated;

revoke all on function public.create_shared_archive_for_space()
  from public, anon, authenticated;

revoke all on function public.mirror_shared_activity_to_archive()
  from public, anon, authenticated;

revoke all on function public.mirror_shared_member_to_archive()
  from public, anon, authenticated;

revoke all on function public.reject_writes_to_ended_shared_space()
  from public, anon, authenticated;

revoke all on function public.enforce_shared_activity_daily_limit()
  from public, anon, authenticated;
