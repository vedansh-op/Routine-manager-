import { useState } from "react";
import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAppStore, todayKey } from "@/store/AppStore";
export default function Habits() {
  const { habits, completions, addHabit, toggleHabitToday } = useAppStore(); const [title,setTitle]=useState("");
  return <ScrollView style={s.page} contentContainerStyle={s.body}><Link href="/" style={s.back}>←  Home</Link><Text style={s.heading}>Habits</Text><Text style={s.sub}>Consistency over intensity.</Text>
    <View style={s.form}><TextInput value={title} onChangeText={setTitle} onSubmitEditing={()=>{addHabit(title);setTitle("");}} placeholder="Name a habit…" placeholderTextColor="#777d8c" style={s.input}/><Pressable style={s.add} onPress={()=>{addHabit(title);setTitle("");}}><Text style={s.addText}>Add</Text></Pressable></View>
    {habits.length===0?<Text style={s.empty}>Start with one small habit.</Text>:habits.filter(h=>!h.archived).map(h=>{const done=completions.includes(h.id+":"+todayKey());return <Pressable key={h.id} onPress={()=>toggleHabitToday(h.id)} style={s.item}><View style={[s.check,done&&s.checked]}><Text style={s.tick}>{done?"✓":""}</Text></View><Text style={s.task}>{h.title}</Text><Text style={s.today}>{done?"DONE":"TODAY"}</Text></Pressable>})}
  </ScrollView>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:"#101216"},body:{padding:24,paddingTop:54},back:{color:"#a99cff",marginBottom:28},heading:{color:"#f4f2ff",fontSize:36,fontWeight:"700"},sub:{color:"#9699a5",marginTop:7},form:{flexDirection:"row",gap:8,marginTop:26},input:{flex:1,backgroundColor:"#1a1d24",borderRadius:12,padding:15,color:"#fff"},add:{backgroundColor:"#a99cff",borderRadius:12,paddingHorizontal:20,justifyContent:"center"},addText:{color:"#171421",fontWeight:"700"},empty:{color:"#777d8c",marginTop:28},item:{flexDirection:"row",gap:13,alignItems:"center",backgroundColor:"#1a1d24",padding:17,borderRadius:13,marginTop:10},check:{width:23,height:23,borderRadius:8,borderWidth:1,borderColor:"#79718f",alignItems:"center",justifyContent:"center"},checked:{backgroundColor:"#a99cff",borderColor:"#a99cff"},tick:{color:"#171421",fontWeight:"800"},task:{color:"#eee",fontSize:15,flex:1},today:{color:"#9699a5",fontSize:9,letterSpacing:1}});
