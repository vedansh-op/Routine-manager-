import { useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";

type Mode = "login" | "signup" | "forgot" | "recovery";
export default function AuthScreen() {
  const router = useRouter();
  const { recovery, clearRecovery } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const activeMode = recovery ? "recovery" : mode;

  async function submit() {
    if (!supabase || !isSupabaseConfigured) return;
    const cleanEmail = email.trim().toLowerCase();
    if (activeMode !== "recovery" && !cleanEmail) return Alert.alert("Email required", "Enter your email address.");
    if ((activeMode === "login" || activeMode === "signup") && password.length < 8) return Alert.alert("Password too short", "Use at least 8 characters.");
    setBusy(true);
    try {
      if (activeMode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: { full_name: name.trim() },
            emailRedirectTo: "oneos://auth",
          },
        });
        if (error) throw error;
        if (!data.session) Alert.alert("Check your email", "Confirm your email address, then return here to sign in.");
        else router.replace("/");
      } else if (activeMode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
        router.replace("/");
      } else if (activeMode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo: "oneos://auth" });
        if (error) throw error;
        Alert.alert("Reset link sent", "Check your email for the password reset link.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        clearRecovery();
        setPassword("");
        Alert.alert("Password updated", "Your new password is ready to use.");
        router.replace("/");
      }
    } catch (error) {
      Alert.alert("Couldn't continue", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const title = activeMode === "signup" ? "Create your account" : activeMode === "forgot" ? "Reset password" : activeMode === "recovery" ? "Choose a new password" : "Welcome back";
  const subtitle = activeMode === "signup" ? "Your personal space starts here." : activeMode === "forgot" ? "We'll email you a secure reset link." : activeMode === "recovery" ? "Make it at least 8 characters." : "Sign in to continue to ONE-OS.";

  return <KeyboardAvoidingView style={s.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <View style={s.content}>
      <Text style={s.brand}>ONE-OS</Text>
      <Text style={s.eyebrow}>YOUR SPACE. YOUR RHYTHM.</Text>
      <Text style={s.title}>{title}</Text>
      <Text style={s.subtitle}>{subtitle}</Text>
      {!isSupabaseConfigured ? <>
        <View style={s.notice}><Text style={s.noticeTitle}>Authentication setup required</Text><Text style={s.noticeText}>Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to your local .env file, then rebuild the app. Never put a service-role key in the app.</Text></View>
      </> : <>
        {activeMode === "signup" && <TextInput value={name} onChangeText={setName} placeholder="Your name (optional)" placeholderTextColor="#777d8c" style={s.input} autoCapitalize="words" />}
        {activeMode !== "recovery" && <TextInput value={email} onChangeText={setEmail} placeholder="Email address" placeholderTextColor="#777d8c" style={s.input} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />}
        {activeMode !== "forgot" && <TextInput value={password} onChangeText={setPassword} placeholder={activeMode === "recovery" ? "New password" : "Password"} placeholderTextColor="#777d8c" style={s.input} secureTextEntry autoCapitalize="none" />}
        <Pressable disabled={busy} onPress={submit} style={[s.primary, busy && { opacity: 0.6 }]}>{busy ? <ActivityIndicator color="#101216" /> : <Text style={s.primaryText}>{activeMode === "signup" ? "Create account" : activeMode === "forgot" ? "Send reset link" : activeMode === "recovery" ? "Update password" : "Sign in"}</Text>}</Pressable>
        {!recovery && activeMode === "login" && <Pressable onPress={() => setMode("forgot")}><Text style={s.action}>Forgot password?</Text></Pressable>}
        {!recovery && <Pressable onPress={() => setMode(activeMode === "signup" ? "login" : "signup")}><Text style={s.action}>{activeMode === "signup" ? "Already have an account? Sign in" : "New to ONE-OS? Create account"}</Text></Pressable>}
        {!recovery && activeMode === "forgot" && <Pressable onPress={() => setMode("login")}><Text style={s.action}>Back to sign in</Text></Pressable>}
      </>}
      <Text style={s.footer}>Private by design · ONE-OS</Text>
    </View>
  </KeyboardAvoidingView>;
}
const s = StyleSheet.create({
  page:{flex:1,backgroundColor:"#101216",justifyContent:"center"},content:{padding:26},brand:{color:"#f4f2ff",fontSize:18,fontWeight:"800",letterSpacing:4},eyebrow:{color:"#9b8cff",fontSize:10,letterSpacing:2,marginTop:10},title:{color:"#f4f2ff",fontSize:32,fontWeight:"700",marginTop:42},subtitle:{color:"#9699a5",fontSize:14,marginTop:9,marginBottom:26},input:{backgroundColor:"#1a1d24",borderWidth:1,borderColor:"#2a2e38",borderRadius:14,padding:16,color:"#f4f2ff",marginBottom:12,fontSize:15},primary:{backgroundColor:"#b7adff",padding:17,borderRadius:14,alignItems:"center",marginTop:8},primaryText:{color:"#101216",fontWeight:"800",fontSize:15},action:{color:"#c7bfff",textAlign:"center",marginTop:20,fontSize:13},notice:{backgroundColor:"#1a1d24",borderWidth:1,borderColor:"#49415f",borderRadius:14,padding:16,marginTop:8},noticeTitle:{color:"#f4f2ff",fontWeight:"700",marginBottom:8},noticeText:{color:"#aeb1bd",lineHeight:20,fontSize:13},footer:{color:"#666c79",fontSize:11,textAlign:"center",marginTop:54}
});
