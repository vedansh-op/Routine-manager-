import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { getEncryptedItem, setEncryptedItem } from "@/lib/secureLocalStore";

export const NOTIFICATION_CATEGORIES = [
  "task",
  "habit",
  "routine",
  "calendar",
  "focus",
  "briefing",
  "shared",
  "travel",
  "system",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type RepeatRule =
  | { kind: "once"; date: string }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number };

export type Reminder = {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  route?: string;
  sourceKey?: string;
  parentReminderId?: string;
  repeat: RepeatRule;
  notificationId: string | null;
  enabled: boolean;
  completed: boolean;
  createdAt: string;
};

export type QuietHours = {
  enabled: boolean;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
};

export type NotificationHistoryEntry = {
  id: string;
  reminderId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  event: "received" | "opened" | "snoozed" | "completed";
  occurredAt: string;
};

export type NotificationSettings = {
  enabled: boolean;
  sound: boolean;
  vibration: boolean;
  calendarLeadMinutes: number;
  categoryEnabled: Record<NotificationCategory, boolean>;
  quietHours: QuietHours;
};

type NotificationState = {
  reminders: Reminder[];
  history: NotificationHistoryEntry[];
  settings: NotificationSettings;
};

export type ReminderDraft = {
  category: NotificationCategory;
  title: string;
  body?: string;
  route?: string;
  sourceKey?: string;
  repeat: RepeatRule;
};

const STORAGE_PREFIX = "one-os-notifications-v1:";
const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  sound: true,
  vibration: true,
  calendarLeadMinutes: 15,
  categoryEnabled: {
    task: true,
    habit: true,
    routine: true,
    calendar: true,
    focus: true,
    briefing: true,
    shared: true,
    travel: true,
    system: true,
  },
  quietHours: {
    enabled: false,
    startHour: 22,
    startMinute: 0,
    endHour: 7,
    endMinute: 0,
  },
};

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  task: "Tasks",
  habit: "Habits",
  routine: "Routines",
  calendar: "Calendar",
  focus: "Focus",
  briefing: "Daily briefings",
  shared: "Shared space",
  travel: "Travel",
  system: "ONE-OS updates",
};

const makeId = () =>
  "rem_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);

function storageKey(userId: string) {
  return STORAGE_PREFIX + userId;
}

