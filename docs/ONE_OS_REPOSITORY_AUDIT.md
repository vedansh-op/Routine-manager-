# ONE-OS repository audit — 2026-11-08

## Scope and confidence

This is a source-code and repository inspection of the `main` branch, not a live Supabase database audit, penetration test, or two-device test. The five SQL migrations and the app/Edge Function sources were read from GitHub. Deployment state and production RLS behavior remain unverified.

## Confirmed repository baseline

- Expo SDK 54, Expo Router, React Native, TypeScript, Supabase Auth/Postgres/Storage/Edge Functions.
- App screens exist for tasks, habits, insights, account, shared space, shared calendar, and photo memories.
- Supabase migrations currently cover profiles, two-member shared spaces/invites, weekly aggregate reports, shared activities, and encrypted Snap delivery.
- Snap delivery currently stores temporary ciphertext in the private Supabase Storage bucket `oneos-private-snaps`.
- Device X25519 private keys and local data-encryption keys are stored in Expo SecureStore; local records and photo bytes are encrypted with XChaCha20-Poly1305.
- GitHub Actions has a successful Android debug APK run #77 for commit `00164f762bcbb960dd0997c3c90732ab23d77972`. This verifies the CI build only, not installation, Supabase deployment, or two-device behavior.

## Confirmed gaps against the agreed ONE-OS decisions

### Identity and account security
- The current auth screen implements email/password sign-up, sign-in, and password reset.
- There is no Google OAuth sign-in flow in the app source inspected.
- There is no app-side mandatory MFA enrollment/challenge flow, recovery-code lifecycle, or visible device/session management.
- Email confirmation is prompted when Supabase returns no session after sign-up, but the repository does not itself prove that production Supabase email-confirmation policy is enabled.
- No delayed account deletion / seven-day grace flow or End Connection workflow was found in the inspected screens and migrations.

### Backups and storage ownership
- No Google Drive OAuth, Drive API client, archive writer, daily backup scheduler, version manifest, restore preview, Smart Merge engine, or integrity-repair pipeline was found.
- Detailed task/habit history is currently device-local. The status document explicitly warns that uninstall removes local history and device private keys and that no key recovery mechanism exists.
- Supabase currently contains identity, shared-space metadata, weekly aggregate reports, shared calendar records, and Snap delivery coordination/storage. This is not yet the agreed local + Supabase metadata + both partner Drives architecture.

### Snap
- Camera and gallery capture, encrypted delivery, local encrypted vault, date-based calendar, and recipient-side acknowledgement flow exist.
- The temporary delivery object is in Supabase Storage, not the sender's Google Drive.
- Permanent independent copies in both partners' Drives are not implemented.
- The current expiry Edge Function purges pending deliveries for recipients whose server-observed presence is older than 72 hours. It also purges uploads left in the `uploading` state for one hour; this short orphan-upload cleanup needs explicit reliability review before production.
- The current acknowledgement function removes the temporary object and then deletes pending delivery metadata. The app's local-save-before-ack ordering must be verified in a two-device test before relying on the receipt guarantee.

### Recovery and lifecycle
- First-contact partner-key fingerprint comparison and write-once key pinning exist.
- Key rotation/recovery is not implemented. A changed partner key blocks sending, which is safer than silently trusting a replacement.
- Device private keys and local-data keys are device-bound; reinstall/lost-device recovery and re-encryption are not implemented.
- Shared calendar read-only retention after disconnection, independent shared-file copies after End Connection, and revocation of lost devices are not implemented.

## Review notes / risks to resolve before adding backup migrations

1. **Do not treat a successful APK build as a deployed or secure release.** The status document says Supabase migrations, Edge Functions, secrets, cron, and two-account tests remain deployment steps.
2. **The publishable Supabase client key in the app is not a service-role key.** Keep service-role credentials exclusively in server-side secrets.
3. **RLS must be validated against a live test project.** Source review shows policies for the inspected tables, but cannot prove the deployed schema matches or that every cross-user access path is denied.
4. **The local encryption key has no recovery/wrapping mechanism.** Do not implement Drive backup of ciphertext without first defining how a newly authorized device can safely obtain the required decryption capability.
5. **The Snap receipt invariant needs an end-to-end test.** Verify that the recipient has fully written and verified their permanent local copy before acknowledgement deletes the temporary delivery object.
6. **The one-hour abandoned-upload purge may race slow or interrupted uploads.** Define resumable upload and cleanup state transitions before relying on it.
7. **Security-definer SQL functions and storage policies need a dedicated review.** Verify execute grants, search paths, membership checks, object-path ownership, rate limits, and unauthorized access with two test accounts.

## Recommended implementation order

1. Finish schema/RLS and security-definer function review; verify current Supabase deployment state without changing production.
2. Design and test recovery-key/key-wrapping hierarchy and new-device recovery before creating backup archives.
3. Add backup metadata/index schema and immutable encrypted archive format on a non-production branch/project.
4. Implement daily incremental backup to each partner's separately authorized Drive, with explicit initial consent, retries, checksums, unlimited healthy versions, and partial-success state.
5. Implement date/chunk-level on-demand restore and Smart Merge; full archive restore only for disaster recovery.
6. Migrate temporary Snap delivery from Supabase Storage to sender-owned Drive and verify recipient permanent-copy acknowledgement.
7. Implement MFA, recovery codes, device management/revocation, End Connection, account deletion grace period, and the strict release audit.
8. Complete physical Android and two-account tests before any production release.

## Explicitly not done by this audit

- No Supabase SQL was executed or deployed.
- No production settings, secrets, OAuth grants, or user data were changed.
- No app source code was changed.
- No claim is made that Google Drive backup, MFA, key recovery, or production security is implemented.
