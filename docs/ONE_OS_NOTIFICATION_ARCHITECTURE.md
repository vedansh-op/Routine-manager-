# ONE-OS notification architecture and delivery plan

**Status:** Approved feature scope; first local-notification foundation committed on the Phase 1 feature branch.
**Platform focus:** Android-first (Expo SDK 54 / React Native).
**Scope rule:** This document defines the full target scope. A listed feature is not complete merely because its category exists.

## 1. Product goals

- Reminders are useful, reliable, private and controllable.
- Personal reminders are scheduled locally and work without an internet connection.
- Reminder metadata is stored in the authenticated account's encrypted local store.
- Shared-space events use an authenticated remote delivery path; private task/habit content is never sent to a partner.
- No silent permission escalation. Ask for notification permission in context.
- Do not request Android exact-alarm access for ordinary task reminders. Android battery policy and OEM restrictions can delay best-effort delivery; the UI must not promise exact delivery.
- Every scheduled reminder has a stable app record and a native notification identifier so rescheduling and cancellation can be idempotent.
- Completing, deleting or changing the time/category of a source item must cancel or replace its old notification.

## 2. Complete approved feature scope

### Core reminders

1. Task due-time reminders, including multiple lead-time choices and custom times.
2. Habit reminders with daily, weekly and selected-day schedules.
3. Routine start, step-transition and routine-finished reminders.
4. Calendar event alerts, including all-day events and configurable advance alerts.
5. Overdue task, unfinished-task and missed-habit alerts.
6. Notification actions: open, mark done, snooze and reschedule.

### Productivity and controls

7. Persistent reminders (user opt-in, bounded and never an endless alarm loop).
8. Morning planning / daily briefing.
9. Evening review and next-day preview.
10. Smart reminders derived from incomplete tasks and the user's chosen rules.
11. Focus-session start, break and finish alerts.
12. Habit streak and check-in reminders.
13. Quiet hours and per-day notification windows.
14. Separate category preferences for tasks, habits, routines, calendar, focus, shared, travel and system alerts.
15. Sound, vibration and importance preferences, respecting Android channel-level user controls.
16. Notification history, delivery state, missed-alert visibility and recovery.

### Context-aware and connected features

17. Location-based reminders with explicit location permission and geofence limits.
18. Shared-space / partner activity notifications with participant-specific privacy.
19. Shared calendar changes, invitations and event updates.
20. Travel-aware reminders using event time zones and local device time.
21. Priority levels for important reminders, without silently bypassing Android Do Not Disturb.
22. Grouping, deduplication and stale-alert cancellation.
23. App badge / outstanding count where supported by the Android launcher.
24. Smart frequency controls to prevent alert fatigue.

## 3. Delivery architecture

### Local notification path

Tasks, habits, routines, personal calendar entries, focus sessions and personal briefings should use on-device scheduling. This path is encrypted at rest, works offline, and does not require a Supabase round trip at delivery time.

Use Android channels by category. Channel choices are user-visible in Android settings and Android may preserve the user's own channel overrides. Use best-effort scheduled delivery by default. Exact alarm permission is a separate decision and must not be requested for ordinary reminders.

### Remote notification path

Shared-space events and server-originated changes need a server-authorized push pipeline. Before implementation:
- register and revoke device push tokens safely;
- validate the recipient's active shared-space membership at send time;
- send only opaque identifiers and minimum necessary display text;
- never include private task/habit data, encryption keys, Snap plaintext or private Drive content;
- rate-limit, deduplicate and audit sends;
- ensure ended connections and revoked devices receive no new shared notifications.

No production Supabase function, schema, FCM credential or push token is configured by this client-side foundation.

### Location and travel path

Location reminders require a dedicated privacy review, foreground/background permission UX, geofence caps and a manual fallback. Travel-aware reminders must preserve the event's timezone and distinguish a fixed event timezone from the phone's current timezone.

## 4. Current foundation implemented on the feature branch

