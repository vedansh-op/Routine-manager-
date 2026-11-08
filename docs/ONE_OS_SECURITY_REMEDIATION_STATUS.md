# ONE-OS security remediation status — 8 November 2026

This status covers six additive security migrations and two updated Snap Edge Functions on the Phase 1 feature branch. The shared-history migration's two malformed function terminators and the weekly-report migration's malformed function terminator were corrected. A duplicated trailing SQL fragment in the weekly-report migration was also removed and the complete file was re-fetched for source verification. Static delimiter checks were previously run for the original nine migration files; the two later privilege and Snap re-download migrations have been source-reviewed but still require PostgreSQL validation. SQL compilation for every migration remains unverified. Snap UI acknowledgement handling now waits for a confirmed server response and does not treat a missing delivery row as a successful receipt. The recipient inbox and Storage read policy now allow re-download of retained `downloaded` ciphertext on the same still-registered recipient device. This does not recover a lost private key or make an old device-bound delivery readable on a replacement device; the key recovery/rotation protocol remains open.

## Finding-by-finding status

| SEC-12 — shared activity archive scope changes | Added a database trigger that makes activity ID, owning space, and original creator immutable after creation, preventing an UPDATE from moving a live event into another partner's shared space while leaving a stale copy in the prior archive. | **Source guard added; validate trigger ordering and update rejection in non-production PostgreSQL.** |
| SEC-13 — over-broad partner device-key discovery | Replaced the shared-device-key SELECT policy: partner public keys are visible only through an active `shared` space with exactly two members; own device keys remain visible to the owner. | **Source hardening added; verify policy behavior with personal, active shared, ended, and overfull spaces in non-production.** |
| SEC-14 — Snap insert boundary | Added a database trigger that rejects Snap deliveries unless the space is a real, active `shared` connection with exactly two distinct members and both sender and recipient belong to it. This protects future elevated insert paths as well as the current RPC. | **Source guard added; test personal spaces, ended spaces, extra members, and valid partner sends in non-production.** |
| SEC-15 — concurrent shared-space membership | Added a table-level membership trigger that serializes inserts by account and target space, rejects a third member, and prevents one account joining two shared spaces concurrently. This closes the race where two invitees could both observe the final slot as free. | **Source guard added; run simultaneous-join tests in non-production PostgreSQL.** |
| SEC-16 — shared calendar read scope | Replaced the shared-calendar SELECT policy so membership alone is insufficient: the row must belong to a `space_type='shared'` space. Ended shared connections remain readable as retained history. | **Source policy added; test personal-space isolation and ended-connection history in non-production.** |
| SEC-17 — Storage policy composition audit | Added a read-only SQL audit that lists every `storage.objects` policy, its permissive/restrictive mode, command, roles, predicates, the Snap bucket configuration, and effective table grants. This is necessary because permissive PostgreSQL policies are OR-combined; an older broad policy can defeat the intended Snap boundary. | **Audit script added; live policy inventory remains unverified until run in a non-production Supabase project.** |

