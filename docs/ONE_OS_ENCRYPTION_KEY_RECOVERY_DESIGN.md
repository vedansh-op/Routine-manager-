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

## 5. Server-side historical Snap authorization — selected design

### Do not weaken the Storage policy

The existing Storage policy requires a delivery's original `recipient_device_id` to reference a non-revoked key row. A revoked historical key therefore remains blocked. Do not clear `revoked_at`, rewrite old delivery rows, or register the restored historical key as a new active device.

The replacement phone receives a fresh random installation device ID and fresh active X25519 keypair. The restored historical X25519 private key is kept as a separate **decrypt-only historical key** in SecureStore; it is not registered as an active delivery destination. The new public key is registered normally. This keeps new incoming Snaps addressed to the new key while historical envelopes remain bound to the old key.

### Use a narrowly scoped recovery-download Edge Function

Keep the Storage bucket private and do not add a broad Storage SELECT policy. Add a dedicated Edge Function (design name: `recover-snap-download`) that uses the service role only after all checks below. It returns a short-lived signed URL for one exact ciphertext object; it never returns plaintext or a private key.

**Challenge issuance:**
1. Require a valid user JWT, verified email, and AAL2.
2. Require a currently active replacement device row owned by that user.
3. Require a historical device-key row owned by the same user. It may be revoked; its public key remains available only to this recovery flow, not partner discovery.
4. Require the requested Snap delivery to have `recipient_id = auth.uid()`, `recipient_device_id = historical_device_id`, a retained ciphertext state (`pending` or `downloaded`), and a non-null object path.
5. Generate a random one-time challenge nonce and two ephemeral X25519 server keypairs. Compute one shared secret against the replacement device's registered public key and one against the historical key's public key. Derive a context-bound expected proof with HKDF-SHA256 + HMAC-SHA256 over challenge ID, nonce, account ID, new device ID, historical device ID, and delivery ID. Persist only the expected proof hash, IDs, and short expiry in a private server-only challenge table; discard ephemeral server private keys immediately. Return the two ephemeral public keys, nonce, challenge ID, and expiry.

**Proof and download:**
6. The replacement app computes both X25519 shared secrets locally, derives the same context-bound HMAC proof, and submits it with the challenge ID.
7. The Edge Function rechecks JWT identity, verified email, AAL2, active replacement device, historical key ownership, delivery ownership/state, expiry, and one-time challenge status. Compare proof hashes in constant time, consume the challenge atomically, and rate-limit attempts.
8. Only after successful proof, create a signed URL for the exact stored `object_path` with a very short expiry (for example 60 seconds). Log an audit event containing user ID, new device ID, historical key ID, delivery ID, and timestamp — never the proof, shared secret, private key, recovery secret, or signed URL.
9. The app downloads ciphertext, decrypts it locally using the restored historical private key, verifies AEAD authentication, and saves it into the local vault using the restored local data key. Failed decryptions do not delete or alter the server object. Each delivery is independently authorized; paginate and rate-limit.

This is a possession proof for both the currently registered replacement key and the restored historical key. It does not trust a client boolean such as `recovery_succeeded=true`. A stolen account session alone is insufficient to obtain historical ciphertext unless the caller also proves possession of both private keys. A signed URL is a short-lived bearer credential, so it must not be logged, persisted, or shared.

### New server-side records and constraints

A later migration must define a private challenge table with:
- random challenge UUID primary key;
- `user_id`, `active_device_id`, `historical_device_id`, and `delivery_id`;
- expected proof hash only;
- created/expiry/consumed timestamps and bounded attempt count;
- no client SELECT/INSERT/UPDATE/DELETE grants or RLS policies exposing rows;
- cleanup of expired/consumed challenges.

A separate audit table should record successful and failed recovery attempts with bounded metadata. The Edge Function must be the only writer/reader via service role; validate every field and enforce per-user and per-device rate limits. Challenge consumption and successful authorization must be atomic to prevent replay or concurrent double use.

### Important limitation

This design deliberately does not restore historical access by editing `snap_deliveries.recipient_device_id`. It also does not grant the new phone permanent direct Storage access to all historical ciphertext. It authorizes a specific user's specific retained delivery only after dual-key possession proof. Existing Storage RLS remains unchanged.

Multiple historical keys are represented by their existing device-key rows. Key rotation and re-wrapping old file keys remain a separate protocol and are not part of this recovery-download path.

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
