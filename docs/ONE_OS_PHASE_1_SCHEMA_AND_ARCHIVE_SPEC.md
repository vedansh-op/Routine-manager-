# ONE-OS Phase 1 schema, ownership and archive specification

**Status:** Proposed design contract. It does not create tables, run migrations, connect Drive, or claim backup/recovery is implemented.
**Design rule:** Extend existing sources of truth; never mirror private record contents into Supabase to make querying easier.

## 1. Current data inventory and ownership

| Current object | Owner / purpose | Current source of truth | Access boundary |
|---|---|---|---|
| auth.users | Login identity | Supabase Auth | Auth provider |
| profiles | Public/minimal profile metadata | Supabase | Own profile |
| spaces | Personal or shared space metadata | Supabase | Member-scoped read; narrow RPC mutation |
| space_members | Membership and role | Supabase | Member-scoped read; server/RPC mutation |
| space_invitations | Hashed, expiring invite coordination | Supabase | No direct client row access; RPC only |
| invitation_attempt_limits | Abuse throttle | Supabase | Server-side only |
| weekly_reports | Aggregate productivity summary | Supabase | Owner; explicitly permitted intended partner only in an active two-person shared space |
| shared_activities | Explicitly shared calendar items | Supabase | Shared-space members while active; archive read after End Connection |
| device_crypto_keys | Public device keys and revocation state | Supabase | Own keys; partner public keys only in active two-member shared space |
| member_presence | Server-observed presence | Supabase | Server/RPC boundary; no broad client reads |
| snap_deliveries | Snap envelope, status and opaque object reference | Supabase metadata | Sender/recipient and device authorization; active shared-space checks |
| shared_archives | Detached retention container | Supabase | Archive participant authorization |
| shared_archive_participants | Detached owner/participant links | Supabase | Each authorized participant only |
| shared_archive_activities | Retained calendar snapshots | Supabase | Participant read-only after disconnection |
| storage bucket oneos-private-snaps | Current temporary Snap ciphertext | Supabase Storage | Private bucket and exact row/device-bound policy |

The current database has no Google Drive connection, backup-version, backup-object, encrypted-index, recovery-envelope or per-install session-revocation tables. Do not assume they exist because they appear in this proposed design.

## 2. Ownership matrix

| Data domain | Authoritative owner | Local copy | Supabase role | Future Drive role | Shared with partner? |
|---|---|---|---|---|---|
| Tasks, notes, due dates, completion history | One account | Encrypted local AppStore | None for detailed records; only allowed aggregates | Owner's encrypted backup | No, unless a future explicit share feature is designed |
| Habits, routines, streak history | One account | Encrypted local AppStore | None for detailed records | Owner's encrypted backup | No |
| Personal photos and files | One account | Encrypted local vault | Opaque delivery coordination only where needed | Owner's encrypted permanent copy | Only individual Snaps explicitly sent |
| Weekly report | One account | Derived locally | Whitelisted aggregate counters | May be represented inside owner's encrypted backup | Only opt-in report to intended partner |
| Shared calendar | Shared-space participants | Local UI/cache | Shared record and detached read-only archive | Optional owner backup later, without replacing server shared source | Yes, intentionally |
| Snap in transit | Sender until verified receipt; then each participant has own permanent copy | Encrypted sender/recipient vault | Current temporary ciphertext + metadata; future design targets opaque Drive reference and delivery state | Sender temporary transfer object plus independent permanent copies in each owner's Drive | Specific recipient only |
| Device keys | Device/account | Private part on that device | Public-key registry and revocation metadata | Never back up raw private key; recover only through approved envelope flow | Public key only to eligible partner |
| Recovery material | Individual user | User-controlled secret and encrypted envelope after approval | Envelope metadata/ciphertext only if separately reviewed | Encrypted envelope may be retained by user-selected storage | Never shared with partner by default |
| Drive authorization | Each account | Platform secure credential storage where approved | Connection status and non-secret scope metadata only | User-owned Drive objects | No cross-account access |

## 3. Existing schema map and migration guardrails