| Finding | Changes now present on branch | Status |
|---|---|---|
| SEC-01 — account deletion cascades shared data | Detached archive tables retain shared calendar snapshots without FK cascades to Auth users or live spaces. Archive participant authorization links become null on account deletion while the other participant's link survives. | **Source remediation added; needs PostgreSQL + two-account deletion tests.** Other shared data types (future shared files, notes, tasks) still need to be added to the archive model before claiming all shared history is covered. |
| SEC-02 — weak invite entropy / guessing | 96-bit invite tokens; hashed at rest; per-account 10-attempt/15-minute throttle. | **Partially fixed.** Add IP/device abuse controls and verify transaction/concurrency behavior. |
| SEC-03 — arbitrary weekly report JSON | 16 KiB serialized JSON limit plus a strict numeric allow-list matching the app payload (`tasks_total`, `tasks_completed`, `habits_total`, `habit_checkins_last_7_days`); requires all four fields as non-negative integer counters and checks completed tasks do not exceed total tasks. | **Source fix aligned with app; database and UI tests still required.** |
| SEC-04 — silent device-key replacement | Registration is insert-only for a device ID; same key is idempotent; different key is rejected. | **Partially fixed.** A separately authenticated recovery/rotation ceremony and key history remain required. |
| SEC-05 — stale presence snapshot expiry race | Replaced list-then-delete with a transactional RPC that locks presence rows and claims eligible deliveries. Edge Function performs retryable object cleanup and finalizes state. Uploads now use a 24-hour renewable lease instead of the old one-hour timeout. | **Source remediation added; test concurrent heartbeat, retry and lease behavior.** App still needs to call lease renewal during long uploads. |
| SEC-06 — acknowledgement deletes before permanent copy | ack-snap now records downloaded only and retains the temporary encrypted object. The inbox and Storage read policy both permit the recipient to re-download retained `downloaded` ciphertext until permanent-copy verification exists. | **Dangerous deletion fixed; re-download path hardened in source; full permanent-copy verification remains open.** Drive object verification and transition to permanent_copy_verified are not implemented. |
| SEC-07 — deployed configuration unverified | No production or non-production project inspection was performed. | **Open — mandatory non-production verification.** |
| SEC-08 — report access via any common space | Partner policy requires exactly two members and space_type='shared'. | **Source fix added; test required.** |
| SEC-09 — shared history after disconnection | Detached archive, two participant slots, calendar snapshot mirror, archive read policy, and MFA + typed-confirmation end_shared_connection RPC. Ended archive becomes read-only; membership removal does not delete the archive participant record. | **Source remediation added for shared calendar only; test required.** Shared-space UI now offers typed End Connection and shows read-only status; calendar creation UI becomes read-only. Other shared data types still need integration. |
| SEC-10 — unbounded text / write abuse | Space name 1–80 chars; activity note <=1,000 chars; shared calendar insert rate limited to 100 per user per UTC day. | **Partially fixed.** Per-user/per-space activity rate limits and other future metadata bounds remain. |
| SEC-11 — excess execution grants on trigger-only SECURITY DEFINER functions | Added an explicit privilege migration revoking EXECUTE from `PUBLIC`, `anon`, and `authenticated` for auth-profile, presence-seeding, archive-mirroring, ended-space guard, and activity-rate trigger functions. | **Source hardening added; verify effective grants and trigger behavior in non-production.** |

## Files added or changed

- supabase/migrations/202611080001_security_remediation.sql
- supabase/migrations/202611080002_durable_shared_history.sql
- supabase/migrations/202611080003_snap_lifecycle_hardening.sql
- supabase/migrations/202611080004_report_and_write_limits.sql
- supabase/migrations/202611080005_trigger_function_privileges.sql
- supabase/migrations/202611080006_snap_redownload_policy.sql
- supabase/migrations/202611080007_immutable_shared_activity_scope.sql
- supabase/migrations/202611080008_scope_partner_device_key_visibility.sql
- supabase/migrations/202611080009_require_active_shared_space_for_snaps.sql
- supabase/migrations/202611080010_serialize_shared_membership.sql
- supabase/migrations/202611080011_scope_shared_calendar_reads.sql
- supabase/tests/one_os_storage_policy_audit.sql
- supabase/functions/ack-snap/index.ts
- supabase/functions/expire-stale-snaps/index.ts
- app/shared.tsx
- app/calendar.tsx
- app/snaps.tsx

## Critical behavior changes

1. A recipient acknowledgement no longer removes the only temporary Snap ciphertext. It records download only.
2. Downloaded Snaps are excluded from the 72-hour offline purge until a permanent independent copy can be verified; the recipient Storage policy also permits re-download while status is `downloaded`.
3. Expiry eligibility is claimed under database locks after checking current presence, rather than using a stale inactive-member list.
4. Shared calendar snapshots are copied to a detached archive that does not cascade with the Auth user or live space. End Connection requires an aal2 session and exact END CONNECTION confirmation.
5. New shared spaces automatically receive an archive container before the owner membership is inserted.

## Important limitations and safety boundary

