import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Task = { id: string; title: string; notes?: string; dueDate?: string; completed: boolean; createdAt: string };
export type Habit = { id: string; title: string; createdAt: string; archived: boolean };
type Store = {
  tasks: Task[];
  habits: Habit[];
  completions: string[];
  ready: boolean;
  addTask: (title: string) => void;
  toggleTask: (id: string) => void;
  addHabit: (title: string) => void;
  toggleHabitToday: (id: string) => void;
};
const KEY = "one-os-v1";
const StoreContext = createContext<Store | null>(null);
const today = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
};
const uid = () => Math.random().toString(36).slice(2, 10);

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [completions, setCompletions] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then(raw => {
      if (raw) {
        const data = JSON.parse(raw);
        setTasks(Array.isArray(data.tasks) ? data.tasks : []);
        setHabits(Array.isArray(data.habits) ? data.habits : []);
        setCompletions(Array.isArray(data.completions) ? data.completions : []);
      }
    }).catch(() => {}).finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (ready) AsyncStorage.setItem(KEY, JSON.stringify({ tasks, habits, completions })).catch(() => {});
  }, [tasks, habits, completions, ready]);

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

  const value = useMemo(() => ({ tasks, habits, completions, ready, addTask, toggleTask, addHabit, toggleHabitToday }), [tasks, habits, completions, ready, addTask, toggleTask, addHabit, toggleHabitToday]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
export function useAppStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useAppStore must be used inside AppStoreProvider");
  return value;
}
export const todayKey = today;
