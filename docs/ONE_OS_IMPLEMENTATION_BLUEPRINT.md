# ONE-OS implementation blueprint

**Status:** Phase 1 architecture baseline
**Scope:** Planning and technical design only. This document does not deploy services, change Supabase, or claim planned features are implemented.
**Repository:** vedansh-op/Routine-manager-
**Baseline branch:** main

## 1. Product and engineering principles

1. Android-first Expo / React Native / TypeScript application.
2. Local-first for day-to-day interaction and offline use.
3. Supabase is the identity, authorization, coordination and small-metadata service—not the bulk-file store.
4. Google Drive is the primary cloud file destination for encrypted archives and large files, with an independently authorized Drive account for each partner.
5. Retrieve only records, date ranges or individual files the user requests. Never download a full archive for ordinary browsing.
6. Encrypt on-device before uploading private content. Keep plaintext and private encryption keys out of Supabase and Drive.
7. Preserve each person's independent data and copies. Shared access must be explicit and revocable.
8. A backup is healthy only after its manifest, cryptographic authentication and archive structure have been verified.
9. Never replace the last known-good backup with an unverified or incomplete version.
10. A successful APK build is not proof of backend deployment, data safety or two-device correctness.

## 2. Existing repository baseline (observed)

The repository already contains Expo SDK 54, Expo Router, React Native and TypeScript; email/password Supabase authentication and persisted sessions; private profiles and two-person shared-space invitations; local encrypted personal task/habit data using XChaCha20-Poly1305; weekly aggregate reports; shared activity calendar with UTC storage and viewer-local rendering; Snap camera/gallery selection, encrypted photo delivery, local encrypted photo vault, recipient acknowledgement and pending-delivery expiry; X25519 device key registration and first-contact partner-key fingerprint pinning; Supabase migrations and Edge Functions for Snap coordination; and a GitHub Actions Android debug APK workflow.

Important current limitations recorded in the repository:
- Detailed task/habit history is local-only and is not yet backed up to Drive.
- Device private keys are device-bound; a reviewed recovery/key-rotation flow is missing.
- Snap delivery currently uses Supabase Storage for encrypted temporary objects; the planned Drive-based delivery path is not implemented.
- MFA enforcement, complete device management, account deletion workflow, End Connection workflow, Drive integration, archive versioning, integrity repair and on-demand cloud history retrieval require implementation and verification.
- Supabase migrations and Edge Functions still require deployment/configuration and two-account testing.

Do not remove or replace existing working flows while implementing the roadmap.

## 3. Responsibility boundaries

### Android app
- UI, local-first tasks/habits, local encrypted vault and bounded cache.
- Camera/gallery selection and client-side encryption/decryption.
- Google OAuth consent and Drive API requests using the user's own authorization.
- Backup orchestration, manifest verification, selective retrieval and restore preview.
- Device registration, local key protection and explicit user consent.

### Supabase
- Authentication, email verification, MFA policy/state, profiles and shared-space membership.
- Authorization checks and small coordination metadata.
- Drive connection metadata; never store OAuth refresh tokens in plaintext.
- Opaque object references, archive version metadata, manifest/checksum metadata, delivery state and synchronization cursors.
- Weekly aggregate reports and narrowly scoped Edge Functions.
- No plaintext photos, personal history archives, recovery secrets or Google Drive access tokens.

### Google Drive
- Encrypted backup objects and immutable version objects.
- Encrypted photos, Snap permanent copies, documents and large attachments.
- Optional indexed, date-partitioned encrypted data chunks for selective retrieval.
- Temporary Snap delivery object held in sender's Drive until recipient receipt is confirmed.
- Separate ownership and authorization for each partner's Drive.

### Local device
- Current working data and offline changes.
- Device-protected private keys.
- Small bounded cache of recently/frequently accessed history.
- Pending upload/download queue and sync cursor.
- No assumption that Android background jobs execute at an exact time.

## 4. Data domains and ownership

| Domain | Authority / storage | Cloud behavior |
|---|---|---|
| Tasks, habits, daily history | User's local encrypted store | Daily encrypted backup; retrieve requested records/chunks only |
| Weekly aggregate reports | Supabase | Small aggregate records only |
| Shared calendar | Shared-space data with per-member authorization | Preserve previously shared records read-only after disconnect |
| Private photos | Each person's private vault | Encrypted files in each owner's Drive |
| Snap delivery | Sender's temporary Drive object + Supabase metadata | Delete temporary object after verified receipt; expiry protocol requires final review |
| Shared files | Independent received copies | Stop synchronization after End Connection |
| Backup archives | Both partners' Drive destinations | Daily backup, unlimited healthy versions subject to quota warnings |
| Keys | Device secure storage and user-held recovery material | Never store plaintext private keys or recovery keys in Supabase/Drive |

