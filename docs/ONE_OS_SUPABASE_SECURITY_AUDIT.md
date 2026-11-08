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


## Final source-level database object inventory — migrations 001–013

**Review date:** 9 November 2026  
**Scope:** Static inventory of the 18 checked-in migration files on the Phase 1 branch. Later migrations replace several earlier policy definitions; the tables below describe the expected final source state after applying all migrations in timestamp order. This is not a live Supabase catalog query, PostgreSQL compilation result, or effective-grant proof.

### RLS policies expected after all checked-in migrations

| Object | Final source policy name | Operation / intended access | Static review note |
|---|---|---|---|
| `public.profiles` | Users can read their own profile | SELECT own row | Owner-scoped by `auth.uid() = id`. |
| `public.profiles` | Users can insert their own profile | INSERT own row | Owner-scoped check. |
| `public.profiles` | Users can update their own profile | UPDATE own row | Owner-scoped using/check. |
| `public.spaces` | Members can view their spaces | SELECT member rows | Uses `is_space_member`; client writes remain RPC-only. |
| `public.space_members` | Members can view space membership | SELECT own-space membership | Uses `is_space_member`; no client write policy. |
| `public.weekly_reports` | Users can read their own weekly reports | SELECT own report | Owner-scoped. |
| `public.weekly_reports` | Partners can read explicitly shared weekly reports | SELECT opted-in report of active two-person shared-space partner | Migration 001 policy is replaced by migration 001 security remediation; final policy joins `spaces`, requires `space_type='shared'` and exactly two members. |
| `public.weekly_reports` | Users can create their own weekly reports | INSERT own report | Owner-scoped; database trigger enforces aggregate-only schema and AAL2 on authenticated writes. |
| `public.weekly_reports` | Users can update their own weekly reports | UPDATE own report | Owner-scoped; aggregate validation and AAL2 trigger also apply. |
| `public.weekly_reports` | Users can delete their own weekly reports | DELETE own report | Owner-scoped; AAL2 trigger applies. |
| `public.shared_activities` | Members can read activities in shared spaces | SELECT rows in actual shared spaces | Replaces the broader original read policy; ended shared history remains readable under the selected policy. |
| `public.shared_activities` | Members can add shared activities | INSERT while member and archive is not ended | Creator must be `auth.uid()`; membership and active archive required; daily limit and AAL2 triggers also apply. |
| `public.shared_activities` | Creators can edit their shared activities | UPDATE own row while shared space remains active | Creator/member/active archive checks plus immutable identity/space trigger; AAL2 trigger applies. |
| `public.shared_activities` | Creators can delete their shared activities | DELETE own row while shared space remains active | Creator/member/active archive checks; archive trigger preserves deletion history; AAL2 trigger applies. |
| `public.device_crypto_keys` | Users can read own and active two-person shared device public keys | SELECT own keys and active partner public keys | Replaces original broad co-member policy; excludes revoked partner keys, personal/ended/non-two-member spaces. Direct client writes are revoked; narrow registration/revocation RPCs are used. |
| `public.snap_deliveries` | Participants can read snap delivery metadata | SELECT as sender or recipient | Direct client writes are revoked; RLS/storage access must be considered with active membership, device revocation and status checks. |
| `public.shared_archives` | Archive participants can read their shared archive | SELECT archive participant's row | Detached from live membership; RLS participant predicate. |
| `public.shared_archive_participants` | Archive participants can read archive membership | SELECT authorized archive membership | Participant-scoped; intended to preserve read-only history. |
| `public.shared_archive_activities` | Archive participants can read shared history | SELECT authorized archived activity | Participant-scoped, no client write policies. |
| `storage.objects` / private bucket `oneos-private-snaps` | ONE-OS sender can upload encrypted snap | INSERT own delivery object while status is uploading | Exact object path and sender binding; bucket is intended private. |
| `storage.objects` / private bucket `oneos-private-snaps` | ONE-OS recipient can download pending or downloaded encrypted snap | SELECT exact retained delivery addressed to caller's active device | Replaces the original pending-only policy; checks recipient identity, matching non-revoked device and pending/downloaded status. |

**Count:** 21 final policies across the application and Storage objects. This count is limited to explicit policies in the checked-in migrations. It does not include policies or grants configured manually in a hosted project or inherited platform defaults.

### Default-deny / server-only objects

The checked-in source expects these objects not to expose general client policies or direct writes:
- `public.space_invitations`: invitation lifecycle only through narrow invitation RPCs.
- `public.member_presence`: no client-facing row policy; presence updates through `touch_my_presence()`.
- `public.invitation_attempt_limits`: abuse-throttle metadata revoked from `anon` and `authenticated`.
- `public.shared_activity_daily_limits`: write-limit state revoked from `anon` and `authenticated`.
- `public.shared_archives`, `public.shared_archive_participants`, and `public.shared_archive_activities`: broad table privileges are revoked then only SELECT is granted to authenticated users with participant RLS.
- `public.device_crypto_keys` and `public.snap_deliveries`: direct client INSERT/UPDATE/DELETE are revoked; function-based operations are used.
- `storage.objects`: no broad public bucket read is intended; only the two named private-bucket policies are added by this product's migrations.

