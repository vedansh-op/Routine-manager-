import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Linking } from "react-native";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  recovery: boolean;
  clearRecovery: () => void;
};
const AuthContext = createContext<AuthContextValue | null>(null);

async function acceptAuthUrl(
  url: string,
  setRecovery: (value: boolean) => void,
  shouldContinue: () => boolean,
) {
  if (!supabase || !shouldContinue()) return;
  try {
    const parsed = new URL(url);
    const query = new URLSearchParams(parsed.search);
    const hash = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token") ?? query.get("access_token");
    const refreshToken = hash.get("refresh_token") ?? query.get("refresh_token");
    const code = query.get("code");
    const isRecovery = (hash.get("type") ?? query.get("type")) === "recovery";
    // Supabase PKCE links return a one-time code; implicit-flow links return tokens.
    // Do not enter recovery mode until Supabase has accepted the credentials.
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
    } else if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (error) throw error;
    } else {
      return;
    }
    if (isRecovery && shouldContinue()) setRecovery(true);
  } catch {
    // Ignore unrelated, expired, or malformed deep links.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let alive = true;
    let receivedAuthEvent = false;
    // Subscribe before reading the persisted session. If sign-in/sign-out fires
    // while getSession is pending, its newer event must win over the snapshot.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      receivedAuthEvent = true;
      if (alive) {
        setSession(nextSession);
        setLoading(false);
      }
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      if (alive && !receivedAuthEvent) setSession(data.session);
    }).catch(() => {
      // Keep the current auth-event session (or signed-out state) on read failure.
    }).finally(() => {
      if (alive) setLoading(false);
    });
    Linking.getInitialURL().then(url => {
      if (url) void acceptAuthUrl(url, setRecovery);
    });
    const linkListener = Linking.addEventListener("url", ({ url }) => {
      void acceptAuthUrl(url, setRecovery);
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
      linkListener.remove();
    };
  }, []);

  const clearRecovery = useCallback(() => setRecovery(false), []);
  const value = useMemo(() => ({
    configured: isSupabaseConfigured,
    loading,
    session,
    user: session?.user ?? null,
    recovery,
    clearRecovery,
  }), [loading, session, recovery, clearRecovery]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
