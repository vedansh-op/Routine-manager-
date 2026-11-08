# ONE-OS Supabase security audit — 2026-11-08

## Scope and limits

Reviewed every Supabase migration, storage policy, Edge Function, cron SQL file, and Supabase function config currently present on `main`:

- `202611070001_profiles.sql`
- `202611070002_shared_spaces_invites.sql`
- `202611070003_weekly_reports.sql`
- `202611070004_shared_activity_calendar.sql`
- `202611070005_encrypted_snap_delivery.sql`
- `functions/ack-snap/index.ts`
- `functions/expire-stale-snaps/index.ts`
- `cron/schedule_snap_expiry.sql`
- `config.toml`

This is a static source review only. No live database introspection, policy simulation, SQL execution, Edge Function invocation, or penetration test was performed. Findings describe what the checked-in migrations would do if deployed as written; actual production state may differ.

## Executive summary

No obvious anonymous read path was found in the explicit RLS policies reviewed, and the Snap storage bucket is configured as private. The RPCs that mutate membership and Snap state are mostly protected by authenticated execution grants and explicit caller checks.

However, the current design is **not ready for a strict security release**. The most important problems are:

1. Account-deletion cascades conflict with the agreed requirement to preserve shared history.
2. Invitation codes have only 48 bits of effective entropy and no application-level attempt throttling.
3. Weekly-report JSON is not constrained to aggregate-only content or a bounded size.
4. Device-key registration silently replaces a device's public key without a verified rotation protocol.
5. The expiry job can act on a stale inactive-member snapshot after a member has become active again.
6. Snap acknowledgement trusts a client request; the server cannot prove the recipient has made the promised permanent copy.
7. The repository does not establish that deployed RLS, grants, bucket policies, cron, or Edge Function secrets match these files.

Severity labels are source-review priorities, not proof of an exploitable production vulnerability.

## Findings and recommended fixes

### SEC-01 — Shared data is cascade-deleted with an account
**Priority: Critical — decision conflict and data-loss risk**

Relevant foreign keys:
- `spaces.created_by -> auth.users ON DELETE CASCADE`
- `space_members.user_id -> auth.users ON DELETE CASCADE`
- `space_invitations.created_by -> auth.users ON DELETE CASCADE`
- `weekly_reports.user_id -> auth.users ON DELETE CASCADE`
- `shared_activities.created_by -> auth.users ON DELETE CASCADE`
- `snap_deliveries.sender_id/recipient_id -> auth.users ON DELETE CASCADE`

Deleting a user can cascade into their spaces, membership, reports, activities, and Snap delivery metadata. In particular, deleting the creator of a shared space can delete the space itself and cascade-delete the other partner's shared records.

**Required fix**
- Do not use account-row deletion as the mechanism for ordinary account closure.
- Introduce a delayed deletion workflow and a durable shared-data ownership/archive model.
- Transfer shared-space ownership or detach the shared archive from the deleting account before deleting identity rows.
- Keep each person's received/permanent file copies independent.
- Add explicit retention and legal-erasure rules for private data versus jointly shared data.
- Test deletion with two accounts and verify the remaining partner retains the agreed read-only shared history.

Do not simply change every foreign key to `ON DELETE SET NULL`; ownership, authorization, and retention need a deliberate schema design.

### SEC-02 — Invitation code effective entropy is 48 bits; no RPC rate limit
**Priority: High**

In `create_shared_space` and `rotate_shared_invite`, the code is generated from eight random bytes but truncated to 12 hexadecimal characters:

`upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12))`

That exposes only six random bytes (48 bits), not all eight bytes. The database hashes the code, but hashing does not add entropy. `join_shared_space` has no per-account or per-source attempt throttling in the checked-in SQL.

**Required fix**
- Use all 16 hex characters from the eight random bytes (64 bits), or preferably a longer random token with at least 96–128 bits.
- Keep only a hash of the invitation token in the database.
- Add server-enforced attempt throttling, cooldowns, and abuse monitoring for failed joins.
- Avoid revealing whether a code exists, expired, or was already used; the current generic error is good and should remain.
- Test concurrent joins, replay, expiry, and brute-force throttling.

