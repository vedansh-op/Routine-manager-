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
- [ ] Configure an APK build and publish a tested APK to GitHub Releases

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

An APK is not available yet. It will be generated only after the app is implemented and a build succeeds. The intended free build path is Expo + EAS Build's available free allowance, with the resulting APK attached to a GitHub Release.


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

Not yet complete: weekly report generation/upload, encrypted local database storage, calendar/photo delivery, 72-hour server cleanup, and two-device testing. Current task/habit persistence still uses AsyncStorage and is not yet encrypted. Apply migrations 1, 2, and 3 in order before testing the full cloud features.


## Phase 4 — Shared activity calendar

The shared calendar stores only events explicitly added to the shared space. Each event is stored as a UTC instant and rendered using the viewing member's device timezone. The database migration enforces shared-space membership for reads and creation, and only the creator can edit or delete their event. Apply `202611070004_shared_activity_calendar.sql` after migrations 1–3.

The calendar is an activity foundation, not yet the photo-memory implementation. Photo capture, encryption, private device storage, delivery acknowledgement, and the 72-hour server-side expiry are still pending.


## Phase 5 — Encrypted local data

The personal task/habit/completion store now encrypts its JSON payload before writing to AsyncStorage, using XChaCha20-Poly1305 and a random per-account 256-bit key stored with Expo SecureStore. The existing plaintext store is migrated on first account load. If decryption fails, writes are paused and the app displays a warning rather than overwriting the stored ciphertext.

This is an implementation awaiting CI and physical-device validation. It protects data at rest in the app's private storage, not a rooted/compromised device, and it does not create a cloud backup of detailed personal history.
