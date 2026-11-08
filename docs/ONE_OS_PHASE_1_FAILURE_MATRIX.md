# ONE-OS Phase 1 failure-state and retry matrix

**Status:** Required behavior contract and test plan. Rows marked "planned" describe required behavior; they are not proof that the behavior is implemented or tested.
**Execution rule:** Database, Storage, Auth, Edge Function and two-account tests must run only in a disposable non-production Supabase project. Physical Android behavior must be checked on real devices.

## 1. Local data and key safety

| Failure / trigger | Required behavior | Retry / recovery rule | Evidence status |
|---|---|---|---|
| Fresh install, no local records and positively visible empty vault | Create one fresh data key through the explicit first-install path; verify write-back | Concurrent startup calls share one initialization | Source + automated unit tests; Android test pending |
| Ciphertext exists but data key is missing | Stop encrypted store startup; preserve ciphertext; show recovery-required state | Retry only after a reviewed recovery ceremony restores the original key | Source + automated unit tests; full recovery protocol not implemented |
| Data key malformed or incorrect length | Fail closed; do not replace key | Manual support/recovery process; never auto-generate over existing data | Source + automated unit tests |
| Ciphertext authentication fails | Do not return plaintext or rewrite ciphertext | Keep original bytes; allow explicit restore from a verified backup after review | Source-level crypto behavior; corruption matrix still needs broader tests |
| Device-key alias pair is partial/malformed or does not match server public key | Do not register a new key or silently rotate | Keep existing values; require explicit recovery/verification | Read-only inspector source; physical tests pending |
| Storage inventory is inaccessible/unknown | Do not classify it as fresh | Retry inspection when platform storage is available; preserve all data | Source + classifier tests |
| App process stops during secure-key migration | Old pointer/active key remains authoritative; incomplete candidates are ignored | Idempotently retry verification and pointer switch | Design requirement; not all envelope/migration tests exist |
| User signs out or changes account mid-load | Stop stale async writes; clear previous account data from UI | New account loads only its own key namespace | Source guard; account-switch device test pending |

## 2. Authentication and device security

| Failure / trigger | Required behavior | Retry / recovery rule | Evidence status |
|---|---|---|---|
| Email not verified | Keep user out of protected app features | Resend confirmation and refresh session | Client source; provider setting and non-production test pending |
| Authenticated session is AAL1 | Do not enter protected screens or perform guarded sensitive writes | Complete provider-issued MFA challenge to obtain AAL2 | Client and migration source; SQL/provider behavior untested |
| Invalid/expired TOTP | Deny access; never infer AAL2 from UI state | Restart challenge against Supabase Auth | Source; test project needed |
| Backup TOTP enrollment interrupted | Do not silently register another factor or remove the last factor | Re-fetch provider factor list and resume/clean up deliberately | Source guardrails; provider-specific behavior untested |
| User loses all TOTP factors | Do not accept a client-only recovery code as AAL2 | Use a provider-supported recovery/administrative path after reviewed design | Open design/release blocker |
| Device key revoked | Deny future partner key discovery and new Snap delivery to that device | New device uses separate recovery/registration ceremony | Source migration/function/UI; database test pending |
| Lost device still has Supabase session | Explain that key revocation does not sign it out | Separate per-install session revocation design required | Known open gap |
| Account requests deletion | No immediate client-side Auth deletion | Future server-enforced 7-day grace, owner-only cancellation and verified final deletion | Not implemented |
| Supabase/network is unavailable during auth assurance check | Keep protected app locked or safely retain local read-only state; do not assume AAL2 | Retry provider check; no client flag bypass | Source behavior; offline/session tests pending |

## 3. Supabase authorization and schema