No SQL was executed against the configured Supabase project. No migration has been applied to production or to a test project. No Edge Function was deployed. No Storage object was touched. No production secrets were read or changed.

These are source changes, not verified deployed fixes. The migrations have not yet been executed by PostgreSQL. They must be reviewed and tested in a disposable non-production Supabase project before any deployment. In particular:
- Archive coverage currently mirrors shared calendar activities, not future shared file/task/note tables.
- The app must call the upload-lease renewal RPC during long-running uploads. Invitation UI now accepts and displays 24-character codes.
- Permanent Google Drive copy verification is not implemented; temporary Snap copies are intentionally retained after download.
- The report JSON schema is now restricted to the four numeric aggregate fields currently emitted by the app; future report fields require an explicit schema migration.
- Device key rotation/recovery is not implemented.
- Deployment catalog/grant/storage/cron/secret verification remains outstanding.

## Required non-production tests

1. Apply migrations in order to a clean Supabase project and confirm all SQL compiles.
2. Create a shared space; verify its archive and both participant slots are created.
3. Add, edit and delete a calendar activity; verify the detached archive snapshot remains intact, including deletion history.
4. End the connection with aal2 and exact phrase; verify writes are rejected and both participants can read archive history.
5. Delete one test Auth account; verify the other participant still reads archive history and archive rows remain.
6. Verify a heartbeat racing the expiry claim prevents the delivery claim when heartbeat wins the lock.
7. Verify expiry cleanup retries after Storage failure and never purges downloaded deliveries.
8. Verify uploading leases can be renewed and expired leases are cleaned safely.
9. Verify ack-snap marks download only and leaves the ciphertext object and delivery envelope intact; verify the recipient can re-download it on the same still-registered recipient device while the delivery remains `downloaded`.
10. Test invite throttling, device key immutability, report size, report RLS, and text constraints.
11. Inspect effective grants, RLS policies, Storage policies, SECURITY DEFINER grants, cron, Vault and Edge Function secrets in the test project.
12. Run two-account and multi-device negative tests for every table and object path.
13. Verify trigger-only SECURITY DEFINER functions cannot be executed by `anon` or `authenticated`, while their database triggers continue to fire normally.
14. Attempt to change `shared_activities.id`, `space_id`, and `created_by` as the creator; all three must be rejected, while ordinary title/note/time edits continue to work.
15. Verify partner public keys are hidden for personal spaces, ended shared spaces, and spaces with other than exactly two members, but visible to the two active shared participants.
16. Attempt Snap inserts through the RPC and a controlled elevated test path for personal, ended, one-member, three-member, wrong-sender, and wrong-recipient cases; only the valid active two-person shared-space case should succeed.
17. Run two concurrent invite acceptances for one remaining slot; exactly one may join. Also attempt concurrent joins into different shared spaces for the same account; only one may succeed. Race a membership insert against the MFA-confirmed End Connection RPC; the archive-row lock must serialize them so no member can join after termination commits.
18. Verify a member cannot read `shared_activities` rows attached to a personal space, while both participants can still read retained calendar history after End Connection.
19. Run `supabase/tests/one_os_storage_policy_audit.sql`; inspect every `storage.objects` policy for broad or overlapping permissive rules, confirm the Snap bucket is private, and review effective grants before accepting the Storage boundary.

## Release decision

ONE-OS remains **not ready for production release**. The strict security audit gate remains in force until the source changes compile and pass the complete non-production test suite, the app is integrated with the new RPCs/states, permanent-copy verification is implemented, the aggregate report schema and device recovery protocol are complete, and deployed configuration is independently verified.


## Supplemental database-policy inventory

- Added read-only audit script: `supabase/tests/one_os_database_policy_audit.sql`.
- It inventories public-table RLS enabled/forced flags, every public-schema RLS policy (including permissive/restrictive mode and expressions), client/service-role table grants, and SECURITY DEFINER functions with effective EXECUTE access and function settings.
- This is intentionally an inventory, not an automatic pass/fail verdict. PostgreSQL permissive policies combine with OR, so reviewers must inspect every policy on each table, not only the ONE-OS policy names.
- Static review note: `member_presence` has RLS enabled and no client-facing SELECT policy in the migrations reviewed. That is fail-closed for ordinary client reads; confirm no app feature relies on direct presence reads and verify the deployed grants/policies in a non-production project.
- Run this audit alongside `supabase/tests/one_os_storage_policy_audit.sql` before considering the database security review complete. No production SQL has been executed.