### SECURITY DEFINER inventory

The final source contains 23 SECURITY DEFINER functions. Every declaration is reviewed in source with `SET search_path = ''`; this reduces search-path hijacking risk but is not a substitute for checking function owner, all schema references, effective EXECUTE grants, trigger call paths and deployed definitions in PostgreSQL.

| Function | Intended caller / role | Static review responsibility |
|---|---|---|
| `public.handle_new_user()` | Auth-user insert trigger only | Creates the caller's profile from Auth metadata; trigger-only, client EXECUTE revoked by migration 005. |
| `public.is_space_member(uuid)` | Authenticated RLS/RPC predicate | Returns only a membership boolean; narrow SECURITY DEFINER predicate. |
| `public.create_shared_space(text)` | Authenticated RPC | Creates shared space and invitation under user identity and membership constraints. |
| `public.join_shared_space(text)` | Authenticated RPC | Consumes invitation under row locks, limits membership and rate-checks the caller. |
| `public.rotate_shared_invite()` | Authenticated owner RPC | Invalidates/replaces invitation for the caller's own shared space. |
| `public.seed_member_presence()` | Membership insert trigger only | Seeds presence; client EXECUTE revoked by migration 005. |
| `public.touch_my_presence()` | Authenticated RPC | Updates only caller's presence/device heartbeat. |
| `public.register_device_crypto_key(text,text)` | Authenticated RPC | Registers caller's device public key; must remain insert-only for a device ID. |
| `public.create_snap_delivery(...)` | Authenticated RPC | Creates pending upload metadata; requires sender/recipient/membership/device validations. |
| `public.finalize_snap_upload(uuid)` | Authenticated RPC | Finalizes caller's upload after checking object existence/path ownership. |
| `public.is_shared_archive_participant(uuid)` | Authenticated RLS predicate | Returns only whether the caller belongs to a detached archive. |
| `public.create_shared_archive_for_space()` | Shared-space insert trigger only | Creates detached archive metadata; client EXECUTE revoked by migration 005. |
| `public.mirror_shared_activity_to_archive()` | Shared-activity change trigger only | Mirrors insert/update/delete into durable calendar history; client EXECUTE revoked. |
| `public.mirror_shared_member_to_archive()` | Membership change trigger only | Maintains detached participant links; client EXECUTE revoked. |
| `public.end_shared_connection(uuid,text)` | Authenticated AAL2 RPC | Ends only caller's shared connection after exact confirmation; stops future shared writes. |
| `public.reject_writes_to_ended_shared_space()` | Invitation/Snap insert triggers only | Rejects new writes after archive termination; client EXECUTE revoked. |
| `public.renew_snap_upload_lease(uuid)` | Authenticated sender RPC | Renews only caller-owned active upload lease. |
| `public.claim_expired_snap_deliveries(timestamptz,integer)` | `service_role` cleanup job only | Transactionally claims expired deliveries; EXECUTE revoked from public/anon/authenticated and granted to service_role. |
| `public.finish_snap_expiry(uuid,boolean)` | `service_role` cleanup job only | Finalizes retryable expiry/Storage cleanup; EXECUTE restricted to service_role. |
| `public.enforce_shared_activity_daily_limit()` | Shared-activity insert trigger only | Applies per-user daily write cap; client EXECUTE revoked by migration 005. |
| `public.require_aal2_for_sensitive_write()` | Sensitive-table triggers only | Enforces AAL2 for authenticated writes across the listed shared, key, Snap, calendar and report tables; client EXECUTE revoked. |
| `public.revoke_device_crypto_key(text)` | Authenticated owner AAL2 RPC | Revokes only caller-owned device key; does not revoke that device's Auth session. |
| `public.require_active_recipient_device_for_snap()` | Snap insert trigger only | Rejects delivery to missing or revoked recipient device; client EXECUTE revoked. |

### Additional trigger functions that are not SECURITY DEFINER

The following source functions are ordinary invoker-security trigger functions, not included in the 23 SECURITY DEFINER count: `set_updated_at()`, `prevent_shared_activity_scope_change()`, `require_active_shared_space_for_snap()`, and `enforce_shared_space_membership_limit()`. They still need their trigger context, caller privileges, table RLS and behavior tested; the function type alone is not a security pass.

### Important grant caveat

The migrations explicitly revoke/grant several function privileges, including authenticated RPCs, trigger-only functions and service-role cleanup functions. That text describes intended source grants only. Existing default privileges, object ownership, manually added grants, extension/schema access and migrations deployed outside this repository can change the effective permission set. The read-only catalog script must be run against the disposable project and compared with this inventory. There is no verified hosted-project catalog snapshot for this review.
