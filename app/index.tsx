import { Link } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useAppStore, todayKey } from "@/store/AppStore";

const Card = ({ title, value, hint }: { title: string; value: string; hint: string }) => (
  <View style={s.card}><Text style={s.muted}>{title}</Text><Text style={s.metric}>{value}</Text><Text style={s.hint}>{hint}</Text></View>
);
export default function Home() {
  const { tasks, habits, completions, ready } = useAppStore();
  const done = tasks.filter(t => t.completed).length;
  const todayHabits = habits.filter(h => completions.includes(h.id + ":" + todayKey())).length;
  return <ScrollView style={s.page} contentContainerStyle={s.body}>
    <Text style={s.eyebrow}>PERSONAL OPERATING SYSTEM</Text><Text style={s.heading}>Your day,{ "\n" }in focus.</Text>
    <Text style={s.date}>{new Date().toLocaleDateString(undefined, { weekday:"long", month:"long", day:"numeric" })}</Text>
    <View style={s.grid}><Card title="TASKS DONE" value={ready ? String(done) + "/" + tasks.length : "—"} hint="Keep your momentum" /><Card title="HABITS TODAY" value={ready ? String(todayHabits) + "/" + habits.length : "—"} hint="Small actions compound" /></View>
    <Text style={s.section}>Your workspace</Text>
    <Link href="/tasks" style={s.link}>01  Tasks  →</Link><Link href="/habits" style={s.link}>02  Habits  →</Link><Link href="/insights" style={s.link}>03  Insights  →</Link>
    <Text style={s.footer}>ONE-OS · built around your rhythm</Text>
  </ScrollView>;
}
const s = StyleSheet.create({ page:{flex:1,backgroundColor:"#101216"},body:{padding:24,paddingTop:58},eyebrow:{color:"#9b8cff",fontSize:10,letterSpacing:2,fontWeight:"700"},heading:{color:"#f4f2ff",fontSize:42,fontWeight:"700",lineHeight:47,marginTop:16},date:{color:"#9699a5",marginTop:12,fontSize:14},grid:{flexDirection:"row",gap:12,marginTop:30},card:{flex:1,backgroundColor:"#1a1d24",borderColor:"#2a2e38",borderWidth:1,borderRadius:18,padding:16},muted:{color:"#9699a5",fontSize:10,letterSpacing:1},metric:{color:"#f4f2ff",fontSize:27,fontWeight:"700",marginTop:12},hint:{color:"#777d8c",fontSize:11,marginTop:5},section:{color:"#f4f2ff",fontSize:18,fontWeight:"700",marginTop:34,marginBottom:12},link:{color:"#e2deff",backgroundColor:"#1a1d24",borderRadius:14,padding:18,marginTop:9,overflow:"hidden",fontSize:15},footer:{color:"#666c79",fontSize:11,marginTop:42,textAlign:"center"}});

// Build trigger: Android APK workflow validation.
