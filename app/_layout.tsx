import { useEffect } from "react";
import { AppState } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppStoreProvider } from "@/store/AppStore";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { ensureDeviceCryptoKey } from "@/lib/deviceCrypto";

function SessionGate() {
  const { configured, loading, session, recovery } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const inAuth = segments[0] === "auth";

  useEffect(() => {
    if (loading) return;
    if ((!configured || !session) && !inAuth) router.replace("/auth");
    else if (session && configured && inAuth && !recovery) router.replace("/");
  }, [configured, loading, session, recovery, inAuth, router]);

  // A heartbeat is written only when the authenticated app is online and active.
  // This is the server-observed signal used by the 72-hour pending-snap expiry worker.
  useEffect(() => {
    const userId = session?.user.id;
    const client = supabase;
    if (!configured || !userId || !client) return;
    let cancelled = false;
    const heartbeat = async () => {
      if (cancelled) return;
      const { data } = await client.from("space_members")
        .select("space_id").eq("user_id", userId).limit(1).maybeSingle();
      if (!cancelled && data?.space_id) {
        // This RPC updates server-observed presence and registered device-key activity.
        await client.rpc("touch_my_presence");
        // Register this device's X25519 public key; its private key stays in SecureStore.
        await ensureDeviceCryptoKey(userId).catch(() => undefined);
      }
    };
    void heartbeat();
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void heartbeat();
    });
    return () => { cancelled = true; subscription.remove(); };
  }, [configured, session?.user.id]);

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#101216" } }} />;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AppStoreProvider>
        <StatusBar style="light" />
        <SessionGate />
      </AppStoreProvider>
    </AuthProvider>
  );
}
