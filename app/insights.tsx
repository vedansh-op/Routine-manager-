import { useMemo, useState } from "react";
import { Link } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAppStore, todayKey } from "@/store/AppStore";
import { useAuth } from "@/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { getDateKeyInTimeZone, getDeviceTimeZone } from "@/lib/time";

function weekStartFor(dateKey: string): string {
  const date = new Date(dateKey + "T12:00:00Z");
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((weekday + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export default function Insights() {
  const { tasks, habits, completions, ready } = useAppStore();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [shared, setShared] = useState(false);
  const timeZone = getDeviceTimeZone();
  const today = getDateKeyInTimeZone(new Date(), timeZone);
  const weekStart = weekStartFor(today);
  const lastSevenDays = useMemo(() => {
    const cursor = new Date(today + "T12:00:00Z");
    return new Set(Array.from({ length: 7 }, (_, index) => {
      const date = new Date(cursor);
      date.setUTCDate(cursor.getUTCDate() - index);
      return date.toISOString().slice(0, 10);
    }));
  }, [today]);
  const taskRate = tasks.length ? Math.round(tasks.filter(t => t.completed).length / tasks.length * 100) : 0;
  const todayHabitCount = habits.filter(h => completions.includes(h.id + ":" + todayKey())).length;
  const weeklyHabitCheckins = completions.filter(value => {
    const dateKey = value.slice(value.lastIndexOf(":") + 1);
    return lastSevenDays.has(dateKey);
  }).length;

  async function saveWeeklyReport(share: boolean) {
    if (!supabase || !user) {
      Alert.alert("Connect your account", "Sign in and configure Supabase before saving a cloud report.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const report = {
        tasks_total: tasks.length,
        tasks_completed: tasks.filter(task => task.completed).length,
        habits_total: habits.length,
        habit_checkins_last_7_days: weeklyHabitCheckins,
      };
      const { error } = await supabase.from("weekly_reports").upsert({
        user_id: user.id,
        week_start: weekStart,
        time_zone: timeZone,
        report,
        shared_with_partner: share,
      }, { onConflict: "user_id,week_start" });
      if (error) throw error;
      setShared(share);
      setMessage(share ? "Weekly summary saved and shared with your connected partner." : "Weekly summary saved privately.");
    } catch (error) {
      Alert.alert("Couldn't save weekly report", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <ScrollView style={s.page} contentContainerStyle={s.body}>
    <Link href="/" style={s.back}>←  Home</Link>
    <Text style={s.heading}>Insights</Text>
    <Text style={s.sub}>A clearer view of your consistency.</Text>
    <View style={s.card}>
      <Text style={s.label}>TASK COMPLETION</Text><Text style={s.value}>{taskRate}%</Text>
      <View style={s.track}><View style={[s.fill,{width:(taskRate+"%") as `${number}%`}]}/></View>
      <Text style={s.note}>{tasks.filter(t=>t.completed).length} of {tasks.length} tasks completed</Text>
    </View>
    <View style={s.card}>
      <Text style={s.label}>HABITS COMPLETED TODAY</Text><Text style={s.value}>{habits.length ? Math.round(todayHabitCount / habits.length * 100) : 0}%</Text>
      <View style={s.track}><View style={[s.fill,{width:((habits.length ? todayHabitCount / habits.length * 100 : 0)+"%") as `${number}%`}]}/></View>
      <Text style={s.note}>{todayHabitCount} of {habits.length} habits checked today</Text>
    </View>
    <View style={s.card}>
      <Text style={s.label}>CLOUD BACKUP · WEEK OF {weekStart}</Text>
      <Text style={s.reportTitle}>A small weekly snapshot</Text>
      <Text style={s.note}>{tasks.length} tasks · {tasks.filter(task => task.completed).length} completed · {weeklyHabitCheckins} habit check-ins in the last 7 local days.</Text>
      <Text style={s.privacy}>Only these aggregate counts are uploaded. Task names, notes, and daily history stay on this phone.</Text>
      <Pressable disabled={busy || !ready} onPress={() => void saveWeeklyReport(false)} style={[s.button, (busy || !ready) && s.disabled]}>
        <Text style={s.buttonText}>{busy ? "Saving…" : "Save private weekly report"}</Text>
      </Pressable>
      <Pressable disabled={busy || !ready} onPress={() => void saveWeeklyReport(true)} style={[s.buttonSecondary, (busy || !ready) && s.disabled]}>
        <Text style={s.buttonSecondaryText}>Share weekly report with partner</Text>
      </Pressable>
      {shared ? <Text style={s.success}>Sharing was enabled for the latest saved report.</Text> : null}
      {!!message && <Text style={s.success}>{message}</Text>}
    </View>
  </ScrollView>;
}
const s=StyleSheet.create({
  page:{flex:1,backgroundColor:"#101216"},body:{padding:24,paddingTop:54,paddingBottom:48},back:{color:"#a99cff",marginBottom:28},
  heading:{color:"#f4f2ff",fontSize:36,fontWeight:"700"},sub:{color:"#9699a5",marginTop:7},
  card:{backgroundColor:"#1a1d24",borderColor:"#2a2e38",borderWidth:1,borderRadius:18,padding:20,marginTop:20},
  label:{color:"#9699a5",fontSize:10,letterSpacing:1},value:{color:"#f4f2ff",fontSize:38,fontWeight:"700",marginTop:12},
  track:{height:7,backgroundColor:"#303440",borderRadius:8,marginTop:15,overflow:"hidden"},fill:{height:7,backgroundColor:"#a99cff",borderRadius:8},
  note:{color:"#858b98",fontSize:12,lineHeight:19,marginTop:10},reportTitle:{color:"#f4f2ff",fontSize:19,fontWeight:"700",marginTop:12},
  privacy:{color:"#aaa5bc",fontSize:11,lineHeight:18,marginTop:12},button:{backgroundColor:"#b7adff",padding:15,borderRadius:12,alignItems:"center",marginTop:16},
  buttonText:{color:"#101216",fontWeight:"800"},buttonSecondary:{backgroundColor:"#29243a",padding:15,borderRadius:12,alignItems:"center",marginTop:10},
  buttonSecondaryText:{color:"#d8d1ff",fontWeight:"700"},disabled:{opacity:0.5},success:{color:"#a8d9b4",fontSize:11,lineHeight:17,marginTop:12},
});