A shared item must not become visible to the other partner merely because a backup is combined. The archive must preserve per-owner and per-item authorization boundaries.

## 5. Backup archive and version model

### 5.1 Logical format

Use a versioned archive format with an authenticated manifest; format/schema and application versions; stable archive ID, owner ID, creation time and backup sequence; encrypted data chunks; per-chunk stable ID, logical domain, date range where applicable, ciphertext size and cryptographic digest; encryption algorithm/version and nonce/associated-data metadata; parent/base version and incremental change cursor; and an authenticated integrity record bound to the manifest.

ZIP may be used as a transport/container for a full recovery snapshot. It must not be the normal data-access API. Do not attempt fragile in-place ZIP mutation. Create a new immutable version and promote it only after verification.

### 5.2 Incremental daily backup

- Local mutations are journaled with stable record IDs and updated timestamps.
- A daily job batches changes since the last successfully committed backup.
- Encrypt and upload changed chunks; reuse unchanged immutable chunks by reference where safe.
- Build a new manifest and version descriptor.
- Upload to each connected Drive independently.
- Verify uploaded bytes by retrieving/verifying the exact object or by a trusted provider checksum plus authenticated content verification; provider metadata alone is insufficient.
- Mark each destination's version healthy only after verification.
- Do not report a combined backup as complete until both required Drive destinations are healthy. Show partial status if one Drive fails.
- Retry safely using idempotency keys and durable local queue state.
- Android background scheduling is best-effort; run when permitted and provide foreground/manual catch-up when the OS delays work.

### 5.3 Retention and quota

- Retain unlimited previous healthy versions as the chosen product policy.
- Never silently prune healthy versions to solve quota pressure.
- Warn around 80% and 95% Drive usage and explain which destination is constrained.
- If a Drive is full, retain pending changes locally, report that the destination is behind, and retry when space is available.
- Unlimited retention is bounded by actual Google account quota and may require the user to add storage or explicitly change retention policy.

## 6. On-demand retrieval and bounded cache

Ordinary browsing must never extract or download the entire ZIP.

### 6.1 Index strategy

Maintain a small authenticated index mapping domain and stable record IDs; date partitions and time ranges; chunk IDs and Drive file IDs; schema version, ciphertext size and integrity digest; and owner/shared visibility labels.

Supabase may hold only minimum opaque index/coordination metadata needed for lookup. Sensitive record content stays encrypted in Drive. Where practical, the app can fetch a compact encrypted index from Drive and decrypt it locally.

### 6.2 Retrieval flow

1. User requests a date, month, record, photo or document.
2. Check local cache.
3. Query the minimal index for the exact item or date partition.
4. Download only the relevant encrypted chunk/file.
5. Verify digest and authenticated encryption before decrypting.
6. Display the requested data.
7. Add it to a bounded cache with LRU/age-based eviction.
8. Never cache more than the configured storage budget; offline pinning must be explicit.

### 6.3 Reinstall and restore

- Reinstall starts with essential account/app metadata, not historical bulk data.
- Re-register the new device and complete required MFA.
- Recover the user's independent key material using the approved recovery flow.
- Restore current essentials and index only.
- Fetch older dates/files only when opened or explicitly selected for offline availability.
- Full archive restore is a separate explicit disaster-recovery action with preview and Smart Merge.

## 7. Encryption and recovery model

- Use authenticated encryption for each independently retrievable object/chunk.
- Separate keys by user and data domain; shared data uses a separately protected shared key.
- Each partner receives an independently generated high-entropy recovery key.
- Recovery key material is displayed only through a secure one-time flow and never sent to Supabase or stored in Drive in plaintext.
- Use a reviewed, versioned key hierarchy and authenticated key-wrapping envelope.
- Device keys remain protected by Android Keystore/SecureStore.
- Define key rotation, lost-device revocation, recovery-key replacement, shared-key rotation on membership change and recovery when one partner is unavailable.
- Do not implement recovery by silently weakening or bypassing encryption.
- The current device-bound Snap key implementation is not yet compatible with seamless device replacement; design and test migration before enabling cloud backup of its encrypted data.

## 8. Snap and Drive delivery model

