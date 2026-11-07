import { useEffect } from "react";
import { AppState } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppStoreProvider } from "@/store/AppStore";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";

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
    if (!configured || !userId || !supabase) return;
    let cancelled = false;
    const heartbeat = async () => {
      const client = supabase;
      if (!client || cancelled) return;
      const { data } = await client.from("space_members")
        .select("space_id").eq("user_id", userId).limit(1).maybeSingle();
      if (!cancelled && data?.space_id) {
        await client.rpc("oneos_heartbeat", { p_space_id: data.space_id });
        // Register a public recipient key automatically; the private key never leaves SecureStore.
        await registerMyPhotoKey(userId, data.space_id).catch(() => undefined);
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
