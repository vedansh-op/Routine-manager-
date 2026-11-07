# ONE-OS architecture

## Platform
- Android-first, personal single-user application.
- Expo + React Native + TypeScript.
- Expo Router for navigation.
- AsyncStorage for the first persistent local data implementation.
- Keep business logic outside screen components so storage can later be replaced without rewriting the UI.

## Main areas
- Home: today's overview, due tasks, habit progress, quick actions.
- Tasks: create, complete, edit, and remove tasks.
- Habits: define habits and record daily completion.
- Insights: derived summaries from the same task and habit records.

## Data ownership
A single shared application store owns tasks, habits, and completion records. Screens read from and update that store; Home and Insights must never maintain separate copies of task or habit state.

## Initial data model
- Task: id, title, notes, dueDate, completed, createdAt, updatedAt.
- Habit: id, title, frequency, createdAt, archived.
- HabitCompletion: habitId, date (local YYYY-MM-DD).

## Quality requirements
- Persist after every mutation.
- Handle empty states and storage errors.
- Use stable IDs; do not use array indexes as entity IDs.
- Keep date keys local-calendar based.
- Ensure UI remains usable on narrow Android screens.
