# ONE-OS authentication, MFA, session and device-revocation audit

Date: 8 November 2026  
Scope: source review of `app/auth.tsx`, `app/_layout.tsx`, `src/auth/AuthProvider.tsx`, `src/lib/supabase.ts`, `app/account.tsx`, `src/lib/deviceCrypto.ts`, and the device-key/Snap migrations on the Phase 1 feature branch.

This is a source-level audit only. No live Supabase settings, auth hooks, sessions, MFA factors, or device records were inspected. No production configuration was changed.

## Findings

### AUTH-01 — Mandatory MFA is not enforced in the app

**Evidence**
- `app/auth.tsx` signs in with `signInWithPassword` and immediately navigates to `/`.
- There is no MFA assurance-level check, `getAuthenticatorAssuranceLevel`, challenge/verify flow, or factor enrollment UI in the inspected authentication screen.
- `app/_layout.tsx` routes any non-null session into the app; it does not require AAL2.
- The End Connection RPC separately checks `auth.jwt()->>'aal' = 'aal2'`, but that protects only that RPC and does not establish app-wide MFA enforcement.

**Risk**
The agreed mandatory-MFA policy is not implemented at the client routing boundary. A password-authenticated session may enter ordinary app screens at a lower assurance level. Other server RPCs must not assume the client has completed MFA.

**Required remediation**
1. Add MFA enrollment and challenge/verify screens using Supabase Auth MFA APIs.
2. Add a central session gate that checks current and next assurance levels and routes AAL1 sessions to the MFA challenge before protected app use.
3. Enforce AAL2 in sensitive SECURITY DEFINER RPCs and Edge Functions, not only in UI.
4. Add server-side Auth configuration/policy requiring MFA as appropriate; verify effective project settings in a non-production project.
5. Test factor enrollment, challenge, invalid code, recovery, refresh, app restart, and factor removal/replacement.

**Status: PARTIALLY IMPLEMENTED — TOTP enrollment/verification UI and an AAL2 app-route gate were added in `app/mfa.tsx` and `app/_layout.tsx`. A database trigger guard was added in `supabase/migrations/202611080012_require_aal2_for_sensitive_writes.sql` for authenticated writes to shared-space lifecycle/membership/invitations, device keys, Snap deliveries, shared calendar activities, and weekly reports. Project-level MFA policy, recovery-code support, server-side Edge Function review, and runtime tests remain OPEN. Do not mark mandatory MFA complete yet.**

### AUTH-02 — Email verification is not explicitly enforced at sign-in

**Evidence**
- Signup displays a “Check your email” message only when Supabase returns no session.
- If signup returns a session, the app navigates directly to the main screen.
- Password sign-in navigates to the main screen without checking `user.email_confirmed_at` or equivalent verified-email state.
- Actual enforcement may exist in remote Supabase Auth configuration, but that configuration was not inspected.

**Risk**
The app code itself does not enforce the agreed mandatory email-verification rule. A project configuration change or misconfiguration could permit an unverified session to access app screens.

**Required remediation**
1. Check verified-email state during session restoration and sign-in.
2. Route unverified users to a resend/confirm screen; do not treat a client-side check as the only security boundary.
3. Verify the Supabase project's email-confirmation setting in a disposable test project.
4. Test signup, resend, expired link, PKCE/deep link, and sign-in before verification.

**Status: PARTIALLY IMPLEMENTED — `app/_layout.tsx` now routes sessions without `email_confirmed_at` to `app/verify-email.tsx`, which supports resend and refresh/recheck. This is a client-side guard only. The Supabase project's Confirm Email setting, email templates/redirect allow-list, and server-side enforcement remain unverified; non-production signup/deep-link tests are required.**

### AUTH-03 — Session persistence uses AsyncStorage

**Evidence**
- `src/lib/supabase.ts` configures Supabase Auth storage with `@react-native-async-storage/async-storage`.
- The X25519 device private key uses Expo SecureStore with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, but the Supabase session token storage does not use that secure storage path.

**Risk**
Session tokens are persisted in ordinary app storage rather than the platform-backed secure storage intended for sensitive credentials. This increases exposure if app data is extracted from a compromised or backed-up device.

**Required remediation**
Evaluate a supported React Native Supabase Auth storage adapter backed by Android Keystore/iOS Keychain (for example, Expo SecureStore with a carefully tested adapter). Confirm token size/refresh behavior, migration of existing sessions, backup exclusions, and logout clearing. Do not simply change the adapter without migration and device testing.