### SEC-03 — Weekly report JSON does not enforce aggregate-only content or size
**Priority: High — privacy and resource-abuse risk**

`weekly_reports.report` only checks that the JSON value is an object. The comment says raw tasks, notes, and daily event rows must not be stored, but the database accepts arbitrary object keys and arbitrarily large JSON documents. A modified client can write personal task titles, notes, or bulky content despite the intended design.

**Required fix**
- Define an allow-listed report schema (approved aggregate counters and summary fields only).
- Validate it in a database function or strict database constraints, not only in the app.
- Set a maximum serialized payload size.
- Consider server-generated aggregates if client tampering would affect shared reporting.
- Add tests proving raw titles, notes, daily records, and oversized JSON are rejected.

### SEC-04 — Device public-key registration silently overwrites an existing key
**Priority: High — key continuity / device takeover risk**

`register_device_crypto_key` uses:

`ON CONFLICT (user_id, device_id) DO UPDATE SET public_key = excluded.public_key`

The RPC authenticates the account but does not require a signed rotation proof, recent MFA, a recovery ceremony, or a second-device approval before replacing the public key associated with an existing device ID. The partner app's fingerprint pinning may detect a changed key, but the server-side history and authorization for the change are not preserved.

**Required fix**
- Make ordinary registration insert-only for an existing device ID.
- Create a separate, audited key-rotation/recovery operation.
- Require an approved recovery flow (new-device MFA plus recovery proof, and partner verification where appropriate).
- Preserve old key fingerprints and rotation/revocation timestamps for audit.
- Never silently replace a pinned partner key.
- Add tests for stolen sessions, reused device IDs, key replacement, and revoked devices.

### SEC-05 — Expiry job can purge after a stale inactivity check
**Priority: High — unintended Snap loss**

`expire-stale-snaps` first fetches all members whose `last_seen_at` is older than 72 hours, then separately fetches and deletes their pending deliveries. If a member reconnects and `touch_my_presence` updates their timestamp after the initial query but before the purge loop reaches their deliveries, the function still uses the stale result and may delete messages for a now-active recipient.

**Required fix**
- Move eligibility and deletion into a database transaction/RPC that locks or rechecks the recipient's current presence at deletion time.
- Recheck the 72-hour cutoff immediately before deleting each delivery, not only when listing inactive members.
- Make the purge idempotent and record reason, timestamp, and counts without logging sensitive content.
- Add a concurrency test: heartbeat occurs between inactive-member selection and delivery purge; pending Snap must survive.

The one-hour cleanup of `uploading` records is also a product reliability risk for slow or interrupted uploads. Replace the fixed timeout with an explicit resumable-upload lease/heartbeat and cleanup only after a safe grace period.

### SEC-06 — Snap acknowledgement cannot prove permanent receipt
**Priority: High — data-loss / false-delivery guarantee**

`ack-snap` authenticates the recipient, reads the pending row, deletes the temporary Storage object, and deletes the metadata row. It does not receive or verify proof that the recipient has stored and verified a permanent independent copy in their own Drive or vault.

A modified client or accidental early invocation can therefore acknowledge and remove the temporary copy before the intended permanent copy is safely stored. The server currently treats an authenticated acknowledgement as proof of receipt.

**Required fix**
- Treat acknowledgement as a client assertion, not verified delivery, until a proof protocol exists.
- Add a durable state machine: pending → downloaded → permanent-copy-verified → acknowledged → temporary-object-cleaned.
- For Drive delivery, verify the recipient's Drive object reference and integrity/checksum through a trusted, scoped flow before cleanup; never give the server plaintext or private keys.
- Keep retryable state if verification or cleanup fails.
- Do not remove the only temporary copy until the permanent-copy condition is satisfied.
- Test app termination, network loss, duplicate acknowledgement, and failed Drive writes.

