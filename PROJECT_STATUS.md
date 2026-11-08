# ONE-OS project status

**Last repository review:** 9 November 2026
**Current work branch:** phase-1/one-os-architecture-blueprint
**Pull request:** https://github.com/vedansh-op/Routine-manager-/pull/1
**Phase:** 1 of 8 — Architecture, Security and Data Design
**Phase decision:** Engineering/design baseline prepared; formal exit waits on independent cryptographic review, disposable Supabase validation and physical Android tests. A current-branch debug APK has now built successfully but is not device-tested. See docs/ONE_OS_PHASE_1_EXIT_REVIEW.md.

## Repository and stack

- Android-first Expo SDK 54, Expo Router, React Native 0.81 and TypeScript.
- Supabase Auth, Postgres, Storage and Edge Functions.
- GitHub Actions for TypeScript/regression tests and standalone Android debug APKs.
- The feature branch is open in PR #1. It has not been merged. No production deployment was performed.

## Implemented application source

### Core app

- Home, Tasks, Habits, Routines, Focus, Insights, Account, Shared Space, Our Time, Shared Calendar, Private Photo Memories, MFA/security and Notifications screens.
- Email/password authentication, password reset, secure session storage adapter, verified-email route gate and Supabase AAL2 challenge gate.
- Two-member shared space and expiring invitation codes with server-side membership/RPC logic.
- User-scoped local tasks, habits, routines and completion history.
- XChaCha20-Poly1305 encrypted local records and encrypted photo vault using device SecureStore-held account data keys.
- Weekly aggregate reports; private task/habit content is not uploaded as detailed Supabase rows.
- Shared calendar activities stored as UTC and rendered in the viewer's timezone.
- Private photo Snap capture/gallery, device-specific X25519 key registration, partner fingerprint pinning, encrypted delivery and local vault.
- Account screen lists registered photo-encryption devices and can revoke another device's Snap key. This does not revoke the device's Supabase login session or erase already downloaded files.

### Security source hardening on the feature branch

- Invitation token entropy increased to 96 bits, tokens stored as hashes and per-account attempt throttling added.
- Weekly report JSON bounded and allow-listed to aggregate numeric fields.
- Device-key registration is insert-only for a device ID; replacement requires a separate recovery/rotation protocol.
- Detached shared archive tables preserve shared calendar snapshots independently of live shared-space membership.
- Snap upload leases, transactional expiry claims and retryable expiry finalization added.
- Snap acknowledgement records download only; temporary ciphertext is retained until a verified permanent-copy mechanism exists.
- Shared activity owner/space scope is immutable.
- Partner device public-key visibility is limited to active two-member shared spaces.
- Snap delivery insert guards enforce active shared membership and recipient-device eligibility.
- Membership concurrency is serialized to prevent third members and duplicate shared-space membership.
- Shared calendar reads are scoped to shared spaces.
- AAL2 database trigger guards added for the listed sensitive writes.
- Device-key revocation RPC and UI added; full per-install auth-session revocation remains open.
- Read-only database and Storage policy inventory SQL scripts added.

These are checked-in source/migration changes. They are not validated deployed database fixes: migrations 001–013 have not been applied to a disposable test Supabase project or production.

## Notifications

Local notifications use Expo Notifications and account-encrypted reminder records.

Implemented source includes:
- Task deadline reminders at multiple lead times, due time and an overdue option; stable grouping/replacement and completion/deletion cleanup.
- Habit reminders daily or selected weekdays; check-in cancels pending snoozes while preserving future repeat schedules.
- Routine step-transition and completion reminders with cancellation when completed.
- Focus-end and break-return alerts.
- Shared calendar reminders with configurable advance time and stale-event reconciliation.
- Morning/evening prompts, quiet hours, category preferences, sound/vibration settings, snooze, Done/Open actions and a recent activity history.
- Account/sign-out reconciliation and cleanup of stale, duplicate and expired scheduled alerts.
- Persisted notification-state validation now rejects invalid repeat rules, malformed fields and duplicate stable IDs/source keys; valid reminder records are bounded and normalized.

Still outstanding in the full notification scope:
- Recurring task follow-ups, missed-habit/streak logic, dynamic daily briefings, routine editing/progress, broader calendar DST/offline coverage, missed-alert recovery, grouping/frequency limits, remote shared push, location/travel-aware reminders and physical Android testing.
- Home-screen widgets remain dependent on stable task/habit/routine/calendar models and tested notification lifecycle.

Android notification delivery is best-effort and can be delayed by OS/OEM battery management. No exact-time guarantee is made.

## Local encryption and recovery

- Explicit fresh-install data-key initialization, read-only local encrypted-data inventory and fail-closed startup classification are present.
- Existing ciphertext is preserved when its key is missing or malformed; code does not silently create a replacement key over existing encrypted data.
- Recovery-state, key-registry, secure-store, Snap-vault and legacy migration tests are included in CI. Secure session storage now enforces the same 100-chunk / 40,000-character limit on write and read; failed chunk writes preserve the previous committed manifest.
- A key hierarchy/recovery-envelope design document exists, but recovery envelopes, historical Snap key recovery and verified new-device replacement are not implemented.
- Backup TOTP is separate from encryption-key recovery. Supabase JS MFA recovery-code semantics are not invented in the client.
- Device-key revocation does not revoke the lost device's auth session.
- Snap ciphertext and wrapped file keys use authenticated encryption; temporary secret buffers are cleared in `finally` blocks. Seven regression tests cover recipient-key enforcement, ciphertext/envelope tampering and failure-path cleanup. **Separate delivery-row metadata is not currently authenticated as associated data**; a versioned backward-compatible metadata-binding design is still required and awaits independent review.