## Newly confirmed release blockers — recovery and account lifecycle

| Finding | Source evidence | Required safe action | Status |
|---|---|---|---|
| SEC-19 — no recoverable encryption-key ceremony | `src/lib/secureLocalStore.ts` creates a random per-account local data key and stores it only in device SecureStore. `src/lib/deviceCrypto.ts` similarly stores the X25519 private key only on the device. Both use device-only accessibility. There is no recovery-key wrapping, encrypted key export/import, recovery-code validation, or authenticated device-replacement flow. | Design and independently review a recovery protocol before implementing it. Each partner's recovery secret must be independent, high entropy, shown once, stored safely by the user, and used to unwrap a separately encrypted copy of the relevant data keys. Never upload plaintext recovery secrets or private keys. Include revocation of lost device registrations and re-verification of partner fingerprints after rotation. | **Open — release blocker.** Do not claim encrypted local data or old Snap deliveries are recoverable after device loss/reinstall. |
| SEC-20 — account deletion lifecycle is not implemented in the app | `app/account.tsx` currently exposes account identity and sign-out only. There is no delayed 7-day deletion request, re-authentication/MFA confirmation, cancellation window, scheduled Auth deletion, or UI explaining the effect on retained shared archives. | Implement only after deletion semantics are tested end-to-end: re-authenticate with MFA, create a pending deletion request with a server-enforced 7-day grace period, restrict cancellation to the account owner during that period, then perform deletion through a trusted server process. Preserve the detached shared archive and the other participant's access. | **Open — release blocker.** No account deletion action is currently exposed in the app. |

### Recovery and deletion verification additions

20. On device A, create encrypted local data and a Snap key; verify a fresh install/device B cannot decrypt it without the approved recovery ceremony. Verify correct recovery restores access and wrong recovery material fails closed.
21. Rotate/revoke a device only after the recovery ceremony; verify the old device can no longer register or send, and partner-key fingerprint changes require explicit re-verification.
22. Request account deletion; verify MFA is required, deletion is delayed for exactly 7 days, only the owner can cancel during the grace period, and final deletion does not erase the other participant's detached shared calendar archive.
23. Confirm no client-side code can directly delete Auth users or bypass the server-enforced deletion schedule.



## Authentication hardening added on 8 November 2026

| Finding | Source change | Status |
|---|---|---|
| AUTH-01 — client-only MFA gate | Added `supabase/migrations/202611080012_require_aal2_for_sensitive_writes.sql` with a database trigger guard requiring an AAL2 JWT for authenticated writes to shared-space lifecycle, membership, invitations, device keys, Snap deliveries, shared calendar activities, and weekly reports. The existing `end_shared_connection` RPC already requires AAL2. | **Source guard added.** It has not been executed by PostgreSQL. Validate AAL1 rejection, AAL2 success, personal-space behavior, and service-role maintenance in non-production. Inventory all remaining SECURITY DEFINER functions and Edge Functions; this is not yet proof of complete coverage. |
| AUTH-02 — unverified email sessions | Added `app/verify-email.tsx` with resend and refresh/recheck actions. `app/_layout.tsx` routes sessions without `email_confirmed_at` to verification before MFA or protected screens. | **Client guard added.** Supabase Confirm Email settings, templates, redirect allow-list and server-side behavior remain unverified. |

New/updated authentication files:
- `supabase/migrations/202611080012_require_aal2_for_sensitive_writes.sql`
- `app/verify-email.tsx`
- `app/_layout.tsx`
- `docs/ONE_OS_AUTH_SESSION_AUDIT.md`

These changes remain source-only. No Supabase migration has been executed, no project Auth setting has been changed, and no production deployment has occurred.
