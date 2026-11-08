import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useAuth } from "@/auth/AuthProvider";
import { RoutineStep, useAppStore } from "@/store/AppStore";
import { cancelReminder, getNotificationState, requestNotificationPermission, rescheduleReminder, scheduleReminder } from "@/lib/notifications";

function parseSteps(value: string): RoutineStep[] {
  return value.split("\n").map((line, index) => {
    const [titlePart, durationPart] = line.split("|");
    return {
      id: "step_" + index,
      title: (titlePart ?? "").trim(),
      durationMinutes: Number((durationPart ?? "5").trim()),
    };
  }).filter(step => step.title.length > 0);
}

export default function RoutinesScreen() {
  const { user } = useAuth();
  const { routines, addRoutine, setRoutineSchedule, removeRoutine, canEdit, storageError } = useAppStore();
  const [title, setTitle] = useState("");
  const [stepsText, setStepsText] = useState("Plan and prepare | 5\nDeep work | 25\nReview and close | 5");
  const [busyId, setBusyId] = useState<string | null>(null);

  function chooseRoutineStart(routineId: string) {
    const initial = new Date(Date.now() + 5 * 60_000);
    DateTimePickerAndroid.open({
      value: initial,
      mode: "date",
      minimumDate: new Date(),
      onChange: (dateEvent, pickedDate) => {
        if (dateEvent.type !== "set" || !pickedDate) return;
        const nextDate = new Date(initial);
        nextDate.setFullYear(pickedDate.getFullYear(), pickedDate.getMonth(), pickedDate.getDate());
        DateTimePickerAndroid.open({
          value: nextDate,
          mode: "time",
          is24Hour: false,
          onChange: (timeEvent, pickedTime) => {
            if (timeEvent.type !== "set" || !pickedTime) return;
            const startAt = new Date(nextDate);
            startAt.setHours(pickedTime.getHours(), pickedTime.getMinutes(), 0, 0);
            void scheduleRoutine(routineId, startAt);
          },
        });
      },
    });
  }

  async function scheduleRoutine(routineId: string, startAt: Date) {
    if (!user?.id || !canEdit) return;
    const routine = routines.find(item => item.id === routineId);
    if (!routine) return;
    if (startAt.getTime() <= Date.now()) {
      Alert.alert("Choose a future start", "Routine reminders must be scheduled before the routine begins.");
      return;
    }
    setBusyId(routineId);
    const prefix = "routine:" + routine.id + ":";
    const previousState = await getNotificationState(user.id);
    const previousByKey = new Map(previousState.reminders
      .filter(item => item.sourceKey?.startsWith(prefix))
      .map(item => [item.sourceKey as string, item]));
    const newIds: string[] = [];
    const scheduledKeys = new Set<string>();
    try {
      let elapsedMinutes = 0;
      for (let index = 0; index < routine.steps.length; index += 1) {
        const step = routine.steps[index];
        const eventAt = new Date(startAt.getTime() + elapsedMinutes * 60_000);
        const sourceKey = prefix + "step:" + step.id;
        const reminder = await scheduleReminder(user.id, {
          category: "routine",
          title: index === 0
            ? "Start " + routine.title + " · " + step.title
            : "Next step · " + step.title,
          body: "Step " + (index + 1) + " of " + routine.steps.length + " · " + step.durationMinutes + " minutes",
          route: "/routines",
          sourceKey,
          repeat: { kind: "once", date: eventAt.toISOString() },
        });
        newIds.push(reminder.id);
        scheduledKeys.add(sourceKey);
        elapsedMinutes += step.durationMinutes;
      }

      const finishKey = prefix + "finish";
      const finishAt = new Date(startAt.getTime() + elapsedMinutes * 60_000);
      const finishReminder = await scheduleReminder(user.id, {
        category: "routine",
        title: "Routine complete · " + routine.title,
        body: "You finished your routine. Take a breath and review your progress.",
        route: "/routines",
        sourceKey: finishKey,
        repeat: { kind: "once", date: finishAt.toISOString() },
      });
      newIds.push(finishReminder.id);
      scheduledKeys.add(finishKey);

      const current = await getNotificationState(user.id);
      const currentLinked = current.reminders.filter(item => item.sourceKey?.startsWith(prefix));
      for (const reminder of currentLinked) {
        if (!scheduledKeys.has(reminder.sourceKey ?? "")) {
          await cancelReminder(user.id, reminder.id);
        }
      }
      const finalIds = currentLinked
        .filter(item => scheduledKeys.has(item.sourceKey ?? ""))
        .map(item => item.id);
      setRoutineSchedule(routine.id, finalIds, startAt.toISOString());
      Alert.alert("Routine scheduled", routine.steps.length + " step alerts and a completion alert are ready on this phone.");
    } catch (error) {
      // Restore the previous set where possible so a failed edit cannot leave
      // a mixed old/new sequence silently scheduled.
      for (const reminderId of newIds) {
        const created = (await getNotificationState(user.id).catch(() => null))?.reminders.find(item => item.id === reminderId);
        if (!created?.sourceKey) continue;
        const previous = previousByKey.get(created.sourceKey);
        if (previous?.repeat.kind === "once") {
          await rescheduleReminder(user.id, created.id, new Date(previous.repeat.date)).catch(() => undefined);
        } else {
          await cancelReminder(user.id, created.id).catch(() => undefined);
        }
      }
      Alert.alert("Couldn't schedule routine", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  function createRoutine() {
    const parsed = parseSteps(stepsText);
    if (!title.trim()) {
      Alert.alert("Add a routine name", "Give this routine a short title.");
      return;
    }
    if (parsed.length === 0 || parsed.length > 12 || parsed.some(step =>
      !Number.isInteger(step.durationMinutes) || step.durationMinutes < 1 || step.durationMinutes > 240,
    )) {
      Alert.alert("Check your steps", "Add 1–12 steps using the format Step name | minutes. Each step must be 1–240 minutes.");
      return;
    }
    addRoutine(title.trim(), parsed);
    setTitle("");
    Alert.alert("Routine added", "Your routine is saved. Choose Start to schedule its step notifications.");
  }

  async function deleteRoutine(routineId: string) {
    try {
      await removeRoutine(routineId);
    } catch (error) {
      Alert.alert("Couldn't remove routine", error instanceof Error ? error.message : "Cancel its reminders and try again.");
    }
  }

  return <ScrollView style={s.page} contentContainerStyle={s.body}>
    <Link href="/" style={s.back}>←  Home</Link>
    <Text style={s.eyebrow}>BUILD A REPEATABLE RHYTHM</Text>
    <Text style={s.heading}>Routines.</Text>
    <Text style={s.sub}>Create a sequence of steps, then schedule the start, transitions and finish alerts locally on this phone.</Text>

    <View style={s.card}>
      <Text style={s.cardTitle}>Create a routine</Text>
      <TextInput value={title} onChangeText={setTitle} editable={canEdit} placeholder="Routine name" placeholderTextColor="#777d8c" style={s.input} />
      <Text style={s.label}>STEPS · ONE PER LINE · NAME | MINUTES</Text>
      <TextInput value={stepsText} onChangeText={setStepsText} editable={canEdit} multiline numberOfLines={6} textAlignVertical="top" placeholder="Prepare | 5&#10;Deep work | 25&#10;Review | 5" placeholderTextColor="#777d8c" style={[s.input,s.stepsInput]} />
      <Pressable disabled={!canEdit} onPress={createRoutine} style={[s.primary,!canEdit && s.disabled]}><Text style={s.primaryText}>Save routine</Text></Pressable>
      <Text style={s.hint}>Each duration is 1–240 minutes. Maximum 12 steps per routine.</Text>
    </View>

    {!canEdit ? <Text style={s.sub}>{storageError ?? "Preparing encrypted storage…"}</Text> : null}
    {routines.length === 0 ? <Text style={s.empty}>No routines yet. Build your first sequence above.</Text> : routines.map(routine =>
      <View key={routine.id} style={s.card}>
        <Text style={s.routineTitle}>{routine.title}</Text>
        <Text style={s.muted}>{routine.steps.length} steps · {routine.steps.reduce((total, step) => total + step.durationMinutes, 0)} minutes total</Text>
        {routine.steps.map((step,index) => <View key={step.id} style={s.step}>
          <Text style={s.stepNumber}>{String(index+1).padStart(2,"0")}</Text>
          <Text style={s.stepTitle}>{step.title}</Text>
          <Text style={s.stepDuration}>{step.durationMinutes}m</Text>
        </View>)}
        {routine.scheduledStartAt ? <Text style={s.scheduled}>Scheduled · {new Date(routine.scheduledStartAt).toLocaleString()}</Text> : null}
        <View style={s.actions}>
          <Pressable disabled={Boolean(busyId)} onPress={() => chooseRoutineStart(routine.id)} style={s.secondary}>
            <Text style={s.secondaryText}>{busyId === routine.id ? "…" : "Schedule start"}</Text>
          </Pressable>
          <Pressable disabled={Boolean(busyId)} onPress={() => void deleteRoutine(routine.id)}><Text style={s.remove}>Delete</Text></Pressable>
        </View>
      </View>
    )}
    <Link href="/notifications" style={s.link}>Notification settings →</Link>
  </ScrollView>;
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor:"#101216"},body:{padding:22,paddingTop:56,paddingBottom:52},
  back:{color:"#c7bfff",fontSize:14,marginBottom:28},eyebrow:{color:"#9b8cff",fontSize:10,letterSpacing:2,fontWeight:"700"},
  heading:{color:"#f4f2ff",fontSize:38,fontWeight:"700",marginTop:12},sub:{color:"#9699a5",fontSize:12,lineHeight:19,marginTop:8},
  card:{backgroundColor:"#1a1d24",borderColor:"#2a2e38",borderWidth:1,borderRadius:18,padding:16,marginTop:15},
  cardTitle:{color:"#f4f2ff",fontSize:16,fontWeight:"700",marginBottom:10},routineTitle:{color:"#f4f2ff",fontSize:18,fontWeight:"800"},
  muted:{color:"#9699a5",fontSize:10,marginTop:5},label:{color:"#9699a5",fontSize:9,letterSpacing:1.2,fontWeight:"800",marginTop:18,marginBottom:7},
  input:{backgroundColor:"#101216",borderWidth:1,borderColor:"#3b3e4a",borderRadius:12,padding:13,color:"#f4f2ff",marginTop:9,fontSize:13},
  stepsInput:{minHeight:120},primary:{backgroundColor:"#b7adff",borderRadius:12,padding:14,alignItems:"center",marginTop:15},
  primaryText:{color:"#171421",fontSize:12,fontWeight:"900"},hint:{color:"#858b98",fontSize:10,lineHeight:16,marginTop:10},
  empty:{color:"#777d8c",marginTop:24},step:{flexDirection:"row",alignItems:"center",gap:10,borderTopWidth:1,borderTopColor:"#2b303a",paddingVertical:11},
  stepNumber:{color:"#9a8aff",fontSize:10,fontWeight:"900"},stepTitle:{color:"#eeeafc",fontSize:12,flex:1},stepDuration:{color:"#b7adff",fontSize:10,fontWeight:"800"},
  scheduled:{color:"#9bd8b1",fontSize:10,marginTop:12},actions:{flexDirection:"row",alignItems:"center",gap:15,marginTop:15},
  secondary:{backgroundColor:"#302b47",borderRadius:10,paddingHorizontal:14,paddingVertical:11},secondaryText:{color:"#d4ceff",fontSize:11,fontWeight:"800"},
  remove:{color:"#ff9eae",fontSize:11,fontWeight:"800"},disabled:{opacity:0.5},link:{color:"#c7bfff",fontSize:12,fontWeight:"700",marginTop:20},
});
