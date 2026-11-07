import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { getRandomBytes } from "expo-crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const KEY_PREFIX = "one-os-data-key:";
const ENCRYPTED_PREFIX = "enc1:";
const toHex = (bytes: Uint8Array) => Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
function fromHex(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error("Encrypted local data is malformed.");
  return Uint8Array.from(value.match(/.{2}/g) ?? [], part => parseInt(part, 16));
}
function encodeUtf8(value: string): Uint8Array {
  const encoded = encodeURIComponent(value);
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === "%") {
      bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(encoded.charCodeAt(i));
  }
  return Uint8Array.from(bytes);
}
function decodeUtf8(value: Uint8Array): string {
  let encoded = "";
  for (const byte of value) encoded += "%" + byte.toString(16).padStart(2, "0");
  return decodeURIComponent(encoded);
}

async function getUserKey(userId: string): Promise<Uint8Array> {
  const alias = KEY_PREFIX + userId;
  let keyHex = await SecureStore.getItemAsync(alias);
  if (!keyHex) {
    keyHex = toHex(getRandomBytes(32));
    await SecureStore.setItemAsync(alias, keyHex, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }
  const key = fromHex(keyHex);
  if (key.length !== 32) throw new Error("The local encryption key is invalid.");
  return key;
}

/** Encrypts each stored value with a fresh XChaCha20-Poly1305 nonce. */
export async function getEncryptedItem(storageKey: string, userId: string): Promise<string | null> {
  const stored = await AsyncStorage.getItem(storageKey);
  if (stored === null) return null;
  if (!stored.startsWith(ENCRYPTED_PREFIX)) {
    await setEncryptedItem(storageKey, userId, stored);
    return stored;
  }
  const parts = stored.slice(ENCRYPTED_PREFIX.length).split(":");
  if (parts.length !== 2) throw new Error("Encrypted local data has an invalid format.");
  const nonce = fromHex(parts[0]);
  if (nonce.length !== 24) throw new Error("Encrypted local data has an invalid nonce.");
  const key = await getUserKey(userId);
  const plaintext = xchacha20poly1305(key, nonce).decrypt(fromHex(parts[1]));
  return decodeUtf8(plaintext);
}

export async function setEncryptedItem(storageKey: string, userId: string, value: string): Promise<void> {
  const key = await getUserKey(userId);
  const nonce = getRandomBytes(24);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(encodeUtf8(value));
  await AsyncStorage.setItem(storageKey, ENCRYPTED_PREFIX + toHex(nonce) + ":" + toHex(ciphertext));
}
