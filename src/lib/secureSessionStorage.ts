import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const CHUNK_SIZE = 400;
const MAX_CHUNKS = 100;
const MAX_SESSION_CHARS = CHUNK_SIZE * MAX_CHUNKS;
const VERSION_PATTERN = /^[a-z0-9]{1,64}$/;
const MANIFEST_SUFFIX = ":manifest";
const CHUNK_PREFIX = ":chunk:";

type SessionManifest = { version: string; chunks: number };

function isValidManifest(value: unknown): value is SessionManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as Partial<SessionManifest>;
  return typeof manifest.version === "string" &&
    VERSION_PATTERN.test(manifest.version) &&
    Number.isInteger(manifest.chunks) &&
    (manifest.chunks as number) >= 1 &&
    (manifest.chunks as number) <= MAX_CHUNKS;
}

function manifestKey(key: string) { return key + MANIFEST_SUFFIX; }
function chunkKey(key: string, version: string, index: number) {
  return key + CHUNK_PREFIX + version + ":" + index;
}

async function readSecureValue(key: string): Promise<string | null> {
  const raw = await SecureStore.getItemAsync(manifestKey(key));
  if (!raw) return null;
  let manifest: SessionManifest;
  try { manifest = JSON.parse(raw) as SessionManifest; }
  catch { throw new Error("ONE-OS secure session manifest is invalid."); }
  if (!isValidManifest(manifest)) {
    throw new Error("ONE-OS secure session manifest is incomplete.");
  }
  const pieces: string[] = [];
  for (let i = 0; i < manifest.chunks; i += 1) {
    const piece = await SecureStore.getItemAsync(chunkKey(key, manifest.version, i));
    if (
      piece === null ||
      piece.length > CHUNK_SIZE ||
      (i < manifest.chunks - 1 && piece.length !== CHUNK_SIZE)
    ) {
      throw new Error("ONE-OS secure session data is incomplete.");
    }
    pieces.push(piece);
  }
  return pieces.join("");
}

async function writeSecureValue(key: string, value: string): Promise<void> {
  if (typeof value !== "string" || value.length > MAX_SESSION_CHARS) {
    throw new Error("ONE-OS secure session exceeds the supported storage limit.");
  }
  const oldRaw = await SecureStore.getItemAsync(manifestKey(key));
  let old: SessionManifest | null = null;
  if (oldRaw) {
    try {
      const parsed: unknown = JSON.parse(oldRaw);
      if (isValidManifest(parsed)) old = parsed;
    } catch { /* replace damaged manifest */ }
  }
  const version = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const pieces: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) pieces.push(value.slice(i, i + CHUNK_SIZE));
  if (pieces.length === 0) pieces.push("");
  for (let i = 0; i < pieces.length; i += 1) {
    await SecureStore.setItemAsync(chunkKey(key, version, i), pieces[i], {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  await SecureStore.setItemAsync(manifestKey(key), JSON.stringify({ version, chunks: pieces.length }), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  if (old?.version && old.version !== version) {
    for (let i = 0; i < old.chunks; i += 1) {
      await SecureStore.deleteItemAsync(chunkKey(key, old.version, i));
    }
  }
}

async function removeSecureValue(key: string): Promise<void> {
  const raw = await SecureStore.getItemAsync(manifestKey(key));
  if (raw) {
    try {
      const manifest = JSON.parse(raw) as SessionManifest;
      if (isValidManifest(manifest)) {
        for (let i = 0; i < manifest.chunks; i += 1) {
          await SecureStore.deleteItemAsync(chunkKey(key, manifest.version, i));
        }
      }
    } catch { /* remove malformed manifest too */ }
  }
  await SecureStore.deleteItemAsync(manifestKey(key));
}

export function createSecureSessionStorage(legacyAsyncStorageKey: string) {
  return {
    async getItem(key: string): Promise<string | null> {
      const secureValue = await readSecureValue(key);
      if (secureValue !== null) return secureValue;
      const legacyValue = await AsyncStorage.getItem(legacyAsyncStorageKey);
      if (legacyValue === null) return null;
      await writeSecureValue(key, legacyValue);
      await AsyncStorage.removeItem(legacyAsyncStorageKey);
      return legacyValue;
    },
    async setItem(key: string, value: string): Promise<void> {
      await writeSecureValue(key, value);
      await AsyncStorage.removeItem(legacyAsyncStorageKey);
    },
    async removeItem(key: string): Promise<void> {
      await removeSecureValue(key);
      await AsyncStorage.removeItem(legacyAsyncStorageKey);
    },
  };
}