The current schema inventory is in the base migrations 202611070001–005 and security changes 202611080001–013.

- Preserve profiles, spaces, space_members and space_invitations as the identity/membership authority. Do not add a second membership table for Drive or backups.
- Keep weekly_reports as aggregate records. Do not place task titles, notes, habit names, daily completions or private chronology in report JSON.
- Keep shared_activities as the active shared calendar source. shared_archives, shared_archive_participants and shared_archive_activities are the detached history boundary for calendar only today. Do not create a second live calendar table.
- Keep device_crypto_keys as the current public-device-key registry. Add recovery/key-history concepts only after the replacement-device protocol and partner fingerprint semantics are reviewed.
- Keep member_presence as server-observed presence. It is not a general device-session authorization system.
- Keep snap_deliveries as the current transfer metadata source. Do not create a parallel delivery state machine; extend the existing row/state only after its state transitions are reconciled and the Drive path is ready.
- Current temporary Snap ciphertext is in oneos-private-snaps. A migration to Drive must use a controlled dual-read/transition period and explicit cleanup verification; do not simply change the object path assumption.
- Do not duplicate a user's task/habit detail into Supabase. The encrypted local AppStore remains the current record authority until a versioned Drive backup is verified.

## 4. Proposed metadata model (not migrations)

The following are logical concepts for a later reviewed schema proposal. Names are illustrative and must be reconciled with live schema/catalog before any SQL is authored.

### 4.1 Drive connection metadata

A conceptual drive connection is scoped to one owner and one provider account:
- owner user ID;
- provider account reference (opaque/non-secret);
- granted scopes and consent timestamp;
- connection state (active, reauth_required, revoked, disconnected);
- last successful validation time and last error category.

Do not store raw OAuth access or refresh tokens in an ordinary table, logs, Analytics, GitHub Actions or app configuration. Prefer the provider-supported on-device secure token flow; any server token broker requires a separate threat model and approved secret-vault/envelope design. Drive scopes must be least-privilege and shown to the user before consent. Each user must authorize their own destination independently.

### 4.2 Backup versions

A backup version represents one immutable snapshot or incremental checkpoint owned by exactly one account:
- stable version UUID and archive UUID;
- owner ID;
- monotonically increasing sequence scoped to archive;
- optional parent version;
- archive format and schema version;
- created, uploaded and integrity-verified timestamps;
- version state: preparing, uploading, verifying, healthy, partial, failed, superseded (not deleted);
- encrypted manifest Drive file ID and ciphertext digest;
- app build/schema compatibility metadata.

Version metadata must not expose plaintext task names, habit names, note text, photo captions or unencrypted detailed history. Avoid putting date-range patterns in public metadata unless privacy review accepts the leakage.

### 4.3 Backup destinations and objects

Track destination outcomes separately for each owner-authorized Drive:
- owner ID and drive-connection ID;
- destination state: pending, uploading, verifying, healthy, blocked_quota, reauth_required, retry_wait, failed;
- destination-specific object/file IDs, exact byte sizes, ciphertext digests, and last verified time;
- retry count and coarse error category, never token or plaintext response dumps.

An overall backup is **healthy** only when every destination required by the user's current policy is healthy for the same version. One successful Drive and one failed Drive means **partial**, not healthy. Retain the last healthy version and every older healthy version unless the user explicitly changes the agreed retention policy.

### 4.4 Encrypted index

The detailed record/date/chunk index should live inside an authenticated encrypted index object in the owner's Drive. Supabase may hold only the minimum opaque locator metadata needed to find the current index/version. Index contents can reveal habit patterns and personal history and therefore must not be placed in plaintext table columns.

An index entry should identify:
- stable random chunk/object ID;
- data domain;
- optional logical record IDs;
- date partition or range;
- schema version;
- ciphertext length and digest;
- immutable Drive file reference for each destination;
- owner and visibility scope.

The encrypted index is updated by creating a new immutable index version. Never edit the last known-good index in place.

### 4.5 Recovery envelope metadata

