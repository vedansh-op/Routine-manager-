import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { x25519 } from "@noble/curves/ed25519.js";
import { supabase } from "@/lib/supabase";

const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  if (!ACCOUNT_ID_PATTERN.test(userId)) {
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


export type LocalEncryptedDataInventory = {
  status: "complete" | "unknown";
  dataKey: "present-valid" | "present-malformed" | "missing" | "unknown";
  appStoreRecord: "encrypted" | "legacy-plaintext" | "absent" | "unknown";
  legacyUnscopedAppStoreRecord: "present" | "absent" | "unknown";
  snapIndex: "encrypted" | "legacy-plaintext" | "absent" | "unknown";
  snapVault: "contains-entries" | "empty-visible" | "not-visible" | "unknown";
  snapVaultFileCount: number | null;
};

/**
 * Read-only inventory of local encrypted account data and its data-key alias.
 *
 * This deliberately does not decrypt, migrate, create, overwrite, or delete
 * anything. "not-visible" is not treated as proof that the vault is empty:
 * Expo reports inaccessible and missing directories identically.
 */
export async function inspectLocalEncryptedData(userId: string): Promise<LocalEncryptedDataInventory> {
  if (!ACCOUNT_ID_PATTERN.test(userId)) {
    throw new Error("A valid account ID is required to inspect local encrypted data.");
  }

  const result: LocalEncryptedDataInventory = {
    status: "unknown",
    dataKey: "unknown",
    appStoreRecord: "unknown",
    legacyUnscopedAppStoreRecord: "unknown",
    snapIndex: "unknown",
    snapVault: "unknown",
    snapVaultFileCount: null,
  };

  try {
    const [dataKeyHex, appStoreRaw, legacyRaw, snapIndexRaw] = await Promise.all([
      SecureStore.getItemAsync("one-os-data-key:" + userId),
      AsyncStorage.getItem("one-os-v2:" + userId),
      AsyncStorage.getItem("one-os-v1"),
      AsyncStorage.getItem("one-os-snap-index-v1:" + userId),
    ]);

    if (dataKeyHex === null) result.dataKey = "missing";
    else result.dataKey = /^(?:[0-9a-f]{2}){32}$/i.test(dataKeyHex) ? "present-valid" : "present-malformed";

    result.appStoreRecord = appStoreRaw === null
      ? "absent"
      : appStoreRaw.startsWith("enc1:") ? "encrypted" : "legacy-plaintext";
    result.legacyUnscopedAppStoreRecord = legacyRaw === null ? "absent" : "present";
    result.snapIndex = snapIndexRaw === null
      ? "absent"
      : snapIndexRaw.startsWith("enc1:") ? "encrypted" : "legacy-plaintext";

    // Inspect from the accessible document root downward. A missing
    // per-user directory is considered empty only after its parent was
    // successfully listed; an inaccessible parent remains unknown.
    const documents = new Directory(Paths.document);
    if (!documents.exists) {
      result.snapVault = "unknown";
    } else {
      const documentEntries = documents.list();
      const vaultRoot = documentEntries.find(
        entry => entry instanceof Directory && entry.name === "oneos-private-snaps",
      );
      if (!vaultRoot) {
        result.snapVault = "empty-visible";
        result.snapVaultFileCount = 0;
      } else {
        const userEntries = vaultRoot.list();
        const userDirectory = userEntries.find(
          entry => entry instanceof Directory && entry.name === userId,
        );
        if (!userDirectory) {
          result.snapVault = "empty-visible";
          result.snapVaultFileCount = 0;
        } else {
          const entries = userDirectory.list();
          const files = entries.filter(entry => entry instanceof File);
          result.snapVaultFileCount = files.length;
          result.snapVault = entries.length > 0 ? "contains-entries" : "empty-visible";
        }
      }
    }

    result.status = "complete";
    return result;
  } catch {
    // Preserve partial observations but never convert an inspection failure
    // into an "empty" result that could authorize fresh-key generation.
    return result;
  }
}