**Status: IMPLEMENTED IN SOURCE — `src/lib/secureSessionStorage.ts` stores Supabase session data in bounded SecureStore chunks and commits a manifest only after all chunks are written. `src/lib/supabase.ts` now uses that adapter with the existing Supabase storage key, migrates the previous AsyncStorage session on first read, and clears the legacy copy after a successful secure write. This is not yet device-validated: test fresh login, upgrade with an existing session, token refresh, large sessions, interrupted writes, logout, reinstall behavior, and Android/iOS behavior before release. SecureStore corruption or partial chunk loss intentionally fails closed rather than silently restoring an older plaintext session.**

### AUTH-04 — No visible device/session management or revocation workflow

**Evidence**
- `app/account.tsx` currently exposes account identity and sign-out only.
- Device crypto keys have a `device_id`, public key and `last_seen_at`; the reviewed schema has no revoked state or revocation timestamp.
- The local private key and device ID are stored separately in SecureStore. No account UI or reviewed RPC revokes a lost device and its key.
- Supabase session sign-out on this device is not equivalent to revoking all sessions or disabling a lost device's Snap decryption key.

**Risk**
The agreed visible device management and lost-device revocation policy are not implemented. A stale registered public key can remain eligible for partner key discovery and Snap delivery until another control excludes it.

**Required remediation**
Design a server-authoritative device registry with explicit status/revoked_at, authenticated AAL2 revocation, session revocation semantics, and recipient-device eligibility checks in Snap creation and Storage reads. Ensure revocation does not silently destroy the only decryption key for already delivered data. Test lost-device recovery on a replacement device before revoking the old one.

**Status: PARTIALLY IMPLEMENTED IN SOURCE — migration `202611080013_device_revocation.sql` adds `revoked_at` and an AAL2-only owner-scoped revocation RPC; `app/account.tsx` lists registered devices and offers revocation of other devices, while protecting the current phone from accidental self-revocation. Snap recipient selection, new-delivery insertion, partner-key visibility, and Storage reads now exclude revoked keys. Non-production tests and recovery/key-continuity tests remain OPEN. **This revokes the Snap encryption key only; it does not terminate the lost phone's Supabase login session.**

### AUTH-05 — Recovery password flow is not a key-recovery flow

**Evidence**
- `app/auth.tsx` supports email password reset and `updateUser({ password })` after a recovery link.
- Device X25519 private keys remain device-only in SecureStore.
- No recovery-key enrollment, protected key backup, one-time recovery-code flow, or key re-wrapping protocol is present in the inspected code.

**Risk**
Resetting the account password does not restore encryption keys. Users may regain account access but remain unable to decrypt historical Snaps or other encrypted data after losing the original device.

**Required remediation**
Complete and independently review the recovery-key/key-wrapping design before enabling device replacement or archive restore. Never upload plaintext private keys or accept a client-provided boolean/hash as proof of recovery.

**Status: OPEN — account password reset must not be described as data-key recovery.**

## MFA implementation added on feature branch

- `app/mfa.tsx` adds TOTP enrollment using a manually entered authenticator setup key, challenge, and six-digit verification. It does not display a QR code.
- `app/_layout.tsx` checks `email_confirmed_at` and routes unverified sessions to `/verify-email` before allowing MFA or app access. `app/verify-email.tsx` supports resending the signup confirmation and refreshing the session after the user opens the email link.
- `app/_layout.tsx` checks Supabase Auth assurance level and routes non-AAL2 sessions to `/mfa`; protected screens are held behind a loading gate while assurance is checked. Device heartbeat/key registration runs only at AAL2.
- The new database trigger guard adds server-side AAL2 enforcement for the listed sensitive table writes, including writes made through SECURITY DEFINER RPCs. `supabase/functions/ack-snap/index.ts` now independently checks verified email and AAL2 before using its service-role client. The expiry Edge Function is a cron-only service-role job authenticated with its dedicated cron secret. This does not prove every RPC, Storage policy, or table is covered; a complete server-side inventory and non-production execution tests remain required. Supabase project MFA policy is not configured or verified here.
- Recovery codes and factor replacement/recovery are not implemented.

## Required non-production test matrix

