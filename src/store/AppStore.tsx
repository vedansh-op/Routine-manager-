import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { ensureDeviceCryptoKey } from "@/lib/deviceCrypto";
import { getEncryptedItem, setEncryptedItem } from "@/lib/secureLocalStore";

export type Task = { id: string; title: string; notes?: string; dueDate?: string; completed: boolean; createdAt: string };
export type Habit = { id: string; title: string; createdAt: string; archived: boolean };
type Store = {
  tasks: Task[];
  habits: Habit[];
  completions: string[];
  ready: boolean;
  storageError: string | null;
  addTask: (title: string) => void;
  toggleTask: (id: string) => void;
  addHabit: (title: string) => void;
  toggleHabitToday: (id: string) => void;
};
const LEGACY_KEY = "one-os-v1";
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

  // Presence is server-observed only. An offline device updates this when it next reconnects and foregrounds ONE-OS.
  useEffect(() => {
    if (!userId || !supabase) return;
    const client = supabase;
    let active = true;
    const heartbeat = async () => {
      if (!active) return;
      const { error } = await client.rpc("touch_my_presence");
      if (error && active) console.info("ONE-OS presence sync unavailable:", error.message);
    };
    void heartbeat();
    void ensureDeviceCryptoKey(userId).catch(error => {
      if (active) console.info("ONE-OS device-key registration unavailable:", error instanceof Error ? error.message : error);
    });
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void heartbeat();
    });
    // Keep a foreground app alive for the server-side 72-hour inactivity clock.
    const heartbeatInterval = setInterval(() => {
      if (AppState.currentState === "active") void heartbeat();
    }, 15 * 60 * 1000);
    return () => {
      active = false;
      subscription.remove();
      clearInterval(heartbeatInterval);
    };
  }, [userId]);

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
        const scopedKey = keyForUser(userId);
        let raw = await getEncryptedItem(scopedKey, userId);
        if (!raw) {
          const alreadyMigrated = await AsyncStorage.getItem(migratedKey(userId));
          if (!alreadyMigrated) {
            const legacy = await AsyncStorage.getItem(LEGACY_KEY);
            if (legacy) {
              raw = legacy;
              await setEncryptedItem(scopedKey, userId, legacy);
              await AsyncStorage.removeItem(LEGACY_KEY);
            }
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
    const value = title.trim();
    if (value) setTasks(old => [{ id: uid(), title: value, completed: false, createdAt: new Date().toISOString() }, ...old]);
  }, []);
  const toggleTask = useCallback((id: string) => setTasks(old => old.map(t => t.id === id ? { ...t, completed: !t.completed } : t)), []);
  const addHabit = useCallback((title: string) => {
    const value = title.trim();
    if (value) setHabits(old => [{ id: uid(), title: value, createdAt: new Date().toISOString(), archived: false }, ...old]);
  }, []);
  const toggleHabitToday = useCallback((id: string) => {
    const key = id + ":" + today();
    setCompletions(old => old.includes(key) ? old.filter(x => x !== key) : [...old, key]);
  }, []);

  const value = useMemo(() => ({ tasks, habits, completions, ready, storageError, addTask, toggleTask, addHabit, toggleHabitToday }), [tasks, habits, completions, ready, storageError, addTask, toggleTask, addHabit, toggleHabitToday]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
export function useAppStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useAppStore must be used inside AppStoreProvider");
  return value;
}
export const todayKey = today;