A device signature can prove that an authorized device approved a receipt statement; it cannot by itself prove the bytes remain recoverable in Drive. The protocol must also verify the destination object and integrity.

### SEC-07 — Live deployment state and effective grants are unverified
**Priority: High — release gate**

The repository contains migrations and a cron setup script, but source files alone do not prove which migrations, policies, grants, bucket settings, Edge Function versions, or cron jobs are active in the Supabase project. `config.toml` sets JWT verification on for `ack-snap` and off for `expire-stale-snaps`; the latter uses a custom 32-character secret check in source. The deployment of that secret and the cron/Vault configuration is not verified.

**Required fix**
- In a non-production test project, query the actual catalog for tables, RLS flags, policies, grants, function definitions, bucket settings, and cron jobs.
- Verify `expire-stale-snaps` has `verify_jwt = false` only because the custom secret is mandatory and stored in Supabase secrets/Vault; rotate it if it has ever been exposed.
- Confirm the service-role key is only in Edge Function secrets and never in the app or repository.
- Run two-account negative tests for every table and Storage object path.
- Keep a deployment manifest of migration versions and Edge Function commit/version.
- Do not treat this static audit as proof that production is safe.

### SEC-08 — Weekly report partner policy does not restrict membership to shared spaces
**Priority: Medium — possible cross-space disclosure**

The partner-read policy joins two rows in `space_members` but does not join `spaces` or require `space_type = 'shared'`. If personal spaces or other multi-member space types are introduced, membership in any common space could satisfy the policy and expose a report marked `shared_with_partner = true`.

**Required fix**
- Join `spaces` and require `space_type = 'shared'`.
- Require the intended two-member relationship, not merely any common membership.
- Prefer a narrowly defined helper that checks current, valid partner membership.
- Add tests using two accounts sharing a non-shared space; partner report access must be denied.

### SEC-09 — Shared calendar has no retention/disconnection model
**Priority: Medium — decision mismatch**

`shared_activities` can be read by current space members. The current schema cascades activities with the creator and the space. It has no durable shared-history ownership, disconnected-member read-only access, or End Connection state. This does not implement the agreed rule that both partners keep existing shared history as read-only after disconnection.

**Required fix**
- Design an immutable shared-history/archive ownership model before implementing End Connection.
- Preserve read-only access to the historical records for both participants after future sync stops.
- Revoke future writes and live sharing separately from historical read access.
- Test either partner ending the connection, account deletion, and both parties retaining their independent copies.

### SEC-10 — Shared calendar and space text fields are weakly bounded
**Priority: Medium — abuse and cost-control risk**

`shared_activities.title` is bounded to 120 characters, but `note` is unbounded. `spaces.name` and `space_invitations` metadata also have no application-specific size limits. Authenticated members can create large text payloads, increasing storage and response costs.

**Required fix**
- Add sensible database-level length limits for space names and activity notes.
- Add per-user/per-space write limits or rate limits for shared activity creation.
- Keep client-side validation for usability, but enforce limits in PostgreSQL too.

## RLS and storage policy inventory

