import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useAuth } from "@/auth/AuthProvider";
import { useAppStore } from "@/store/AppStore";
import { replaceReminderSet } from "@/lib/notifications";

const leadOptions = [
  { minutes: 60, label: "1h before" },
  { minutes: 30, label: "30m before" },
  { minutes: 15, label: "15m before" },
  { minutes: 5, label: "5m before" },
  { minutes: 0, label: "At due time" },
  { minutes: -60, label: "1h after due" },
];

export default function Tasks() {
  const { user } = useAuth();
  const { tasks, addTask, toggleTask, removeTask, setTaskReminder, canEdit, storageError } = useAppStore();
  const [title, setTitle] = useState("");
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [selectedLeadTimes, setSelectedLeadTimes] = useState<number[]>([0]);

  function toggleLeadTime(minutes: number) {
    setSelectedLeadTimes(old => old.includes(minutes)
      ? old.filter(value => value !== minutes)
      : [...old, minutes]);
  }

  async function createTaskReminders(taskId: string, dueAt: Date) {
    if (!user?.id || !canEdit) return;
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;
    if (dueAt.getTime() <= Date.now()) {
      Alert.alert("Choose a future due time", "Task alerts must be scheduled before the task is due.");
      return;
    }

    setSchedulingId(taskId);
    const selectedOffsets = [...selectedLeadTimes].sort((a, b) => b - a);
    try {
      let skippedPastLead = false;
      const drafts = selectedOffsets.flatMap(minutes => {
        const alertAt = new Date(dueAt.getTime() - minutes * 60_000);
        if (alertAt.getTime() <= Date.now()) {
          skippedPastLead = true;
          return [];
        }
        return [{
          category: "task" as const,
          title: task.title,
          body: minutes === 0
            ? "This task is due now."
            : minutes < 0
              ? "This task is overdue by " + (Math.abs(minutes) >= 60 ? Math.abs(minutes) / 60 + " hour" : Math.abs(minutes) + " minutes") + "."
              : "This task is due in " + (minutes >= 60 ? minutes / 60 + " hour" + (minutes === 60 ? "" : "s") : minutes + " minutes") + ".",
          route: "/tasks",
          sourceKey: "task:" + task.id + ":lead:" + minutes,
          repeat: { kind: "once" as const, date: alertAt.toISOString() },
        }];
      });
      const created = await replaceReminderSet(user.id, "task:" + task.id + ":lead:", drafts);
      const activeIds = created.map(item => item.id);
      setTaskReminder(task.id, activeIds, dueAt.toISOString());

      if (skippedPastLead) {
        Alert.alert("Some early alerts were skipped", "A selected lead-time had already passed. The remaining alerts were saved.");
      } else {
        Alert.alert("Task reminders saved", activeIds.length
          ? activeIds.length + " alert" + (activeIds.length === 1 ? "" : "s") + " linked to this task."
          : "No alerts selected. The task due time was saved without notifications.");
      }
    } catch (error) {
      Alert.alert("Couldn't save task reminders", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSchedulingId(null);
    }
  }

  function chooseReminderTime(taskId: string, date: Date) {
    DateTimePickerAndroid.open({
      value: date,
      mode: "time",
      is24Hour: false,
      onChange: (event, pickedTime) => {
        if (event.type !== "set" || !pickedTime) return;
        const next = new Date(date);
        next.setHours(pickedTime.getHours(), pickedTime.getMinutes(), 0, 0);
        void createTaskReminders(taskId, next);
      },
    });
  }

  function confirmDeleteTask(taskId: string) {
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;
    Alert.alert(
      "Delete this task?",
      "“" + task.title + "” and all of its scheduled alerts will be removed from this device.",
      [
        { text: "Keep task", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void removeTask(taskId).catch(error => {
              Alert.alert("Couldn't delete task", error instanceof Error ? error.message : "Its reminders could not be safely cancelled.");
            });
          },
        },
      ],
    );
  }

  function chooseReminderDate(taskId: string) {
    const task = tasks.find(item => item.id === taskId);
    const initial = task?.dueDate ? new Date(task.dueDate) : new Date(Date.now() + 60 * 60 * 1000);
    const safeInitial = initial.getTime() > Date.now() ? initial : new Date(Date.now() + 60 * 60 * 1000);
    DateTimePickerAndroid.open({
      value: safeInitial,
      mode: "date",
      minimumDate: new Date(),
      onChange: (event, pickedDate) => {
        if (event.type !== "set" || !pickedDate) return;
        const next = new Date(safeInitial);
        next.setFullYear(pickedDate.getFullYear(), pickedDate.getMonth(), pickedDate.getDate());
        chooseReminderTime(taskId, next);
      },
    });
  }

  return <ScrollView style={s.page} contentContainerStyle={s.body}>
    <Link href="/" style={s.back}>←  Home</Link>
    <Text style={s.heading}>Tasks</Text>
    <Text style={s.sub}>Turn intention into action. Choose one or more alerts before a task is due.</Text>
    <View style={s.form}>
      <TextInput value={title} onChangeText={setTitle} editable={canEdit} onSubmitEditing={() => { addTask(title); setTitle(""); }} placeholder="Add a task…" placeholderTextColor="#777d8c" style={s.input} />
      <Pressable disabled={!canEdit} style={[s.add, !canEdit && s.disabled]} onPress={() => { addTask(title); setTitle(""); }}>
        <Text style={s.addText}>Add</Text>
      </Pressable>
    </View>
    <Text style={s.label}>TASK ALERT LEAD-TIMES · SELECT MULTIPLE</Text>
    <View style={s.chips}>
      {leadOptions.map(option => <Pressable key={option.minutes} onPress={() => toggleLeadTime(option.minutes)} style={[s.chip, selectedLeadTimes.includes(option.minutes) && s.chipActive]}>
        <Text style={[s.chipText, selectedLeadTimes.includes(option.minutes) && s.chipTextActive]}>{option.label}</Text>
      </Pressable>)}
    </View>
    <Text style={s.hint}>The selected alert pattern applies when you set or change a task's due time.</Text>
    {!canEdit ? <Text style={s.sub}>{storageError ? "Editing is paused to protect your saved data. " + storageError : "Preparing secure local storage…"}</Text> : null}
    {tasks.length === 0 ? <Text style={s.empty}>Nothing here yet. Add your first task above.</Text> : tasks.map(task => {
      const reminderCount = task.reminderIds?.length ?? (task.reminderId ? 1 : 0);
      return <View key={task.id} style={s.item}>
        <Pressable disabled={!canEdit} onPress={() => void toggleTask(task.id)} style={s.taskToggle}>
          <Text style={s.check}>{task.completed ? "✓" : "○"}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.task, task.completed && s.done]}>{task.title}</Text>
            {task.dueDate && !task.completed ? <Text style={s.due}>Due · {new Date(task.dueDate).toLocaleString()} · {reminderCount} alert{reminderCount === 1 ? "" : "s"}</Text> : null}
          </View>
        </Pressable>
        {!task.completed ? <View style={s.rowActions}>
          <Pressable
            disabled={!canEdit || Boolean(schedulingId)}
            style={[s.remind, (!canEdit || Boolean(schedulingId)) && s.disabled]}
            onPress={() => chooseReminderDate(task.id)}
          >
            <Text style={s.remindText}>{schedulingId === task.id ? "…" : task.dueDate ? "Change alerts" : "Set due time"}</Text>
          </Pressable>
          <Pressable disabled={!canEdit || Boolean(schedulingId)} style={s.delete} onPress={() => confirmDeleteTask(task.id)}>
            <Text style={s.deleteText}>Delete</Text>
          </Pressable>
        </View> : <Pressable disabled={!canEdit} style={s.delete} onPress={() => confirmDeleteTask(task.id)}><Text style={s.deleteText}>Delete</Text></Pressable>}
      </View>;
    })}
    <Link href="/notifications" style={s.settingsLink}>Notification settings →</Link>
  </ScrollView>;
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor:"#101216"},body:{padding:24,paddingTop:54,paddingBottom:48},
  back:{color:"#a99cff",marginBottom:28},heading:{color:"#f4f2ff",fontSize:36,fontWeight:"700"},
  sub:{color:"#9699a5",marginTop:7,lineHeight:19},form:{flexDirection:"row",gap:8,marginTop:26},
  input:{flex:1,backgroundColor:"#1a1d24",borderRadius:12,padding:15,color:"#fff"},
  add:{backgroundColor:"#a99cff",borderRadius:12,paddingHorizontal:20,justifyContent:"center"},
  addText:{color:"#171421",fontWeight:"700"},empty:{color:"#777d8c",marginTop:28},
  label:{color:"#9699a5",fontSize:9,letterSpacing:1.2,fontWeight:"800",marginTop:22,marginBottom:9},
  chips:{flexDirection:"row",flexWrap:"wrap",gap:7},chip:{borderWidth:1,borderColor:"#414554",borderRadius:18,paddingHorizontal:11,paddingVertical:8},
  chipActive:{backgroundColor:"#b7adff",borderColor:"#b7adff"},chipText:{color:"#b7bac5",fontSize:10,fontWeight:"700"},chipTextActive:{color:"#171421"},
  hint:{color:"#858b98",fontSize:10,lineHeight:16,marginTop:9},item:{flexDirection:"row",gap:10,alignItems:"center",backgroundColor:"#1a1d24",padding:14,borderRadius:13,marginTop:10},
  taskToggle:{flex:1,flexDirection:"row",gap:12,alignItems:"center"},check:{color:"#a99cff",fontSize:18},
  task:{color:"#eee",fontSize:14,flex:1},done:{textDecorationLine:"line-through",color:"#777d8c"},
  due:{color:"#9f98d8",fontSize:9,marginTop:5},remind:{backgroundColor:"#302b47",borderRadius:9,paddingHorizontal:10,paddingVertical:9},
  remindText:{color:"#d4ceff",fontSize:10,fontWeight:"800"},rowActions:{gap:7,alignItems:"flex-end"},delete:{borderWidth:1,borderColor:"#62404a",borderRadius:9,paddingHorizontal:10,paddingVertical:8},deleteText:{color:"#ff9eae",fontSize:9,fontWeight:"800"},disabled:{opacity:0.45},
  settingsLink:{color:"#c7bfff",marginTop:22,fontSize:12,fontWeight:"700"},
});
