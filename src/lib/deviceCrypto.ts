import * as SecureStore from "expo-secure-store";
import { getRandomBytes } from "expo-crypto";
import { x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { supabase } from "@/lib/supabase";


const partnerPinAlias = (userId: string, spaceId: string) =>
  "one-os-snap-partner-pin-v1:" + userId + ":" + spaceId;

/** Short SHA-256 fingerprint to compare with the partner over a separate trusted channel. */
export function partnerKeyFingerprint(ownSecretKey: Uint8Array, partnerPublicKeyHex: string): string {
  const sharedSecret = x25519.getSharedSecret(ownSecretKey, fromHex(partnerPublicKeyHex));
  const fingerprint = toHex(sha256(sharedSecret)).slice(0, 32);
  sharedSecret.fill(0);
  return fingerprint.match(/.{1,4}/g)?.join(" ") ?? fingerprint;
}

export async function getPinnedPartnerPublicKey(userId: string, spaceId: string): Promise<string | null> {
  return SecureStore.getItemAsync(partnerPinAlias(userId, spaceId));
}

/** First-contact pinning is write-once; unexpected key changes are blocked, not silently trusted. */
export async function pinPartnerPublicKey(userId: string, spaceId: string, publicKeyHex: string): Promise<void> {
  const alias = partnerPinAlias(userId, spaceId);
  const existing = await SecureStore.getItemAsync(alias);
  if (existing && existing !== publicKeyHex) {
    throw new Error("Your partner's registered key has changed. Sending is blocked until a verified key-recovery flow is available.");
  }
  if (!existing) {
    await SecureStore.setItemAsync(alias, publicKeyHex, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }
}

export type DeviceCryptoKey = {
  deviceId: string;
  secretKey: Uint8Array;
  publicKey: Uint8Array;
  publicKeyHex: string;
};

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");

function fromHex(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error("Saved device key is malformed.");
  return Uint8Array.from(value.match(/.{2}/g) ?? [], part => parseInt(part, 16));
}

/** Keeps each account's X25519 private key in Android Keystore and publishes only the public key. */
async function createDeviceCryptoKey(userId: string): Promise<DeviceCryptoKey> {
  if (!supabase) throw new Error("Connect Supabase before registering a device key.");
  const deviceAlias = "one-os-snap-device:" + userId;
  const secretAlias = "one-os-snap-x25519:" + userId;
  let deviceId = await SecureStore.getItemAsync(deviceAlias);
  let secretHex = await SecureStore.getItemAsync(secretAlias);

  if (!deviceId && !secretHex) {
    deviceId = toHex(getRandomBytes(16));
    secretHex = toHex(getRandomBytes(32));
    await SecureStore.setItemAsync(deviceAlias, deviceId, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    await SecureStore.setItemAsync(secretAlias, secretHex, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  } else if (!deviceId || !secretHex) {
    throw new Error("This device's photo encryption key is incomplete. Existing encrypted memories were not replaced.");
  }

  const secretKey = fromHex(secretHex);
  if (secretKey.length !== 32 || !/^[0-9a-f]{32}$/.test(deviceId)) {
    throw new Error("This device's photo encryption key is invalid.");
  }

  const publicKey = x25519.getPublicKey(secretKey);
  const publicKeyHex = toHex(publicKey);
  const { error } = await supabase.rpc("register_device_crypto_key", {
    p_device_id: deviceId,
    p_public_key: publicKeyHex,
  });
  if (error) throw error;
  return { deviceId, secretKey, publicKey, publicKeyHex };
}

export async function getPartnerPublicKey(spaceId: string, ownUserId: string): Promise<{ userId: string; deviceId: string; publicKeyHex: string } | null> {
  if (!supabase) throw new Error("Connect Supabase before sharing photos.");
  const { data: partner, error: partnerError } = await supabase
    .from("space_members")
    .select("user_id")
    .eq("space_id", spaceId)
    .neq("user_id", ownUserId)
    .maybeSingle();
  if (partnerError) throw partnerError;
  if (!partner?.user_id) return null;

  const freshness = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const { data: device, error: keyError } = await supabase
    .from("device_crypto_keys")
    .select("device_id,public_key,last_seen_at")
    .eq("user_id", partner.user_id)
    .gt("last_seen_at", freshness)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (keyError) throw keyError;
  return device?.public_key ? { userId: partner.user_id, deviceId: device.device_id, publicKeyHex: device.public_key } : null;
}


const keyRegistrations = new Map<string, Promise<DeviceCryptoKey>>();

/** Coalesces concurrent registration requests so two screens never race to create different first keys. */
export function ensureDeviceCryptoKey(userId: string): Promise<DeviceCryptoKey> {
  const active = keyRegistrations.get(userId);
  if (active) return active;
  const pending = createDeviceCryptoKey(userId).finally(() => {
    if (keyRegistrations.get(userId) === pending) keyRegistrations.delete(userId);
  });
  keyRegistrations.set(userId, pending);
  return pending;
}
