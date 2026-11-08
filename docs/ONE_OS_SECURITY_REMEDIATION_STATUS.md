# ONE-OS security remediation status — 8 November 2026

This status covers six additive security migrations and two updated Snap Edge Functions on the Phase 1 feature branch. The shared-history migration's two malformed function terminators and the weekly-report migration's malformed function terminator were corrected. A duplicated trailing SQL fragment in the weekly-report migration was also removed and the complete file was re-fetched for source verification. Static delimiter checks were previously run for the original nine migration files; the two later privilege and Snap re-download migrations have been source-reviewed but still require PostgreSQL validation. SQL compilation for every migration remains unverified. Snap UI acknowledgement handling now waits for a confirmed server response and does not treat a missing delivery row as a successful receipt. The recipient inbox and Storage read policy now allow re-download of retained `downloaded` ciphertext on the same still-registered recipient device. This does not recover a lost private key or make an old device-bound delivery readable on a replacement device; the key recovery/rotation protocol remains open.

## Finding-by-finding status

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

## Release decision

ONE-OS remains **not ready for production release**. The strict security audit gate remains in force until the source changes compile and pass the complete non-production test suite, the app is integrated with the new RPCs/states, permanent-copy verification is implemented, the aggregate report schema and device recovery protocol are complete, and deployed configuration is independently verified.