| Failure / trigger | Required behavior | Retry / recovery rule | Evidence status |
|---|---|---|---|
| Migration fails part-way or SQL compilation fails | Do not proceed to later migrations or production | Fix on disposable project, reset/reapply in order and inspect actual schema | No PostgreSQL execution evidence yet |
| A table is missing RLS, has unsafe grants, or a broad permissive policy | Treat as a security blocker | Inventory every policy/grant; correct in a new reviewed migration and repeat negative tests | Read-only audit scripts exist; live catalog not inspected |
| AAL2 trigger missing/disabled on a sensitive table | Reject Phase 1 server-side signoff | Compare every intended table and direct/RPC write path to audit output | Inventory query exists; not run against test project |
| SECURITY DEFINER routine has unsafe search_path or execute grant | Do not expose it to client roles | Review owner, body, search_path and effective role grants | Static review only; test catalog pending |
| Invite guesses exceed throttle | Return generic error and deny acceptance | Retry only after throttle window; never reveal existence/expiry/use status | Source remediation; test IP/device/concurrency missing |
| Two users race to join the same final membership slot | At most one transaction succeeds; no third member | Loser receives generic safe failure and may request a new invite | Locking source exists; concurrent DB test pending |
| User tries to read personal-space shared activity as partner | Deny | No retry unless membership/type authorization changes legitimately | Policy source; negative RLS test pending |
| User tries Snap create/send in ended, personal or overfull space | Deny before delivery row or object access | Rejoin requires a new valid shared-space lifecycle | Trigger source; non-production test pending |
| A user tries direct membership/invite/Snap/presence writes | Deny direct PostgREST path; require narrow RPC | Retry through approved RPC after authorization | Source grants/policies; effective grants pending |

## 4. Snap delivery lifecycle

| Failure / trigger | Required behavior | Retry / recovery rule | Evidence status |
|---|---|---|---|
| Ciphertext upload interrupted or object only partially written | Do not mark delivery pending/complete | Resume/retry upload under valid lease; verify finalized object | Source flow + lease RPC; long-upload renewal is not wired in app |
| Upload lease expires | Claimed upload becomes eligible for controlled cleanup; no permanent copy is deleted | Start a new delivery after checking whether sender's local copy exists | Source lifecycle functions; SQL concurrency tests pending |
| Recipient is offline when expiry job evaluates delivery | Fresh server-locked presence determines eligibility; do not use stale selection | Retry cleanup job; never purge downloaded state | Source transaction; live race test pending |
| Recipient downloads but permanent copy is not verified | Keep temporary ciphertext and delivery metadata | Allow same authorized device to re-download retained ciphertext | Source changes; no Drive proof yet |
| Recipient acknowledges before durable copy | Server records only downloaded, not permanent-copy-verified | Do not delete temporary ciphertext until proof path exists | Source fix; two-device test pending |
| Ack response is lost after server commits | Retry is idempotent; do not treat a missing row as proof unless server contract confirms terminal state | Query delivery state and reconcile | Source/UI change; two-device network test pending |
| Temporary object deletion fails | Retain retryable cleanup state and do not falsely report cleanup | Retry only the temporary object cleanup | Edge source; deployed cron/secrets/test unavailable |
| Sender/recipient membership ends during transfer | Stop new writes; preserve established permanent independent copies | Retain/expire temporary transfer only under approved lifecycle rules | Source guards; end-to-end test pending |

## 5. Backup and restore (future Drive feature)

| Failure / trigger | Required behavior | Retry / recovery rule | Evidence status |
|---|---|---|---|
| First Drive succeeds, second Drive fails | Report partial; first destination may be healthy, aggregate policy remains partial | Retry only failed destination with stable version/object IDs | Design specified; not implemented |
| OAuth token revoked or permission scope removed | Mark destination reauth_required; never treat old token failure as success | Ask owner to reauthorize; do not ask partner to share their Drive | Design specified; not implemented |
| Drive quota exhausted | Keep local changes queued and last healthy version untouched | Retry after quota increases or user explicitly changes policy | Design specified; not implemented |
| Upload times out after provider accepted bytes | Query stable object/version and verify exact ciphertext before re-upload | Idempotent reconciliation; avoid duplicate version promotion | Design specified; not implemented |
| Manifest upload succeeds but one or more chunks fail | Version remains preparing/partial, never healthy | Resume missing chunks and verify manifest/chunk set | Design specified; not implemented |
| Uploaded bytes differ from local digest | Reject destination version as unhealthy | Re-upload fresh immutable object; preserve prior healthy version | Design specified; not implemented |
| Manifest AEAD/AAD/key-version check fails | Refuse to decrypt, index or restore | Preserve source objects; require known-good version or recovery review | Design specified; cryptographic review required |
| Backup job runs twice or app is relaunched | One logical version/job per idempotency key | Reconcile state rather than creating duplicate snapshots | Design specified; not implemented |
| User opens one old record/date | Retrieve only relevant index/chunk; never download whole archive | Retry a bounded individual object request | Design specified; not implemented |
| Restore contains stale records/tombstones/conflicts | Preview changes; preserve newer local values and tombstones; flag ambiguous conflicts | User resolves conflicts; rollback point retained | Smart Merge not implemented |

