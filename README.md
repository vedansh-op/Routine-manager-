# ONE-OS

An Android-first personal operating system for tasks, habits, routines, focus, insights, private memories and an explicitly shared two-person space.

Repository: [vedansh-op/Routine-manager-](https://github.com/vedansh-op/Routine-manager-)

## Current phase and status

ONE-OS is in **Phase 1 of 8 — Architecture, Security and Data Design**. The design/source baseline is documented on the open feature branch and PR #1:

- [Phase 1 exit review](docs/ONE_OS_PHASE_1_EXIT_REVIEW.md)
- [Project status](PROJECT_STATUS.md)
- [Threat model](docs/ONE_OS_PHASE_1_THREAT_MODEL.md)
- [Schema and encrypted archive specification](docs/ONE_OS_PHASE_1_SCHEMA_AND_ARCHIVE_SPEC.md)
- [Failure and retry matrix](docs/ONE_OS_PHASE_1_FAILURE_MATRIX.md)

The engineering/design package is ready for external validation. Formal Phase 1 sign-off is still held on independent cryptographic review, disposable Supabase validation and physical Android testing. No production SQL, Edge Function, Auth configuration, cron, secrets or Storage objects were changed in this review.

## Current app foundation

- Expo SDK 54 / Expo Router / React Native / TypeScript.
- Home, Tasks, Habits, Routines, Focus, Insights, Account, Shared Space, Our Time, Shared Calendar, Private Photo Memories, security/MFA and Notifications screens.
- Supabase email/password auth, persisted secure-session adapter, verified-email route gate and AAL2 challenge gate.
- Local-first personal tasks, habits, routines and history encrypted at rest with XChaCha20-Poly1305 and a per-account key held in Android SecureStore.
- Weekly aggregate reports only; private task titles, notes and detailed daily history are not uploaded as cloud rows.
- Shared calendar entries use UTC instants and viewer-local display.
- Private Snap source uses per-device X25519 keys, partner fingerprint pinning, encrypted ciphertext transfer and a local encrypted vault.
- Security migration hardening covers invitation throttling, write limits, shared-history snapshots, Snap lifecycle, key visibility, active membership, AAL2 database guards and device-key revocation.
- Local notifications cover tasks, habits, routines, focus, calendar and daily prompts, with quiet hours, category preferences, snooze/actions and reconciliation.

These are source and migration changes on the feature branch. They are not proof of a configured/deployed Supabase project or physical Android behavior.

## Important limitations

- Google Drive OAuth, encrypted backup versions, two-independent-Drive verification, selective history retrieval and Smart Merge are not implemented.
- The encryption-key recovery envelope and historical Snap key recovery are not implemented. Uninstall or loss of a device can still make local-only data unavailable.
- Device-key revocation blocks Snap key eligibility; it does not yet revoke the lost phone's Supabase login session or erase files already downloaded there.
- Current temporary Snap delivery still uses Supabase Storage. A verified permanent Drive-copy proof path is not implemented.
- Remote shared push and location/travel-aware reminders are not implemented.
- A successful TypeScript check is not an APK build. A successful APK build is not a backend deployment or a two-device test.
- A rooted or compromised device can expose plaintext while the app is unlocked; at-rest encryption cannot eliminate that risk.

## Supabase validation — do not run on production

The feature branch contains 18 ordered SQL migrations under supabase/migrations/ (base schema plus hardening migrations 001–013). They have **not** been compiled/applied in a disposable test project during this review, and they have not been deployed to production.

Before any deployment:
1. Create a disposable, non-production Supabase project with synthetic test accounts and no production data.
2. Reconcile its live schema/catalog with all checked-in migrations.
3. Apply migrations in timestamp order and run supabase/tests/one_os_database_policy_audit.sql and supabase/tests/one_os_storage_policy_audit.sql.
4. Verify effective grants, every RLS policy, SECURITY DEFINER function, trigger, Storage policy, Edge Function and cron behavior.
5. Execute the negative two-account, concurrency, MFA/AAL2, Snap lifecycle and recovery test matrix.
6. Obtain an independent cryptographic review before implementing or enabling key recovery and encrypted Drive backup.

Do not apply the feature-branch migrations to a production Supabase project as part of ordinary testing. Never place a service-role key in the Android app, APK, GitHub repository or client-side environment.

## Build and releases

- [GitHub Actions](https://github.com/vedansh-op/Routine-manager-/actions)
- [ONE-OS Releases](https://github.com/vedansh-op/Routine-manager-/releases)
- [Release process](docs/RELEASING.md)

A previous debug APK exists for an older base commit; it is not a build of the latest feature branch. No current feature-branch APK or physical-device test is claimed by this Phase 1 review. Versioned releases are created only from reviewed tags. The configured release workflow creates a debug/test APK, not a Play Store production-signed build.

## Engineering rule

Keep production untouched until the test project, cryptographic review, device tests, PR review and an explicit deployment approval are complete.
