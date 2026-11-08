import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useAuth } from "@/auth/AuthProvider";
import { useAppStore } from "@/store/AppStore";
import { cancelReminder, scheduleReminder } from "@/lib/notifications";

export default function Tasks() {
  const { user } = useAuth();
  const { tasks, addTask, toggleTask, setTaskReminder, canEdit, storageError } = useAppStore();
  const [title, setTitle] = useState("");
  const [schedulingId, setSchedulingId] = useState<string | null>(null);

  async function createTaskReminder(taskId: string, date: Date) {
    if (!user?.id || !canEdit) return;
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;
    setSchedulingId(taskId);
    try {
      const next = await scheduleReminder(user.id, {
        category: "task",
        title: task.title,
        body: "It's time for this task.",
        route: "/tasks",
        sourceKey: "task:" + task.id,
        repeat: { kind: "once", date: date.toISOString() },
      });
      if (task.reminderId && task.reminderId !== next.id) {
        try {
          await cancelReminder(user.id, task.reminderId);
        } catch (error) {
          await cancelReminder(user.id, next.id).catch(() => undefined);
          throw error;
        }
      }
      setTaskReminder(task.id, next.id, date.toISOString());
    } catch (error) {
      Alert.alert(
        "Couldn't set task reminder",
        error instanceof Error ? error.message : "Enable notifications and try again.",
      );
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
        if (next.getTime() <= Date.now()) {
          Alert.alert("Choose a future time", "The task reminder must be scheduled in the future.");
          return;
        }
        void createTaskReminder(taskId, next);
      },
    });
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
    <Text style={s.sub}>Turn intention into action. Set a reminder when a task needs a deadline.</Text>
    <View style={s.form}>
      <TextInput value={title} onChangeText={setTitle} editable={canEdit} onSubmitEditing={() => { addTask(title); setTitle(""); }} placeholder="Add a task…" placeholderTextColor="#777d8c" style={s.input} />
      <Pressable disabled={!canEdit} style={[s.add, !canEdit && s.disabled]} onPress={() => { addTask(title); setTitle(""); }}>
        <Text style={s.addText}>Add</Text>
      </Pressable>
    </View>
    {!canEdit ? <Text style={s.sub}>{storageError ? "Editing is paused to protect your saved data. " + storageError : "Preparing secure local storage…"}</Text> : null}
    {tasks.length === 0 ? <Text style={s.empty}>Nothing here yet. Add your first task above.</Text> : tasks.map(task =>
      <View key={task.id} style={s.item}>
        <Pressable disabled={!canEdit} onPress={() => toggleTask(task.id)} style={s.taskToggle}>
          <Text style={s.check}>{task.completed ? "✓" : "○"}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.task, task.completed && s.done]}>{task.title}</Text>
            {task.dueDate && !task.completed ? <Text style={s.due}>Reminder · {new Date(task.dueDate).toLocaleString()}</Text> : null}
          </View>
        </Pressable>
        {!task.completed ? <Pressable
          disabled={!canEdit || Boolean(schedulingId)}
          style={[s.remind, (!canEdit || Boolean(schedulingId)) && s.disabled]}
          onPress={() => chooseReminderDate(task.id)}
        >
          <Text style={s.remindText}>{schedulingId === task.id ? "…" : task.reminderId ? "Change alert" : "Remind me"}</Text>
        </Pressable> : null}
      </View>
    )}
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
  item:{flexDirection:"row",gap:10,alignItems:"center",backgroundColor:"#1a1d24",padding:14,borderRadius:13,marginTop:10},
  taskToggle:{flex:1,flexDirection:"row",gap:12,alignItems:"center"},check:{color:"#a99cff",fontSize:18},
  task:{color:"#eee",fontSize:14,flex:1},done:{textDecorationLine:"line-through",color:"#777d8c"},
  due:{color:"#9f98d8",fontSize:9,marginTop:5},remind:{backgroundColor:"#302b47",borderRadius:9,paddingHorizontal:10,paddingVertical:9},
  remindText:{color:"#d4ceff",fontSize:10,fontWeight:"800"},disabled:{opacity:0.45},
  settingsLink:{color:"#c7bfff",marginTop:22,fontSize:12,fontWeight:"700"},
});
