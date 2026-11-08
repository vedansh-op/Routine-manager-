# ONE-OS MFA recovery implementation gate

Date: 8 November 2026
Scope: recovery design for the Expo / React Native application using `@supabase/supabase-js`.

## Decision

Do not implement a client-invented recovery-code flow that claims to replace Supabase MFA. The current ONE-OS app relies on Supabase Auth assurance levels: protected routes and sensitive database writes require an Auth-issued AAL2 session. A code accepted only by an application table or Edge Function does not, by itself, upgrade the Supabase JWT to AAL2.

The agreed product requirement remains: users need a recovery path if their primary authenticator is lost. The implementation must preserve the AAL2 security boundary rather than bypass it.

## Provider capability checked

The current Supabase JavaScript MFA reference says recovery codes are not supported by the JavaScript Auth MFA API and recommends enrolling more than one MFA factor (up to 10). The Supabase MFA guide likewise says Supabase does not return recovery codes and recommends a backup TOTP factor stored separately from the primary factor.

Sources checked 8 November 2026:
- https://supabase.com/docs/reference/javascript/auth-mfa
- https://supabase.com/docs/guides/platform/multi-factor-authentication
- https://supabase.com/docs/guides/auth/auth-mfa/totp

An experimental recovery-code API exists in some non-JavaScript SDK documentation, but that is not evidence that the React Native JavaScript client used by this app supports it. Do not call undocumented methods or infer cross-SDK support.

## Safe immediate path

1. Keep the existing primary TOTP factor.
2. Add support for enrolling a second, independently stored TOTP factor (for example, a separate authenticator on a second device or a separately protected authenticator vault).
3. Require a fresh AAL2 challenge before adding, replacing, or removing a factor.
4. Show the user which factor is primary versus backup without exposing TOTP secrets after enrollment.
5. Do not permit removal of the last verified factor.
6. Test sign-in, factor selection, invalid codes, interrupted enrollment, refresh, logout, app restart, and recovery on a replacement phone in a non-production Supabase project.
7. Keep encryption-key recovery separate. A backup TOTP factor restores account/MFA access; it does not restore the device's X25519 private key or decrypt historical Snaps.

## If one-time recovery codes remain mandatory

A proper one-time recovery-code feature must be supported by the Auth server or a reviewed authentication extension that can establish an equivalent, cryptographically trustworthy step-up state for every AAL2-protected operation. A custom database code verifier alone is insufficient.

Any future implementation must provide:
- high-entropy codes generated server-side and displayed once;
- server-side protected verifiers only (never plaintext codes in the database, logs, analytics, or client storage);
- rate limiting and abuse monitoring;
- atomic, single-use consumption resistant to concurrent replay;
- explicit expiry/regeneration and revocation semantics;
- a trusted way to establish step-up authorization without fabricating or bypassing Supabase's AAL2 claim;
- session review/revocation after recovery and notification to the account owner;
- independent security review and adversarial tests.

Do not store plaintext recovery codes in Supabase or Drive. Do not accept a client boolean, client timestamp, or untrusted hash as proof of successful recovery. Do not let password reset stand in for MFA recovery.

## Relationship to encryption-key recovery

MFA recovery is not encryption recovery. Even after the user regains an AAL2 session, historical Snap content remains undecryptable if the only copy of the recipient's X25519 private key was on the lost phone. Encryption-key recovery requires its own user-controlled recovery secret/key-wrapping design, verified partner-key continuity, and restore tests. Do not revoke the old device's key until the replacement-device recovery path has been proven, except where an emergency security decision explicitly requires immediate revocation.

## Source implementation update — 8 November 2026

The feature branch now contains:
- `app/security.tsx`: lists verified TOTP factors, permits one additional backup factor when exactly one verified factor exists, shows the new setup secret during enrollment, verifies the backup with a Supabase MFA challenge, and permits removal only of the additional factor (never the last factor).
- `app/account.tsx`: links to authenticator management.
- `app/mfa.tsx`: offers a choice among verified factors at sign-in instead of always forcing the first factor.

The UI labels the additional factor as a backup and explicitly warns that it does not recover historical encryption keys. The current implementation is source-only and has not yet been tested against a real Supabase test project or on physical Android devices. Factor ordering/naming and the exact provider behavior for adding/removing factors must be verified before release. The app currently limits its own UI to two factors even though the provider may allow more.

## Status

**SOURCE UI IMPLEMENTED — NOT YET VALIDATED OR DEPLOYED.**

No database migration, Edge Function, Auth configuration, or production setting was changed. Next steps are to complete TypeScript CI, validate enrollment/challenge/unenrollment and AAL2 behavior in a disposable Supabase project, and test on Android. One-time recovery codes remain a release blocker until the Auth server can support the required AAL2 step-up semantics. Encryption-key recovery remains a separate release blocker.