## 6. Notifications and Android lifecycle

| Failure / trigger | Required behavior | Retry / recovery rule | Evidence status |
|---|---|---|---|
| User denies notification permission | Keep reminder records and show delivery paused | Allow user to enable later; reconcile after permission returns | Source feature; Android test pending |
| Reminder payload has malformed repeat rule or duplicate stable key | Drop invalid rows from scheduling; retain other valid reminder records and normalize safely | Reconcile only validated entries | New source validator + regression tests; CI currently being rerun |
| Native scheduling succeeds but encrypted persistence fails | Cancel just-created native request; report failure | Retry without losing the previous valid reminder set | Source code; injected native/storage failure tests incomplete |
| Group replacement partially schedules | Cancel only the new partial set; preserve old group | Retry complete replacement | Source logic; deeper fault-injection test pending |
| User completes/deletes task, habit or routine | Cancel its related reminder and child snoozes; preserve unrelated repeats | Do not record action success until state change succeeds | Source feature; Android action tests pending |
| App is killed/rebooted or OEM delays a scheduled alert | Reconcile app-owned requests on next foreground; do not promise exact delivery | Display missed/late status as known; Android delivery history is inherently incomplete | Source reconciliation; physical test pending |
| Timezone/DST/device-clock changes | Recompute calendar and one-off schedules using stored instant/timezone semantics | Reconcile at next app start/foreground | Calendar source; DST tests pending |
| Notification action response repeats | Make action idempotent; avoid duplicate completions/history | Reconcile current task/habit/routine source state | Source response de-dupe; cold-start/repeat device tests pending |
| Android battery saver blocks or delays delivery | Show best-effort warning and preserve scheduled reminder record | Do not request exact-alarm permission silently; offer Android settings education | Design rule; device matrix pending |

## 7. Required non-production validation sequence

1. Create a disposable Supabase project with no production user data or credentials.
2. Apply all migrations in order and capture the resulting migration/catalog snapshot.
3. Run the database and Storage policy inventory scripts; inspect every policy, effective grant, SECURITY DEFINER function, trigger, bucket and cron configuration.
4. Execute two-account authorization negatives and membership/Snap concurrency races.
5. Exercise AAL1 rejection/AAL2 success, email verification, MFA factor enrollment and device revoke.
6. Exercise Snap upload interruption, lease renewal, acknowledgement retry, heartbeat/expiry race, ended connection and retained archive.
7. Execute archive/key-recovery test vectors only after independent cryptographic review and with synthetic accounts/keys.
8. On at least two physical Android devices, test install/restart/reboot, account switch, permission denial, quiet hours, timezone/DST, battery saver, network loss, session restore and notification actions.
9. Keep production migrations, Edge Functions, secrets, Auth config, Storage objects and live data untouched until formal approval.

## 8. Exit evidence rules

- A source file existing is not evidence that its SQL compiled or its server behavior passed.
- A migration checked into Git is not an applied migration.
- A green CI job proves only the steps in that job for the exact commit SHA.
- An APK artifact proves a build only; installation and OS behavior require a real device.
- A UI device-key revoke is not a full account-session revocation.
- A successful Supabase download is not proof of a permanent Drive copy.
- A ciphertext digest alone is not a substitute for authenticated decryption.
- A passing test project does not authorize production deployment; production requires separate approval and a reviewed deployment checklist.
