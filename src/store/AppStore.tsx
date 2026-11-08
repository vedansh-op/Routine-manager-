import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { getEncryptedItem, initializeUserKeyForFreshInstall, setEncryptedItem } from "@/lib/secureLocalStore";
import { inspectLocalEncryptedData } from "@/lib/keyRecoveryRegistry";
import { classifyRecoveryBootstrapState } from "@/lib/keyRecoveryState";
import { migrateLegacyRecordForUser } from "@/lib/legacyMigration";
import { cancelReminder, cancelSnoozesForReminder, getNotificationState } from "@/lib/notifications";

export type Task = { id: string; title: string; notes?: string; dueDate?: string; reminderId?: string; reminderIds?: string[]; completed: boolean; createdAt: string };
export type Habit = { id: string; title: string; createdAt: string; archived: boolean; reminderId?: string; reminderIds?: string[]; reminderTime?: string; reminderDays?: number[] };
export type RoutineStep = { id: string; title: string; durationMinutes: number };
export type Routine = {
  id: string;
  title: string;
  steps: RoutineStep[];
  createdAt: string;
  reminderIds?: string[];
  scheduledStartAt?: string;
};
type Store = {
  tasks: Task[];
  habits: Habit[];
  routines: Routine[];
  completions: string[];
  ready: boolean;
  storageError: string | null;
  canEdit: boolean;
  addTask: (title: string) => void;
  toggleTask: (id: string) => Promise<boolean>;
  removeTask: (id: string) => Promise<void>;
  setTaskReminder: (id: string, reminderIds: string[], dueDate: string) => void;
  addHabit: (title: string) => void;
  addRoutine: (title: string, steps: RoutineStep[]) => void;
  setRoutineSchedule: (id: string, reminderIds: string[], startAt: string) => void;
  removeRoutine: (id: string) => Promise<void>;
  completeRoutine: (id: string) => Promise<boolean>;
  toggleHabitToday: (id: string) => Promise<boolean>;
  setHabitReminder: (id: string, reminderIds: string[] | null, reminderTime?: string, reminderDays?: number[]) => void;
};
const keyForUser = (userId: string) => "one-os-v2:" + userId;
const migratedKey = (userId: string) => "one-os-v2-migrated:" + userId;
const StoreContext = createContext<Store | null>(null);
const today = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
};
const uid = () => Math.random().toString(36).slice(2, 10);

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [completions, setCompletions] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [storageUnlocked, setStorageUnlocked] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setStorageUnlocked(false);
    setStorageError(null);
    setActiveUserId(userId);
    setTasks([]);
    setHabits([]);
    setRoutines([]);
    setCompletions([]);
    if (!userId) {
      setReady(true);
      return () => { cancelled = true; };
    }

    (async () => {
      try {
        // Inspect local keys and ciphertext before any path can create a key or
        // write an empty store. Missing keys beside encrypted data must stop
        // startup and preserve the original files for recovery.
        const dataInventory = await inspectLocalEncryptedData(userId);
        if (cancelled) return;
        const bootstrapState = classifyRecoveryBootstrapState(dataInventory);
        if (bootstrapState === "fresh-candidate") {
          await initializeUserKeyForFreshInstall(userId);
          if (cancelled) return;
        } else if (bootstrapState !== "ready") {
          throw new Error(
            bootstrapState === "recover-existing"
              ? "Encrypted local data exists but its key is missing or invalid. Your data has been preserved; account recovery is required before continuing."
              : "Local security storage could not be verified. Your data has been left unchanged; please try again or contact support.",
          );
        }

        const scopedKey = keyForUser(userId);
        let raw = await getEncryptedItem(scopedKey, userId);
        if (cancelled) return;
        if (!raw) {
          const alreadyMigrated = await AsyncStorage.getItem(migratedKey(userId));
          if (!alreadyMigrated) {
            await migrateLegacyRecordForUser(
              userId,
              AsyncStorage,
              async legacy => {
                raw = legacy;
                await setEncryptedItem(scopedKey, userId, legacy);
              },
              () => !cancelled,
            );
            if (cancelled) return;
            await AsyncStorage.setItem(migratedKey(userId), "1");
          }
        }
        if (cancelled) return;
        if (raw) {
          const data = JSON.parse(raw);
          setTasks(Array.isArray(data.tasks) ? data.tasks : []);
          setHabits(Array.isArray(data.habits) ? data.habits : []);
          setRoutines(Array.isArray(data.routines) ? data.routines : []);
          setCompletions(Array.isArray(data.completions) ? data.completions : []);
        }
        if (!cancelled) setStorageUnlocked(true);
      } catch (error) {
        if (!cancelled) setStorageError(error instanceof Error ? error.message : "Could not unlock this account's local data.");
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!ready || !storageUnlocked || !userId || activeUserId !== userId) return;
    let cancelled = false;
    setEncryptedItem(keyForUser(userId), userId, JSON.stringify({ tasks, habits, routines, completions })).catch(error => {
      // A failed write from a previous account/session must not lock the
      // store after the user has signed out or switched accounts.
      if (cancelled) return;
      setStorageError(error instanceof Error ? error.message : "Could not encrypt local data.");
      setStorageUnlocked(false);
    });
    return () => { cancelled = true; };
  }, [tasks, habits, routines, completions, ready, storageUnlocked, userId, activeUserId]);

  const addTask = useCallback((title: string) => {
    if (!storageUnlocked || !ready || activeUserId !== userId) return;
    const value = title.trim();
    if (value) setTasks(old => [{ id: uid(), title: value, completed: false, createdAt: new Date().toISOString() }, ...old]);
  }, [storageUnlocked, ready, activeUserId, userId]);
  const toggleTask = useCallback(async (id: string) => {
    if (!storageUnlocked || !ready || activeUserId !== userId) return false;
    const task = tasks.find(item => item.id === id);
    if (!task) return false;
    const completing = !task.completed;
    const reminderIds = task.reminderIds ?? (task.reminderId ? [task.reminderId] : []);
    if (completing && reminderIds.length > 0 && userId) {
      try {
        for (const reminderId of reminderIds) await cancelReminder(userId, reminderId);
      } catch (error) {
        setStorageError(error instanceof Error ? "Task reminder could not be cancelled: " + error.message : "Task reminder could not be cancelled.");
        return false;
      }
    }
    setTasks(old => old.map(item => item.id === id
      ? {
          ...item,
          completed: completing,
          reminderId: completing ? undefined : item.reminderId,
          reminderIds: completing ? undefined : item.reminderIds,
          dueDate: completing ? undefined : item.dueDate,
        }
      : item));
    return true;
  }, [tasks, storageUnlocked, ready, activeUserId, userId]);
  const removeTask = useCallback(async (id: string) => {
    if (!storageUnlocked || !ready || activeUserId !== userId || !userId) return;
    const task = tasks.find(item => item.id === id);
    if (!task) return;
    const notificationState = await getNotificationState(userId);
    const sourcePrefix = "task:" + id + ":lead:";
    const linkedIds = new Set([
      ...(task.reminderIds ?? (task.reminderId ? [task.reminderId] : [])),
      ...notificationState.reminders
        .filter(item => item.sourceKey?.startsWith(sourcePrefix))
        .map(item => item.id),
    ]);
    for (const reminderId of linkedIds) await cancelReminder(userId, reminderId);
    setTasks(old => old.filter(item => item.id !== id));
  }, [tasks, storageUnlocked, ready, activeUserId, userId]);

  const setTaskReminder = useCallback((id: string, reminderIds: string[], dueDate: string) => {
    if (!storageUnlocked || !ready || activeUserId !== userId) return;
    setTasks(old => old.map(item => item.id === id
      ? { ...item, reminderIds, reminderId: reminderIds[0], dueDate, completed: false }
      : item));
  }, [storageUnlocked, ready, activeUserId, userId]);
  const addHabit = useCallback((title: string) => {
    if (!storageUnlocked || !ready || activeUserId !== userId) return;
    const value = title.trim();
    if (value) setHabits(old => [{ id: uid(), title: value, createdAt: new Date().toISOString(), archived: false }, ...old]);
  }, [storageUnlocked, ready, activeUserId, userId]);
  const toggleHabitToday = useCallback(async (id: string) => {
    if (!storageUnlocked || !ready || activeUserId !== userId) return false;
    const key = id + ":" + today();
    const alreadyDone = completions.includes(key);
    if (!alreadyDone && userId) {
      const habit = habits.find(item => item.id === id);
      if (!habit) return false;
      const reminderState = await getNotificationState(userId);
      const parentIds = new Set([
        ...(habit.reminderIds ?? (habit.reminderId ? [habit.reminderId] : [])),
        ...reminderState.reminders
          .filter(item => item.sourceKey?.startsWith("habit:" + id + ":"))
          .map(item => item.id),
      ]);
      for (const reminderId of parentIds) {
        await cancelSnoozesForReminder(userId, reminderId);
      }
    }
    setCompletions(old => old.includes(key) ? old.filter(x => x !== key) : [...old, key]);
    return true;
  }, [completions, habits, storageUnlocked, ready, activeUserId, userId]);

  const addRoutine = useCallback((title: string, steps: RoutineStep[]) => {
    if (!storageUnlocked || !ready || activeUserId !== userId) return;
    const value = title.trim();
    const validSteps = steps.filter(step =>
      typeof step.title === "string" && step.title.trim().length > 0 &&
      Number.isInteger(step.durationMinutes) && step.durationMinutes >= 1 && step.durationMinutes <= 240,
    ).slice(0, 12);
    if (!value || validSteps.length === 0) return;
    setRoutines(old => [{
      id: uid(),
      title: value.slice(0, 80),
      steps: validSteps.map(step => ({ ...step, id: step.id || uid(), title: step.title.trim().slice(0, 80) })),
      createdAt: new Date().toISOString(),
    }, ...old]);
  }, [storageUnlocked, ready, activeUserId, userId]);
  const setRoutineSchedule = useCallback((id: string, reminderIds: string[], startAt: string) => {
    if (!storageUnlocked || !ready || activeUserId !== userId) return;
    setRoutines(old => old.map(item => item.id === id
      ? { ...item, reminderIds, scheduledStartAt: startAt }
      : item));
  }, [storageUnlocked, ready, activeUserId, userId]);
  const completeRoutine = useCallback(async (id: string) => {
    if (!storageUnlocked || !ready || activeUserId !== userId || !userId) return false;
    const routine = routines.find(item => item.id === id);
    if (!routine) return false;
    try {
      const notificationState = await getNotificationState(userId);
      const sourcePrefix = "routine:" + id + ":";
      const linkedIds = new Set([
        ...(routine.reminderIds ?? []),
        ...notificationState.reminders
          .filter(item => item.sourceKey?.startsWith(sourcePrefix))
          .map(item => item.id),
      ]);
      for (const reminderId of linkedIds) await cancelReminder(userId, reminderId);
      setRoutines(old => old.map(item => item.id === id
        ? { ...item, reminderIds: undefined, scheduledStartAt: undefined }
        : item));
      return true;
    } catch (error) {
      setStorageError(error instanceof Error ? "Routine reminders could not be cancelled: " + error.message : "Routine reminders could not be cancelled.");
      return false;
    }
  }, [routines, storageUnlocked, ready, activeUserId, userId]);

  const removeRoutine = useCallback(async (id: string) => {
    if (!storageUnlocked || !ready || activeUserId !== userId) return;
    const routine = routines.find(item => item.id === id);
    if (!routine) return;
    if (userId) {
      const notificationState = await getNotificationState(userId);
      const sourcePrefix = "routine:" + id + ":";
      const linkedIds = new Set([
        ...(routine.reminderIds ?? []),
        ...notificationState.reminders
          .filter(item => item.sourceKey?.startsWith(sourcePrefix))
          .map(item => item.id),
      ]);
      for (const reminderId of linkedIds) {
        await cancelReminder(userId, reminderId);
      }
    }
    setRoutines(old => old.filter(item => item.id !== id));
  }, [routines, storageUnlocked, ready, activeUserId, userId]);

  const setHabitReminder = useCallback((id: string, reminderIds: string[] | null, reminderTime?: string, reminderDays?: number[]) => {
    if (!storageUnlocked || !ready || activeUserId !== userId) return;
    setHabits(old => old.map(item => item.id === id
      ? { ...item, reminderIds: reminderIds ?? undefined, reminderId: reminderIds?.[0], reminderTime: reminderIds?.length ? reminderTime : undefined, reminderDays: reminderIds?.length ? reminderDays : undefined }
      : item));
  }, [storageUnlocked, ready, activeUserId, userId]);

  const canEdit = ready && storageUnlocked && activeUserId === userId;
  const value = useMemo(() => ({ tasks, habits, routines, completions, ready, storageError, canEdit, addTask, toggleTask, removeTask, setTaskReminder, addHabit, toggleHabitToday, setHabitReminder, addRoutine, setRoutineSchedule, removeRoutine, completeRoutine }), [tasks, habits, routines, completions, ready, storageError, canEdit, addTask, toggleTask, removeTask, setTaskReminder, addHabit, toggleHabitToday, setHabitReminder, addRoutine, setRoutineSchedule, removeRoutine, completeRoutine]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
export function useAppStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useAppStore must be used inside AppStoreProvider");
  return value;
}
export const todayKey = today;
