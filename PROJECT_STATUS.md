# ONE-OS project status

## Repository and stack
- Repository: `vedansh-op/Routine-manager-`
- Expo SDK 54, Expo Router, React Native, TypeScript.
- Supabase Auth/Postgres/Storage/Edge Functions.
- Android-first; GitHub Actions creates a debug APK.

## Implemented source

### Core app
- [x] Home, Tasks, Habits, Insights, Account, Shared Space, Our Time, Shared Calendar, and Private Photo Memories screens.
- [x] Email/password authentication, persisted sessions, password recovery, and private profiles.
- [x] Two-member shared space with one-time, seven-day invitation code.
- [x] User-scoped local tasks, habits, and completions.
- [x] Encrypted local personal data using XChaCha20-Poly1305 and per-account keys held in Expo SecureStore.
- [x] Weekly aggregate reports; raw task titles, notes, and daily history are not uploaded.
- [x] Shared activity calendar storing UTC instants and rendering in each viewer's local timezone.
- [x] Photo capture/library picker, encrypted send, inbox, recipient decrypt/save, encrypted local photo vault, and date-based photo calendar.
- [x] Per-device X25519 keys stored in SecureStore; public keys are registered in Supabase.
- [x] Server-observed presence heartbeat and photo acknowledgement/expiry Edge Functions.
- [x] First-contact partner-key verification using a shared X25519 fingerprint compared out-of-band and a write-once local key pin.
- [x] GitHub Actions Android debug APK workflow.

## Supabase deployment checklist
Apply the following migrations in order:
1. `202611070001_profiles.sql`
2. `202611070002_shared_spaces_invites.sql`
3. `202611070003_weekly_reports.sql`
4. `202611070004_shared_activity_calendar.sql`
5. `202611070005_encrypted_snap_delivery.sql`

Then:
- [ ] Configure Project URL and publishable/anon key in the local Expo environment.
- [ ] Add `oneos://auth` to Supabase Auth redirect URLs.
- [ ] Apply all five migrations in the SQL Editor.
- [ ] Deploy `ack-snap` and `expire-stale-snaps` Edge Functions.
- [ ] Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ONEOS_CRON_SECRET` as server-side Edge Function secrets.
- [ ] Configure the 15-minute cron schedule from `supabase/cron/schedule_snap_expiry.sql`.
- [ ] Test signup, sign-in, shared-space invite, weekly reports, calendar, and photo delivery with two accounts.

Never put the Supabase service-role key in the Android app, APK, or Git repository.

## Data retention and privacy
- Detailed personal task/habit/day history remains local to each user's device. It is not synced as a full cloud backup.
- Cloud weekly reports contain aggregate counts only.
- Shared calendar entries are explicitly shared.
- Photo ciphertext is uploaded; the recipient decrypts and stores it in their own encrypted app-private vault before cloud acknowledgement.
- The server expires only pending cloud photos when the recipient has had no successful authenticated heartbeat for 72 hours. Offline app opens do not reset the server timer.
- App uninstall removes local detailed history, local photo files, and device private keys. There is no recovery mechanism for those keys yet.
- First-contact fingerprint verification and write-once local pinning are implemented, but must be tested on both devices. A reviewed key-rotation/recovery flow is still missing.

## Android build status
- [ ] Confirm the newest GitHub Actions run completes successfully.
- [ ] Confirm a downloadable `ONE-OS-debug-apk` artifact belongs to that same successful run.
- [ ] Install and test on a physical Android device.
- [ ] Test photo send/receive, failed uploads, duplicate acknowledgement, tamper rejection, and 72-hour expiry using both accounts/devices.
- [ ] Configure production signing and publish a release APK.

A successful TypeScript check or debug APK build is not proof that Supabase is configured or that two-device features work end to end.