| Object | RLS / policy observed | Static review |
|---|---|---|
| `profiles` | RLS enabled; select/insert/update restricted to `auth.uid() = id`; no delete policy | Reasonable owner isolation. Policies omit explicit `TO authenticated`, but `auth.uid()` is null for anon; add explicit role targeting for clarity and least privilege. |
| `spaces` | RLS enabled; member-only select via `is_space_member`; no client write policies | Good default-deny for client writes. Mutations must remain behind narrow RPCs. |
| `space_members` | RLS enabled; members can select membership in their own space; no client write policies | Good default-deny. Ensure no future broad write grant/policy is added. |
| `space_invitations` | RLS enabled; no client policies | Good default-deny; invite token only returned by RPC. |
| `weekly_reports` | RLS enabled; owner CRUD plus partner select when explicitly shared | Fix SEC-03 and SEC-08. |
| `shared_activities` | RLS enabled; members read/insert; creators update/delete while still members | Reasonable current membership check; does not provide agreed post-disconnection history retention (SEC-09). |
| `device_crypto_keys` | RLS enabled; user and users sharing a space can read public keys; writes revoked from anon/authenticated | No direct client writes. Registration RPC key replacement needs SEC-04 fix. |
| `member_presence` | RLS enabled; no client policies; direct client writes revoked | Default-deny. Presence updates occur through authenticated RPC. |
| `snap_deliveries` | RLS enabled; sender/recipient can select metadata; direct client writes revoked | Reasonable participant isolation at source level. A current-membership check may be needed for delivery operations after End Connection. |
| `storage.objects` / `oneos-private-snaps` | Private bucket; authenticated sender insert only for own `uploading` path; recipient select only for pending delivery addressed to one of their registered devices | Good narrow source-level policy. No client update/delete policy was added. Confirm effective Storage grants and policy behavior in a test project. |

### RLS implementation notes

- All reviewed application tables explicitly enable RLS.
- No `FORCE ROW LEVEL SECURITY` was found. Table owners and service-role access can bypass RLS by design; privileged code must remain tightly controlled.
- Several tables rely on Supabase default grants plus RLS. Verify actual grants in the deployed project; RLS does not replace SQL privileges.
- No client-side insert/update/delete policies exist for invitation/membership tables, Snap delivery metadata, or member presence in the checked-in migrations.
- The two Storage policies are limited to the private Snap bucket and exact object paths tied to a delivery row.

## SECURITY DEFINER function inventory

| Function | Purpose | Source review |
|---|---|---|
| `handle_new_user()` | Auth user insert trigger creates profile | Trigger-only; fixed empty search path and qualified table. No caller-supplied user ID. Keep trigger-only. |
| `set_updated_at()` | Timestamp trigger | Not SECURITY DEFINER; simple trigger assignment. |
| `is_space_member(uuid)` | Membership predicate used by RLS/RPCs | SECURITY DEFINER, stable, empty search path, qualified table, PUBLIC execute revoked and authenticated execute granted. Returns only boolean. Keep narrow. |
| `create_shared_space(text)` | Creates a two-person shared space and invite | Auth check, per-user advisory lock, no direct client table writes. Fix invite entropy/rate limiting. Add input length bounds. |
| `join_shared_space(text)` | Consumes one-time invite | Auth check, per-user advisory lock, row lock on invite, expiry/use checks, max two members. Fix rate limiting and test races. |
| `rotate_shared_invite()` | Rotates owner invite | Auth check, owner check, row lock, invalidates older unused invites. Fix entropy/rate limiting; test join-vs-rotate races. |
| `seed_member_presence()` | Seeds presence after membership insert | Trigger-only, fixed empty search path, qualified table. Keep trigger-only. |
| `touch_my_presence()` | Updates caller's presence and device-key last-seen | Auth check and caller-scoped update. No user-supplied target ID. |
| `register_device_crypto_key(text,text)` | Registers device public key | Auth check and strict hex format validation; unsafe silent key replacement noted in SEC-04. |
| `create_snap_delivery(...)` | Creates pending-upload metadata and envelope | Auth check, sender membership, exactly two members, recipient device-key existence, envelope format, MIME and 20 MB limit. Good basic checks; add rate/volume limits and verify exact shared-space type. |
| `finalize_snap_upload(uuid)` | Changes own upload to pending after Storage object exists | Auth check, sender ownership, row lock, verifies object exists in private bucket. Ensure object upload completion/integrity is checked, not just object presence. |

All reviewed SECURITY DEFINER RPCs in migration 0005 and membership RPCs in migration 0002 revoke execute from PUBLIC and grant execute to authenticated. The trigger functions are intended to be invoked by database triggers, not exposed as client RPCs. Before release, verify effective function grants from PostgreSQL catalogs, including default privileges and any grants made outside these migrations.

