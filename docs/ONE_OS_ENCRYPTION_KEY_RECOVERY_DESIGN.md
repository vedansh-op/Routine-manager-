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

## 2. Local key-storage changes required

The current source has a single SecureStore alias per user for each key:
- `one-os-snap-device:<userId>`
- `one-os-snap-x25519:<userId>`
- `one-os-data-key:<userId>`

The current `ensureDeviceCryptoKey()` expects exactly one active device key and registers it on every startup. Recovery must not simply replace the values behind these aliases because that would conflate historical and active identity.

The implementation must introduce an explicit versioned key registry in SecureStore, with separate namespaces for:
- active installation identity and active X25519 private key;
- zero or more historical decrypt-only X25519 private keys, keyed by their original device IDs;
- the single account-local vault/data key;
- recovery-envelope metadata/version and last successful verification state.

The account-local data key remains the same logical key across replacement devices because it decrypts existing local vault files and encrypted local indexes. A restored historical Snap private key is separate from the new active Snap private key. The normal registration function must only ever register the active key.

Migration rules:
1. Read the legacy aliases without deleting or modifying them.
2. Validate the legacy device ID, private-key length, and derived public key against the registered server row before migrating.
3. Atomically write the new versioned active-key record and verify it can be read and derive the same public key.
4. Only after verification mark the registry migrated; retain legacy aliases until a later release and explicit cleanup policy.
5. If only one of the legacy device ID/private key exists, or any value is malformed/mismatched, stop and preserve all existing values. Never silently generate a replacement key over incomplete legacy material.
6. For the data key, distinguish a genuinely new account with no encrypted local data from a missing key when encrypted records/files already exist. If ciphertext exists but the key is missing, fail closed and offer recovery; never create a new key and imply the old data is recoverable.
7. During restore, write candidate key material to temporary versioned aliases, read it back, derive/compare public keys and authenticate a known encrypted vault item, then atomically switch a small active-version pointer. Keep the previous pointer/aliases until the new state is fully verified. On failure, roll back the pointer and leave source ciphertext untouched.
8. Never log key bytes, recovery secrets, decrypted content, or raw challenge proofs. Clear temporary byte arrays best-effort after use; JavaScript zeroization is best-effort only and must not be described as guaranteed memory erasure.

The current `createUserKey()` automatically creates a new data key when its SecureStore alias is empty. Before recovery ships, replace that behavior with an explicit first-install vs missing-key decision based on the presence of encrypted local records and vault files. This is a release-blocking correctness issue: a missing old key must not be mistaken for a fresh account.

The current `createDeviceCryptoKey()` stores the device ID and private key in separate writes and correctly fails closed when only one exists. Preserve this behavior while making the writes versioned and recoverable; do not introduce a fallback that generates a second key after a partial write.

## 3. Recommended recovery model

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

## 4. Replacement-device recovery sequence

1. User signs into the same ONE-OS account on the replacement phone and completes email verification and Supabase AAL2.
2. User explicitly chooses recovery and obtains the encrypted recovery envelope from an authorized Drive backup.
3. User enters/scans the recovery secret locally. The app derives the wrapping key, authenticates the envelope, and decrypts the two key materials only in memory.
4. Before changing any account/device state, validate key lengths, envelope version, account binding, original device ID format, and that the restored historical public key derived from the private key matches the original registered public key (including when that original row is revoked).
5. Restore the local data key and historical X25519 private key into separate, explicitly versioned SecureStore aliases. Never overwrite an existing non-empty key silently; require an explicit conflict/recovery path. The historical private key is decrypt-only and must not be used for new outgoing Snap delivery.
6. Generate a fresh active X25519 keypair and a new random installation device ID for the replacement phone, then register that new public key normally. Keep the historical key separate; do not pretend the old installation itself has returned or clear its revocation marker.
7. Use the dual-key possession challenge in Section 5 to authorize retrieval of each retained historical delivery addressed to the prior device ID. The server workflow must preserve audit history and must not un-revoke the lost device or bypass Storage RLS.
8. Verify the restored local vault and at least one historical Snap item before marking recovery complete. If verification fails, leave the original server-side encrypted copies untouched and provide a safe retry path.
9. Any later re-wrapping of old file keys to the new active public key is a separately reviewed migration. Do not silently rotate keys during sign-in.

## 5. Important security boundaries

- **MFA is not encryption recovery.** A backup TOTP factor only restores account access.
- **Password reset is not encryption recovery.**
- **Device revocation remains meaningful.** A replacement device gets a new device ID. The old ID stays revoked; recovery must not reactivate it.
- Restoring the old X25519 private key means the replacement can decrypt historical envelopes addressed to that key. It does not erase copies or knowledge already obtained by a lost device.
- Recovery-secret loss means the envelope cannot be opened. The app must say this plainly; there is no server-side master key or support backdoor.
- Recovery-secret rotation requires decrypting the existing envelope locally, creating and verifying a new envelope, confirming the new secret, then retiring the old envelope only after a healthy new copy exists.
- Recovery envelope and archive versions must be immutable and integrity-verified before being treated as healthy.
- Do not upload a key envelope before explicit user consent to recovery setup and Drive destinations.
- Do not add a custom server boolean that claims recovery succeeded. The client must cryptographically authenticate the envelope; server authorization must separately enforce account ownership, AAL2, active space/device constraints, and rate limits.

## 6. Server-side historical Snap authorization — selected design

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

## 7. Test gate

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

## 8. Current decision and status

**DESIGN RECOMMENDATION ONLY — NOT IMPLEMENTED OR VALIDATED.**