- Expo Notifications dependency pinned to the SDK 54-compatible ~0.32.17 line.
- Config plugin added to app.json.
- Android notification channels are defined by reminder category and sound/vibration preference.
- Permission request is user-initiated from the Notifications screen; channels are initialized before the permission flow.
- Reminder records and category preferences use the account's existing encrypted local storage key.
- One-time, daily and weekly local reminders are schedulable.
- Quiet hours shift one-time reminders to the next quiet-hours end; repeating reminders are rejected when their selected time falls in quiet hours.
- Category and master switches cancel/reschedule pending local reminders.
- Notification actions support snooze 10 minutes, mark reminder done, and open the relevant screen. Snoozing a recurring reminder creates a separate one-time alert and preserves its recurring schedule.
- Task rows can schedule multiple deadline alerts (1 hour, 30 minutes, 15 minutes, 5 minutes and/or at the due time); selections are idempotently linked by task ID, and completing a task cancels every linked alert.
- Habits can schedule local check-ins every day or on individually selected weekdays; reminders use stable habit source keys and can be changed or removed.
- Upcoming shared calendar events are reconciled into local alerts at a user-configurable advance time (5, 10, 15, 30, 60 or 120 minutes), for events within the next 30 days (up to 40 events per sync). Stable source keys prevent duplicates on refresh.
- Encrypted notification history records foreground deliveries and notification actions (OS delivery history is incomplete when Android does not run the app listener in the background).
- On sign-out/account change, scheduled alerts are reconciled so alerts belonging to another account are cancelled; stale, duplicate and expired scheduled alerts are cleaned up.
- A Notifications screen exposes permission state, category controls, quiet hours, sound/vibration preferences, reminder creation, snoozing, removal and recent activity.

These are source-level features; CI and real-device behavior still need verification. Android may apply OEM battery restrictions. The local notification layer is not a server push system.

## 5. Remaining integration work

- Add recurring task due dates, deletion lifecycle cancellation, and tests for task-alert replacement across partial failures.
- Make habit reminders completion-aware so a completed habit does not produce an unnecessary alert later that day; define next-eligible-day and streak rules.
- Implement a routine model and step timing before routine-transition notifications.
- Add calendar alert lead-time preferences, event deletion cancellation and durable per-member reconciliation.
- Add source-item IDs and an idempotent reconciliation job so repeated app opens never duplicate reminders.
- Extend notification history with missed/delayed state and reliable background delivery reconciliation.
- Build task/habit-aware daily briefing and evening summary content; current morning/evening prompts are simple reminders only.
- Add focus-session and streak rules.
- Add priority/grouping/deduplication and smart frequency limits.
- Implement remote push with test-only credentials/project first; no production secrets or deployment during this phase.
- Implement location and travel handling with explicit permission and privacy review.
- Test cold start, app restart, device reboot, account switch, sign-out, timezone/DST change, offline scheduling, permission denial, quiet hours, Android 13+ permission UX, battery saver and low-memory behavior on a physical Android device.

## 6. Home-screen widgets dependency

Build Android home-screen widgets only after:
1. the task, habit, routine and calendar models have stable IDs and due/schedule fields;
2. reminder scheduling and cancellation are idempotent;
3. widget actions can update the same authoritative local store as the app;
4. notification and widget state have been tested across reboot, account switch and offline operation.

Initial widget set: today's tasks, habit checklist, current routine / next step, next calendar event, focus timer, quick-add task and daily progress. Widgets are a later Android-experience milestone, not a dependency for the notification engine.

## 7. Safety and reliability boundaries

- Do not request exact-alarm permission for general reminders.
- Do not silently ask for background location.
- Do not claim that a scheduled notification is guaranteed to display at an exact second.
- Never send private reminders to the shared space.
- Never clear encrypted reminder records merely because Android notification permission was denied.
- When notification permission is revoked, retain reminders and show that delivery is paused.
- When a category is disabled, cancel its pending native notifications but retain the reminder records so enabling it can restore future schedules.
- Use local tests for scheduling calculations and physical-device tests for OS delivery behavior.
