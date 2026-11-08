import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { getLocalDeviceId } from "@/lib/deviceCrypto";

type DeviceRow = {
  device_id: string;
  public_key: string;
  last_seen_at: string;
  revoked_at: string | null;
};

export default function AccountScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    if (!user || !supabase) {
      setDevices([]);
      setLoadingDevices(false);
      return;
    }
    setLoadingDevices(true);
    try {
      const localId = await getLocalDeviceId(user.id);
      setCurrentDeviceId(localId);
      const { data, error } = await supabase
        .from("device_crypto_keys")
        .select("device_id,public_key,last_seen_at,revoked_at")
        .eq("user_id", user.id)
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      setDevices((data ?? []) as DeviceRow[]);
    } catch (error) {
      Alert.alert("Couldn't load devices", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setLoadingDevices(false);
    }
  }, [user]);

  useEffect(() => { void loadDevices(); }, [loadDevices]);

  async function revokeDevice(deviceId: string) {
    if (!supabase) return;
    setRevokingId(deviceId);
    try {
      const { error } = await supabase.rpc("revoke_device_crypto_key", {
        p_device_id: deviceId,
      });
      if (error) throw error;
      await loadDevices();
      Alert.alert("Device revoked", "That device's encryption key is revoked, so it cannot receive new private Snaps or read retained Snap ciphertext. This does not end its ONE-OS login session or erase files already downloaded to it.");
    } catch (error) {
      Alert.alert("Couldn't revoke device", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setRevokingId(null);
    }
  }

  function confirmRevoke(device: DeviceRow) {
    Alert.alert(
      "Revoke this device?",
      "Its photo-encryption key will be revoked. This does not sign the device out of ONE-OS or erase files already downloaded there. Make sure you have access to another trusted device first.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Revoke device", style: "destructive", onPress: () => void revokeDevice(device.device_id) },
      ],
    );
  }

  async function signOut() {
    const { error } = await supabase?.auth.signOut() ?? { error: new Error("Authentication is not configured.") };
    if (error) Alert.alert("Sign out failed", error.message);
    else router.replace("/auth");
  }

  return <ScrollView style={s.page} contentContainerStyle={s.content}>
    <Text style={s.eyebrow}>ACCOUNT</Text>
    <Text style={s.title}>Your identity</Text>
    <View style={s.card}>
      <Text style={s.label}>SIGNED IN AS</Text>
      <Text style={s.value}>{user?.email ?? "Unknown"}</Text>
      <Text style={s.meta}>User ID</Text>
      <Text selectable style={s.id}>{user?.id ?? "—"}</Text>
    </View>

    <View style={s.card}>
      <View style={s.sectionRow}>
        <Text style={s.sectionTitle}>Your devices</Text>
        <Pressable onPress={() => void loadDevices()}><Text style={s.refresh}>Refresh</Text></Pressable>
      </View>
      <Text style={s.description}>A device listed here has a registered photo-encryption key. Revoking a device key blocks Snap encryption-key access. It does not yet terminate that phone's ONE-OS login session or erase files already saved there.</Text>
      {loadingDevices ? <ActivityIndicator color="#b7adff" /> : devices.length ? devices.map(device => {
        const isCurrent = device.device_id === currentDeviceId;
        const isRevoked = Boolean(device.revoked_at);
        return <View key={device.device_id} style={s.device}>
          <View style={s.deviceHeading}>
            <Text style={s.deviceName}>{isCurrent ? "This phone" : "Registered device"}</Text>
            <Text style={[s.status, isRevoked ? s.revoked : isCurrent ? s.current : s.active]}>
              {isRevoked ? "REVOKED" : isCurrent ? "THIS DEVICE" : "ACTIVE"}
            </Text>
          </View>
          <Text selectable style={s.deviceId}>{device.device_id}</Text>
          <Text style={s.deviceDate}>Last seen: {new Date(device.last_seen_at).toLocaleString()}</Text>
          {!isRevoked && !isCurrent ? <Pressable
            disabled={Boolean(revokingId)}
            style={[s.revokeButton, Boolean(revokingId) && s.disabled]}
            onPress={() => confirmRevoke(device)}
          >
            {revokingId === device.device_id ? <ActivityIndicator color="#ffb7c5" /> : <Text style={s.revokeText}>Revoke this device</Text>}
          </Pressable> : null}
        </View>;
      }) : <Text style={s.description}>No registered devices found yet. Open ONE-OS on this phone after completing MFA.</Text>}
    </View>

    <Pressable onPress={signOut} style={s.button}><Text style={s.buttonText}>Sign out</Text></Pressable>
    <Pressable onPress={() => router.back()}><Text style={s.back}>Back to ONE-OS</Text></Pressable>
  </ScrollView>;
}

const s=StyleSheet.create({
  page:{flex:1,backgroundColor:"#101216"},content:{padding:24,paddingTop:64,paddingBottom:48},
  eyebrow:{color:"#9b8cff",fontSize:10,letterSpacing:2,fontWeight:"700"},
  title:{color:"#f4f2ff",fontSize:34,fontWeight:"700",marginTop:12},
  card:{backgroundColor:"#1a1d24",borderColor:"#2a2e38",borderWidth:1,borderRadius:18,padding:18,marginTop:24},
  label:{color:"#9699a5",fontSize:10,letterSpacing:1},value:{color:"#f4f2ff",fontSize:16,marginTop:8},
  meta:{color:"#9699a5",fontSize:10,marginTop:24},id:{color:"#c7bfff",fontSize:11,marginTop:6},
  sectionRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  sectionTitle:{color:"#f4f2ff",fontSize:17,fontWeight:"700"},refresh:{color:"#c7bfff",fontSize:12,fontWeight:"700"},
  description:{color:"#9699a5",fontSize:12,lineHeight:19,marginTop:9},
  device:{borderTopWidth:1,borderTopColor:"#303440",marginTop:15,paddingTop:14},
  deviceHeading:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  deviceName:{color:"#f4f2ff",fontSize:13,fontWeight:"700"},
  status:{fontSize:9,fontWeight:"800",letterSpacing:1},current:{color:"#b7adff"},active:{color:"#9bd8b1"},revoked:{color:"#ff9eae"},
  deviceId:{color:"#c7bfff",fontSize:11,marginTop:8},deviceDate:{color:"#858b98",fontSize:10,marginTop:6},
  revokeButton:{alignSelf:"flex-start",borderWidth:1,borderColor:"#70404b",borderRadius:10,paddingVertical:9,paddingHorizontal:13,marginTop:12},
  revokeText:{color:"#ffb7c5",fontSize:11,fontWeight:"800"},disabled:{opacity:0.5},
  button:{backgroundColor:"#3b2730",borderRadius:14,padding:17,alignItems:"center",marginTop:24},
  buttonText:{color:"#ffb7c5",fontWeight:"700"},back:{color:"#c7bfff",textAlign:"center",marginTop:20},
});
