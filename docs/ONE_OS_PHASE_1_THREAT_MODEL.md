# ONE-OS Phase 1 threat model

**Status:** Engineering threat-model baseline for review. This is not an independent penetration test or cryptographic audit.
**Scope:** Android app, Supabase authentication/authorization, personal encrypted local data, shared-space records, Snap delivery, and the proposed two-independent-Google-Drive backup system.

## 1. Security objectives

1. A user's private tasks, habits, notes, photos, files and history remain private from the partner and other accounts unless the user explicitly shares a specific item.
2. Supabase stores identity, authorization and minimum coordination metadata. It must not receive private plaintext, local data-encryption keys, X25519 private keys, recovery secrets or Drive refresh tokens.
3. Each partner controls and authorizes their own Drive destination. Shared-space membership does not grant access to the other person's private Drive or backup.
4. Only active, verified, correctly authenticated members and devices may perform their authorized operations.
5. A lost, revoked, disconnected, corrupted or offline device must not cause silent data deletion, key replacement, false delivery success or false backup health.
6. Shared history promised to survive disconnection/account deletion must be stored independently of live membership rows and have a narrow read-only authorization path.
7. Security-sensitive operations fail closed when identity, authorization, integrity or recovery state is ambiguous.

## 2. Assets and protection requirements

| Asset | Primary location today | Required protection |
|---|---|---|
| Supabase access/refresh session | Supabase Auth + device secure storage adapter | Device-local protection, verified email, AAL2 for sensitive actions, session revocation design |
| Personal task/habit/routine data | Encrypted local AppStore record | Confidentiality, authenticated integrity, account separation, no key replacement on missing-key state |
| Local data-encryption key | Android SecureStore | Device-bound protection; separately reviewed recovery envelope before backup/restore |
| X25519 device private key | Android SecureStore | Device-bound protection, write-once registration, revocation and separately designed historical-key recovery |
| Partner public key/fingerprint | Supabase public key row + locally pinned fingerprint | Active shared membership visibility, explicit out-of-band fingerprint verification, key-change review |
| Shared calendar activities | Supabase while active; detached archive snapshots | Active two-person membership for writes, scoped reads, read-only retention after disconnection |
| Snap ciphertext and envelope | Current private Supabase Storage bucket and metadata | Exact sender/recipient/device authorization, encryption before upload, replay/expiry controls, no premature deletion |
| Future backup chunks/manifests | Each owner's Google Drive | Client-side authenticated encryption, immutable versions, independent destination health and integrity verification |
| Future Drive OAuth credentials | Not implemented | Least privilege, protected on-device or approved secret vault; never ordinary plaintext table values |
| Recovery secret/envelope | Not implemented | High entropy, shown once, never stored plaintext by app server or Drive; reviewed key wrapping |
| Invitation tokens | Supabase invitation RPC/table | High entropy, hashed at rest, expiry, atomic single-use, rate limits and generic errors |

## 3. Trust boundaries and actors

- **Android app process:** trusted only while the device and OS are not compromised. App code can still contain bugs; encrypted-at-rest data does not protect plaintext while the app is unlocked.
- **Android OS / SecureStore / filesystem:** platform boundary. Backup/restore behavior, device-lock behavior, accessibility and reboot semantics require physical-device verification.
- **Supabase Auth:** identity and authentication authority. The application must not fabricate AAL2 or trust client-only flags.
- **Supabase database and Storage:** authorization boundary. RLS is one layer; table grants, Storage policies, SECURITY DEFINER routines, triggers, service-role functions and deployed configuration all matter.
- **Supabase Edge Functions and scheduled jobs:** privileged server boundary. Service-role access must be narrow, authenticated, logged without secrets, idempotent and retry-safe.
- **Google Drive:** external storage provider under each user's independent account and OAuth consent. Drive account loss, token revocation, quota, API failure and provider-side deletion are expected failure modes.
- **Partner account/device:** authenticated but not automatically trusted with private user data. A valid shared-space membership grants only explicitly shared capabilities.
- **GitHub / CI:** source and build supply chain. A green check proves only the commands that ran against that commit; it does not prove backend deployment or device behavior.
- **Network / push provider:** untrusted transport. All remote operations require authenticated authorization and minimal payloads.

## 4. Threat scenarios and controls

