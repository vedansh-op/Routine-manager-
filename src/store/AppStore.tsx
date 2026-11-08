import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { getEncryptedItem, initializeUserKeyForFreshInstall, setEncryptedItem } from "@/lib/secureLocalStore";
import { inspectLocalEncryptedData } from "@/lib/keyRecoveryRegistry";
import { classifyRecoveryBootstrapState } from "@/lib/keyRecoveryState";
import { migrateLegacyRecordForUser } from "@/lib/legacyMigration";

export type Task = { id: string; title: string; notes?: string; dueDate?: string; completed: boolean; createdAt: string };
export type Habit = { id: string; title: string; createdAt: string; archived: boolean };
type Store = {
  tasks: Task[];
  habits: Habit[];
  completions: string[];
  ready: boolean;
  storageError: string | null;
  canEdit: boolean;
  addTask: (title: string) => void;
  toggleTask: (id: string) => void;
  addHabit: (title: string) => void;
  toggleHabitToday: (id: string) => void;
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
        const bootstrapState = classifyRecoveryBootstrapState(dataInventory);
        if (bootstrapState === "fresh-candidate") {
          await initializeUserKeyForFreshInstall(userId);
        } else if (bootstrapState !== "ready") {
          throw new Error(
            bootstrapState === "recover-existing"
              ? "Encrypted local data exists but its key is missing or invalid. Your data has been preserved; account recovery is required before continuing."
              : "Local security storage could not be verified. Your data has been left unchanged; please try again or contact support.",
          );
        }

        const scopedKey = keyForUser(userId);
        let raw = await getEncryptedItem(scopedKey, userId);
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
            );
            await AsyncStorage.setItem(migratedKey(userId), "1");
          }
        }
        if (cancelled) return;
        if (raw) {
          const data = JSON.parse(raw);
          setTasks(Array.isArray(data.tasks) ? data.tasks : []);
          setHabits(Array.isArray(data.habits) ? data.habits : []);
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
    setEncryptedItem(keyForUser(userId), userId, JSON.stringify({ tasks, habits, completions })).catch(error => {
      setStorageError(error instanceof Error ? error.message : "Could not encrypt local data.");
      setStorageUnlocked(false);
    });
  }, [tasks, habits, completions, ready, storageUnlocked, userId, activeUserId]);

  const addTask = useCallback((title: string) => {
    if (!storageUnlocked || !ready || activeUserId !== userId) return;
    const value = title.trim();
    if (value) setTasks(old => [{ id: uid(), title: value, completed: false, createdAt: new Date().toISOString() }, ...old]);
  }, [storageUnlocked, ready, activeUserId, userId]);
  const toggleTask = useCallback((id: string) => { if (!storageUnlocked || !ready || activeUserId !== userId) return; setTasks(old => old.map(t => t.id === id ? { ...t, completed: !t.completed } : t)); }, [storageUnlocked, ready, activeUserId, userId]);
  const addHabit = useCallback((title: string) => {
    if (!storageUnlocked || !ready || activeUserId !== userId) return;
    const value = title.trim();
    if (value) setHabits(old => [{ id: uid(), title: value, createdAt: new Date().toISOString(), archived: false }, ...old]);
  }, [storageUnlocked, ready, activeUserId, userId]);
  const toggleHabitToday = useCallback((id: string) => {
    if (!storageUnlocked || !ready || activeUserId !== userId) return;
    const key = id + ":" + today();
    setCompletions(old => old.includes(key) ? old.filter(x => x !== key) : [...old, key]);
  }, [storageUnlocked, ready, activeUserId, userId]);

  const canEdit = ready && storageUnlocked && activeUserId === userId;
  const value = useMemo(() => ({ tasks, habits, completions, ready, storageError, canEdit, addTask, toggleTask, addHabit, toggleHabitToday }), [tasks, habits, completions, ready, storageError, canEdit, addTask, toggleTask, addHabit, toggleHabitToday]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
export function useAppStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useAppStore must be used inside AppStoreProvider");
  return value;
}
export const todayKey = today;