- Verify an AAL1 password session cannot reach protected app screens before MFA challenge.
- Verify the AAL2 trigger rejects authenticated AAL1 writes and permits AAL2 writes for every guarded table; verify service-role Snap delivery/expiry jobs still work.
- Inventory every remaining SECURITY DEFINER RPC and Edge Function for sensitive operations not covered by the guarded tables.
- Verify unconfirmed email cannot use protected app functionality, regardless of whether signup returns a session.
- Verify refresh, deep links, app restart and logout preserve the intended auth state.
- Inspect session token persistence and backup behavior on physical Android devices.
- Revoke a test device at AAL2; confirm it cannot receive new Snaps or read protected ciphertext.
- Confirm the partner's still-authorized device and retained shared archive continue working.
- Reset account password without the original phone; verify the UI clearly distinguishes account access from encryption-key recovery.

## Release decision

**Do not mark mandatory MFA, verified-email enforcement, secure session storage, device management/revocation, or encryption-key recovery as complete.** These are open release blockers until implementation and non-production tests pass.

No migrations were executed. No Supabase project was accessed. No Edge Function was deployed. No production data or settings were changed.


## AUTH-03 implementation notes

- Secure session values are split into small chunks to avoid platform secure-storage per-item size limits; a manifest pointer is updated only after all new chunks have been persisted.
- The previous Supabase default storage key is preserved so existing installations can migrate the old AsyncStorage value without forcing an immediate sign-in.
- After a secure write succeeds, the legacy AsyncStorage entry is removed. Logout removes both secure chunks/manifest and any legacy entry.
- SecureStore writes use `WHEN_UNLOCKED_THIS_DEVICE_ONLY` accessibility. Physical-device testing is still required; source changes alone do not prove platform behavior or backup exclusion.


## AUTH-04 implementation notes

- Device rows are retained with `revoked_at` instead of being deleted, preserving an audit record visible to the account owner.
- Revocation requires the caller's own device ID and an AAL2 JWT. The RPC does not accept a target user ID.
- The current installation is identified from its local SecureStore device ID and cannot revoke itself through the account screen.
- Revoked keys are excluded from partner key discovery, Snap recipient selection, new Snap-delivery insertion, and recipient Storage reads.
- Revocation cannot remotely erase plaintext or ciphertext already copied to a device. It also does not restore access to old deliveries encrypted to a revoked/lost private key. Key recovery/re-wrapping remains a separate release blocker.
- Migration ordering: `revoked_at` is added in migration `202611080006_snap_redownload_policy.sql` before migration `202611080008_scope_partner_device_key_visibility.sql` references it; migration 013 repeats the addition with `IF NOT EXISTS` for safe standalone upgrades.
- Must test on a disposable Supabase project: revoke another device at AAL2; reject AAL1; verify revoked device cannot discover partner keys, receive new deliveries, or download retained ciphertext; verify owner can still see revoked history; confirm current device cannot revoke itself in UI; verify unrelated partner and existing local memories remain intact.


### AUTH-04 additional boundary: account session revocation is still missing

The current device revocation implementation is deliberately limited to the X25519 device key and Snap eligibility. It does **not** revoke the lost phone's Supabase refresh/access session, and it cannot remotely erase already downloaded files. Therefore it must not be described as complete lost-device account containment.

Before release, add a separate session/device authorization design that can revoke the lost installation's authenticated access without signing out every trusted device. Do not approximate per-device revocation by globally signing out the account unless the user explicitly chooses that emergency action. Verify every Edge Function, RPC, Storage policy, and database write path uses the intended device/session authorization boundary. Existing Supabase sessions are not automatically bound to the X25519 device ID.

### Recovery work must remain split into two independent systems

1. **Authenticator recovery codes:** one-time codes for regaining account MFA access if the authenticator is lost. They must be high entropy, shown once, stored server-side only as protected verifiers, rate-limited, single-use under transaction, and trigger factor replacement/session review. They do not decrypt photos.
2. **Encryption-key recovery:** a separate user-controlled recovery secret or reviewed key-wrapping scheme that can restore the device's X25519 private key and historical file keys. It must be tested offline and after phone replacement. An email password reset or MFA recovery code is not a substitute.
3. **Device replacement:** after successful recovery, register a new key, establish a verified partner-key rotation ceremony, re-wrap or re-share historical keys where authorized, then revoke the lost device's key and authenticated session. Preserve an audit trail and avoid silently trusting a changed partner fingerprint.

Do not implement a client-only "recovery successful" flag. Both recovery systems need server-verified, replay-resistant protocols and independent cryptographic review before release.
