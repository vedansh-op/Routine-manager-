import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import type { Factor } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type TotpFactor = { id: string; friendly_name?: string | null; status?: string; factor_type?: string };

export default function SecurityScreen() {
  const router = useRouter();
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState("");
  const [pendingFactor, setPendingFactor] = useState<TotpFactor | null>(null);
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");

  const refresh = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      setFactors(((data.totp ?? []) as TotpFactor[]).filter(f => f.status === "verified"));
    } catch (error) {
      Alert.alert("Couldn't load authenticators", error instanceof Error ? error.message : "Please try again.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function addBackup() {
    if (!supabase) return;
    if (factors.length !== 1) {
      Alert.alert("Not available", "ONE-OS currently supports one primary and one backup authenticator. Add a backup only after your primary is verified.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "ONE-OS backup authenticator" });
      if (error) throw error;
      setPendingFactor({ id: data.id, friendly_name: "ONE-OS backup authenticator", status: "unverified", factor_type: "totp" });
      setSecret(data.totp.secret);
      setCode("");
      setChallengeId("");
    } catch (error) {
      Alert.alert("Couldn't add backup", error instanceof Error ? error.message : "Please try again.");
    } finally { setBusy(false); }
  }

  async function verifyBackup() {
    if (!supabase || !pendingFactor || !/^\d{6}$/.test(code.trim())) {
      Alert.alert("Enter your code", "Enter the six-digit code from the new backup authenticator.");
      return;
    }
    setBusy(true);
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: pendingFactor.id });
      if (challengeError) throw challengeError;
      const { error } = await supabase.auth.mfa.verify({ factorId: pendingFactor.id, challengeId: challenge.id, code: code.trim() });
      if (error) throw error;
      const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (assurance.currentLevel !== "aal2") throw new Error("The session did not reach AAL2. Please retry with a fresh code.");
      setSecret("");
      setCode("");
      setPendingFactor(null);
      setChallengeId("");
      await refresh();
      Alert.alert("Backup authenticator added", "Keep this authenticator separate from your primary one. It can help you regain MFA access, but it does not restore encrypted files if a device key is lost.");
    } catch (error) {
      Alert.alert("Verification failed", error instanceof Error ? error.message : "Check the code and try again.");
    } finally { setBusy(false); }
  }

  function removeBackup(factor: TotpFactor) {
    if (!supabase) return;
    if (factors.length <= 1) {
      Alert.alert("Primary authenticator required", "ONE-OS will not remove your last verified authenticator.");
      return;
    }
    Alert.alert("Remove backup authenticator?", "Only remove it if your primary authenticator is working and available.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => { void (async () => {
        setBusy(true);
        try {
          const { error } = await supabase!.auth.mfa.unenroll({ factorId: factor.id });
          if (error) throw error;
          await refresh();
        } catch (error) {
          Alert.alert("Couldn't remove authenticator", error instanceof Error ? error.message : "Please try again.");
        } finally { setBusy(false); }
      })(); } },
    ]);
  }

  return <ScrollView contentContainerStyle={s.page}>
    <Text style={s.brand}>ONE-OS</Text>
    <Text style={s.eyebrow}>SECURITY SETTINGS</Text>
    <Text style={s.title}>Authenticators</Text>
    <Text style={s.subtitle}>Keep a second authenticator in a separate, secure place. This protects account access if your primary authenticator becomes unavailable. It does not recover your encrypted photo keys.</Text>
    {loading ? <ActivityIndicator color="#b7adff" /> : <>
      <View style={s.card}>
        <Text style={s.label}>VERIFIED TOTP FACTORS</Text>
        {factors.map((factor, index) => <View key={factor.id} style={s.factor}>
          <Text style={s.factorName}>{factor.friendly_name || "ONE-OS authenticator"}</Text>
          <Text style={s.body}>{index === 0 ? "Primary / first enrolled" : "Additional authenticator"}</Text>
          {factors.length > 1 && index > 0 ? <Pressable disabled={busy} onPress={() => removeBackup(factor)}><Text style={s.remove}>Remove additional authenticator</Text></Pressable> : null}
        </View>)}
        {factors.length === 0 ? <Text style={s.body}>No verified authenticator was found. Complete the sign-in MFA setup first.</Text> : null}
      </View>
      {pendingFactor ? <View style={s.card}>
        <Text style={s.label}>BACKUP SETUP KEY — SHOWN ONCE</Text>
        <Text selectable style={s.secret}>{secret}</Text>
        <Text style={s.body}>Add this as a separate account in your authenticator app. Store it somewhere separate from your primary authenticator. Then enter its current six-digit code.</Text>
        <TextInput value={code} onChangeText={v => setCode(v.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit code" placeholderTextColor="#777d8c" keyboardType="number-pad" maxLength={6} style={s.input}/>
        <Pressable disabled={busy || code.length !== 6} onPress={() => void verifyBackup()} style={s.primary}><Text style={s.primaryText}>{busy ? "Verifying…" : "Verify backup authenticator"}</Text></Pressable>
        <Pressable disabled={busy} onPress={() => { setSecret(""); setPendingFactor(null); setCode(""); setChallengeId(""); void refresh(); }}><Text style={s.cancel}>Cancel setup</Text></Pressable>
      </View> : factors.length === 1 ? <Pressable disabled={busy} onPress={() => void addBackup()} style={s.primary}><Text style={s.primaryText}>{busy ? "Please wait…" : "Add backup authenticator"}</Text></Pressable> : null}
    </>}
    <Pressable onPress={() => void refresh()}><Text style={s.cancel}>Refresh factors</Text></Pressable>
    <Pressable onPress={() => router.back()}><Text style={s.cancel}>Back</Text></Pressable>
  </ScrollView>;
}

const s = StyleSheet.create({
  page:{flexGrow:1,justifyContent:"center",backgroundColor:"#101216",padding:24},
  brand:{color:"#f4f2ff",fontSize:18,fontWeight:"800",letterSpacing:4},
  eyebrow:{color:"#9b8cff",fontSize:10,letterSpacing:2,marginTop:12},
  title:{color:"#f4f2ff",fontSize:30,fontWeight:"700",marginTop:28},
  subtitle:{color:"#9699a5",fontSize:14,lineHeight:21,marginTop:10,marginBottom:18},
  card:{backgroundColor:"#1a1d24",borderColor:"#2a2e38",borderWidth:1,borderRadius:16,padding:16,marginBottom:14},
  label:{color:"#9699a5",fontSize:10,letterSpacing:1},
  factor:{borderTopWidth:1,borderTopColor:"#303440",paddingTop:12,marginTop:12},
  factorName:{color:"#f4f2ff",fontSize:14,fontWeight:"700"},
  body:{color:"#c3c5ce",fontSize:13,lineHeight:21,marginTop:8},
  secret:{color:"#c7bfff",fontSize:17,fontWeight:"700",letterSpacing:1,marginVertical:12},
  input:{backgroundColor:"#101216",borderWidth:1,borderColor:"#49415f",borderRadius:14,padding:16,color:"#f4f2ff",fontSize:18,letterSpacing:5,textAlign:"center",marginTop:12,marginBottom:12},
  primary:{backgroundColor:"#b7adff",padding:16,borderRadius:14,alignItems:"center",marginBottom:8},
  primaryText:{color:"#101216",fontWeight:"800"},
  remove:{color:"#ffb7c5",fontSize:12,fontWeight:"700",marginTop:12},
  cancel:{color:"#c7bfff",textAlign:"center",marginTop:18,fontSize:13},
});
