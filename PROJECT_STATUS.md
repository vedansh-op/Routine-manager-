# ONE-OS project status

## Completed in GitHub
- Initialized the repository as an Expo Router / React Native TypeScript Android project.
- Added app configuration, EAS APK preview profile, TypeScript configuration, and Git ignore rules.
- Added Home, Tasks, Habits, and Insights screens.
- Added a shared AsyncStorage-backed store for tasks, habits, and daily habit completions.
- Connected the screens to the same data source so Home and Insights derive their values from Tasks and Habits.

## Design source audit
The supplied Stitch bundle was inspected locally. It contains HTML prototypes, screen-preview PNGs, and design-system notes. It does not contain a complete native Android app. The original design assets still need to be imported into `design-source/` and the native UI refined against them.

## Phase 1 — Authentication implementation
- [x] Supabase client with persisted auth sessions
- [x] Email/password sign-up and sign-in screens
- [x] Email confirmation and password reset/recovery deep-link handling
- [x] Authenticated route gate and account/sign-out screen
- [x] Private profiles table with row-level security migration
- [ ] Configure a real Supabase project and add local Expo public environment variables
- [ ] Verify sign-up, sign-in, session restore, password reset, and sign-out on Android



## Phase 2 — Code-only shared-space foundation
- [x] Added database schema for shared spaces, members, and invitation records
- [x] Added authenticated RPC to create a shared space and generate a one-time code
- [x] Added authenticated RPC to redeem a code; codes expire after 7 days and can only be used once
- [x] Enforced a maximum of two members and prevented a user joining multiple shared spaces
- [ ] Run the Phase 2 SQL migration in the Supabase SQL Editor
- [x] Added Create space / Enter code screen and connected both actions to Supabase RPCs
- [x] Added Shared space entry to the Home screen
- [ ] Test the flow with two separate accounts/devices

## Validation still required
- Install dependencies and run TypeScript checks.
- Run the app on an Android device and fix runtime/build issues.
- Verify persistence, date-bound habit completion, and screen layouts.
- Configure EAS credentials/build and publish a tested APK.

## APK status
- [x] Installable Android debug APK successfully built in GitHub Actions run #53 (artifact: `ONE-OS-debug-apk`, about 44.9 MB ZIP / 126 MB APK).
- [x] Newer source revision passed TypeScript validation and Expo prebuild in run #54.
- [ ] Finish run #54 Android Gradle build and verify its APK artifact.
- [ ] Install on a physical Android device and test login, local encryption, photo send/receive, and server expiry.
- [ ] Configure production signing and publish a release APK.

The run #53 APK includes the date-based photo calendar, device-targeted delivery, capture-time handling, and foreground heartbeat. It predates only the final secure-storage key-creation race fix being rebuilt in run #54.


## Phase 3 — Local-first data and timezone foundation
- [x] Scope local task, habit, and completion storage by authenticated user ID so accounts on one device do not share the same local workspace.
- [x] Add one-time migration of the original local store into the first signed-in account's scoped store.
- [x] Add timezone helpers based on IANA timezone identifiers and UTC instants.
- [x] Add an Our Time screen with live local and Europe/Lisbon clocks; Portugal daylight-saving offsets are calculated by the runtime timezone database.
- [x] Add a weekly_reports table migration: each user owns their summary, and partner access requires explicit sharing plus shared-space membership.
- [ ] Apply migration 202611070003_weekly_reports.sql in the Supabase SQL Editor.
- [x] Add an Insights action to upload aggregate weekly counts, privately or with explicit partner sharing. It sends counts only, never task names or notes.
- [ ] Replace current AsyncStorage persistence with encrypted app-private storage before describing local records as encrypted.
- [ ] Implement the shared memories calendar, activity sharing controls, encrypted photo delivery, acknowledgements, and server-side 72-hour expiry.
- [ ] Configure per-user timezone preferences and reminder scheduling; current Our Time screen detects this device's timezone and uses Europe/Lisbon for the partner.

## Important data-retention boundary
The weekly_reports table is designed for aggregated summaries only. Do not upload raw task titles, notes, daily completion rows, or full personal history. Uninstalling the app will remove device-local detail; only weekly reports and other explicitly cloud-backed records can be restored after reinstall.