- Camera and gallery both remain supported.
- Encrypt photo bytes on sender device.
- Upload a temporary encrypted delivery object to sender's Drive.
- Supabase stores only delivery metadata, recipient/device reference, expiry and opaque Drive object reference.
- Recipient downloads ciphertext, verifies and decrypts locally, then saves a permanent encrypted local copy and a permanent encrypted copy in their own Drive.
- Sender retains an independent permanent encrypted copy in their own Drive.
- Acknowledge delivery only after the recipient's permanent copy is verified.
- Delete the temporary sender-side delivery object only after successful acknowledgement and verification.
- Existing 72-hour pending expiry must remove only the temporary delivery object, never either permanent copy.
- If either permanent copy fails, show partial delivery/backup state and retry; do not falsely mark both copies complete.

## 9. Restore and conflict policy

Smart Merge:
- Match records by stable IDs, not titles or array positions.
- Add missing records.
- Preserve newer local/cloud revisions.
- Use revision numbers and timestamps as hints, not the sole conflict proof.
- Preserve tombstones so deleted records are not resurrected by an older archive.
- If concurrent edits cannot be safely merged, show a review screen.
- Preview affected categories and counts before restore.
- Never overwrite local data before the imported archive is fully verified.
- Make restore idempotent and keep a rollback point.

## 10. Security, connection and lifecycle policies

- Mandatory verified email and MFA; Google sign-in is allowed only with a verified provider email claim.
- Device Management shows active devices and supports session/device revocation.
- New devices require MFA.
- Lost-device recovery revokes the old device after new-device recovery is verified.
- Account deletion uses the chosen seven-day grace period and restricted cancellation flow.
- End Connection requires typing exactly END CONNECTION, then a separate authenticated/MFA confirmation.
- End Connection stops shared synchronization, cancels pending Snap deliveries, and preserves independent copies and previously shared calendar history as read-only.
- Shared files remain independent copies; do not delete the other person's copy.
- Preserve an auditable event trail without retaining unnecessary sensitive content.

## 11. Required metadata concepts (proposed, not migrations)

Logical entities to validate against existing schema before adding migrations:
- connected_drive_accounts: user, provider, encrypted token reference, scopes, status, last validation time.
- backup_versions: owner, archive ID, sequence, parent version, manifest reference, status, created/verified timestamps.
- backup_objects: version, logical chunk ID, Drive file ID, ciphertext digest, size, domain, date partition, destination owner.
- backup_sync_state: user, Drive destination, last successful cursor, pending cursor, last error category and retry state.
- data_index_entries: opaque record/chunk locator, domain, date range, owner/visibility and schema version.
- device_registry: device ID, public-key references, registration/revocation timestamps and session status.
- recovery_key_envelopes: key version and non-secret envelope metadata only; never plaintext recovery keys.
- connection_lifecycle_events: connection ended/revoked timestamps and preservation state.
- snap_deliveries: temporary sender Drive object reference, recipient, state, expiry, acknowledgement and permanent-copy verification state.

Before migrations, inspect all existing tables, RLS policies, RPCs and Edge Functions. Prefer extending existing structures over duplicating them. OAuth token storage must use provider-appropriate secure handling; do not store raw refresh tokens in ordinary application tables.

## 12. Phase 1 exit criteria

- [ ] Existing source/schema inventory is complete.
- [ ] Data ownership matrix is reviewed.
- [ ] Threat model covers account takeover, lost device, partner disconnect, compromised device, Drive account revocation, replay, tampering and partial upload.
- [ ] Archive manifest and version format are specified.
- [ ] Key hierarchy and recovery protocol receive cryptographic review.
- [ ] On-demand index/query protocol is specified.
- [ ] Supabase-vs-Drive boundary is documented.
- [ ] Migration plan maps new concepts to existing schema without duplicate sources of truth.
- [ ] Failure-state and retry matrix is written.
- [ ] No production migration or deployment occurs until design review is complete.

## 13. Implementation sequence after Phase 1

1. Complete schema and threat-model review.
2. Implement account verification, MFA and device registry hardening.
3. Implement key hierarchy and recovery prototype with test vectors.
4. Implement Google Drive OAuth and least-privilege file operations.
5. Implement encrypted object/chunk format and index.
6. Implement daily incremental backup and two-Drive verification.
7. Implement bounded on-demand retrieval and cache.
8. Implement Smart Merge and disaster restore.
9. Migrate Snap temporary delivery from Supabase Storage to sender Drive and verify recipient permanent copy.
10. Implement End Connection/account deletion lifecycle.
11. Run strict security, RLS, Edge Function, recovery, corruption, quota, offline and two-device tests before release.

## 14. Explicit non-goals for this phase

- No source-code feature implementation.
- No Supabase SQL execution or migration deployment.
- No Edge Function deployment.
- No Google Drive OAuth connection or token collection.
- No production data changes.
- No APK release claim.