A future recovery envelope record may hold owner, envelope version, KDF/algorithm identifiers, ciphertext object reference, key-version identifiers, created/retired timestamps and verification state. It must never contain the plaintext recovery secret, plaintext data key, plaintext X25519 private key or a client boolean claiming recovery was successful. Its exact cryptographic format and server authorization are blocked on independent review.

### 4.6 Snap delivery transition

The future Drive delivery should reuse the existing snap_deliveries authorization and audited lifecycle. It may add opaque sender Drive object reference, ciphertext digest/size, recipient permanent-copy verification reference and proof/receipt metadata, but must not accept a client string as proof that a Drive object is permanently copied. The recipient's destination needs independent verification through a trusted protocol. Only after permanent-copy proof can temporary sender delivery ciphertext be deleted.

### 4.7 Snap envelope versioning and metadata authentication

**Current-state finding:** the checked-in Snap v1 encryption authenticates the encrypted photo bytes and separately wraps a random file key using X25519 + HKDF + XChaCha20-Poly1305. The current calls do not supply AEAD associated data for delivery-row metadata. Ciphertext authentication alone therefore does not cryptographically bind `space_id`, `sender_id`, `recipient_id`, `recipient_device_id`, `mime_type`, `captured_at` or declared plaintext size to the encrypted photo. Server-side row authorization remains required, but it is not a substitute for cryptographic context binding.

**Required v2 design before claiming metadata integrity:**

- Preserve an explicit `encryption_version=1` path for existing deliveries. New v2 envelopes must be stored and routed by an explicit version field; a failed v2 authentication must never fall back to v1.
- Allocate a stable random delivery UUID before encrypting. The sender may generate a UUID client-side, but the v2 creation RPC must verify its shape and uniqueness and derive the sender identity from the authenticated session rather than trust a client-supplied identity.
- Define deterministic, versioned, length-prefixed binary AAD encoding. Do not depend on incidental JSON property order or locale-sensitive timestamp formatting.
- Bind content AEAD to a v2 domain/version tag, stable delivery UUID, space UUID, authenticated sender UUID, recipient UUID, exact recipient device ID, normalized MIME type, canonical capture instant and plaintext byte length. Additional fields that change payload interpretation must either be bound or treated as advisory only.
- Bind wrapped-file-key AEAD to a separate domain/version tag, delivery/recipient/device context, recipient public-key fingerprint, ephemeral public key and wrap salt. Use distinct domain tags for content and key-wrap authentication.
- Keep decryption version-specific. For v2, recompute the exact AAD from the authenticated delivery row and recipient's own device-key context before decrypting. Any mismatch fails closed.
- Use a new versioned RPC such as `create_snap_delivery_v2` or an equally unambiguous compatible entry point. Avoid an overloaded PostgREST signature that could make old-client calls ambiguous. Keep legacy v1 creation/decryption available for existing app builds during a planned compatibility window.
- Add SQL constraints for supported versions and tests for row-field tampering, cross-delivery replay, wrong-device context, envelope tampering, duplicate IDs and historical v1 decryption.
- Do not change the v1 wire format in place. The v2 design, AAD encoding and migration path require independent cryptographic review before implementation or release.

## 5. Immutable archive format contract

This section defines a format contract for implementation planning, not an approved cryptographic construction. Algorithm details, key derivation, nonces, AAD serialization and recovery-envelope wrapping require independent cryptographic review and test vectors before implementation.

### 5.1 Archive layers

- Each backup version is immutable and identified by a random version UUID and sequence.
- Data is split into bounded logical chunks by domain and retrieval range; ordinary browsing never requires downloading a full archive.
- Each chunk is independently authenticated and encrypted on the device before upload.
- A manifest lists every chunk, its exact ciphertext digest and size, schema version, and immutable object reference.
- The manifest itself is encrypted and authenticated. A small outer header may contain only the minimum non-sensitive locator/version information needed to select and retrieve it.
- A destination is not healthy until exact uploaded bytes are read back or otherwise independently verified under an approved provider integrity contract, then authenticated/decrypted locally.
- A new version is promoted only after the manifest and all required chunks for that destination pass verification. A partial destination never overwrites the last healthy version.

