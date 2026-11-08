# ONE-OS encryption-key recovery design gate

Date: 8 November 2026
Scope: design-only review of the existing local vault and Snap encryption implementation. No application code, database migration, Drive integration, or production setting is changed by this document.

## 1. Current key hierarchy confirmed in source

The app currently has two independent random 32-byte per-user keys:

1. **Snap recipient X25519 private key** — stored in Expo SecureStore under `one-os-snap-x25519:<userId>`. Its public key is registered in `device_crypto_keys`. A Snap sender creates a random file key, encrypts the image with XChaCha20-Poly1305, and wraps that file key to the recipient device public key using ephemeral X25519 + HKDF-SHA256 + XChaCha20-Poly1305.
2. **Local vault/data key** — stored in Expo SecureStore under `one-os-data-key:<userId>`. It encrypts the local Snap files and encrypted AsyncStorage values. The encrypted photo files and index are device-local today.

The SecureStore entries use device-only accessibility. They are not backed up by the app. A replacement installation therefore cannot currently decrypt old recipient Snap envelopes or the local encrypted vault merely by signing into the same Supabase account.

Relevant source:
- `src/lib/deviceCrypto.ts`
- `src/lib/snapCrypto.ts`
- `src/lib/secureLocalStore.ts`
- `src/lib/snapVault.ts`
- `app/snaps.tsx`

## 2. Recommended recovery model

Use a **separate, high-entropy, user-held recovery secret** to protect a recovery envelope. Do not derive it from the account password, email, phone number, or a partner's credentials.

At first explicit recovery setup, generate 32 random bytes on the user's device. Encode it for a one-time display as a human-storable recovery phrase or a checksummed encoding. The user must confirm they saved it before recovery is marked enabled. The plaintext secret is never sent to Supabase or Drive and is not retained in ordinary app storage.

Use HKDF-SHA-256 with a random per-envelope salt and a versioned, domain-separated context string to derive a 32-byte wrapping key from the random recovery secret. Since the secret is uniformly random and high entropy, a password KDF is not needed. Do not accept a short human-chosen password as the recovery secret.

Create a versioned authenticated envelope using XChaCha20-Poly1305. The encrypted payload contains:
- the existing 32-byte X25519 private key;
- the existing 32-byte local vault/data key;
- the original device ID associated with the X25519 key;
- key IDs and format/version identifiers.

Bind authenticated metadata (AAD) to the account UUID, envelope version, key IDs, and algorithm identifiers. Store only the envelope, salt, nonce, public metadata, and integrity/version information in the user's own Drive backup. A second opaque copy may be stored in the other agreed backup destination only if the user has authorized that destination; it remains unreadable without the recovery secret. Never store the recovery secret or plaintext private keys in Supabase, Drive, logs, analytics, crash reports, or app preferences.

The recovery envelope is a small key backup, not a substitute for the encrypted data archive. The data itself must still be backed up as authenticated ciphertext.

## 3. Replacement-device recovery sequence

1. User signs into the same ONE-OS account on the replacement phone and completes email verification and Supabase AAL2.
2. User explicitly chooses recovery and obtains the encrypted recovery envelope from an authorized Drive backup.
3. User enters/scans the recovery secret locally. The app derives the wrapping key, authenticates the envelope, and decrypts the two key materials only in memory.
4. Before changing any account/device state, validate key lengths, envelope version, account binding, device ID format, and that the restored public key derived from the private key matches the expected registered public key.
5. Restore the local data key into the replacement phone's SecureStore and restore the X25519 private key. Never overwrite an existing non-empty key silently; require an explicit conflict/recovery path.
6. Register a **new installation device ID** for the replacement phone. Preserve the old X25519 key material for decrypting historical Snap envelopes, but do not pretend the old installation itself has returned.
7. Add a reviewed, AAL2-protected server workflow to authorize the replacement device to retrieve retained historical deliveries addressed to the prior device ID. This workflow must only move/authorize the user's own recipient deliveries, must preserve audit history, and must not un-revoke the lost device. It must not be implemented as a client-side bypass of Storage RLS.
8. Verify the restored local vault and at least one historical Snap/archive item before marking recovery complete. If verification fails, leave the original server-side encrypted copies untouched and provide a safe retry path.
9. After recovery, allow the user to create a fresh device key and re-wrap/re-address historical items through a separately reviewed migration. Do not silently rotate keys during sign-in.

## 4. Important security boundaries

- **MFA is not encryption recovery.** A backup TOTP factor only restores account access.
- **Password reset is not encryption recovery.**
- **Device revocation remains meaningful.** A replacement device gets a new device ID. The old ID stays revoked; recovery must not reactivate it.
- Restoring the old X25519 private key means the replacement can decrypt historical envelopes addressed to that key. It does not erase copies or knowledge already obtained by a lost device.
- Recovery-secret loss means the envelope cannot be opened. The app must say this plainly; there is no server-side master key or support backdoor.
- Recovery-secret rotation requires decrypting the existing envelope locally, creating and verifying a new envelope, confirming the new secret, then retiring the old envelope only after a healthy new copy exists.
- Recovery envelope and archive versions must be immutable and integrity-verified before being treated as healthy.
- Do not upload a key envelope before explicit user consent to recovery setup and Drive destinations.
- Do not add a custom server boolean that claims recovery succeeded. The client must cryptographically authenticate the envelope; server authorization must separately enforce account ownership, AAL2, active space/device constraints, and rate limits.

## 5. Required server/data design before implementation

A later migration and RPC review must define:
- how a new active device can request the user's own retained Snap ciphertext addressed to a prior device ID without weakening partner isolation;
- how the old revoked device ID remains revoked and visible in audit history;
- whether Snap metadata is re-addressed to the new device ID or a dedicated historical-key access mapping is used;
- how multiple historical device keys and future key rotation are represented;
- how RLS and Storage policies authorize only the authenticated recipient's own deliveries;
- how recovery attempts are rate-limited and audited;
- how concurrent recovery, lost/revoked devices, and partially restored archives behave.

No policy should grant broad access to all ciphertext for a user merely because the client claims it decrypted a recovery envelope.

## 6. Test gate

Before release, use a disposable Supabase project and two physical Android devices to test:
- first-time key generation and recovery-envelope creation;
- wrong secret, corrupted envelope, wrong account, wrong version, tampered AAD, and truncated envelope;
- interruption during envelope upload and during local SecureStore restore;
- replacement phone with no existing keys;
- replacement phone with conflicting pre-existing keys;
- lost device revoked before recovery;
- old device remains revoked after recovery;
- historical Snap download/decryption using restored key material;
- local vault index and photo decryption using restored data key;
- AAL1 rejection and AAL2 success for server-side recovery authorization;
- cross-account and partner isolation for every new RPC, table, and Storage policy;
- recovery-secret rotation and old-envelope retirement;
- recovery on a second replacement device and idempotent retry.

## 7. Current decision and status

**DESIGN RECOMMENDATION ONLY — NOT IMPLEMENTED OR VALIDATED.**

The key-wrapping approach is technically compatible with the existing XChaCha20-Poly1305 and HKDF-SHA256 dependencies. However, the server-side historical-delivery authorization and device-ID lifecycle must be designed and tested before source implementation. In particular, do not implement a client-only restore that silently reuses or reactivates a revoked device ID.

No migration, Edge Function, production SQL, Drive OAuth, or application code was changed as part of this design gate.
