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

export type NotificationSettings = {
  enabled: boolean;
  sound: boolean;
  vibration: boolean;
  categoryEnabled: Record<NotificationCategory, boolean>;
  quietHours: QuietHours;
};

type NotificationState = {
  reminders: Reminder[];
  settings: NotificationSettings;
};

export type ReminderDraft = {
  category: NotificationCategory;
  title: string;
  body?: string;
  route?: string;
  repeat: RepeatRule;
};

const STORAGE_PREFIX = "one-os-notifications-v1:";
const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  sound: true,
  vibration: true,
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
  return { reminders: [], settings: DEFAULT_SETTINGS };
}

function normalizeState(value: unknown): NotificationState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultState();
  const source = value as Partial<NotificationState>;
  const rawSettings = source.settings as Partial<NotificationSettings> | undefined;
  const rawCategories = rawSettings?.categoryEnabled as Partial<Record<NotificationCategory, boolean>> | undefined;
  const rawQuiet = rawSettings?.quietHours as Partial<QuietHours> | undefined;
  const reminders = Array.isArray(source.reminders)
    ? source.reminders.filter((item): item is Reminder => {
        if (!item || typeof item !== "object") return false;
        const row = item as Partial<Reminder>;
        return typeof row.id === "string" && isCategory(row.category) &&
          typeof row.title === "string" && typeof row.body === "string" &&
          typeof row.enabled === "boolean" && typeof row.completed === "boolean" &&
          (row.notificationId === null || typeof row.notificationId === "string") &&
          Boolean(row.repeat && typeof row.repeat === "object");
      })
    : [];
  return {
    reminders,
    settings: {
      enabled: rawSettings?.enabled !== false,
      sound: rawSettings?.sound !== false,
      vibration: rawSettings?.vibration !== false,
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

export async function initializeNotificationChannels() {
  if (Platform.OS !== "android") return;
  const state = defaultState();
  for (const category of NOTIFICATION_CATEGORIES) {
    const id = channelId(category, state.settings);
    await Notifications.setNotificationChannelAsync(id, {
      name: CATEGORY_LABELS[category],
      description: CATEGORY_LABELS[category] + " reminders from ONE-OS",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: state.settings.vibration ? [0, 250, 120, 250] : [],
      sound: state.settings.sound ? "default" : null,
      lightColor: "#A99CFF",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }
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

export async function getNotificationState(userId: string) {
  return loadState(userId);
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
        route: reminder.route ?? "/notifications",
      },
    },
    trigger,
  });
}

export async function scheduleReminder(userId: string, draft: ReminderDraft) {
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
  const reminder: Reminder = {
    id: makeId(),
    category: draft.category,
    title,
    body,
    route: draft.route,
    repeat: draft.repeat,
    notificationId: null,
    enabled: true,
    completed: false,
    createdAt: new Date().toISOString(),
  };
  const notificationId = await scheduleNative(userId, reminder, state.settings);
  reminder.notificationId = notificationId;
  state.reminders = [reminder, ...state.reminders].slice(0, 200);
  try {
    await saveState(userId, state);
  } catch (error) {
    if (notificationId) await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined);
    throw error;
  }
  return reminder;
}

export async function cancelReminder(userId: string, reminderId: string) {
  const state = await loadState(userId);
  const reminder = state.reminders.find(item => item.id === reminderId);
  if (!reminder) return;
  if (reminder.notificationId) await Notifications.cancelScheduledNotificationAsync(reminder.notificationId);
  state.reminders = state.reminders.filter(item => item.id !== reminderId);
  await saveState(userId, state);
}

export async function completeReminder(userId: string, reminderId: string) {
  const state = await loadState(userId);
  const reminder = state.reminders.find(item => item.id === reminderId);
  if (!reminder) return;
  if (reminder.notificationId) await Notifications.cancelScheduledNotificationAsync(reminder.notificationId);
  reminder.notificationId = null;
  reminder.completed = true;
  reminder.enabled = false;
  await saveState(userId, state);
}

export async function snoozeReminder(userId: string, reminderId: string, minutes = 10) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) throw new Error("Snooze duration is invalid.");
  const state = await loadState(userId);
  const reminder = state.reminders.find(item => item.id === reminderId);
  if (!reminder || reminder.completed) return;
  const oldId = reminder.notificationId;
  reminder.repeat = { kind: "once", date: new Date(Date.now() + minutes * 60_000).toISOString() };
  reminder.enabled = true;
  reminder.notificationId = null;
  const nextId = await scheduleNative(userId, reminder, state.settings);
  reminder.notificationId = nextId;
  await saveState(userId, state);
  if (oldId && oldId !== nextId) await Notifications.cancelScheduledNotificationAsync(oldId).catch(() => undefined);
}

export async function updateNotificationSettings(
  userId: string,
  patch: Partial<Omit<NotificationSettings, "categoryEnabled" | "quietHours">> & {
    categoryEnabled?: Partial<Record<NotificationCategory, boolean>>;
    quietHours?: Partial<QuietHours>;
  },
) {
  const state = await loadState(userId);
  const oldSettings = state.settings;
  state.settings = {
    ...oldSettings,
    ...patch,
    categoryEnabled: { ...oldSettings.categoryEnabled, ...patch.categoryEnabled },
    quietHours: { ...oldSettings.quietHours, ...patch.quietHours },
  };
  const permission = await Notifications.getPermissionsAsync();
  if (permission.granted) {
    const replacements: Array<{ reminder: Reminder; oldId: string | null; newId: string | null }> = [];
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
          replacements.push({ reminder, oldId, newId });
        } catch {
          reminder.notificationId = null;
        }
      }
    }
  }
  await saveState(userId, state);
  if (Platform.OS === "android") {
    for (const category of NOTIFICATION_CATEGORIES) {
      const id = channelId(category, state.settings);
      await Notifications.setNotificationChannelAsync(id, {
        name: CATEGORY_LABELS[category],
        description: CATEGORY_LABELS[category] + " reminders from ONE-OS",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: state.settings.vibration ? [0, 250, 120, 250] : [],
        sound: state.settings.sound ? "default" : null,
        lightColor: "#A99CFF",
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }
  }
  return state;
}

export async function listEnabledReminderCategories(userId: string) {
  const state = await loadState(userId);
  return NOTIFICATION_CATEGORIES.filter(category =>
    state.settings.enabled && state.settings.categoryEnabled[category],
  );
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
