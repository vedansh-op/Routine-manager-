# ONE-OS

A personal Android operating system for daily execution: tasks, routines, habits, and insights in one calm, consistent workspace.

> This repository is being used as the ONE-OS project repository. The existing repository name is retained.

## Project status

- [x] Repository selected: `vedansh-op/Routine-manager-`
- [x] Empty GitHub repository verified; default branch: `main`
- [x] Initial product architecture and Android build path documented
- [ ] Import the original Stitch design bundle (HTML prototypes, PNG previews, design-system docs)
- [ ] Implement the Expo / React Native application
- [ ] Add persistent local storage and shared data layer
- [ ] Validate on a physical Android device
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
3. Copy `.env.example` to `.env` and fill in the Project URL and publishable/anon key from Supabase project settings.
4. In Supabase Authentication → URL Configuration, add `oneos://auth` as an allowed redirect URL.
5. Rebuild the Android app after setting the environment variables.

Only the Supabase publishable/anon key belongs in the app. Never use the service-role key in an APK. The database migration enables RLS and limits each user to their own profile.

**Build note:** Phase 1 source code is committed, but it is not end-to-end verified until the Supabase project is configured and a real Android sign-up/sign-in/reset flow is tested.
