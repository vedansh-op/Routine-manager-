import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";

type Factor = { id: string; friendly_name?: string | null; status?: string; factor_type?: string };

export default function MfaScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [factor, setFactor] = useState<Factor | null>(null);
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [stage, setStage] = useState<"enroll" | "verify">("enroll");

  const refresh = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (assurance.currentLevel === "aal2") { router.replace("/"); return; }
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      // Reuse a pending factor instead of creating another enrollment. A pending
      // factor may exist if the app was closed before its first code was verified.
      const totpFactors = (data.totp ?? []) as Factor[];
      const existing = totpFactors.find(item => item.status === "verified")
        ?? totpFactors.find(item => item.status === "unverified");
      if (existing) {
        setFactor(existing);
        setStage("verify");
      } else {
        setFactor(null);
        setStage("enroll");
      }
    } catch (error) {
      Alert.alert("Security check failed", error instanceof Error ? error.message : "Please try again.");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function beginEnrollment() {
    if (!supabase) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "ONE-OS authenticator" });
      if (error) throw error;
      setFactor({ id: data.id, friendly_name: "ONE-OS authenticator", status: "unverified", factor_type: "totp" });
      setSecret(data.totp.secret);
      setStage("verify");
    } catch (error) {
      Alert.alert("Couldn't set up MFA", error instanceof Error ? error.message : "Please try again.");
    } finally { setBusy(false); }
  }

  async function verify() {
    if (!supabase || !factor || !/^\d{6}$/.test(code.trim())) {
      Alert.alert("Enter your code", "Enter the six-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    try {
      let activeChallenge = challengeId;
      if (!activeChallenge) {
        const { data, error } = await supabase.auth.mfa.challenge({ factorId: factor.id });
        if (error) throw error;
        activeChallenge = data.id;
        setChallengeId(activeChallenge);
      }
      const { error } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: activeChallenge,
        code: code.trim(),
      });
      if (error) throw error;
      const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (assurance.currentLevel !== "aal2") throw new Error("The session has not reached the required security level. Try a fresh code.");
      setSecret("");
      setCode("");
      setChallengeId("");
      router.replace("/");
    } catch (error) {
      setChallengeId("");
      Alert.alert("Verification failed", error instanceof Error ? error.message : "Check the code and try again.");
    } finally { setBusy(false); }
  }

  async function signOut() {
    const { error } = await supabase?.auth.signOut() ?? { error: new Error("Authentication unavailable.") };
    if (error) Alert.alert("Sign out failed", error.message);
    else router.replace("/auth");
  }

  return <ScrollView contentContainerStyle={s.page}>
    <Text style={s.brand}>ONE-OS</Text>
    <Text style={s.eyebrow}>ACCOUNT SECURITY</Text>
    <Text style={s.title}>{stage === "enroll" ? "Set up two-step verification" : secret ? "Add your authenticator" : "Verify it's you"}</Text>
    <Text style={s.subtitle}>ONE-OS requires an authenticator code before opening your private space.</Text>
    {loading ? <ActivityIndicator color="#b7adff" /> : <>
      {stage === "enroll" ? <>
        <View style={s.card}><Text style={s.body}>Install an authenticator app, then set up a time-based code for ONE-OS. Your private data stays protected until this step is complete.</Text></View>
        <Pressable disabled={busy} onPress={beginEnrollment} style={s.primary}><Text style={s.primaryText}>{busy ? "Please wait…" : "Set up authenticator"}</Text></Pressable>
      </> : <>
        {factor?.status === "unverified" && !secret ? <View style={s.card}><Text style={s.body}>A setup was started earlier but not completed. Use the authenticator entry created during that setup. If you no longer have its setup key, the account recovery and factor-reset flow is not available yet; do not create another factor.</Text></View> : null}
        {secret ? <View style={s.card}>
          <Text style={s.label}>SETUP KEY</Text>
          <Text selectable style={s.secret}>{secret}</Text>
          <Text style={s.body}>In your authenticator app, add an account manually using this key. Keep it private. Then enter the six-digit code below.</Text>
        </View> : <View style={s.card}><Text style={s.body}>Open your authenticator app and enter the current six-digit ONE-OS code.</Text></View>}
        <TextInput value={code} onChangeText={value => setCode(value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit code" placeholderTextColor="#777d8c" keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} style={s.input}/>
        <Pressable disabled={busy || code.length !== 6} onPress={verify} style={[s.primary, (busy || code.length !== 6) && { opacity: 0.55 }]}><Text style={s.primaryText}>{busy ? "Verifying…" : "Verify and continue"}</Text></Pressable>
        {secret ? <Pressable onPress={() => { setSecret(""); setCode(""); setChallengeId(""); void refresh(); }}><Text style={s.action}>I already have an authenticator</Text></Pressable> : null}
      </>}
    </>}
    <Pressable onPress={signOut}><Text style={s.action}>Sign out</Text></Pressable>
  </ScrollView>;
}
const s=StyleSheet.create({page:{flexGrow:1,justifyContent:"center",backgroundColor:"#101216",padding:26},brand:{color:"#f4f2ff",fontSize:18,fontWeight:"800",letterSpacing:4},eyebrow:{color:"#9b8cff",fontSize:10,letterSpacing:2,marginTop:12},title:{color:"#f4f2ff",fontSize:30,fontWeight:"700",marginTop:34},subtitle:{color:"#9699a5",fontSize:14,lineHeight:21,marginTop:10,marginBottom:24},card:{backgroundColor:"#1a1d24",borderColor:"#2a2e38",borderWidth:1,borderRadius:16,padding:16,marginBottom:14},label:{color:"#9699a5",fontSize:10,letterSpacing:1},secret:{color:"#c7bfff",fontSize:17,fontWeight:"700",letterSpacing:1,marginVertical:12},body:{color:"#c3c5ce",fontSize:13,lineHeight:21,marginTop:8},input:{backgroundColor:"#1a1d24",borderWidth:1,borderColor:"#49415f",borderRadius:14,padding:16,color:"#f4f2ff",fontSize:18,letterSpacing:5,textAlign:"center",marginBottom:12},primary:{backgroundColor:"#b7adff",padding:17,borderRadius:14,alignItems:"center"},primaryText:{color:"#101216",fontWeight:"800"},action:{color:"#c7bfff",textAlign:"center",marginTop:22,fontSize:13}});
