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
2. ONE-OS generates an 8-character, single-use code.
3. The second person signs in with their own account and enters the code.
4. Both accounts become members of the same shared space. A space is limited to two members.

Codes expire after seven days. The database stores a SHA-256 hash of each code, not the plaintext code. Membership changes are performed through authenticated database functions.

### Apply the Phase 2 migration

After applying the Phase 1 migration, open Supabase → SQL Editor and run the complete contents of:
`supabase/migrations/202611070002_shared_spaces_invites.sql`

Then rebuild the app with the Supabase Project URL and publishable/anon key configured. Test creation with one account and code redemption with a second account.

The app currently has the Create space and Join with a code screen. Shared task/habit selection and realtime shared-data sync are later phases; connecting accounts does not yet make all personal data visible to the other person.
