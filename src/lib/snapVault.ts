import { Directory, File, Paths } from "expo-file-system";
import { decryptLocalBytes, encryptLocalBytes, getEncryptedItem, setEncryptedItem } from "@/lib/secureLocalStore";

export type LocalSnap = {
  id: string;
  deliveryId?: string;
  fileUri: string;
  mimeType: string;
  capturedAt: string;
  direction: "sent" | "received";
};

const indexKey = (userId: string) => "one-os-snap-index-v1:" + userId;
const vaultDirectory = (userId: string) => new Directory(Paths.document, "oneos-private-snaps", userId);

// Serialize every index/file mutation for one account. This prevents two
// simultaneous saves from both reading the same index and losing one entry.
const vaultQueues = new Map<string, Promise<void>>();
function withVaultLock<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const previous = vaultQueues.get(userId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const settled = current.then(() => undefined, () => undefined);
  vaultQueues.set(userId, settled);
  void settled.then(() => {
    if (vaultQueues.get(userId) === settled) vaultQueues.delete(userId);
  });
  return current;
}

async function readIndex(userId: string): Promise<LocalSnap[]> {
  const raw = await getEncryptedItem(indexKey(userId), userId);
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error("Your private photo index is invalid; it has not been overwritten.");
  return value as LocalSnap[];
}

export function getLocalSnaps(userId: string): Promise<LocalSnap[]> {
  return withVaultLock(userId, () => readIndex(userId));
}

export async function saveLocalSnap(
  userId: string,
  id: string,
  mimeType: string,
  capturedAt: string,
  direction: "sent" | "received",
  plaintext: Uint8Array,
  deliveryId?: string,
): Promise<LocalSnap> {
  return withVaultLock(userId, async () => {
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
    // Do not silently normalize IDs: distinct IDs must not collide on disk.
    if (!safeId || safeId !== id) throw new Error("Invalid local photo identifier.");

    // Finish encryption before opening the target file, so key failures
    // cannot truncate an existing memory.
    const encryptedAtRest = await encryptLocalBytes(userId, plaintext);
    try {
      const directory = vaultDirectory(userId);
      directory.create({ idempotent: true, intermediates: true });
      const file = new File(directory, safeId + ".enc");
      file.create({ intermediates: true, overwrite: true });
      await file.write(encryptedAtRest);

      const record: LocalSnap = { id, deliveryId, fileUri: file.uri, mimeType, capturedAt, direction };
      const existing = await readIndex(userId);
      const next = [record, ...existing.filter(item => item.id !== id)];
      await setEncryptedItem(indexKey(userId), userId, JSON.stringify(next));
      return record;
    } finally {
      encryptedAtRest.fill(0);
    }
  });
}

export async function linkLocalSnapDelivery(userId: string, id: string, deliveryId: string): Promise<void> {
  await withVaultLock(userId, async () => {
    const existing = await readIndex(userId);
    const next = existing.map(item => item.id === id ? { ...item, deliveryId } : item);
    await setEncryptedItem(indexKey(userId), userId, JSON.stringify(next));
  });
}

export async function readLocalSnap(userId: string, record: LocalSnap): Promise<Uint8Array> {
  // Keep deletion/replacement from racing a preview while its bytes are read.
  return withVaultLock(userId, async () => {
    const file = new File(record.fileUri);
    if (!file.exists) throw new Error("This photo is no longer present on this device.");
    const encryptedAtRest = await file.bytes();
    try {
      return await decryptLocalBytes(userId, encryptedAtRest);
    } finally {
      encryptedAtRest.fill(0);
    }
  });
}

export async function deleteLocalSnap(userId: string, record: LocalSnap): Promise<void> {
  await withVaultLock(userId, async () => {
    const existing = await readIndex(userId);
    // Commit the index removal first. If file deletion fails, the result is
    // an unreferenced encrypted file rather than a broken visible memory.
    await setEncryptedItem(indexKey(userId), userId, JSON.stringify(existing.filter(item => item.id !== record.id)));
    const file = new File(record.fileUri);
    if (file.exists) file.delete();
  });
}

export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const hasB = i + 1 < bytes.length;
    const hasC = i + 2 < bytes.length;
    const b = hasB ? bytes[i + 1] : 0;
    const c = hasC ? bytes[i + 2] : 0;
    out += alphabet[a >> 2];
    out += alphabet[((a & 3) << 4) | (b >> 4)];
    out += hasB ? alphabet[((b & 15) << 2) | (c >> 6)] : "=";
    out += hasC ? alphabet[c & 63] : "=";
  }
  return out;
}
