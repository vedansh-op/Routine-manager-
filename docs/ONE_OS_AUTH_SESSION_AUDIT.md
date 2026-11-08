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

**Status: OPEN — no storage migration made.**

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

**Status: OPEN — no revocation migration or UI added.**

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