The key-wrapping approach is technically compatible with the existing XChaCha20-Poly1305 and HKDF-SHA256 dependencies. However, the server-side historical-delivery authorization and device-ID lifecycle must be designed and tested before source implementation. In particular, do not implement a client-only restore that silently reuses or reactivates a revoked device ID.

No migration, Edge Function, production SQL, Drive OAuth, or application code was changed as part of this design gate.

## 9. Current call-site audit and implementation order

The source audit traced these call sites:

- `app/_layout.tsx` and `src/store/AppStore.tsx` both call `ensureDeviceCryptoKey(userId)`; registration is coalesced in-process, but these two entry points must continue to resolve to the same active installation identity.
- `app/snaps.tsx` uses the returned active key for partner fingerprinting and normal Snap decryption. Historical keys must never be returned by this API or selected for new outgoing deliveries.
- `app/account.tsx` reads the active installation ID through `getLocalDeviceId()`; it must continue to report only the active installation, not a historical key.
- `src/lib/secureLocalStore.ts` owns the account data key used by task/habit storage and the Snap vault. `src/store/AppStore.tsx` stores encrypted task data under `one-os-v2:<userId>`; `src/lib/snapVault.ts` stores encrypted Snap files and an encrypted index.
- `app/snaps.tsx` saves sender and received plaintext into the encrypted local vault, then later decrypts the local file for preview. The local vault data key is therefore required independently of the historical X25519 key.

### Findings that affect migration safety

1. The active X25519 device ID and private key are stored in two separate legacy aliases. The current code correctly rejects a one-sided/missing pair; a migration must retain this fail-closed behavior.
2. The account data key is created on demand by `createUserKey()`. It is used by both AsyncStorage encrypted records and the Snap vault. A missing key can make existing ciphertext unreadable; key creation must become an explicit first-install operation, not a generic fallback.
3. The AppStore migration marker is separate from the encryption key. It does not prove that the account has no encrypted records or vault files.
4. A successful local vault restore needs to verify both the encrypted index and at least one referenced file where available. If the vault is empty, the recovery envelope's authenticated metadata and a separately stored key-check value must validate the restored key.
5. Expo SecureStore does not provide a multi-key transaction. The registry pointer pattern is therefore required; write candidate aliases first, read them back, verify them, and switch one pointer last. Keep rollback material until a subsequent successful launch.
6. Existing normal Snap downloads use the active key only. Historical Snap recovery must be a separate explicit API and UI flow, backed by the selected challenge/Edge Function design. Do not add historical-key fallback to `decryptSnap()` or normal inbox download logic.

### Implementation sequence (source-only, before server work)

A. Add a versioned local key registry module and typed records. It must support one active device key, multiple historical decrypt-only keys, and a data-key version without exposing raw key material to UI state.

B. Add read-only legacy inspection. Determine whether each alias exists, validate formats, and compare the derived public key to the matching own `device_crypto_keys` row. Do not write or delete anything in this phase.

C. Add a local encrypted-data inventory. Check the AppStore ciphertext key and Snap vault index/files without decrypting or changing them. Treat inaccessible filesystem state or partial inventory as unknown, not empty.

D. Add an explicit bootstrap decision:
- truly fresh local account: create initial active device key and data key;
- valid legacy state: migrate to versioned aliases and verify;
- encrypted content exists but its key is missing: stop and require recovery;
- partial/malformed/mismatched key material: stop and preserve all values;
- offline/unavailable server validation: keep already-valid local data usable where safe, but defer registration/migration that requires server confirmation.

E. Add temporary restore slots and a verified pointer switch with rollback. Recovery must not overwrite the existing active alias, and must not register a historical key as active.

F. Only after local storage passes tests, implement the recovery envelope creation/restore UI. Historical-download Edge Function and private challenge tables are a separate server-side phase.

### Required tests before any recovery implementation is considered complete

- Fresh install creates one active device key and one data key exactly once.
- Concurrent bootstrap from AppStore, root layout, and Snap screen does not create divergent keys.
- Both legacy aliases present and valid migrate without changing derived public key or device ID.
- Either legacy alias missing, malformed, or mismatched stops without overwriting any alias.
- Existing encrypted AppStore record with missing data key is detected and never replaced with a fresh key.
- Existing Snap vault index or file with missing data key is detected and never overwritten.
- Empty new vault can be distinguished from unavailable/inaccessible filesystem state.
- Interrupted candidate write leaves old pointer active; interrupted pointer switch rolls back safely.
- Restored historical key can decrypt only historical envelopes in the explicit recovery path and cannot be selected by ordinary Snap sending.
- Restored data key authenticates the encrypted AppStore record and Snap vault index/file before success is shown.
- Sign-out, account switching, app restart, and reinstall do not cross-contaminate key namespaces.

Status: source call sites reviewed. A read-only legacy device-key inspector now exists in `src/lib/keyRecoveryRegistry.ts`; it validates local alias shape and compares the derived public key with the user's registered server row without returning or mutating key material. It does not yet inspect the local data key, encrypted task record, or Snap vault files, and it does not migrate or restore keys. These checks are implementation gates, not claims of completed testing.


## 10. Read-only inspection foundation

`src/lib/keyRecoveryRegistry.ts` adds `inspectLegacyDeviceKey(userId)`. Its result is a small status union: absent, partial, malformed, server-unavailable, server-error, server-mismatch, or valid (with revoked state). It does not return identifiers or key bytes, write SecureStore, call key registration, or alter database rows. A valid result means only that the local legacy private key derives the public key stored for that exact account/device row; it does not prove data-key or vault recoverability.

The next implementation step is a read-only local-data inventory for the encrypted AppStore key and Snap vault index/files. No migration or automatic key generation should be wired into app startup until that inventory and the bootstrap decision are reviewed.
