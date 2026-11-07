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
- [ ] Add Create space / Enter code screens and connect them to the RPCs
- [ ] Test the flow with two separate accounts/devices

## Validation still required
- Install dependencies and run TypeScript checks.
- Run the app on an Android device and fix runtime/build issues.
- Verify persistence, date-bound habit completion, and screen layouts.
- Configure EAS credentials/build and publish a tested APK.

## APK status
No APK has been built or tested yet. Do not treat the EAS profile as a completed build.
