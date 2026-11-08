import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useAuth } from "@/auth/AuthProvider";
import { useAppStore, todayKey } from "@/store/AppStore";
import { cancelReminder, getNotificationState, requestNotificationPermission, scheduleReminder } from "@/lib/notifications";

const dayOptions = [
  { weekday: 1, label: "Sun" },
  { weekday: 2, label: "Mon" },
  { weekday: 3, label: "Tue" },
  { weekday: 4, label: "Wed" },
  { weekday: 5, label: "Thu" },
  { weekday: 6, label: "Fri" },
  { weekday: 7, label: "Sat" },
];

function reminderClock(value?: string) {
  const match = value?.match(/^(\d{2}):(\d{2})$/);
  const date = new Date();
  if (match) date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  else date.setHours(20, 0, 0, 0);
  return date;
}

function daysLabel(days?: number[]) {
  if (!days || days.length === 7) return "Every day";
  return dayOptions.filter(item => days.includes(item.weekday)).map(item => item.label).join(", ");
}

export default function Habits() {
  const { user } = useAuth();
  const { habits, completions, addHabit, toggleHabitToday, setHabitReminder, canEdit, storageError } = useAppStore();
  const [title, setTitle] = useState("");
  const [busyHabitId, setBusyHabitId] = useState<string | null>(null);
  const [selectedDaysByHabit, setSelectedDaysByHabit] = useState<Record<string, number[]>>({});

  function daysFor(habitId: string, savedDays?: number[]) {
    return selectedDaysByHabit[habitId] ?? savedDays ?? [1, 2, 3, 4, 5, 6, 7];
  }

  function toggleDay(habitId: string, day: number, savedDays?: number[]) {
    setSelectedDaysByHabit(old => {
      const current = old[habitId] ?? savedDays ?? [1, 2, 3, 4, 5, 6, 7];
      const next = current.includes(day) ? current.filter(value => value !== day) : [...current, day];
      return { ...old, [habitId]: next.sort((a, b) => a - b) };
    });
  }

  async function checkInHabit(habitId: string) {
    const saved = await toggleHabitToday(habitId);
    if (!saved) {
      Alert.alert("Couldn't update habit", storageError ?? "Please try again.");
    }
  }

  async function saveHabitReminder(habitId: string, hour: number, minute: number) {
    if (!user?.id || !canEdit) return;
    const habit = habits.find(item => item.id === habitId);
    if (!habit) return;
    const chosenDays = [...daysFor(habitId, habit.reminderDays)].sort((a, b) => a - b);
    if (!chosenDays.length) {
      Alert.alert("Choose at least one day", "Select the days when this habit reminder should repeat.");
      return;
    }
    setBusyHabitId(habitId);
    try {
      const permission = await requestNotificationPermission();
      if (!permission.granted) {
        Alert.alert("Notifications are off", "Allow ONE-OS notifications in Android settings, then try again.");
        return;
      }

      const prefix = "habit:" + habit.id + ":";
      const selectedKeys = new Set<string>();
      if (chosenDays.length === 7) {
        const sourceKey = prefix + "daily";
        await scheduleReminder(user.id, {
          category: "habit",
          title: "Habit check-in: " + habit.title,
          body: "A small step still counts. Check in when you're ready.",
          route: "/habits",
          sourceKey,
          repeat: { kind: "daily", hour, minute },
        });
        selectedKeys.add(sourceKey);
      } else {
        for (const weekday of chosenDays) {
          const sourceKey = prefix + "weekday:" + weekday;
          await scheduleReminder(user.id, {
            category: "habit",
            title: "Habit check-in: " + habit.title,
            body: "A small step still counts. Check in when you're ready.",
            route: "/habits",
            sourceKey,
            repeat: { kind: "weekly", weekday, hour, minute },
          });
          selectedKeys.add(sourceKey);
        }
      }

      const current = await getNotificationState(user.id);
      const related = current.reminders.filter(item => item.sourceKey?.startsWith(prefix));
      const activeIds: string[] = [];
      for (const reminder of related) {
        if (reminder.sourceKey && selectedKeys.has(reminder.sourceKey)) {
          activeIds.push(reminder.id);
        } else {
          await cancelReminder(user.id, reminder.id);
        }
      }
      const previousIds = habit.reminderIds ?? (habit.reminderId ? [habit.reminderId] : []);
      for (const previousId of previousIds) {
        if (!activeIds.includes(previousId)) await cancelReminder(user.id, previousId).catch(() => undefined);
      }
      setHabitReminder(
        habit.id,
        activeIds,
        String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0"),
        chosenDays,
      );
    } catch (error) {
      Alert.alert("Couldn't set habit reminder", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusyHabitId(null);
    }
  }

  function chooseReminderTime(habitId: string) {
    const habit = habits.find(item => item.id === habitId);
    const value = reminderClock(habit?.reminderTime);
    DateTimePickerAndroid.open({
      value,
      mode: "time",
      is24Hour: false,
      onChange: (event, selected) => {
        if (event.type !== "set" || !selected) return;
        void saveHabitReminder(habitId, selected.getHours(), selected.getMinutes());
      },
    });
  }

  async function removeHabitReminder(habitId: string) {
    if (!user?.id) return;
    const habit = habits.find(item => item.id === habitId);
    if (!habit) return;
    const ids = habit.reminderIds ?? (habit.reminderId ? [habit.reminderId] : []);
    if (!ids.length) return;
    setBusyHabitId(habitId);
    try {
      for (const id of ids) await cancelReminder(user.id, id);
      setHabitReminder(habitId, null);
    } catch (error) {
      Alert.alert("Couldn't remove habit reminder", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusyHabitId(null);
    }
  }

  return <ScrollView style={s.page} contentContainerStyle={s.body}>
    <Link href="/" style={s.back}>←  Home</Link>
    <Text style={s.heading}>Habits</Text>
    <Text style={s.sub}>Consistency over intensity. Choose the days and time for each check-in.</Text>
    <View style={s.form}>
      <TextInput value={title} onChangeText={setTitle} editable={canEdit} onSubmitEditing={() => { addHabit(title); setTitle(""); }} placeholder="Name a habit…" placeholderTextColor="#777d8c" style={s.input} />
      <Pressable disabled={!canEdit} style={[s.add, !canEdit && s.disabled]} onPress={() => { addHabit(title); setTitle(""); }}>
        <Text style={s.addText}>Add</Text>
      </Pressable>
    </View>
    {!canEdit ? <Text style={s.sub}>{storageError ? "Editing is paused to protect your saved data. " + storageError : "Preparing secure local storage…"}</Text> : null}
    {habits.length === 0 ? <Text style={s.empty}>Start with one small habit.</Text> : habits.filter(h => !h.archived).map(h => {
      const done = completions.includes(h.id + ":" + todayKey());
      const chosenDays = daysFor(h.id, h.reminderDays);
      const reminderCount = h.reminderIds?.length ?? (h.reminderId ? 1 : 0);
      return <View key={h.id} style={s.item}>
        <Pressable disabled={!canEdit} onPress={() => { void checkInHabit(h.id); }} style={s.habitToggle}>
          <View style={[s.check, done && s.checked]}><Text style={s.tick}>{done ? "✓" : ""}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.task}>{h.title}</Text>
            <Text style={s.today}>{done ? "DONE TODAY" : "TODAY"}</Text>
            {h.reminderTime ? <Text style={s.reminderTime}>{daysLabel(h.reminderDays)} · {reminderClock(h.reminderTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {reminderCount} alert{reminderCount === 1 ? "" : "s"}</Text> : null}
          </View>
        </Pressable>
        <View style={s.reminderControls}>
          <Text style={s.dayLabel}>REPEAT DAYS</Text>
          <View style={s.days}>
            {dayOptions.map(day => <Pressable key={day.weekday} onPress={() => toggleDay(h.id, day.weekday, h.reminderDays)} style={[s.day, chosenDays.includes(day.weekday) && s.dayActive]}>
              <Text style={[s.dayText, chosenDays.includes(day.weekday) && s.dayTextActive]}>{day.label}</Text>
            </Pressable>)}
          </View>
          <View style={s.actions}>
            <Pressable disabled={!canEdit || Boolean(busyHabitId)} style={s.reminderButton} onPress={() => chooseReminderTime(h.id)}>
              <Text style={s.reminderButtonText}>{busyHabitId === h.id ? "…" : h.reminderId ? "Save alert" : "Set alert"}</Text>
            </Pressable>
            {h.reminderId ? <Pressable disabled={Boolean(busyHabitId)} onPress={() => void removeHabitReminder(h.id)}><Text style={s.remove}>Remove</Text></Pressable> : null}
          </View>
        </View>
      </View>;
    })}
    <Link href="/notifications" style={s.settingsLink}>Notification settings →</Link>
    <Text style={s.footer}>A habit reminder repeats on your chosen days. Checking off a habit records your progress; future repeat alerts stay scheduled until changed or removed.</Text>
  </ScrollView>;
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor:"#101216"},body:{padding:24,paddingTop:54,paddingBottom:48},
  back:{color:"#a99cff",marginBottom:28},heading:{color:"#f4f2ff",fontSize:36,fontWeight:"700"},
  sub:{color:"#9699a5",marginTop:7,lineHeight:19},form:{flexDirection:"row",gap:8,marginTop:26},
  input:{flex:1,backgroundColor:"#1a1d24",borderRadius:12,padding:15,color:"#fff"},
  add:{backgroundColor:"#a99cff",borderRadius:12,paddingHorizontal:20,justifyContent:"center"},
  addText:{color:"#171421",fontWeight:"700"},empty:{color:"#777d8c",marginTop:28},
  item:{backgroundColor:"#1a1d24",padding:14,borderRadius:13,marginTop:10},
  habitToggle:{flexDirection:"row",gap:12,alignItems:"center"},check:{width:23,height:23,borderRadius:8,borderWidth:1,borderColor:"#79718f",alignItems:"center",justifyContent:"center"},
  checked:{backgroundColor:"#a99cff",borderColor:"#a99cff"},tick:{color:"#171421",fontWeight:"800"},
  task:{color:"#eee",fontSize:14,flex:1},today:{color:"#9699a5",fontSize:9,letterSpacing:1,marginTop:4},
  reminderTime:{color:"#a99cff",fontSize:9,marginTop:4},reminderControls:{marginTop:14,borderTopWidth:1,borderTopColor:"#303440",paddingTop:12},
  dayLabel:{color:"#9699a5",fontSize:9,fontWeight:"800",letterSpacing:1},days:{flexDirection:"row",gap:6,marginTop:9},
  day:{flex:1,alignItems:"center",paddingVertical:8,borderRadius:9,borderWidth:1,borderColor:"#414554"},
  dayActive:{backgroundColor:"#302b47",borderColor:"#a99cff"},dayText:{color:"#b7bac5",fontSize:9,fontWeight:"800"},dayTextActive:{color:"#d4ceff"},
  actions:{flexDirection:"row",alignItems:"center",gap:15,marginTop:12},reminderButton:{backgroundColor:"#302b47",borderRadius:9,paddingHorizontal:12,paddingVertical:9},
  reminderButtonText:{color:"#d4ceff",fontSize:10,fontWeight:"800"},remove:{color:"#ff9eae",fontSize:10,fontWeight:"800"},
  disabled:{opacity:0.45},settingsLink:{color:"#c7bfff",marginTop:22,fontSize:12,fontWeight:"700"},
  footer:{color:"#686e7b",fontSize:10,lineHeight:16,marginTop:22},
});
