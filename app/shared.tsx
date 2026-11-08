import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";

type Membership = { space_id: string; role: string; spaces?: { name?: string } | null };

export default function SharedSpaceScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [connectionEnded, setConnectionEnded] = useState(false);
  const [endPhrase, setEndPhrase] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabase || !user) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("space_members")
      .select("space_id, role, spaces(name)")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (error) Alert.alert("Couldn't load shared space", error.message);
    else {
      setMembership(data as Membership | null);
      if (data?.space_id) {
        const { data: archive, error: archiveError } = await supabase
          .from("shared_archives").select("ended_at")
          .eq("source_space_id", data.space_id).maybeSingle();
        if (archiveError) Alert.alert("Couldn't check connection status", archiveError.message);
        setConnectionEnded(Boolean(archive?.ended_at));
      } else setConnectionEnded(false);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function createSpace() {
    if (!supabase) return Alert.alert("Setup required", "Connect your Supabase project first.");
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("create_shared_space", { p_name: "Our shared space" });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.invite_code) throw new Error("The server did not return an invitation code.");
      setGeneratedCode(result.invite_code);
      setExpiresAt(result.expires_at);
      await refresh();
    } catch (error) {
      Alert.alert("Couldn't create space", error instanceof Error ? error.message : "Please try again.");
    } finally { setBusy(false); }
  }

  async function renewInvite() {
    if (!supabase) return Alert.alert("Setup required", "Connect your Supabase project first.");
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("rotate_shared_invite");
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.invite_code) throw new Error("The server did not return a replacement invitation code.");
      setGeneratedCode(result.invite_code);
      setExpiresAt(result.expires_at);
      Alert.alert("New invitation code ready", "The previous unused code has been invalidated. Share this new code privately.");
    } catch (error) {
      Alert.alert("Couldn't renew invitation", error instanceof Error ? error.message : "Please try again.");
    } finally { setBusy(false); }
  }

  async function endConnection() {
    if (!supabase || !membership) return;
    if (endPhrase !== "END CONNECTION") {
      return Alert.alert("Confirmation does not match", "Type END CONNECTION exactly to continue.");
    }
    setBusy(true);
    try {
      const { error } = await supabase.rpc("end_shared_connection", {
        p_space_id: membership.space_id,
        p_confirmation: endPhrase,
      });
      if (error) throw error;
      setEndPhrase("");
      await refresh();
      Alert.alert("Connection ended", "Future shared updates and Snap sends are stopped. Your existing shared calendar history remains available as read-only.");
    } catch (error) {
      Alert.alert("Couldn't end connection", error instanceof Error ? error.message : "Please try again. Recent multi-factor authentication is required.");
    } finally { setBusy(false); }
  }

  async function joinSpace() {
    const code = inviteCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 24) return Alert.alert("Check the code", "Enter the 24-character invitation code.");
    if (!supabase) return Alert.alert("Setup required", "Connect your Supabase project first.");
    setBusy(true);
    try {
      const { error } = await supabase.rpc("join_shared_space", { p_code: code });
      if (error) throw error;
      setInviteCode("");
      setGeneratedCode("");
      await refresh();
      Alert.alert("You're connected", "This account has joined the shared space.");
    } catch (error) {
      Alert.alert("Couldn't join space", error instanceof Error ? error.message : "Please try again.");
    } finally { setBusy(false); }
  }

  return <ScrollView style={s.page} contentContainerStyle={s.body}>
    <Pressable onPress={() => router.back()}><Text style={s.back}>←  Back</Text></Pressable>
    <Text style={s.eyebrow}>TWO PEOPLE · ONE SHARED SPACE</Text>
    <Text style={s.title}>Stay in sync.</Text>
    <Text style={s.subtitle}>Connect two ONE-OS accounts with a private, one-time invitation code. Your personal space remains yours.</Text>
    {loading ? <ActivityIndicator color="#b7adff" /> : membership ? <View style={s.card}>
      <Text style={s.label}>CONNECTED SPACE</Text>
      <Text style={s.spaceName}>{membership.spaces?.name ?? "Our shared space"}</Text>
      <Text style={s.copy}>You're connected as {membership.role}. Shared features will appear here as they are enabled.</Text>
      <Text style={s.meta}>Space ID</Text><Text selectable style={s.id}>{membership.space_id}</Text>
      {connectionEnded ? <View style={s.codePanel}><Text style={s.label}>READ-ONLY HISTORY</Text><Text style={s.copy}>This connection has ended. Existing shared calendar history is retained, but new shared updates and Snap sends are stopped.</Text></View> : membership.role === "owner" ? <>
        <Text style={s.copy}>Lost the code or did it expire? You can issue a replacement before your partner joins. Any older unused code will stop working.</Text>
        <Pressable disabled={busy} onPress={() => void renewInvite()} style={[s.secondary, busy && s.disabled]}>
          {busy ? <ActivityIndicator color="#d8d1ff" /> : <Text style={s.secondaryText}>Generate replacement code</Text>}
        </Pressable>
      </> : null}
      <View style={s.codePanel}>
        <Text style={s.label}>END CONNECTION</Text>
        <Text style={s.copy}>This stops future shared updates. Existing shared calendar history remains read-only. Your account must have recent multi-factor authentication.</Text>
        <TextInput value={endPhrase} onChangeText={setEndPhrase} placeholder="Type END CONNECTION" placeholderTextColor="#777d8c" autoCapitalize="characters" autoCorrect={false} style={s.input} />
        <Pressable disabled={busy || connectionEnded || endPhrase !== "END CONNECTION"} onPress={() => void endConnection()} style={[s.secondary, (busy || connectionEnded || endPhrase !== "END CONNECTION") && s.disabled]}>
          <Text style={s.secondaryText}>Confirm End Connection</Text>
        </Pressable>
      </View>
      {!!generatedCode && <View style={s.codePanel}>
        <Text style={s.label}>YOUR INVITATION CODE</Text>
        <Text selectable style={s.code}>{generatedCode}</Text>
        <Text style={s.copy}>Copy this code now and send it privately. It can be used once and expires {expiresAt ? new Date(expiresAt).toLocaleString() : "in 7 days"}.</Text>
      </View>}
    </View> : <>
      <View style={s.card}>
        <Text style={s.cardTitle}>Create a shared space</Text>
        <Text style={s.copy}>Generate an 24-character code and send it privately to the person you want to connect with.</Text>
        <Pressable disabled={busy} onPress={createSpace} style={[s.primary, busy && s.disabled]}>
          {busy ? <ActivityIndicator color="#101216" /> : <Text style={s.primaryText}>Create space & generate code</Text>}
        </Pressable>
        {!!generatedCode && <View style={s.codePanel}>
          <Text style={s.label}>YOUR INVITATION CODE</Text>
          <Text selectable style={s.code}>{generatedCode}</Text>
          <Text style={s.copy}>Share this code with the other person. It can be used once and expires {expiresAt ? new Date(expiresAt).toLocaleString() : "in 7 days"}.</Text>
        </View>}
      </View>
      <View style={s.card}>
        <Text style={s.cardTitle}>Join with a code</Text>
        <Text style={s.copy}>Already received an invitation? Enter the code below using your own ONE-OS account.</Text>
        <TextInput value={inviteCode} onChangeText={setInviteCode} placeholder="12-character code" placeholderTextColor="#777d8c" autoCapitalize="characters" autoCorrect={false} maxLength={24} style={s.input} />
        <Pressable disabled={busy} onPress={joinSpace} style={[s.secondary, busy && s.disabled]}>
          <Text style={s.secondaryText}>Join shared space</Text>
        </Pressable>
      </View>
    </>}
    <Text style={s.foot}>Invitation codes are single-use and expire after 7 days. A shared space supports two members.</Text>
  </ScrollView>;
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor:"#101216"},body:{padding:24,paddingTop:58,paddingBottom:50},back:{color:"#c7bfff",fontSize:14,marginBottom:34},
  eyebrow:{color:"#9b8cff",fontSize:10,letterSpacing:2,fontWeight:"700"},title:{color:"#f4f2ff",fontSize:38,fontWeight:"700",marginTop:14},
  subtitle:{color:"#9699a5",fontSize:14,lineHeight:22,marginTop:10,marginBottom:26},
  card:{backgroundColor:"#1a1d24",borderColor:"#2a2e38",borderWidth:1,borderRadius:18,padding:18,marginBottom:16},
  cardTitle:{color:"#f4f2ff",fontSize:18,fontWeight:"700"},copy:{color:"#9699a5",fontSize:13,lineHeight:20,marginTop:9},
  primary:{backgroundColor:"#b7adff",padding:16,borderRadius:13,alignItems:"center",marginTop:18},primaryText:{color:"#101216",fontWeight:"800"},
  secondary:{backgroundColor:"#29243a",padding:16,borderRadius:13,alignItems:"center",marginTop:12},secondaryText:{color:"#d8d1ff",fontWeight:"800"},
  input:{backgroundColor:"#101216",borderWidth:1,borderColor:"#3b3e4a",borderRadius:12,padding:15,color:"#f4f2ff",marginTop:16,fontSize:16,letterSpacing:2},
  disabled:{opacity:0.55},codePanel:{backgroundColor:"#101216",borderRadius:14,padding:16,marginTop:18},
  label:{color:"#9699a5",fontSize:10,letterSpacing:1,fontWeight:"700"},code:{color:"#c7bfff",fontSize:30,fontWeight:"800",letterSpacing:5,marginTop:10},
  spaceName:{color:"#f4f2ff",fontSize:22,fontWeight:"700",marginTop:12},meta:{color:"#9699a5",fontSize:10,marginTop:22},id:{color:"#c7bfff",fontSize:11,marginTop:6},
  foot:{color:"#666c79",fontSize:11,lineHeight:18,textAlign:"center",marginTop:12}
});