### 5.2 Required manifest fields

The encrypted manifest should include:
- format identifier and manifest schema version;
- random archive ID, version ID, and sequence;
- optional parent/base version ID and incremental cursor;
- owner account binding;
- application data schema/version and exporter version;
- encryption suite identifier and key-version reference;
- list of chunk descriptors: random chunk ID, domain enum, optional date range, data schema version, exact ciphertext byte length, digest, and immutable object locator per destination;
- manifest creation timestamp;
- authenticated integrity binding over the canonical serialized manifest.

Do not treat a filename, Drive metadata, file size or unsigned JSON field as proof of authenticity. The authenticated manifest must bind every chunk descriptor; each chunk's associated data must bind owner, archive, chunk, domain and schema/version so chunks cannot be moved between users or domains unnoticed.

### 5.3 Encryption and key constraints

- Continue using a reviewed authenticated-encryption construction compatible with independently retrievable chunks. Existing XChaCha20-Poly1305 use is not itself proof that the future archive protocol is safe.
- Use unique random nonces for every encryption under a given key; define versioned key separation and rotation.
- Use a domain-separated HKDF-based hierarchy only after independent cryptographic review.
- The user's recovery secret must not be the raw data key. A versioned recovery envelope should wrap or derive access to separate data keys without exposing them to Supabase or Drive.
- Never send private keys or recovery secrets to the partner, backend, analytics or logs.
- Recovery must verify account identity, recovery proof, envelope authenticity, local inventory and at least one known key-check before reporting success.
- Do not rotate/delete old key envelopes or keys until the new version is read back and authenticated.

### 5.4 Immutability and retention

- Upload new immutable chunk and manifest objects; never overwrite a healthy version.
- Use stable idempotency IDs so retries do not create unbounded duplicate versions.
- Record a separate destination status for each user's Drive.
- The current chosen policy retains unlimited healthy versions subject to real provider quota. Do not silently prune to free space.
- Warn at 80% and 95% quota, retain pending changes locally when quota blocks upload, and show which destination is behind.
- Delete only temporary delivery objects after verified receipt; never let Snap expiry delete either partner's permanent copy.

## 6. On-demand retrieval and Smart Merge contract

1. User requests a specific photo, record, date, month or range.
2. Search local cache/index first.
3. Retrieve the smallest encrypted index or date-partition required to identify the target.
4. Fetch only referenced ciphertext chunks/files. Do not fetch the whole ZIP/archive for ordinary browsing.
5. Verify exact ciphertext digest and authenticated encryption before decrypting.
6. Confirm owner/domain/version binding from authenticated metadata.
7. Display the requested result and optionally cache it within a bounded LRU budget.
8. Offline cache pinning must be explicit; evictions never delete the only healthy backup.
9. Restore begins with a full manifest/chunk verification and preview. No local record is modified before validation succeeds.
10. Smart Merge matches stable IDs, adds missing records, preserves newer versions, respects tombstones and sends concurrent conflicts to manual review. Merge must be idempotent and have a rollback point.

## 7. Migration sequencing and no-duplicate-source rules

1. Inventory live database tables, columns, indexes, policies, grants, RPCs, Storage policies/buckets and cron/Edge Function deployment state in a disposable project.
2. Reconcile the live catalog with the checked-in migrations before writing any new migration.
3. Agree the independent recovery envelope and device-replacement protocol before enabling encrypted backups.
4. Add only metadata tables that cannot be represented safely by existing rows; do not duplicate membership, live calendar, Snap delivery or task contents.
5. Implement a new immutable version writer and per-destination verification before scheduling recurring backups.
6. Implement selective retrieval and restore preview before any automatic restore.
7. Migrate temporary Snap delivery only after permanent-copy verification and dual-device lifecycle tests pass.

No SQL or migration in this document has been executed. No Drive OAuth or archive code is implemented by this specification.