## Supabase migration inventory

The feature branch currently contains these migrations, in order:

1. 202611070001_profiles.sql
2. 202611070002_shared_spaces_invites.sql
3. 202611070003_weekly_reports.sql
4. 202611070004_shared_activity_calendar.sql
5. 202611070005_encrypted_snap_delivery.sql
6. 202611080001_security_remediation.sql
7. 202611080002_durable_shared_history.sql
8. 202611080003_snap_lifecycle_hardening.sql
9. 202611080004_report_and_write_limits.sql
10. 202611080005_trigger_function_privileges.sql
11. 202611080006_snap_redownload_policy.sql
12. 202611080007_immutable_shared_activity_scope.sql
13. 202611080008_scope_partner_device_key_visibility.sql
14. 202611080009_require_active_shared_space_for_snaps.sql
15. 202611080010_serialize_shared_membership.sql
16. 202611080011_scope_shared_calendar_reads.sql
17. 202611080012_require_aal2_for_sensitive_writes.sql
18. 202611080013_device_revocation.sql

**Do not apply these to production as part of this phase review.** They must first compile and pass the RLS, grants, Storage, trigger, RPC, concurrency and two-account matrix in a disposable non-production Supabase project. The audit SQL scripts are read-only inventories, not automatic proof of safety.

No SQL has been run against the configured project during this work. No Edge Function has been deployed. No production Auth settings, secrets, cron jobs or Storage objects have been modified.

## Phase 1 design documents

- docs/ONE_OS_PHASE_1_THREAT_MODEL.md
- docs/ONE_OS_SUPABASE_SECURITY_AUDIT.md (final source-level inventory section lists 21 RLS/Storage policies and 23 SECURITY DEFINER functions)
- docs/ONE_OS_PHASE_1_SCHEMA_AND_ARCHIVE_SPEC.md
- docs/ONE_OS_PHASE_1_FAILURE_MATRIX.md
- docs/ONE_OS_PHASE_1_EXIT_REVIEW.md
- docs/ONE_OS_SUPABASE_SECURITY_AUDIT.md
- docs/ONE_OS_SECURITY_REMEDIATION_STATUS.md
- docs/ONE_OS_AUTH_SESSION_AUDIT.md
- docs/ONE_OS_ENCRYPTION_KEY_RECOVERY_DESIGN.md
- docs/ONE_OS_NOTIFICATION_ARCHITECTURE.md
- docs/ONE_OS_IMPLEMENTATION_BLUEPRINT.md

The new schema/archive document describes proposed future metadata concepts. It does not mean Drive OAuth, encrypted backup versions, selective retrieval or Smart Merge are implemented.

## CI validation

The latest verified feature-branch CI run passed on commit 1bab4deda75f2d345f41b3ad8f2f9c2e2a1532e7:
- TypeScript validation passed.
- Recovery-state suite: 27 tests passed.
- Notification-state suite: 6 tests passed.
- Snap crypto suite: 7 tests passed.
- Secure session storage suite: 7 tests passed.
- **Total: 47 automated tests passed across four suites.**

Run: https://github.com/vedansh-op/Routine-manager-/actions/runs/42534451255

The TypeScript workflow runs recovery, notification-state, Snap crypto and secure session storage suites. The Android APK and versioned release workflows run the same regression tests. The APK workflow now also builds this feature branch for device validation.

## Build and release status

- A current-branch standalone debug APK was built successfully by run https://github.com/vedansh-op/Routine-manager-/actions/runs/42533640626 from source commit `47eeade84cfb7d045dc096471568dfd1ffb9fc10`. Artifact: `ONE-OS-debug-apk` (47,261,710-byte ZIP; contains a 135,856,630-byte APK).
- APK SHA-256: `de9f626b1a5c0051565a2f6f956fe0cb76b7f608786a90a2bd05a83b42b9fa66`. The APK contains `AndroidManifest.xml`, 21 DEX files and `assets/index.android.bundle`; package includes arm64-v8a, armeabi-v7a, x86 and x86_64 libraries.
- The workflow verified the embedded JavaScript bundle and uploaded the APK. It has **not** been installed or tested on a physical Android device.
- No versioned release or Play Store production-signed build is claimed here.
- The release workflow creates a standalone debug/test APK, not a Play Store production-signed APK.

## Next gates

1. Independent cryptographic review of key hierarchy, recovery envelope, nonce/AAD rules and device replacement.
2. Apply migrations in a disposable Supabase project; validate PostgreSQL compilation, effective grants/RLS/Storage policies, triggers, RPCs, Edge Functions and two-account/concurrency cases.
3. Build and install the current feature branch on physical Android device(s); test authentication, local-key safety, notifications, reboot, timezone/DST, battery saver, Snap lifecycle and account switching.
4. Resolve all findings and update the Phase 1 exit review with exact evidence.
5. Request a separate explicit approval before merge, production deployment or release.

A green CI check proves only the commands that ran for that commit. It does not prove a deployed backend, secure live configuration, working Google Drive backup, successful recovery or Android delivery.
