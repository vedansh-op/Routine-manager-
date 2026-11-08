# ONE-OS Phase 1 exit review

**Phase:** 1 of 8 — Architecture, Security and Data Design
**Review branch:** phase-1/one-os-architecture-blueprint
**Review type:** Repository/source and design-document review; not a production or independent security sign-off.
**Decision:** **DESIGN BASELINE COMPLETE; FORMAL PHASE EXIT HELD FOR EXTERNAL SECURITY VALIDATION.**

The team has a coherent source inventory, ownership model, threat model, archive/index contract, failure/retry matrix and migration plan. Source-level authentication, local-key safety, notification and database hardening work is present on the feature branch. However, key recovery is not implemented or independently reviewed, and the migrations have not been compiled/applied in a disposable Supabase project. Those are real exit blockers, not administrative checkboxes.

## 1. Exit checklist

| Phase 1 deliverable | Decision | Evidence / limitation |
|---|---|---|
| Existing repository/source inventory | **Complete for checked-in branch** | Current screens, libraries, tests, migrations, SQL functions, Edge Functions, workflows and current known gaps are documented. Live deployed catalog remains unknown. |
| Existing schema/RLS/Storage inventory | **Source inventory complete; live validation open** | Migrations 001–013 and read-only database/Storage audit scripts are in source. Effective deployed policy/grant state has not been queried. |
| Data ownership matrix | **Complete as design baseline** | See ONE_OS_PHASE_1_SCHEMA_AND_ARCHIVE_SPEC.md. Private local, Supabase, shared and future Drive boundaries are distinguished. |
| Threat model | **Complete as engineering baseline** | See ONE_OS_PHASE_1_THREAT_MODEL.md. Includes assets, trust boundaries, abuse cases, authorization invariants and residual risks. |
| Supabase vs Drive boundary | **Complete as design baseline** | Supabase is metadata/authorization; private archives and owner-authorized Drive content are encrypted on-device. No Drive integration is claimed. |
| Archive/version manifest | **Specified, not cryptographically approved** | Immutable version/chunk/manifest structure, authenticated binding, per-destination health and retention are specified. Exact key derivation/AAD serialization/nonces still require independent crypto review. |
| On-demand index/query protocol | **Specified as design** | Encrypted index, local-cache-first lookup, selective chunk retrieval, integrity-before-decrypt and bounded LRU are specified. No backup index code exists yet. |
| Migration map/no duplicate sources | **Complete as design baseline** | Existing tables are mapped; logical future concepts are marked proposals rather than migrations. Existing membership, calendar, Snap, and personal record authorities are not duplicated. |
| Failure/retry matrix | **Complete as test contract** | See ONE_OS_PHASE_1_FAILURE_MATRIX.md. It distinguishes required behavior from actual evidence. |
| Local key safety | **Source foundation and automated tests present** | Explicit fresh-key initialization, read-only inventory, fail-closed classifier and preservation of encrypted data when its key is missing. Recovery envelope and new-device historical recovery remain unimplemented. |
| Authentication/MFA/device controls | **Source foundation present; server/provider tests open** | Verified-email and AAL2 route/write guards, TOTP factor UI, secure session storage and device-key revocation are on the branch. Backup TOTP is not encryption recovery. Per-device Supabase session revocation is not implemented. |
| Notification foundation | **Local source foundation present; OS testing open** | Local task/habit/routine/calendar/focus reminders, controls and actions exist. Persisted-state validation now has regression tests. Remote push, geofence/travel and advanced lifecycle features remain future integrations. |
| SQL compilation and non-production RLS tests | **Open / external environment required** | No disposable Supabase project has applied migrations 001–013; PostgreSQL compilation, effective grants, two-account negatives and concurrency tests are unverified. |
| Independent cryptographic review | **Open / external specialist required** | ChatGPT/source review is not a substitute for independent cryptographic review. The proposed key hierarchy/recovery envelope must not be implemented as production recovery until reviewed. |
| Physical Android and two-device tests | **Open / physical devices required** | Build/CI and source tests do not prove SecureStore, notification delivery, MFA provider behavior, reboot, OEM battery restrictions or two-device Snap behavior. |
| Production deployment | **Intentionally not performed** | No production SQL, migration, Edge Function, Auth configuration, Storage object, cron, secret or live user data was changed or accessed. |

## 2. CI evidence

The following exact branch commit passed the TypeScript validation workflow:
- Commit: 1afabcc1a0e97c42196a6716ba7eae978427d5a1
- Run: https://github.com/vedansh-op/Routine-manager-/actions/runs/42530632242
- Verified successful job steps: dependency installation, TypeScript validation, recovery-state tests, notification-state tests.
- Recovery-state suite: 27 tests passed.
- Notification-state suite: 6 tests passed.

Earlier red runs were caused by cross-realm strict assertions in the new test harness. The test assertions were corrected; the green run above is the evidence to use. Do not cite the earlier failed runs as current status.

The later commits in this branch add documentation and workflow configuration. The TypeScript workflow does not trigger on documentation-only changes. Any later source change must receive a new green run before it is treated as verified.

## 3. Hard blockers before Phase 1 can be formally closed

1. **Independent cryptographic review:** review key separation, recovery envelope, nonce and AAD rules, device replacement, historical Snap recovery, rotation and rollback. The archive document is a proposal until this is done.
2. **Disposable Supabase validation:** apply all migrations in order to a new test project; validate SQL compilation, policies/grants, triggers, Edge Functions and scheduled-job assumptions; run the complete two-account/concurrency negative matrix.
3. **Physical Android validation:** install the current feature-branch build on real device(s); validate session storage, MFA, local-key bootstrap, reminders, reboot/timezone/battery conditions and Snap transfer/revocation. A second account/device is required for partner flows.

These checks must be completed in a controlled non-production environment. They do not authorize production deployment by themselves.

## 4. Release blockers that remain after the design phase

- Implement and verify a user-controlled encryption-key recovery envelope and historical-key restore.
- Implement account-deletion request with server-enforced seven-day grace and owner-only cancellation.
- Design per-install Supabase session revocation; current device-key revocation only blocks Snap key use.
- Complete shared archive coverage for any additional shared data types before promising that all history survives disconnection/deletion.
- Implement Google Drive consent, independent owner destinations, immutable encrypted backup versions, integrity checks, quota handling, selective retrieval and Smart Merge.
- Move Snap temporary delivery to the agreed Drive path only after permanent-copy verification is trusted.
- Implement remote shared push, location/travel-aware reminders and the remaining advanced notification lifecycle.
- Complete device-level validation and a release security review.

## 5. Phase decision

The **Phase 1 engineering/design package is now prepared and documented**. It is appropriate to treat the architecture baseline as ready for external validation and implementation planning.

The phase is **not formally signed off as complete** until the three hard blockers above are satisfied. Do not label the app production-ready, do not mark encryption recovery or server-side security validated, and do not deploy/merge/release as a side effect of this review.

## 6. Next safe sequence

1. Obtain an independent cryptographic review of the key and archive design.
2. Use a disposable Supabase project to compile/apply the migrations and run the database/Storage authorization matrix.
3. Produce and install a new feature-branch debug APK, then run the Android and two-account matrix.
4. Fix all findings, re-run CI and update this exit review with exact evidence.
5. Only then request Phase 1 sign-off. Production changes remain a separate explicit approval.
