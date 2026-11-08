import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { supabase } from "@/lib/supabase";

export default function VerifyEmailScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const email = session?.user.email ?? "";

  async function resend() {
    if (!supabase || !email) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email });
      if (error) throw error;
      Alert.alert("Email sent", "Check your inbox and spam folder for the verification link.");
    } catch (error) {
      Alert.alert("Couldn't resend", error instanceof Error ? error.message : "Please wait a little and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function checkAgain() {
    if (!supabase) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) throw error;
      if (data.session?.user.email_confirmed_at) {
        router.replace("/mfa");
      } else {
        Alert.alert("Not verified yet", "Open the verification link from your email, then tap this button again.");
      }
    } catch (error) {
      Alert.alert("Couldn't check yet", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    setBusy(true);
    try {
      await supabase.auth.signOut();
      router.replace("/auth");
    } finally {
      setBusy(false);
    }
  }

  return <View style={s.page}>
    <View style={s.content}>
      <Text style={s.brand}>ONE-OS</Text>
      <Text style={s.eyebrow}>ONE QUICK SECURITY STEP</Text>
      <Text style={s.title}>Verify your email</Text>
      <Text style={s.body}>Before opening your shared space, confirm that you own this email address.</Text>
      <View style={s.emailCard}>
        <Text style={s.emailLabel}>VERIFICATION EMAIL</Text>
        <Text style={s.email}>{email || "No email address found"}</Text>
      </View>
      <Pressable disabled={busy || !email} onPress={resend} style={[s.primary, (busy || !email) && s.disabled]}>
        {busy ? <ActivityIndicator color="#101216" /> : <Text style={s.primaryText}>Resend verification email</Text>}
      </Pressable>
      <Pressable disabled={busy} onPress={checkAgain} style={[s.secondary, busy && s.disabled]}>
        <Text style={s.secondaryText}>I've verified — check again</Text>
      </Pressable>
      <Pressable disabled={busy} onPress={signOut}>
        <Text style={s.signOut}>Use a different account</Text>
      </Pressable>
      <Text style={s.footer}>ONE-OS keeps shared features behind verified email and MFA.</Text>
    </View>
  </View>;
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor:"#101216",justifyContent:"center"},
  content:{padding:26},
  brand:{color:"#f4f2ff",fontSize:18,fontWeight:"800",letterSpacing:4},
  eyebrow:{color:"#9b8cff",fontSize:10,letterSpacing:2,marginTop:10},
  title:{color:"#f4f2ff",fontSize:32,fontWeight:"700",marginTop:42},
  body:{color:"#9699a5",fontSize:14,lineHeight:22,marginTop:10,marginBottom:24},
  emailCard:{backgroundColor:"#1a1d24",borderWidth:1,borderColor:"#2a2e38",borderRadius:14,padding:16,marginBottom:14},
  emailLabel:{color:"#777d8c",fontSize:10,letterSpacing:1.5,marginBottom:8},
  email:{color:"#f4f2ff",fontSize:15,fontWeight:"600"},
  primary:{backgroundColor:"#b7adff",padding:17,borderRadius:14,alignItems:"center",marginTop:8},
  primaryText:{color:"#101216",fontWeight:"800",fontSize:15},
  secondary:{borderWidth:1,borderColor:"#514a70",padding:16,borderRadius:14,alignItems:"center",marginTop:12},
  secondaryText:{color:"#c7bfff",fontWeight:"700",fontSize:14},
  disabled:{opacity:0.55},
  signOut:{color:"#aeb1bd",textAlign:"center",marginTop:22,fontSize:13},
  footer:{color:"#666c79",fontSize:11,textAlign:"center",marginTop:48,lineHeight:17}
});