function isCategory(value: unknown): value is NotificationCategory {
  return typeof value === "string" && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

function isValidClock(hour: number, minute: number) {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 &&
    Number.isInteger(minute) && minute >= 0 && minute <= 59;
}

function isQuietTime(date: Date, quiet: QuietHours) {
  if (!quiet.enabled) return false;
  const current = date.getHours() * 60 + date.getMinutes();
  const start = quiet.startHour * 60 + quiet.startMinute;
  const end = quiet.endHour * 60 + quiet.endMinute;
  if (start === end) return false;
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

function moveAfterQuietHours(date: Date, quiet: QuietHours) {
  if (!isQuietTime(date, quiet)) return date;
  const next = new Date(date);
  next.setHours(quiet.endHour, quiet.endMinute, 0, 0);
  if (next.getTime() <= date.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

function defaultState(): NotificationState {
  return { reminders: [], history: [], settings: DEFAULT_SETTINGS };
}

function normalizeState(value: unknown): NotificationState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultState();
  const source = value as Partial<NotificationState>;
  const rawSettings = source.settings as Partial<NotificationSettings> | undefined;
  const rawCategories = rawSettings?.categoryEnabled as Partial<Record<NotificationCategory, boolean>> | undefined;
  const rawQuiet = rawSettings?.quietHours as Partial<QuietHours> | undefined;
  const history = Array.isArray(source.history)
    ? source.history.filter((item): item is NotificationHistoryEntry => {
        if (!item || typeof item !== "object") return false;
        const row = item as Partial<NotificationHistoryEntry>;
        return typeof row.id === "string" && typeof row.reminderId === "string" &&
          isCategory(row.category) && typeof row.title === "string" &&
          typeof row.body === "string" &&
          (row.event === "received" || row.event === "opened" || row.event === "snoozed" || row.event === "completed") &&
          typeof row.occurredAt === "string" && Number.isFinite(Date.parse(row.occurredAt));
      }).slice(0, 100)
    : [];
  const reminders = Array.isArray(source.reminders)
    ? source.reminders.filter((item): item is Reminder => {
        if (!item || typeof item !== "object") return false;
        const row = item as Partial<Reminder>;
        return typeof row.id === "string" && isCategory(row.category) &&
          typeof row.title === "string" && typeof row.body === "string" &&
          (row.sourceKey === undefined || typeof row.sourceKey === "string") &&
          (row.parentReminderId === undefined || typeof row.parentReminderId === "string") &&
          typeof row.enabled === "boolean" && typeof row.completed === "boolean" &&
          (row.notificationId === null || typeof row.notificationId === "string") &&
          Boolean(row.repeat && typeof row.repeat === "object");
      })
    : [];
  return {
    reminders,
    history,
    settings: {
      enabled: rawSettings?.enabled !== false,
      sound: rawSettings?.sound !== false,
      vibration: rawSettings?.vibration !== false,
      calendarLeadMinutes: [5, 10, 15, 30, 60, 120].includes(rawSettings?.calendarLeadMinutes ?? 15) ? rawSettings?.calendarLeadMinutes ?? 15 : 15,
      categoryEnabled: {
        task: rawCategories?.task !== false,
        habit: rawCategories?.habit !== false,
        routine: rawCategories?.routine !== false,
        calendar: rawCategories?.calendar !== false,
        focus: rawCategories?.focus !== false,
        briefing: rawCategories?.briefing !== false,
        shared: rawCategories?.shared !== false,
        travel: rawCategories?.travel !== false,
        system: rawCategories?.system !== false,
      },
      quietHours: {
        enabled: rawQuiet?.enabled === true,
        startHour: Number.isInteger(rawQuiet?.startHour) && rawQuiet!.startHour! >= 0 && rawQuiet!.startHour! <= 23 ? rawQuiet!.startHour! : 22,
        startMinute: Number.isInteger(rawQuiet?.startMinute) && rawQuiet!.startMinute! >= 0 && rawQuiet!.startMinute! <= 59 ? rawQuiet!.startMinute! : 0,
        endHour: Number.isInteger(rawQuiet?.endHour) && rawQuiet!.endHour! >= 0 && rawQuiet!.endHour! <= 23 ? rawQuiet!.endHour! : 7,
        endMinute: Number.isInteger(rawQuiet?.endMinute) && rawQuiet!.endMinute! >= 0 && rawQuiet!.endMinute! <= 59 ? rawQuiet!.endMinute! : 0,
      },
    },
  };
}

let notificationQueue: Promise<void> = Promise.resolve();

async function withNotificationQueue<T>(work: () => Promise<T>): Promise<T> {
  const previous = notificationQueue;
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  notificationQueue = current;
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
  }
}

async function loadState(userId: string): Promise<NotificationState> {
  const stored = await getEncryptedItem(storageKey(userId), userId);
  if (!stored) return defaultState();
  try {
    return normalizeState(JSON.parse(stored));
  } catch {
    throw new Error("Notification settings are unreadable. Existing encrypted data was left unchanged.");
  }
}

async function saveState(userId: string, state: NotificationState) {
  await setEncryptedItem(storageKey(userId), userId, JSON.stringify(state));
}

function channelId(category: NotificationCategory, settings: NotificationSettings) {
  return [
    "oneos",
    category,
    settings.sound ? "sound" : "silent",
    settings.vibration ? "vibrate" : "still",
  ].join("-");
}

async function ensureNotificationChannels(settings: NotificationSettings) {
  if (Platform.OS !== "android") return;
  for (const category of NOTIFICATION_CATEGORIES) {
    const id = channelId(category, settings);
    await Notifications.setNotificationChannelAsync(id, {
      name: CATEGORY_LABELS[category],
      description: CATEGORY_LABELS[category] + " reminders from ONE-OS",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: settings.vibration ? [0, 250, 120, 250] : undefined,
      sound: settings.sound ? "default" : null,
      lightColor: "#A99CFF",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }
}

export async function initializeNotificationChannels() {
  await ensureNotificationChannels(DEFAULT_SETTINGS);
}

export async function requestNotificationPermission() {
  await initializeNotificationChannels();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return current;
  return Notifications.requestPermissionsAsync();
}

export async function getNotificationPermission() {
  await initializeNotificationChannels();
  return Notifications.getPermissionsAsync();
}

export async function reconcileScheduledNotifications(userId: string | null) {
  return withNotificationQueue(async () => {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  const owned = new Map<string, Notifications.NotificationRequest>();
  for (const request of pending) {
    const data = request.content.data as { userId?: unknown; reminderId?: unknown } | undefined;
    if (!userId || data?.userId !== userId) {
      await Notifications.cancelScheduledNotificationAsync(request.identifier).catch(() => undefined);
      continue;
    }
    if (typeof data.reminderId === "string") {
      if (owned.has(data.reminderId)) {
        await Notifications.cancelScheduledNotificationAsync(request.identifier).catch(() => undefined);
      } else {
        owned.set(data.reminderId, request);
      }
    }
  }
  if (!userId) return;

  const state = await loadState(userId);
  await ensureNotificationChannels(state.settings);
  const permission = await Notifications.getPermissionsAsync();
  let changed = false;
  for (const reminder of state.reminders) {
    const existing = owned.get(reminder.id);
    const shouldSchedule = permission.granted && state.settings.enabled &&
      state.settings.categoryEnabled[reminder.category] && reminder.enabled && !reminder.completed;
    if (!shouldSchedule) {
      if (existing) {
        await Notifications.cancelScheduledNotificationAsync(existing.identifier).catch(() => undefined);
        owned.delete(reminder.id);
      }
      if (reminder.notificationId !== null) {
        reminder.notificationId = null;
        changed = true;
      }
      continue;
    }
    if (existing) {
      if (reminder.notificationId !== existing.identifier) {
        reminder.notificationId = existing.identifier;
        changed = true;
      }
      owned.delete(reminder.id);
      continue;
    }
    if (reminder.repeat.kind === "once" && new Date(reminder.repeat.date).getTime() <= Date.now()) {
      reminder.notificationId = null;
      reminder.enabled = false;
      changed = true;
      continue;
    }
    try {
      const nextId = await scheduleNative(userId, reminder, state.settings);
      if (reminder.notificationId !== nextId) {
        reminder.notificationId = nextId;
        changed = true;
      }
    } catch {
      if (reminder.notificationId !== null) {
        reminder.notificationId = null;
        changed = true;
      }
    }
  }
  // Any remaining app-owned scheduled alerts have no encrypted reminder
  // record, so they are stale and must not continue firing.
  for (const request of owned.values()) {
    await Notifications.cancelScheduledNotificationAsync(request.identifier).catch(() => undefined);
  }
  if (changed) await saveState(userId, state);
  });
}

export async function getNotificationState(userId: string) {
  return withNotificationQueue(async () => {
  const state = await loadState(userId);
  await ensureNotificationChannels(state.settings);
  return state;
  });
}

function buildTrigger(repeat: RepeatRule, settings: NotificationSettings, category: NotificationCategory) {
  const channel = channelId(category, settings);
  if (repeat.kind === "once") {
    const date = new Date(repeat.date);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
      throw new Error("Choose a reminder time in the future.");
    }
    const adjusted = moveAfterQuietHours(date, settings.quietHours);
    return {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: adjusted,
      channelId: channel,
    } satisfies Notifications.NotificationTriggerInput;
  }
  if (!isValidClock(repeat.hour, repeat.minute)) throw new Error("The reminder time is invalid.");
  const probe = new Date();
  probe.setHours(repeat.hour, repeat.minute, 0, 0);
  if (isQuietTime(probe, settings.quietHours)) {
    throw new Error("That repeat time falls inside quiet hours. Choose a time outside quiet hours.");
  }
  if (repeat.kind === "daily") {
    return {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: repeat.hour,
      minute: repeat.minute,
      channelId: channel,
    } satisfies Notifications.NotificationTriggerInput;
  }
  if (!Number.isInteger(repeat.weekday) || repeat.weekday < 1 || repeat.weekday > 7) {
    throw new Error("Choose a valid weekday for this reminder.");
  }
  return {
    type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
    weekday: repeat.weekday,
    hour: repeat.hour,
    minute: repeat.minute,
    channelId: channel,
  } satisfies Notifications.NotificationTriggerInput;
}

async function scheduleNative(userId: string, reminder: Reminder, settings: NotificationSettings) {
  if (!settings.enabled || !settings.categoryEnabled[reminder.category] || !reminder.enabled || reminder.completed) {
    return null;
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) throw new Error("Notification permission is off. Enable it in notification settings first.");
  const trigger = buildTrigger(reminder.repeat, settings, reminder.category);
  return Notifications.scheduleNotificationAsync({
    content: {
      title: reminder.title,
      body: reminder.body,
      sound: settings.sound,
      priority: Notifications.AndroidNotificationPriority.HIGH,
      categoryIdentifier: "oneos_reminder",
      data: {
        userId,
        reminderId: reminder.id,
        category: reminder.category,
        sourceKey: reminder.sourceKey,
        parentReminderId: reminder.parentReminderId,
        repeatKind: reminder.repeat.kind,
        route: reminder.route ?? "/notifications",
      },
    },
    trigger,
  });
}

export async function scheduleReminder(userId: string, draft: ReminderDraft) {
  return withNotificationQueue(async () => {
  const title = draft.title.trim();
  if (!title) throw new Error("Enter a reminder title.");
  if (title.length > 90) throw new Error("Keep reminder titles under 90 characters.");
  if (!isCategory(draft.category)) throw new Error("Choose a valid reminder category.");
  const body = (draft.body ?? "").trim().slice(0, 240);
  const state = await loadState(userId);
  if (!state.settings.enabled || !state.settings.categoryEnabled[draft.category]) {
    throw new Error("This notification category is switched off in your settings.");
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) throw new Error("Notification permission is off. Enable it first.");
  await ensureNotificationChannels(state.settings);
  if (draft.sourceKey && draft.sourceKey.length > 180) throw new Error("Reminder source key is too long.");
  const existing = draft.sourceKey
    ? state.reminders.find(item => item.sourceKey === draft.sourceKey)
    : undefined;
  const reminder: Reminder = {
    id: existing?.id ?? makeId(),
    category: draft.category,
    title,
    body,
    route: draft.route,
    sourceKey: draft.sourceKey,
    repeat: draft.repeat,
    notificationId: null,
    enabled: true,
    completed: false,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  const notificationId = await scheduleNative(userId, reminder, state.settings);
  reminder.notificationId = notificationId;
  const staleSnoozes = existing
    ? state.reminders.filter(item => item.parentReminderId === existing.id)
    : [];
  state.reminders = [
    reminder,
    ...state.reminders.filter(item =>
      item.id !== reminder.id && item.parentReminderId !== reminder.id,
    ),
  ].slice(0, 200);
  try {
    await saveState(userId, state);
  } catch (error) {
    if (notificationId) await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined);
    throw error;
  }
  if (existing?.notificationId && existing.notificationId !== notificationId) {
    await Notifications.cancelScheduledNotificationAsync(existing.notificationId).catch(() => undefined);
  }
  for (const snoozed of staleSnoozes) {
    if (snoozed.notificationId) {
      await Notifications.cancelScheduledNotificationAsync(snoozed.notificationId).catch(() => undefined);
    }
  }
  return reminder;
  });
}

export async function cancelReminder(userId: string, reminderId: string) {
  return withNotificationQueue(async () => {
    const state = await loadState(userId);
    const targetIds = new Set([
      reminderId,
      ...state.reminders.filter(item => item.parentReminderId === reminderId).map(item => item.id),
    ]);
    for (const reminder of state.reminders) {
      if (targetIds.has(reminder.id) && reminder.notificationId) {
        await Notifications.cancelScheduledNotificationAsync(reminder.notificationId).catch(() => undefined);
      }
    }
    state.reminders = state.reminders.filter(item => !targetIds.has(item.id));
    await saveState(userId, state);
  });
}

export async function completeReminder(userId: string, reminderId: string) {
  return withNotificationQueue(async () => {
    const state = await loadState(userId);
    const reminder = state.reminders.find(item => item.id === reminderId);
    if (!reminder) return;
    const childReminders = state.reminders.filter(item => item.parentReminderId === reminderId);
    for (const item of [reminder, ...childReminders]) {
      if (item.notificationId) await Notifications.cancelScheduledNotificationAsync(item.notificationId).catch(() => undefined);
      item.notificationId = null;
      item.enabled = false;
      item.completed = true;
    }
    await saveState(userId, state);
  });
}

export async function cancelSnoozesForReminder(userId: string, reminderId: string) {
  return withNotificationQueue(async () => {
    const state = await loadState(userId);
    const snoozes = state.reminders.filter(item => item.parentReminderId === reminderId);
    for (const item of snoozes) {
      if (item.notificationId) await Notifications.cancelScheduledNotificationAsync(item.notificationId).catch(() => undefined);
    }
    state.reminders = state.reminders.filter(item => item.parentReminderId !== reminderId);
    await saveState(userId, state);
  });
}

export async function snoozeReminder(userId: string, reminderId: string, minutes = 10) {
  return withNotificationQueue(async () => {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) throw new Error("Snooze duration is invalid.");
  const state = await loadState(userId);
  const reminder = state.reminders.find(item => item.id === reminderId);
  if (!reminder || reminder.completed) return;

  // Keep a recurring source reminder intact. Snoozing creates a separate
  // one-off alert; a one-time source is paused only after the snooze is saved.
  const isOneTime = reminder.repeat.kind === "once";
  const oldId = reminder.notificationId;
  const snoozed: Reminder = {
    ...reminder,
    id: makeId(),
    sourceKey: undefined,
    parentReminderId: reminder.parentReminderId ?? reminder.id,
    repeat: { kind: "once", date: new Date(Date.now() + minutes * 60_000).toISOString() },
    notificationId: null,
    enabled: true,
    completed: false,
    createdAt: new Date().toISOString(),
  };
  snoozed.notificationId = await scheduleNative(userId, snoozed, state.settings);
  if (isOneTime) {
    reminder.notificationId = null;
    reminder.enabled = false;
    reminder.completed = true;
  }
  state.reminders = [snoozed, ...state.reminders].slice(0, 200);
  try {
    await saveState(userId, state);
  } catch (error) {
    if (snoozed.notificationId) await Notifications.cancelScheduledNotificationAsync(snoozed.notificationId).catch(() => undefined);
    throw error;
  }
  if (isOneTime && oldId) await Notifications.cancelScheduledNotificationAsync(oldId).catch(() => undefined);
  });
}

export async function updateNotificationSettings(
  userId: string,
  patch: Partial<Omit<NotificationSettings, "categoryEnabled" | "quietHours">> & {
    categoryEnabled?: Partial<Record<NotificationCategory, boolean>>;
    quietHours?: Partial<QuietHours>;
  },
) {
  return withNotificationQueue(async () => {
    const state = await loadState(userId);
    const oldSettings = state.settings;
    state.settings = {
      ...oldSettings,
      ...patch,
      categoryEnabled: { ...oldSettings.categoryEnabled, ...patch.categoryEnabled },
      quietHours: { ...oldSettings.quietHours, ...patch.quietHours },
    };
    await ensureNotificationChannels(state.settings);
    const permission = await Notifications.getPermissionsAsync();
    if (permission.granted) {
      for (const reminder of state.reminders) {
        const oldId = reminder.notificationId;
        if (oldId) {
          await Notifications.cancelScheduledNotificationAsync(oldId).catch(() => undefined);
          reminder.notificationId = null;
        }
        if (reminder.enabled && !reminder.completed) {
          try {
            const newId = await scheduleNative(userId, reminder, state.settings);
            reminder.notificationId = newId;
          } catch {
            reminder.notificationId = null;
          }
        }
      }
    }
    await saveState(userId, state);
    return state;
  });
}

export async function recordNotificationHistory(
  userId: string,
  entry: Omit<NotificationHistoryEntry, "id" | "occurredAt"> & { occurredAt?: string },
) {
  return withNotificationQueue(async () => {
    const state = await loadState(userId);
    const id = makeId();
    state.history = [{
      ...entry,
      id,
      occurredAt: entry.occurredAt ?? new Date().toISOString(),
    }, ...state.history].slice(0, 100);
    await saveState(userId, state);
  });
}

export async function listEnabledReminderCategories(userId: string) {
  return withNotificationQueue(async () => {
  const state = await loadState(userId);
  return NOTIFICATION_CATEGORIES.filter(category =>
    state.settings.enabled && state.settings.categoryEnabled[category],
  );
  });
}

export function getNotificationCategoryLabel(category: NotificationCategory) {
  return CATEGORY_LABELS[category];
}

export function configureNotificationResponseActions() {
  void Notifications.setNotificationCategoryAsync("oneos_reminder", [
    {
      identifier: "SNOOZE_10",
      buttonTitle: "Snooze 10 min",
      options: { opensAppToForeground: false },
    },
    {
      identifier: "DONE",
      buttonTitle: "Done",
      options: { opensAppToForeground: false },
    },
    {
      identifier: "OPEN",
      buttonTitle: "Open",
      options: { opensAppToForeground: true },
    },
  ]);
}
