import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";

export default function AccountScreen() {
  const { user } = useAuth();
  const router = useRouter();
  async function signOut() {
    const { error } = await supabase?.auth.signOut() ?? { error: new Error("Authentication is not configured.") };
    if (error) Alert.alert("Sign out failed", error.message);
    else router.replace("/auth");
  }
  return <View style={s.page}>
    <Text style={s.eyebrow}>ACCOUNT</Text><Text style={s.title}>Your identity</Text>
    <View style={s.card}><Text style={s.label}>SIGNED IN AS</Text><Text style={s.value}>{user?.email ?? "Unknown"}</Text><Text style={s.meta}>User ID</Text><Text selectable style={s.id}>{user?.id ?? "—"}</Text></View>
    <Pressable onPress={signOut} style={s.button}><Text style={s.buttonText}>Sign out</Text></Pressable>
    <Pressable onPress={() => router.back()}><Text style={s.back}>Back to ONE-OS</Text></Pressable>
  </View>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:"#101216",padding:24,paddingTop:64},eyebrow:{color:"#9b8cff",fontSize:10,letterSpacing:2,fontWeight:"700"},title:{color:"#f4f2ff",fontSize:34,fontWeight:"700",marginTop:12},card:{backgroundColor:"#1a1d24",borderColor:"#2a2e38",borderWidth:1,borderRadius:18,padding:18,marginTop:30},label:{color:"#9699a5",fontSize:10,letterSpacing:1},value:{color:"#f4f2ff",fontSize:16,marginTop:8},meta:{color:"#9699a5",fontSize:10,marginTop:24},id:{color:"#c7bfff",fontSize:11,marginTop:6},button:{backgroundColor:"#3b2730",borderRadius:14,padding:17,alignItems:"center",marginTop:24},buttonText:{color:"#ffb7c5",fontWeight:"700"},back:{color:"#c7bfff",textAlign:"center",marginTop:20}});
