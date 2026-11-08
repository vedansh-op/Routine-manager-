import { createClient } from "@supabase/supabase-js";
import { createSecureSessionStorage } from "@/lib/secureSessionStorage";

// These are public client-side Supabase values. Never put a service-role or secret key here.
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "https://uvewcpctoprtdovcopya.supabase.co";
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_PItKsimEPXin4Nzat06qbA_5gjkuW21";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Keep Supabase's existing default storage key so current installations can
// migrate their session from AsyncStorage into SecureStore on first read.
const authStorageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: createSecureSessionStorage(authStorageKey),
        storageKey: authStorageKey,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;
