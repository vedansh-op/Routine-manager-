import * as SecureStore from "expo-secure-store";
import { x25519 } from "@noble/curves/ed25519.js";
import { supabase } from "@/lib/supabase";

const LEGACY_DEVICE_ID_PREFIX = "one-os-snap-device:";
const LEGACY_DEVICE_SECRET_PREFIX = "one-os-snap-x25519:";

export type LegacyDeviceKeyInspection =
  | { status: "absent"; deviceIdPresent: false; secretPresent: false }
  | { status: "partial"; deviceIdPresent: boolean; secretPresent: boolean }
  | { status: "malformed"; deviceIdPresent: true; secretPresent: true }
  | { status: "server-unavailable"; deviceIdPresent: true; secretPresent: true }
  | { status: "server-error"; deviceIdPresent: true; secretPresent: true }
  | { status: "server-mismatch"; deviceIdPresent: true; secretPresent: true }
  | { status: "valid"; deviceIdPresent: true; secretPresent: true; revoked: boolean };

/**
 * Read-only inspection of the pre-registry device key aliases.
 *
 * This function never creates, updates, registers, or deletes key material.
 * It intentionally returns no device ID, private key, or public key so callers
 * cannot accidentally place key material in UI state or logs.
 */
export async function inspectLegacyDeviceKey(userId: string): Promise<LegacyDeviceKeyInspection> {
  if (!userId || userId.length > 128) {
    throw new Error("A valid account ID is required to inspect local key storage.");
  }

  const [deviceId, secretHex] = await Promise.all([
    SecureStore.getItemAsync(LEGACY_DEVICE_ID_PREFIX + userId),
    SecureStore.getItemAsync(LEGACY_DEVICE_SECRET_PREFIX + userId),
  ]);

  const deviceIdPresent = deviceId !== null;
  const secretPresent = secretHex !== null;

  if (!deviceIdPresent && !secretPresent) {
    return { status: "absent", deviceIdPresent: false, secretPresent: false };
  }
  if (!deviceIdPresent || !secretPresent) {
    return { status: "partial", deviceIdPresent, secretPresent };
  }

  if (!/^[0-9a-f]{32}$/.test(deviceId!) || !/^(?:[0-9a-f]{2}){32}$/.test(secretHex!)) {
    return { status: "malformed", deviceIdPresent: true, secretPresent: true };
  }

  if (!supabase) {
    return { status: "server-unavailable", deviceIdPresent: true, secretPresent: true };
  }

  let publicKeyHex: string;
  try {
    const secretKey = Uint8Array.from(
      secretHex!.match(/.{2}/g) ?? [],
      part => Number.parseInt(part, 16),
    );
    try {
      const publicKey = x25519.getPublicKey(secretKey);
      publicKeyHex = Array.from(publicKey, value => value.toString(16).padStart(2, "0")).join("");
    } finally {
      secretKey.fill(0);
    }
  } catch {
    return { status: "malformed", deviceIdPresent: true, secretPresent: true };
  }

  const { data, error } = await supabase
    .from("device_crypto_keys")
    .select("public_key,revoked_at")
    .eq("user_id", userId)
    .eq("device_id", deviceId!)
    .maybeSingle();

  if (error) {
    return { status: "server-error", deviceIdPresent: true, secretPresent: true };
  }
  if (!data?.public_key || data.public_key.toLowerCase() !== publicKeyHex) {
    return { status: "server-mismatch", deviceIdPresent: true, secretPresent: true };
  }

  return {
    status: "valid",
    deviceIdPresent: true,
    secretPresent: true,
    revoked: data.revoked_at !== null,
  };
}
