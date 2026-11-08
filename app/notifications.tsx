import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link } from "expo-router";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useAuth } from "@/auth/AuthProvider";
import { useAppStore } from "@/store/AppStore";
import {
  cancelReminder,
  getNotificationCategoryLabel,
  getNotificationPermission,
  getNotificationState,
  NOTIFICATION_CATEGORIES,
  NotificationCategory,
  NotificationSettings,
  NotificationHistoryEntry,
  Reminder,
  requestNotificationPermission,
  scheduleReminder,
  snoozeReminder,
  updateNotificationSettings,
} from "@/lib/notifications";

type RepeatMode = "once" | "daily" | "weekly";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function clockDate(hour: number, minute: number) {
  const value = new Date();
  value.setHours(hour, minute, 0, 0);
  return value;
}

function reminderTime(reminder: Reminder) {
  if (reminder.repeat.kind === "once") return new Date(reminder.repeat.date).toLocaleString();
  if (reminder.repeat.kind === "daily") {
    return "Every day · " + clockDate(reminder.repeat.hour, reminder.repeat.minute).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return "Every " + weekdays[reminder.repeat.weekday - 1] + " · " +
    clockDate(reminder.repeat.hour, reminder.repeat.minute).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function NotificationsScreen() {
  const { user } = useAuth();
  const { canEdit, storageError } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [permission, setPermission] = useState<boolean | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [history, setHistory] = useState<NotificationHistoryEntry[]>([]);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<NotificationCategory>("task");
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("once");
  const [weekday, setWeekday] = useState(() => new Date().getDay() + 1);
  const [scheduledAt, setScheduledAt] = useState(() => new Date(Date.now() + 60 * 60 * 1000));

  const refresh = useCallback(async () => {
    if (!user?.id || !canEdit) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [permissionState, localState] = await Promise.all([
        getNotificationPermission(),
        getNotificationState(user.id),
      ]);
      setPermission(permissionState.granted);
      setSettings(localState.settings);
      setReminders(localState.reminders);
      setHistory(localState.history);
    } catch (error) {
      Alert.alert("Notifications unavailable", error instanceof Error ? error.message : "Secure notification settings could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [user?.id, canEdit]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function enableNotifications() {
    setBusy(true);
    try {
      const result = await requestNotificationPermission();
      setPermission(result.granted);
      if (!result.granted) {
        Alert.alert("Permission not enabled", "Allow notifications for ONE-OS in Android settings to receive reminders.");
      }
    } catch (error) {
      Alert.alert("Couldn't enable notifications", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(patch: Parameters<typeof updateNotificationSettings>[1]) {
    if (!user?.id || !settings) return;
    setBusy(true);
    try {
      const next = await updateNotificationSettings(user.id, patch);
      setSettings(next.settings);
      setReminders(next.reminders);
      setHistory(next.history);
    } catch (error) {
      Alert.alert("Couldn't update settings", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDailyPrompt(kind: "morning" | "evening", hour: number, minute: number) {
    if (!user?.id) return;
    const isMorning = kind === "morning";
    setBusy(true);
    try {
      const reminder = await scheduleReminder(user.id, {
        category: "briefing",
        title: isMorning ? "Plan your day" : "Review your day",
        body: isMorning
          ? "Check today's tasks and habits, then choose your most important next step."
          : "Look back at what you completed and prepare tomorrow's priorities.",
        route: "/",
        sourceKey: "builtin:" + kind + "-planning",
        repeat: { kind: "daily", hour, minute },
      });
      setReminders(old => [reminder, ...old.filter(item => item.id !== reminder.id)].slice(0, 200));
    } catch (error) {
      Alert.alert("Couldn't save daily prompt", error instanceof Error ? error.message : "Check notification permissions and briefing settings.");
    } finally {
      setBusy(false);
    }
  }

  function chooseDailyPromptTime(kind: "morning" | "evening") {
    const key = "builtin:" + kind + "-planning";
    const current = reminders.find(item => item.sourceKey === key);
    const time = current?.repeat.kind === "daily"
      ? clockDate(current.repeat.hour, current.repeat.minute)
      : clockDate(kind === "morning" ? 8 : 20, 0);
    DateTimePickerAndroid.open({
      value: time,
      mode: "time",
      is24Hour: false,
      onChange: (event, selected) => {
        if (event.type !== "set" || !selected) return;
        void saveDailyPrompt(kind, selected.getHours(), selected.getMinutes());
      },
    });
  }

  async function disableDailyPrompt(kind: "morning" | "evening") {
    if (!user?.id) return;
    const key = "builtin:" + kind + "-planning";
    const reminder = reminders.find(item => item.sourceKey === key);
    if (!reminder) return;
    setBusy(true);
    try {
      await cancelReminder(user.id, reminder.id);
      setReminders(old => old.filter(item => item.id !== reminder.id));
    } catch (error) {
      Alert.alert("Couldn't turn off daily prompt", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function addReminder() {
    if (!user?.id) return;
    if (!title.trim()) {
      Alert.alert("Name your reminder", "Enter a short title first.");
      return;
    }
    if (permission !== true) {
      await enableNotifications();
      return;
    }
    setBusy(true);
    try {
      const repeat = repeatMode === "once"
        ? { kind: "once" as const, date: scheduledAt.toISOString() }
        : repeatMode === "daily"
          ? { kind: "daily" as const, hour: scheduledAt.getHours(), minute: scheduledAt.getMinutes() }
          : { kind: "weekly" as const, weekday, hour: scheduledAt.getHours(), minute: scheduledAt.getMinutes() };
      const reminder = await scheduleReminder(user.id, {
        category,
        title: title.trim(),
        body: body.trim(),
        route: category === "task" ? "/tasks" : category === "habit" ? "/habits" : category === "calendar" ? "/calendar" : "/notifications",
        repeat,
      });
      setReminders(old => [reminder, ...old].slice(0, 200));
      setTitle("");
      setBody("");
      Alert.alert("Reminder scheduled", "ONE-OS will notify this phone at the selected time. Android may delay delivery when battery restrictions apply.");
    } catch (error) {
      Alert.alert("Couldn't schedule reminder", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function pickDate() {
    DateTimePickerAndroid.open({
      value: scheduledAt,
      mode: "date",
      minimumDate: new Date(),
      onChange: (event, picked) => {
        if (event.type !== "set" || !picked) return;
        const next = new Date(scheduledAt);
        next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
        setScheduledAt(next);
      },
    });
  }

  function pickTime(target: "reminder" | "quiet-start" | "quiet-end") {
    const current = target === "quiet-start" && settings
      ? clockDate(settings.quietHours.startHour, settings.quietHours.startMinute)
      : target === "quiet-end" && settings
        ? clockDate(settings.quietHours.endHour, settings.quietHours.endMinute)
        : scheduledAt;
    DateTimePickerAndroid.open({
      value: current,
      mode: "time",
      is24Hour: false,
      onChange: (event, picked) => {
        if (event.type !== "set" || !picked) return;
        if (target === "reminder") {
          const next = new Date(scheduledAt);
          next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
          setScheduledAt(next);
          return;
        }
        if (!settings) return;
        if (target === "quiet-start") {
          void saveSettings({ quietHours: { startHour: picked.getHours(), startMinute: picked.getMinutes() } });
        } else {
          void saveSettings({ quietHours: { endHour: picked.getHours(), endMinute: picked.getMinutes() } });
        }
      },
    });
  }

  async function removeReminder(reminder: Reminder) {
    if (!user?.id) return;
    setBusy(true);
    try {
      await cancelReminder(user.id, reminder.id);
      setReminders(old => old.filter(item => item.id !== reminder.id));
    } catch (error) {
      Alert.alert("Couldn't remove reminder", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function snooze(reminder: Reminder) {
    if (!user?.id) return;
    setBusy(true);
    try {
      await snoozeReminder(user.id, reminder.id, 10);
      await refresh();
    } catch (error) {
      Alert.alert("Couldn't snooze reminder", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return <View style={s.page}><View style={s.content}><Link href="/" style={s.back}>←  Home</Link><Text style={s.heading}>Notifications</Text><Text style={s.muted}>{storageError ? "Secure local storage is locked. " + storageError : "Preparing your encrypted account storage…"}</Text></View></View>;
  }

  return <ScrollView style={s.page} contentContainerStyle={s.content}>
    <Link href="/" style={s.back}>←  Home</Link>
    <Text style={s.eyebrow}>YOUR PERSONAL ALERT SYSTEM</Text>
    <Text style={s.heading}>Notifications.</Text>
    <Text style={s.muted}>Private reminders are stored encrypted on this phone and are scheduled locally. They do not require a cloud connection.</Text>

    <View style={s.card}>
      <View style={s.rowBetween}>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle}>Android permission</Text>
          <Text style={s.mutedSmall}>{permission === true ? "Allowed on this device" : permission === false ? "Not allowed yet" : "Checking permission…"}</Text>
        </View>
        <Pressable disabled={busy} onPress={() => void enableNotifications()} style={s.button}>
          {busy ? <ActivityIndicator color="#171421" /> : <Text style={s.buttonText}>{permission ? "Check" : "Enable"}</Text>}
        </Pressable>
      </View>
      {permission === false ? <Text style={s.hint}>Android can block notifications until you approve the permission. You can also change it later in system settings.</Text> : null}
    </View>

    {settings ? <View style={s.card}>
      <Text style={s.cardTitle}>Notification controls</Text>
      <Pressable disabled={busy} onPress={() => void saveSettings({ enabled: !settings.enabled })} style={s.settingRow}>
        <View><Text style={s.settingTitle}>All notifications</Text><Text style={s.mutedSmall}>Master switch for scheduled reminders</Text></View>
        <Text style={[s.state, settings.enabled ? s.on : s.off]}>{settings.enabled ? "ON" : "OFF"}</Text>
      </Pressable>
      <Pressable disabled={busy} onPress={() => void saveSettings({ sound: !settings.sound })} style={s.settingRow}>
        <View><Text style={s.settingTitle}>Notification sound</Text><Text style={s.mutedSmall}>Uses your Android channel preferences</Text></View>
        <Text style={[s.state, settings.sound ? s.on : s.off]}>{settings.sound ? "ON" : "OFF"}</Text>
      </Pressable>
      <Pressable disabled={busy} onPress={() => void saveSettings({ vibration: !settings.vibration })} style={s.settingRow}>
        <View><Text style={s.settingTitle}>Vibration</Text><Text style={s.mutedSmall}>Vibration pattern for ONE-OS channels</Text></View>
        <Text style={[s.state, settings.vibration ? s.on : s.off]}>{settings.vibration ? "ON" : "OFF"}</Text>
      </Pressable>
      <Pressable disabled={busy} onPress={() => void saveSettings({ quietHours: { enabled: !settings.quietHours.enabled } })} style={s.settingRow}>
        <View><Text style={s.settingTitle}>Quiet hours</Text><Text style={s.mutedSmall}>One-time reminders move to the quiet-hours end</Text></View>
        <Text style={[s.state, settings.quietHours.enabled ? s.on : s.off]}>{settings.quietHours.enabled ? "ON" : "OFF"}</Text>
      </Pressable>
      <View style={s.timeRow}>
        <Pressable onPress={() => pickTime("quiet-start")} style={s.timeButton}><Text style={s.mutedSmall}>START</Text><Text style={s.timeValue}>{clockDate(settings.quietHours.startHour, settings.quietHours.startMinute).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text></Pressable>
        <Pressable onPress={() => pickTime("quiet-end")} style={s.timeButton}><Text style={s.mutedSmall}>END</Text><Text style={s.timeValue}>{clockDate(settings.quietHours.endHour, settings.quietHours.endMinute).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text></Pressable>
      </View>
      <Text style={s.label}>CATEGORIES</Text>
      {NOTIFICATION_CATEGORIES.map(item => <Pressable key={item} disabled={busy} onPress={() => void saveSettings({ categoryEnabled: { [item]: !settings.categoryEnabled[item] } })} style={s.settingRow}>
        <Text style={s.settingTitle}>{getNotificationCategoryLabel(item)}</Text>
        <Text style={[s.state, settings.categoryEnabled[item] ? s.on : s.off]}>{settings.categoryEnabled[item] ? "ON" : "OFF"}</Text>
      </Pressable>)}
    </View> : null}

    <View style={s.card}>
      <Text style={s.cardTitle}>Daily planning prompts</Text>
      <Text style={s.mutedSmall}>Simple daily nudges. They do not bypass quiet hours or Android notification settings.</Text>
      {(["morning", "evening"] as const).map(kind => {
        const key = "builtin:" + kind + "-planning";
        const current = reminders.find(item => item.sourceKey === key && item.enabled && !item.completed);
        return <View key={kind} style={s.settingRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.settingTitle}>{kind === "morning" ? "Morning planning" : "Evening review"}</Text>
            <Text style={s.mutedSmall}>{current ? reminderTime(current) : "Not scheduled"}</Text>
          </View>
          <Pressable disabled={busy} onPress={() => current ? void disableDailyPrompt(kind) : chooseDailyPromptTime(kind)}>
            <Text style={[s.state, current ? s.on : s.off]}>{current ? "TURN OFF" : "SET TIME"}</Text>
          </Pressable>
          {current ? <Pressable disabled={busy} onPress={() => chooseDailyPromptTime(kind)}><Text style={s.refresh}>Change</Text></Pressable> : null}
        </View>;
      })}
    </View>

    <View style={s.card}>
      <Text style={s.cardTitle}>Create a reminder</Text>
      <TextInput value={title} onChangeText={setTitle} maxLength={90} placeholder="What should ONE-OS remind you?" placeholderTextColor="#777d8c" style={s.input} />
      <TextInput value={body} onChangeText={setBody} maxLength={240} placeholder="Optional details" placeholderTextColor="#777d8c" style={s.input} />
      <Text style={s.label}>CATEGORY</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        {NOTIFICATION_CATEGORIES.filter(item => item !== "system").map(item => <Pressable key={item} onPress={() => setCategory(item)} style={[s.chip, category === item && s.chipActive]}><Text style={[s.chipText, category === item && s.chipTextActive]}>{getNotificationCategoryLabel(item)}</Text></Pressable>)}
      </ScrollView>
      <Text style={s.label}>REPEAT</Text>
      <View style={s.timeRow}>
        {(["once", "daily", "weekly"] as RepeatMode[]).map(mode => <Pressable key={mode} onPress={() => setRepeatMode(mode)} style={[s.timeButton, repeatMode === mode && s.timeButtonActive]}><Text style={[s.chipText, repeatMode === mode && s.chipTextActive]}>{mode === "once" ? "Once" : mode === "daily" ? "Daily" : "Weekly"}</Text></Pressable>)}
      </View>
      {repeatMode === "once" ? <Pressable onPress={pickDate} style={s.timeButton}><Text style={s.mutedSmall}>DATE</Text><Text style={s.timeValue}>{scheduledAt.toLocaleDateString()}</Text></Pressable> : null}
      <View style={s.timeRow}>
        <Pressable onPress={() => pickTime("reminder")} style={s.timeButton}><Text style={s.mutedSmall}>TIME</Text><Text style={s.timeValue}>{scheduledAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text></Pressable>
        {repeatMode === "weekly" ? <Pressable onPress={() => setWeekday(old => old % 7 + 1)} style={s.timeButton}><Text style={s.mutedSmall}>DAY</Text><Text style={s.timeValue}>{weekdays[weekday - 1]}</Text></Pressable> : null}
      </View>
      <Pressable disabled={busy || !settings?.enabled || permission === false} onPress={() => void addReminder()} style={[s.primary, (busy || !settings?.enabled || permission === false) && s.disabled]}>
        {busy ? <ActivityIndicator color="#171421" /> : <Text style={s.primaryText}>Schedule reminder</Text>}
      </Pressable>
      <Text style={s.hint}>Android may delay best-effort reminders during battery saving. Exact-alarm access is intentionally not requested for ordinary reminders.</Text>
    </View>

    <View style={s.card}>
      <View style={s.rowBetween}><Text style={s.cardTitle}>Scheduled reminders</Text><Pressable onPress={() => void refresh()}><Text style={s.refresh}>Refresh</Text></Pressable></View>
      {loading ? <ActivityIndicator color="#b7adff" /> : reminders.length === 0 ? <Text style={s.muted}>No reminders scheduled yet.</Text> : reminders.map(reminder => <View key={reminder.id} style={s.reminder}>
        <View style={{ flex: 1 }}>
          <Text style={s.reminderTitle}>{reminder.title}</Text>
          <Text style={s.mutedSmall}>{getNotificationCategoryLabel(reminder.category)} · {reminderTime(reminder)}</Text>
          {reminder.body ? <Text style={s.mutedSmall}>{reminder.body}</Text> : null}
          {reminder.completed ? <Text style={s.completed}>COMPLETED</Text> : reminder.enabled ? <Text style={s.scheduled}>SCHEDULED</Text> : <Text style={s.mutedSmall}>PAUSED</Text>}
        </View>
        {!reminder.completed ? <View style={s.reminderActions}>
          <Pressable disabled={busy} onPress={() => void snooze(reminder)}><Text style={s.action}>+10m</Text></Pressable>
          <Pressable disabled={busy} onPress={() => void removeReminder(reminder)}><Text style={s.remove}>Remove</Text></Pressable>
        </View> : null}
      </View>)}
    </View>

    <View style={s.card}>
      <Text style={s.cardTitle}>Recent notification activity</Text>
      {history.length === 0 ? <Text style={s.muted}>No notification activity recorded on this phone yet. Foreground deliveries and actions appear here.</Text> : history.slice(0, 12).map(entry => <View key={entry.id} style={s.historyRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.reminderTitle}>{entry.title}</Text>
          <Text style={s.mutedSmall}>{getNotificationCategoryLabel(entry.category)} · {new Date(entry.occurredAt).toLocaleString()}</Text>
        </View>
        <Text style={s.historyEvent}>{entry.event.toUpperCase()}</Text>
      </View>)}
    </View>

    <Text style={s.footer}>Local reminders work offline. Shared activity alerts, remote push, location triggers and automatic daily summaries need their later integration stages.</Text>
  </ScrollView>;
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor:"#101216"},content:{padding:22,paddingTop:56,paddingBottom:52},
  back:{color:"#c7bfff",fontSize:14,marginBottom:28},eyebrow:{color:"#9b8cff",fontSize:10,letterSpacing:2,fontWeight:"700"},
  heading:{color:"#f4f2ff",fontSize:38,fontWeight:"700",marginTop:12},muted:{color:"#9699a5",fontSize:12,lineHeight:19,marginTop:8},
  mutedSmall:{color:"#9699a5",fontSize:10,lineHeight:16},card:{backgroundColor:"#1a1d24",borderColor:"#2a2e38",borderWidth:1,borderRadius:18,padding:16,marginTop:15},
  rowBetween:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},cardTitle:{color:"#f4f2ff",fontSize:16,fontWeight:"700",marginBottom:10},
  button:{backgroundColor:"#b7adff",borderRadius:11,paddingHorizontal:16,paddingVertical:11,minWidth:76,alignItems:"center"},buttonText:{color:"#171421",fontWeight:"800",fontSize:12},
  hint:{color:"#858b98",fontSize:10,lineHeight:16,marginTop:10},settingRow:{minHeight:48,borderTopWidth:1,borderTopColor:"#2b303a",flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12,paddingVertical:8},
  settingTitle:{color:"#eeeafc",fontSize:12,fontWeight:"600"},state:{fontSize:10,fontWeight:"900",letterSpacing:1},on:{color:"#9bd8b1"},off:{color:"#ff9eae"},
  timeRow:{flexDirection:"row",gap:9,marginTop:10},timeButton:{flex:1,backgroundColor:"#11141a",borderColor:"#353947",borderWidth:1,borderRadius:11,padding:12,marginTop:8},
  timeValue:{color:"#f4f2ff",fontWeight:"700",fontSize:14,marginTop:5},label:{color:"#9699a5",fontSize:9,letterSpacing:1.4,fontWeight:"800",marginTop:18,marginBottom:7},
  input:{backgroundColor:"#101216",borderWidth:1,borderColor:"#3b3e4a",borderRadius:12,padding:14,color:"#f4f2ff",marginTop:10,fontSize:13},
  chips:{gap:8,paddingVertical:5},chip:{borderWidth:1,borderColor:"#414554",borderRadius:18,paddingHorizontal:12,paddingVertical:9},chipActive:{backgroundColor:"#b7adff",borderColor:"#b7adff"},
  chipText:{color:"#b7bac5",fontSize:11,fontWeight:"700"},chipTextActive:{color:"#171421"},timeButtonActive:{backgroundColor:"#302b47",borderColor:"#8e83d2"},
  primary:{backgroundColor:"#b7adff",borderRadius:12,padding:15,alignItems:"center",marginTop:16},primaryText:{color:"#171421",fontSize:13,fontWeight:"900"},
  disabled:{opacity:0.45},refresh:{color:"#c7bfff",fontSize:11,fontWeight:"700"},reminder:{flexDirection:"row",alignItems:"center",gap:10,paddingVertical:13,borderTopWidth:1,borderTopColor:"#2b303a"},
  reminderTitle:{color:"#f4f2ff",fontSize:13,fontWeight:"700"},reminderActions:{gap:12,alignItems:"flex-end"},action:{color:"#c7bfff",fontSize:11,fontWeight:"800"},remove:{color:"#ff9eae",fontSize:10,fontWeight:"800"},
  scheduled:{color:"#9bd8b1",fontSize:9,fontWeight:"800",marginTop:5},completed:{color:"#c7bfff",fontSize:9,fontWeight:"800",marginTop:5},
  historyRow:{flexDirection:"row",alignItems:"center",gap:10,paddingVertical:11,borderTopWidth:1,borderTopColor:"#2b303a"},historyEvent:{color:"#b7adff",fontSize:8,fontWeight:"900",letterSpacing:0.7},
  footer:{color:"#686e7b",fontSize:10,lineHeight:16,textAlign:"center",marginTop:24},
});
