# ONE-OS security remediation status — 8 November 2026

This document accompanies `202611080001_security_remediation.sql`.

## What changed in source

| Audit finding | Source change | Status |
|---|---|---|
| SEC-01 shared data deleted with account | No schema change yet. Requires durable archive/ownership model before changing foreign keys. | **Open — critical release blocker** |
| SEC-02 invite entropy and guessing | New/rotated invitation codes use 12 random bytes (96 bits); join RPC validates 24 hex chars and enforces 10 attempts per account per 15-minute window. | **Partially fixed** — account-level throttling only; add edge/IP/device abuse controls and concurrency tests. |
| SEC-03 unconstrained weekly report | Added 16 KiB serialized JSON limit. | **Partially fixed** — strict allow-list and canonical aggregate schema still required; size cap alone does not prevent private-field leakage. |
| SEC-04 silent device-key replacement | Registration is insert-only for a device ID; same key is idempotent; different key is rejected. | **Partially fixed** — verified rotation/recovery ceremony and key history still required. |
| SEC-05 stale expiry snapshot | No runtime change yet. | **Open — release blocker for Snap expiry** |
| SEC-06 acknowledgement deletes before durable copy proof | No runtime change yet. | **Open — release blocker for Snap receipt** |
| SEC-07 deployed configuration unverified | No live project inspection or deployment performed. | **Open — mandatory non-production verification** |
| SEC-08 report access via any common space | Partner report policy now requires a two-member space with `space_type='shared'`. | **Source fix added; test required** |
| SEC-09 shared calendar retention after disconnect | No schema change yet. | **Open — critical release blocker** |
| SEC-10 unbounded text | Added database limits: space name 1–80 characters; activity note <=1,000 characters. | **Source fix added; test required** |

## Important safety boundary

No production Supabase SQL was run. No migration was applied to the configured Supabase project. No Edge Function was deployed, no Storage object was touched, and no secrets were read or changed.

The migration is additive and intended for a disposable/non-production project first. It has not yet been executed against PostgreSQL, so it must not be described as tested or production-ready. Review migration ordering and run the full two-account regression suite before applying it anywhere important.

## Remaining implementation work

### SEC-01 + SEC-09 — durable shared archive

Implement a durable shared archive independent of either Auth user row. It must retain both participants' authorized read-only history after End Connection and after either account's deletion, while private records remain individually erasable. Add an explicit archive participant/ownership table and retention lifecycle. Do not simply replace cascades with `SET NULL`; define who can read, export, erase, and retain each record first. Account deletion must be a delayed workflow with a seven-day grace period and a verified archive-preservation step.

### SEC-05 — atomic expiry eligibility

Replace the Edge Function's stale list-then-delete algorithm with a transactional database claim/expiry RPC that rechecks and locks current presence and delivery state at the moment of claiming. Use an explicit upload lease/heartbeat rather than deleting all uploads older than one hour. Storage deletion must be retryable and idempotent; do not remove metadata before recording enough state to retry object cleanup.

### SEC-06 — verified Snap receipt

Implement a durable state machine with distinct downloaded, permanent-copy-verified, acknowledged, and temporary-cleaned states. The recipient must supply a scoped Drive object reference and integrity proof; a client acknowledgement or device signature alone is not proof that bytes remain recoverable. Keep the temporary ciphertext until the permanent destination object and checksum have been verified. Failure and duplicate requests must be retry-safe.

### SEC-07 — non-production verification

Create a separate Supabase test project. Apply migrations there, inspect effective grants/RLS policies/Storage policies/function grants/cron/secrets, and run negative tests with two accounts and multiple devices. Confirm the Edge Function's custom cron secret is configured only in Supabase secrets/Vault. Do not use the production project for this verification.

## Required tests for the new migration

1. New invite is 24 hex characters and its stored value is only a SHA-256 hash.
2. Eleven join attempts in one 15-minute window are throttled; the window resets after expiry.
3. A 24-character invite is accepted once; replay and malformed/expired values fail generically.
4. Existing device ID + same key is idempotent; same device ID + different key is rejected.
5. Weekly report payloads over 16 KiB are rejected.
6. Shared report opt-in is visible only to the other member of the intended two-member shared space; personal-space and unrelated users are denied.
7. Space names over 80 characters and activity notes over 1,000 characters are rejected.
8. Existing valid data passes the new constraints before the migration is considered deployable.

## Release decision

ONE-OS remains **not ready for production release** until SEC-01, SEC-05, SEC-06, SEC-07, and SEC-09 are implemented and verified, and the partial fixes above have passed the test suite. The strict security audit decision remains in force.
