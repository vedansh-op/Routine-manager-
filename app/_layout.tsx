import { useEffect } from "react";
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