## Phase 4 — Shared activity calendar
- [x] Add shared_activities table with member-only read access and creator-only edit/delete.
- [x] Add a calendar screen with monthly navigation, activity-day markers, selected-day details, and add-shared-moment flow.
- [x] Store activity instants as UTC and render the calendar in each device's local IANA timezone.
- [ ] Apply migration 202611070004_shared_activity_calendar.sql in Supabase SQL Editor.
- [ ] Test event creation and visibility using both accounts in different timezones.
- [ ] Add activity date/time picker (current quick-add records the moment of creation).
- [ ] Add image capture, client-side encryption, recipient device-key exchange, queued delivery, verified receipt, and server-side 72-hour pending-photo purge.


## Phase 5 — Encrypted local personal data (implementation in validation)
- [x] Add per-account 256-bit data keys stored in Android Keystore through Expo SecureStore.
- [x] Encrypt local task/habit/completion JSON with XChaCha20-Poly1305 using a fresh 192-bit nonce per write.
- [x] Migrate the existing plaintext local store to encrypted storage on first successful account load.
- [x] Pause writes and surface a warning if local ciphertext cannot be decrypted, rather than silently replacing the user's data.
- [ ] Verify package compatibility and TypeScript/Android build in GitHub Actions.
- [ ] Test encryption round-trip, legacy migration, account switching, app restart, and key-loss recovery on a physical Android device.

Security boundary: this protects stored app data at rest using a key held by Android secure storage. It does not protect a compromised/rooted device, and it is not yet an encrypted backup. A clean uninstall removes the app's local data; Supabase weekly reports remain separately available.


## Phase 6 — Encrypted shared photo memories (implementation in validation)
- [x] Add per-device X25519 identity keys; keep private keys in Expo SecureStore and publish only public keys.
- [x] Add ephemeral X25519 + HKDF-SHA256 key wrapping and XChaCha20-Poly1305 photo encryption.
- [x] Add local photo vault using app-private file storage and per-account encryption at rest.
- [x] Add private Storage bucket and participant-only delivery metadata policies.
- [x] Add authenticated receipt Edge Function: remove cloud ciphertext and clear the delivery key envelope after local save.
- [x] Add server-observed presence heartbeat and 72-hour inactivity cleanup Edge Function.
- [x] Add camera/library picker, encrypted sender upload, inbox receive/decrypt/save, and local memory gallery.
- [ ] Apply migration 202611070005_encrypted_snap_delivery.sql after migrations 001–004.
- [ ] Deploy ack-snap and expire-stale-snaps Edge Functions; set ONEOS_CRON_SECRET and configure the scheduled worker.
- [ ] Validate concurrent first-key registration, upload failure cleanup, repeated ack, tamper detection, file permissions, and Android runtime.
- [ ] Test using both accounts and physical devices in different countries/timezones.
- [ ] Add multi-device key envelopes/recovery before claiming account-level recovery; current recipient envelope targets one registered device key.
- [ ] Consider app uninstall/reinstall behaviour: local memories and device private keys are lost; no recovery service exists.

Privacy boundary: only ciphertext and wrapped key metadata are uploaded. Local photo copies are encrypted at rest in app-private storage. The server cannot decrypt photo content. The 72-hour clock depends on a successful online heartbeat, not the device's offline activity.


## Phase 6 — Private encrypted photo-delivery backend foundation
- [x] Added per-member authenticated heartbeat records for server-observed app sync.
- [x] Added private photo-delivery metadata with two-member validation, ciphertext size/type limits, recipient-only download policy, and sender-only upload policy.
- [x] Added acknowledgement RPC; only the intended recipient can mark a pending delivery as received.
- [x] Added a private Storage bucket; the database stores only object path and an opaque wrapped file-key envelope.
- [x] Added a Supabase Edge Function that removes pending ciphertext and metadata after 72 hours without a recipient heartbeat.
- [ ] Implement and review the Android client-side X25519 recipient key registration, per-photo key wrapping, capture, upload, download, local decrypt, and verified-save flow.
- [ ] Deploy the Edge Function and configure a 15-minute Supabase Cron invocation with a secret header.
- [ ] Apply migration 202611080001_private_photo_delivery.sql after migrations 001–004 and test with both accounts/devices.

Important: this is backend groundwork, not a completed end-to-end photo feature. Do not upload plaintext photos or reuse the local database encryption key for photo sharing. The Edge Function uses the service-role key only in server-side secrets; never put it in the Android app. The 72-hour timer is based on the last successful authenticated heartbeat the server has observed, not the phone's offline clock. Only pending cloud copies are purged; acknowledged deliveries remain subject to recipient local storage.
