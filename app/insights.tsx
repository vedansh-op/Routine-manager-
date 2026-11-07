import { Link } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useAppStore, todayKey } from "@/store/AppStore";
export default function Insights() {
  const { tasks, habits, completions }=useAppStore();
  const taskRate=tasks.length?Math.round(tasks.filter(t=>t.completed).length/tasks.length*100):0;
  const habitRate=habits.length?Math.round(habits.filter(h=>completions.includes(h.id+":"+todayKey())).length/habits.length*100):0;
  return <ScrollView style={s.page} contentContainerStyle={s.body}><Link href="/" style={s.back}>←  Home</Link><Text style={s.heading}>Insights</Text><Text style={s.sub}>A clearer view of your consistency.</Text>
    <View style={s.card}><Text style={s.label}>TASK COMPLETION</Text><Text style={s.value}>{taskRate}%</Text><View style={s.track}><View style={[s.fill,{width:taskRate+"%"}]}/></View><Text style={s.note}>{tasks.filter(t=>t.completed).length} of {tasks.length} tasks completed</Text></View>
    <View style={s.card}><Text style={s.label}>HABITS COMPLETED TODAY</Text><Text style={s.value}>{habitRate}%</Text><View style={s.track}><View style={[s.fill,{width:habitRate+"%"}]}/></View><Text style={s.note}>{habits.filter(h=>completions.includes(h.id+":"+todayKey())).length} of {habits.length} habits checked today</Text></View>
  </ScrollView>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:"#101216"},body:{padding:24,paddingTop:54},back:{color:"#a99cff",marginBottom:28},heading:{color:"#f4f2ff",fontSize:36,fontWeight:"700"},sub:{color:"#9699a5",marginTop:7},card:{backgroundColor:"#1a1d24",borderColor:"#2a2e38",borderWidth:1,borderRadius:18,padding:20,marginTop:20},label:{color:"#9699a5",fontSize:10,letterSpacing:1},value:{color:"#f4f2ff",fontSize:38,fontWeight:"700",marginTop:12},track:{height:7,backgroundColor:"#303440",borderRadius:8,marginTop:15,overflow:"hidden"},fill:{height:7,backgroundColor:"#a99cff",borderRadius:8},note:{color:"#858b98",fontSize:12,marginTop:10}});
