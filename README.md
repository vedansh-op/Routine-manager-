# ONE-OS

An Android-first personal operating system for tasks, habits, routines, insights, and a two-person shared space.

Repository: [vedansh-op/Routine-manager-](https://github.com/vedansh-op/Routine-manager-)

## Current implementation

- Expo SDK 54 / React Native / TypeScript app with Home, Tasks, Habits, Insights, Account, Shared Space, Our Time, Shared Calendar, and Private Photo Memories screens.
- Supabase email/password authentication and code-only shared-space invitations (two members maximum); owners can replace an unused or expired invite before the second member joins.
- Local-first task, habit, and completion history, encrypted at rest with XChaCha20-Poly1305; Supabase receives weekly aggregate reports only.
- Shared activities can be scheduled with the phone's native date/time picker, stored as UTC instants, and displayed in each device's local timezone; the creator sees the Portugal-time conversion before saving.
- Private photo memories: device-specific X25519 keys in Android SecureStore, ephemeral key agreement + HKDF-SHA256, XChaCha20-Poly1305 photo encryption, encrypted app-private local vault, recipient acknowledgement, and server-side expiry of pending cloud deliveries after 72 hours without a successful recipient heartbeat.
- GitHub Actions workflow builds an installable Android debug APK.

## Supabase setup order

Run these migrations in the Supabase SQL Editor, in this exact order:

1. `supabase/migrations/202611070001_profiles.sql`
2. `supabase/migrations/202611070002_shared_spaces_invites.sql`
3. `supabase/migrations/202611070003_weekly_reports.sql`
4. `supabase/migrations/202611070004_shared_activity_calendar.sql`
5. `supabase/migrations/202611070005_encrypted_snap_delivery.sql`

Deploy both Edge Functions from `supabase/functions/`:
- `ack-snap`
- `expire-stale-snaps`

For the expiry function, configure the server-only secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ONEOS_CRON_SECRET`. Then configure the 15-minute schedule using `supabase/cron/schedule_snap_expiry.sql` (requires pg_cron, pg_net, and Vault). Never put the service-role key in the app, APK, or repository.

In the app, configure only the Supabase Project URL and publishable/anon key as Expo public environment variables. Add `oneos://auth` to Supabase Authentication redirect URLs.

## Data and privacy boundaries

- Detailed task/habit/day history stays on each user's device. It is not uploaded as a cloud backup.
- Supabase stores aggregate weekly reports and records explicitly added/shared in the shared space.
- Private photo bytes are encrypted before upload. Each recipient saves the photo in their own encrypted app-private vault before acknowledgement removes the temporary cloud copy.
- The 72-hour expiry is based on the server's last successful authenticated heartbeat. Offline app opens cannot reset it.
- Uninstalling the app removes local history, local photos, and device private keys. There is no key-recovery or encrypted cloud backup yet.
- First-contact photo-key verification now shows a shared-secret fingerprint and pins the partner's public key locally; both people must compare the same fingerprint over a separate trusted channel. Key changes are blocked. This flow still needs two-device testing and a verified recovery path. Encryption does not protect a rooted or compromised device.

## Build and validation

Open [GitHub Actions](https://github.com/vedansh-op/Routine-manager-/actions). A build is ready only when the latest relevant run completes successfully and includes a downloadable `ONE-OS-debug-apk` artifact from that same run.

The current source still needs live Supabase configuration, migrations/functions deployment, two-account testing, and physical Android testing. A successful TypeScript check or APK build alone does not prove backend flows work.