## Required verification test matrix (non-production only)

1. Anonymous client cannot read any profile, report, space, membership, invitation, calendar, device key, presence row, or Snap metadata.
2. User A cannot read or mutate User B's private profile/report/device metadata.
3. User A cannot read a Snap object for User B or another recipient; a recipient can read only the exact pending object addressed to their registered device.
4. User cannot insert/update/delete membership, invitation, presence, or Snap metadata directly through PostgREST.
5. A shared-report opt-in grants access only to the one intended partner in a shared space; unrelated or personal-space co-members are denied.
6. Concurrent invitation joins never create a third member; replay and expired codes fail; throttling blocks repeated guesses.
7. Existing device IDs cannot silently replace public keys; revoked devices cannot receive new deliveries.
8. A heartbeat racing with the 72-hour expiry job prevents deletion of pending deliveries.
9. A Snap cannot be acknowledged until the recipient's independent permanent copy is verified; retries remain safe after app termination.
10. Account deletion and End Connection preserve both partners' independent copies and read-only shared history as previously decided.

## Recommended order before implementation

1. Resolve SEC-01 and SEC-09 data ownership/retention architecture before writing account-deletion or End Connection migrations.
2. Fix invitation entropy and add abuse throttling.
3. Define the device key recovery/rotation hierarchy and make registration insert-only.
4. Define the Snap receipt and expiry state machines; remove stale-snapshot deletion races.
5. Enforce aggregate-only weekly report schema and bounded text fields.
6. Build a non-production Supabase project from migrations, inspect effective grants/policies, and run the two-account negative test matrix.
7. Only after those reviews, create reviewed migration changes and deployment instructions.

## Explicitly not performed

- No Supabase SQL was executed.
- No Supabase production database, Storage bucket, Auth setting, Vault secret, cron job, or Edge Function was changed.
- No Edge Function was deployed or invoked.
- No user data or production secrets were accessed.
- No claim is made that the live Supabase project currently has exactly these policies or function definitions.



## Supplemental finding — Snap metadata authentication

### SEC-21 — Snap AEAD does not bind delivery-row metadata as associated data

**Priority: Medium — cryptographic context integrity / replay confusion**

The current `src/lib/snapCrypto.ts` authenticates Snap ciphertext and its wrapped random file key with XChaCha20-Poly1305, but the v1 AEAD calls do not supply associated data. Delivery fields such as `space_id`, `sender_id`, `recipient_id`, `recipient_device_id`, `mime_type`, `captured_at` and declared plaintext size are stored separately and are not cryptographically bound to the payload. Database authorization and RLS checks are still required, but they do not provide ciphertext-level binding between those fields and the encrypted bytes.

This is not a reason to change v1 in place: old deliveries and older app builds must remain readable, and changing AAD silently would make existing records undecryptable.

**Required fix**
- Define an explicit v2 envelope and SQL version column. Preserve a v1 decrypt-only compatibility path for existing rows.
- Allocate a stable delivery UUID before encryption and use a new unambiguous v2 creation RPC that derives the sender from the authenticated session and validates ID uniqueness.
- Define a canonical versioned length-prefixed AAD encoding. Bind the v2 content AEAD to delivery ID, space, sender, recipient, recipient device, normalized MIME type, capture instant and plaintext byte length.
- Bind wrapped-file-key AEAD with a separate domain tag and delivery/recipient/device context plus recipient-key fingerprint and ephemeral key context.
- Route decryption strictly by version. A failed v2 authentication must never fall back to v1.
- Test metadata tampering, cross-delivery replay, wrong-device context, duplicate delivery IDs, and historical v1 decryption.
- Obtain independent cryptographic review of the AAD encoding, key separation and migration/compatibility protocol before implementation.

**Status: OPEN — design requirement documented in `docs/ONE_OS_PHASE_1_SCHEMA_AND_ARCHIVE_SPEC.md`; not implemented in source or database.**
