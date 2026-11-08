import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useAuth } from "@/auth/AuthProvider";
import { useAppStore, todayKey } from "@/store/AppStore";
import { cancelReminder, requestNotificationPermission, scheduleReminder } from "@/lib/notifications";

function reminderClock(value?: string) {
  const match = value?.match(/^(\d{2}):(\d{2})$/);
  const date = new Date();
  if (match) date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  else date.setHours(20, 0, 0, 0);
  return date;
}

export default function Habits() {
  const { user } = useAuth();
  const { habits, completions, addHabit, toggleHabitToday, setHabitReminder, canEdit, storageError } = useAppStore();
  const [title, setTitle] = useState("");
  const [busyHabitId, setBusyHabitId] = useState<string | null>(null);

  async function saveDailyReminder(habitId: string, hour: number, minute: number) {
    if (!user?.id || !canEdit) return;
    const habit = habits.find(item => item.id === habitId);
    if (!habit) return;
    setBusyHabitId(habitId);
    try {
      const permission = await requestNotificationPermission();
      if (!permission.granted) {
        Alert.alert("Notifications are off", "Allow ONE-OS notifications in Android settings, then try again.");
        return;
      }
      const next = await scheduleReminder(user.id, {
        category: "habit",
        title: "Habit check-in: " + habit.title,
        body: "A small step still counts. Check in when you're ready.",
        route: "/habits",
        repeat: { kind: "daily", hour, minute },
      });
      setHabitReminder(habit.id, next.id, String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0"));
      if (habit.reminderId) await cancelReminder(user.id, habit.reminderId).catch(() => undefined);
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
        void saveDailyReminder(habitId, selected.getHours(), selected.getMinutes());
      },
    });
  }

  async function removeDailyReminder(habitId: string) {
    if (!user?.id) return;
    const habit = habits.find(item => item.id === habitId);
    if (!habit?.reminderId) return;
    setBusyHabitId(habitId);
    try {
      await cancelReminder(user.id, habit.reminderId);
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
    <Text style={s.sub}>Consistency over intensity. Add a daily alert to make check-ins easier.</Text>
    <View style={s.form}>
      <TextInput value={title} onChangeText={setTitle} editable={canEdit} onSubmitEditing={() => { addHabit(title); setTitle(""); }} placeholder="Name a habit…" placeholderTextColor="#777d8c" style={s.input} />
      <Pressable disabled={!canEdit} style={[s.add, !canEdit && s.disabled]} onPress={() => { addHabit(title); setTitle(""); }}>
        <Text style={s.addText}>Add</Text>
      </Pressable>
    </View>
    {!canEdit ? <Text style={s.sub}>{storageError ? "Editing is paused to protect your saved data. " + storageError : "Preparing secure local storage…"}</Text> : null}
    {habits.length === 0 ? <Text style={s.empty}>Start with one small habit.</Text> : habits.filter(h => !h.archived).map(h => {
      const done = completions.includes(h.id + ":" + todayKey());
      return <View key={h.id} style={s.item}>
        <Pressable key={h.id + "-toggle"} disabled={!canEdit} onPress={() => toggleHabitToday(h.id)} style={s.habitToggle}>
          <View style={[s.check, done && s.checked]}><Text style={s.tick}>{done ? "✓" : ""}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.task}>{h.title}</Text>
            <Text style={s.today}>{done ? "DONE TODAY" : "TODAY"}</Text>
            {h.reminderTime ? <Text style={s.reminderTime}>Daily reminder · {reminderClock(h.reminderTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text> : null}
          </View>
        </Pressable>
        <Pressable disabled={!canEdit || Boolean(busyHabitId)} style={s.reminderButton} onPress={() => chooseReminderTime(h.id)}>
          <Text style={s.reminderButtonText}>{busyHabitId === h.id ? "…" : h.reminderId ? "Change" : "Set alert"}</Text>
        </Pressable>
        {h.reminderId ? <Pressable disabled={Boolean(busyHabitId)} onPress={() => void removeDailyReminder(h.id)}><Text style={s.remove}>×</Text></Pressable> : null}
      </View>;
    })}
    <Link href="/notifications" style={s.settingsLink}>Notification settings →</Link>
    <Text style={s.footer}>Daily habit reminders repeat at the selected local time until you remove or change them. Completing today's habit does not cancel future daily reminders.</Text>
  </ScrollView>;
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor:"#101216"},body:{padding:24,paddingTop:54,paddingBottom:48},
  back:{color:"#a99cff",marginBottom:28},heading:{color:"#f4f2ff",fontSize:36,fontWeight:"700"},
  sub:{color:"#9699a5",marginTop:7,lineHeight:19},form:{flexDirection:"row",gap:8,marginTop:26},
  input:{flex:1,backgroundColor:"#1a1d24",borderRadius:12,padding:15,color:"#fff"},
  add:{backgroundColor:"#a99cff",borderRadius:12,paddingHorizontal:20,justifyContent:"center"},
  addText:{color:"#171421",fontWeight:"700"},empty:{color:"#777d8c",marginTop:28},
  item:{flexDirection:"row",gap:9,alignItems:"center",backgroundColor:"#1a1d24",padding:14,borderRadius:13,marginTop:10},
  habitToggle:{flex:1,flexDirection:"row",gap:12,alignItems:"center"},check:{width:23,height:23,borderRadius:8,borderWidth:1,borderColor:"#79718f",alignItems:"center",justifyContent:"center"},
  checked:{backgroundColor:"#a99cff",borderColor:"#a99cff"},tick:{color:"#171421",fontWeight:"800"},
  task:{color:"#eee",fontSize:14,flex:1},today:{color:"#9699a5",fontSize:9,letterSpacing:1,marginTop:4},
  reminderTime:{color:"#a99cff",fontSize:9,marginTop:4},reminderButton:{backgroundColor:"#302b47",borderRadius:9,paddingHorizontal:10,paddingVertical:8},
  reminderButtonText:{color:"#d4ceff",fontSize:10,fontWeight:"800"},remove:{color:"#ff9eae",fontSize:19,paddingHorizontal:3},
  disabled:{opacity:0.45},settingsLink:{color:"#c7bfff",marginTop:22,fontSize:12,fontWeight:"700"},
  footer:{color:"#686e7b",fontSize:10,lineHeight:16,marginTop:22},
});
