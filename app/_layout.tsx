import { useEffect, useState } from "react";
import { AppState, ActivityIndicator, View } from "react-native";
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
  const route = segments[0];
  const inAuth = route === "auth";
  const inMfa = route === "mfa";
  const inVerifyEmail = route === "verify-email";
  const emailVerified = Boolean(session?.user.email_confirmed_at);
  const [assuranceReady, setAssuranceReady] = useState(false);
  const [aal2, setAal2] = useState(false);

  useEffect(() => {
    let alive = true;
    setAssuranceReady(false);
    setAal2(false);
    if (!session || !supabase || recovery || !emailVerified) {
      setAssuranceReady(true);
      return () => { alive = false; };
    }
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data, error }) => {
      if (!alive) return;
      setAal2(!error && data.currentLevel === "aal2");
      setAssuranceReady(true);
    }).catch(() => { if (alive) setAssuranceReady(true); });
    return () => { alive = false; };
  }, [session?.access_token, recovery, emailVerified]);

  useEffect(() => {
    if (loading || (!assuranceReady && session && emailVerified && !recovery)) return;
    if ((!configured || !session) && !inAuth) router.replace("/auth");
    else if (session && configured && !recovery && !emailVerified && !inVerifyEmail) router.replace("/verify-email");
    else if (session && configured && emailVerified && !recovery && !aal2 && !inMfa) router.replace("/mfa");
    else if (session && configured && emailVerified && !recovery && aal2 && (inAuth || inMfa || inVerifyEmail)) router.replace("/");
  }, [configured, loading, session, emailVerified, recovery, assuranceReady, aal2, inAuth, inMfa, inVerifyEmail, router]);

  // Heartbeat and device-key registration run only after the session reaches AAL2.
  useEffect(() => {
    const userId = session?.user.id;
    const client = supabase;
    if (!configured || !userId || !client || !aal2) return;
    let cancelled = false;
    const heartbeat = async () => {
      if (cancelled) return;
      const { data } = await client.from("space_members")
        .select("space_id").eq("user_id", userId).limit(1).maybeSingle();
      if (!cancelled && data?.space_id) {
        await client.rpc("touch_my_presence");
        await ensureDeviceCryptoKey(userId).catch(() => undefined);
      }
    };
    void heartbeat();
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void heartbeat();
    });
    return () => { cancelled = true; subscription.remove(); };
  }, [configured, session?.user.id, aal2]);

  if (session && !recovery && !inVerifyEmail && (!emailVerified || (!inMfa && (!assuranceReady || !aal2)))) {
    return <View style={{ flex: 1, backgroundColor: "#101216", alignItems: "center", justifyContent: "center" }}><ActivityIndicator color="#b7adff" /></View>;
  }
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
