# ONE-OS

A personal Android operating system for daily execution: tasks, routines, habits, and insights in one calm, consistent workspace.

> This repository is being used as the ONE-OS project repository. The existing repository name is retained.

## Project status

- [x] Repository selected: `vedansh-op/Routine-manager-`
- [x] Expo / React Native TypeScript Android application scaffold
- [x] Home, Tasks, Habits, and Insights screens with shared local persistence
- [x] Supabase authentication source implementation
- [x] Code-only shared-space database and app screen foundation
- [ ] Configure Supabase credentials and apply database migrations
- [ ] Validate on two physical Android accounts/devices
- [x] Configure GitHub Actions Android debug APK build and generate installable APK artifacts
- [ ] Physically test the current APK on Android and publish a signed release build

## Product scope

ONE-OS is an Android-first personal productivity app. The first release focuses on:
- Home dashboard
- Tasks and task management
- Habits and routine tracking
- Insights and analytics
- Shared state so changes made in Tasks and Habits are reflected on Home and Insights
- Dark and light themes

## Development

The source package supplied for this project currently contains Stitch design assets and HTML prototypes, not a complete Android app. The app scaffold will be built separately from those design references.

See [PROJECT_STATUS.md](PROJECT_STATUS.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Android APK

A debug APK has been generated successfully by GitHub Actions run #53. It is an installable debug build, not yet physically tested. Its GitHub Actions artifact is retained until 21 November 2026. The latest source revision is being rebuilt in run #54; check the Actions page for the newest completed `ONE-OS-debug-apk` artifact.


## Phase 1 — Authentication

The app now includes Supabase email/password sign-up and sign-in, persisted sessions, email confirmation, password-reset links, password recovery, and sign-out. Each account receives a private profile row protected by row-level security.

### One-time Supabase setup

1. Create a Supabase project.
2. In the Supabase SQL Editor, run `supabase/migrations/202611070001_profiles.sql`.
3. Copy `.env.example` to `.env` and fill in the Project URL and publishable key from Supabase project settings.
4. In Supabase Authentication → URL Configuration, add `oneos://auth` as an allowed redirect URL.
5. Rebuild the Android app after setting the environment variables.

Only the Supabase publishable/anon key belongs in the app. Never use the service-role key in an APK. The database migration enables RLS and limits each user to their own profile.

**Build note:** Phase 1 source code is committed, but it is not end-to-end verified until the Supabase project is configured and a real Android sign-up/sign-in/reset flow is tested.


## Phase 2 — Connect two people using an invitation code

The app uses a code-only flow (no invitation URLs):
1. The first signed-in person creates a shared space.
2. ONE-OS generates an 12-character, single-use code.
3. The second person signs in with their own account and enters the code.
4. Both accounts become members of the same shared space. A space is limited to two members.

Codes expire after seven days. The database stores a SHA-256 hash of each code, not the plaintext code. Membership changes are performed through authenticated database functions.

### Apply the Phase 2 migration

After applying the Phase 1 migration, open Supabase → SQL Editor and run the complete contents of:
`supabase/migrations/202611070002_shared_spaces_invites.sql`

Then rebuild the app with the Supabase Project URL and publishable/anon key configured. Test creation with one account and code redemption with a second account.

The app currently has the Create space and Join with a code screen. Shared task/habit selection and realtime shared-data sync are later phases; connecting accounts does not yet make all personal data visible to the other person.


## Phase 3 — Local-first data and timezone foundation

ONE-OS is being built local-first: detailed personal tasks, habits, and daily history belong on each signed-in user's device. The local store is now scoped by Supabase user ID to prevent two accounts on the same phone from seeing the same records. The original unscoped store is migrated once to the first account that signs in.

The 202611070003_weekly_reports.sql migration adds a small cloud table for aggregated weekly summaries. Reports are private by default; partner reads require the owner to enable sharing and both accounts to belong to the same shared space. The migration does not create or upload daily activity records.

The Our Time screen displays the current device timezone beside mainland Portugal (Europe/Lisbon). It uses IANA timezone rules, so Portugal's daylight-saving offset changes are handled automatically. Shared event timestamps should be stored as UTC instants and formatted separately for each member.

The weekly report aggregate upload, encrypted local personal store, shared activity calendar, and encrypted photo-delivery source implementations are now present. Supabase project credentials, SQL migrations, Edge Function deployment, two-device verification, and physical Android testing are still required. Apply migrations 1–5 in order before testing all cloud features.


## Phase 4 — Shared activity calendar

The shared calendar stores only events explicitly added to the shared space. Each event is stored as a UTC instant and rendered using the viewing member's device timezone. The database migration enforces shared-space membership for reads and creation, and only the creator can edit or delete their event. Apply `202611070004_shared_activity_calendar.sql` after migrations 1–3.

The calendar stores explicitly shared activities. Photo memories are handled separately by the Private photo memories screen and are browsed by date in its own local calendar.


## Phase 5 — Encrypted local data

The personal task/habit/completion store now encrypts its JSON payload before writing to AsyncStorage, using XChaCha20-Poly1305 and a random per-account 256-bit key stored with Expo SecureStore. The existing plaintext store is migrated on first account load. If decryption fails, writes are paused and the app displays a warning rather than overwriting the stored ciphertext.

This is an implementation awaiting CI and physical-device validation. It protects data at rest in the app's private storage, not a rooted/compromised device, and it does not create a cloud backup of detailed personal history.


## Phase 6 — Private photo memories

The Private photo memories screen is now part of the app. It uses X25519 ephemeral key agreement, HKDF-SHA256, and XChaCha20-Poly1305 to encrypt a snap before it is uploaded. The recipient's private key is kept in Android SecureStore; the server stores only ciphertext and an encrypted one-time file-key envelope. Each recipient saves the decrypted image encrypted in their own app-private vault before the app requests cloud acknowledgement.

The Supabase migration `202611070005_encrypted_snap_delivery.sql` creates the public-key registry, server-observed presence, delivery metadata, and a private Storage bucket. Apply migrations 001–005 in order. Deploy `ack-snap` and `expire-stale-snaps` from `supabase/functions/`, set the server-only `ONEOS_CRON_SECRET` for the expiry function, then configure the 15-minute schedule using `supabase/cron/schedule_snap_expiry.sql`. The scheduled SQL requires pg_cron, pg_net, and Vault. Do not put a service-role key into the app or GitHub source.

The 72-hour rule uses the server's last successful authenticated heartbeat. Opening ONE-OS while offline cannot reset that timer until the phone reconnects. Expiry removes only pending cloud photo objects and their delivery records; it does not remove account data or photos already saved locally.

**Not yet end-to-end verified:** Supabase migrations/functions have not been deployed to the live project, and two-device camera/send/receive/acknowledgement/expiry tests are still required. A device reinstall loses its SecureStore private photo key and its local vault; there is no key-recovery or encrypted cloud backup yet. Do not treat the app as a production secure messenger until these risks and tests are addressed.


## Photo privacy foundation (in progress)

The private photo-delivery backend and client cryptographic primitives are now present in source. Photos are intended to be encrypted on-device with a fresh XChaCha20-Poly1305 key; that key is wrapped to the partner's X25519 public key using an ephemeral exchange and HKDF-SHA256. The recipient's private key is stored in Android SecureStore. Supabase stores ciphertext and an opaque key envelope only. The Android camera/picker, upload/inbox UI, private local save, first-contact key verification, and physical-device tests are still pending.

Apply the new migrations after the earlier migrations:
- `202611080001_private_photo_delivery.sql`
- `202611080002_photo_key_directory.sql`

Deploy `supabase/functions/purge-stale-photo-deliveries` and schedule it every 15 minutes. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a long random `ONEOS_PURGE_CRON_SECRET` as Edge Function secrets. Cron must send that secret in the `x-oneos-cron-secret` header. Never place the service-role key in the app or repository.
