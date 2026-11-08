import { useState } from "react";
import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAppStore } from "@/store/AppStore";
export default function Tasks() {
  const { tasks, addTask, toggleTask, canEdit, storageError } = useAppStore(); const [title,setTitle]=useState("");
  return <ScrollView style={s.page} contentContainerStyle={s.body}><Link href="/" style={s.back}>←  Home</Link><Text style={s.heading}>Tasks</Text><Text style={s.sub}>Turn intention into action.</Text>
    <View style={s.form}><TextInput value={title} onChangeText={setTitle} editable={canEdit} onSubmitEditing={()=>{addTask(title);setTitle("");}} placeholder="Add a task…" placeholderTextColor="#777d8c" style={s.input}/><Pressable disabled={!canEdit} style={[s.add, !canEdit && { opacity: 0.45 }]} onPress={()=>{addTask(title);setTitle("");}}><Text style={s.addText}>Add</Text></Pressable></View>
    {!canEdit ? <Text style={s.sub}>{storageError ? "Editing is paused to protect your saved data. " + storageError : "Preparing secure local storage…"}</Text> : null}
    {tasks.length===0?<Text style={s.empty}>Nothing here yet. Add your first task above.</Text>:tasks.map(t=><Pressable key={t.id} disabled={!canEdit} onPress={()=>toggleTask(t.id)} style={s.item}><Text style={s.check}>{t.completed?"✓":"○"}</Text><Text style={[s.task,t.completed&&s.done]}>{t.title}</Text></Pressable>)}
  </ScrollView>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:"#101216"},body:{padding:24,paddingTop:54},back:{color:"#a99cff",marginBottom:28},heading:{color:"#f4f2ff",fontSize:36,fontWeight:"700"},sub:{color:"#9699a5",marginTop:7},form:{flexDirection:"row",gap:8,marginTop:26},input:{flex:1,backgroundColor:"#1a1d24",borderRadius:12,padding:15,color:"#fff"},add:{backgroundColor:"#a99cff",borderRadius:12,paddingHorizontal:20,justifyContent:"center"},addText:{color:"#171421",fontWeight:"700"},empty:{color:"#777d8c",marginTop:28},item:{flexDirection:"row",gap:14,alignItems:"center",backgroundColor:"#1a1d24",padding:17,borderRadius:13,marginTop:10},check:{color:"#a99cff",fontSize:18},task:{color:"#eee",fontSize:15},done:{textDecorationLine:"line-through",color:"#777d8c"}});