| Threat | Impact | Required control / current status |
|---|---|---|
| Account takeover using stolen password/session | Read/write private and shared account data | Verified-email/AAL2 app gate and database write guards exist in source. Test login/session refresh and every server write in a disposable project. Device-specific session revocation remains unimplemented. |
| MFA authenticator lost | User cannot regain account access | Current JS MFA path supports a separately stored backup TOTP factor; a custom client-only recovery code must not impersonate AAL2. Backup-factor UX exists in source; test provider behavior in a disposable project. |
| Phone lost, stolen or replaced | Local data and historical Snaps may become unrecoverable; stolen session may remain active | Device-key revocation source exists but does not revoke that phone's Supabase session or erase local files. Encryption-key recovery and per-install session revocation remain open. |
| Partner disconnects / account deleted | Shared records may disappear or remain writable unexpectedly | Detached shared calendar archive, typed End Connection and AAL2 source guard exist. Only calendar activities are mirrored; broader shared content retention and two-account deletion tests remain open. |
| Malicious or compromised partner | Attempts to read private tasks, keys, files or other users' data | Shared-space membership is not a blanket data grant. RLS, active two-person checks, key discovery scope and separate Drive ownership; verify all policies with negative tests. |
| Invitation guessing | Unauthorized shared-space join | 96-bit invite tokens, hash-at-rest and per-account throttle exist in source. IP/device abuse monitoring and concurrency validation remain open. |
| Replay / duplicate RPC or event | Duplicate invite, Snap acknowledgement, backup version or push | Stable IDs, row locks, transactional claims, idempotent acknowledgement/retry and unique constraints. Test duplicate and concurrent calls. |
| Tampering with ciphertext, manifest or index | Silent corruption or malicious restore | AEAD authentication, exact-byte digest, AAD bound to owner/archive/chunk/domain/version; reject before decrypt/restore. Recovery/archive format still requires independent cryptographic review and test vectors. |
| Partial upload / app killed / offline | Incomplete object incorrectly marked healthy or temporary data deleted | Upload lease, durable state, retry and partial-success state; never mark healthy before read-back/authentication. Long-upload lease renewal and Drive flow are not implemented. |
| Drive OAuth token revoked / Drive account unavailable | Backup falls behind or cannot restore | Preserve local data and last healthy version; show destination-specific degraded status; do not delete healthy versions. Drive flow not implemented. |
| Drive quota exhausted | Future backup incomplete | Warn at agreed 80%/95%; no silent pruning; queue locally and report partial status. Not implemented. |
| Shared push reaches ended/revoked partner | Private/shared activity metadata leak | Server re-checks active membership and device status at send time; only opaque IDs/minimal text; deduplicate and audit. Push pipeline not implemented. |
| Notification payload contains private data | Lock-screen disclosure | Personal reminders remain local; shared pushes exclude private task/habit content. Android lock-screen privacy and channel controls must be verified. |
| Android delays or drops a notification | Missed task/habit alert | Best-effort semantics, reconciliation on foreground, visible reminder history/state, no exact-time guarantee. Physical OEM/battery/reboot tests remain open. |
| Rooted/compromised device or malicious accessibility service | Plaintext or keys captured while unlocked | Explicit residual risk; at-rest encryption cannot defend a compromised runtime. Minimize plaintext/key lifetime, redact logs, and state the limitation to users. |
| Secrets leaked in code/logs/CI | Server compromise | No service-role key in client; server secrets only; scan repository/workflow logs before release; rotate exposed secrets. No secrets were changed or accessed in this review. |

## 5. Authorization invariants

1. The authenticated account identity is the authority for client data access; clients never supply another user's owner ID as authority.
2. Personal records remain owner-only. Shared-space membership cannot grant access to personal AppStore data, private Drive content or local vault keys.
3. A Snap sender and recipient must be distinct members of one active shared space of type shared with exactly two members, and the recipient device key must be active.
4. Partner public keys are discoverable only for an active two-person shared space; ended spaces and personal spaces must not reveal partner keys.
5. End Connection is terminal for shared writes and invitations. Previously archived calendar history is read-only.
6. Device-key revocation is not equivalent to session revocation, local erasure or encryption-key recovery. UI and docs must say exactly what it does.
7. A service-role operation needs a distinct server-side authorization condition and must not rely on client-provided claims about successful copy/recovery.
8. Every permissive RLS policy is OR-combined with other permissive policies. Review all effective policies and SQL grants together, not just policies introduced by ONE-OS.
9. AAL2 triggers protect only the tables to which they are attached. Inventory all user-writable tables, RPCs, Storage paths and Edge Functions.
10. No recovery or restore flow may create a replacement data key when ciphertext exists and the original key is missing.

## 6. Data minimization and privacy rules

- Private task/habit titles, notes, completion details, photos and file contents remain encrypted on device and in the owner's Drive.
- Supabase weekly reports contain only the currently whitelisted aggregate counters.
- Push payloads must not contain private task/habit content, plaintext Snaps, encryption keys, recovery secrets or Drive tokens.
- Keep dates, domains and history indexes encrypted where their visibility could reveal sensitive habits or routines.
- Do not put tokens, email confirmation links, TOTP secrets, recovery material, private key bytes, or decrypted file content in logs or analytics.
- Display lock-screen content only to the extent selected by the user and Android channel settings.

## 7. Residual risks and release gates

Known open blockers:
- No independent cryptographic review of the key hierarchy/recovery-envelope design.
- No encryption-key recovery envelope or historical-key recovery implementation.
- No recovery-code mechanism that can legitimately establish Supabase AAL2; backup TOTP is the supported source-level fallback.
- Device-key revocation does not revoke the lost phone's auth session.
- Seven-day account-deletion workflow is not implemented.
- Google Drive OAuth, immutable backup archives, two-Drive verification, selective retrieval and Smart Merge are not implemented.
- Snap temporary delivery still uses Supabase Storage; permanent Drive-copy proof is not implemented.
- No disposable Supabase project has run migrations and full RLS/Storage/grants/two-account tests.
- No current physical Android test evidence for session storage, MFA, key inspection, notifications, Snap flows, reboot, timezone or OEM battery behavior.
- Notification push/location/travel integrations are not implemented.

## 8. Required review

Before any production deployment, an independent reviewer must assess the cryptographic/key-recovery design, and the team must run the test plan in ONE_OS_PHASE_1_FAILURE_MATRIX.md against a disposable Supabase project and physical Android devices. Source-code review and CI are necessary but insufficient.
