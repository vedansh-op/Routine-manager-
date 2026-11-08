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

/** Resolve files only inside this account's vault; never trust a stored URI. */
function localSnapFile(userId: string, id: string): File {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId || safeId !== id) throw new Error("Invalid local photo identifier.");
  return new File(vaultDirectory(userId), safeId + ".enc");
}

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

function isLocalSnapRecord(value: unknown): value is LocalSnap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(item.id)) return false;
  if (item.deliveryId !== undefined &&
      (typeof item.deliveryId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(item.deliveryId))) return false;
  if (typeof item.fileUri !== "string" || item.fileUri.length === 0) return false;
  if (typeof item.mimeType !== "string" ||
      !["image/jpeg", "image/png", "image/webp", "image/heic"].includes(item.mimeType)) return false;
  if (typeof item.capturedAt !== "string" || !Number.isFinite(Date.parse(item.capturedAt))) return false;
  return item.direction === "sent" || item.direction === "received";
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function readIndex(userId: string): Promise<LocalSnap[]> {
  const raw = await getEncryptedItem(indexKey(userId), userId);
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Your private photo index is damaged; it has not been overwritten.");
  }
  if (!Array.isArray(value) || !value.every(isLocalSnapRecord)) {
    throw new Error("Your private photo index contains invalid records; it has not been overwritten.");
  }
  const ids = value.map(item => item.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Your private photo index contains duplicate IDs; it has not been overwritten.");
  }
  return value;
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

    // Never overwrite an existing memory for the same ID. A retry must
    // verify/reuse the durable copy instead of replacing it before index commit.
    const existing = await readIndex(userId);
    if (existing.some(item => item.id === id)) {
      throw new Error("This private memory is already saved on this device.");
    }

    const record: LocalSnap = { id, deliveryId, fileUri: localSnapFile(userId, id).uri, mimeType, capturedAt, direction };
    if (!isLocalSnapRecord(record)) throw new Error("The private memory details are invalid.");

    const directory = vaultDirectory(userId);
    directory.create({ idempotent: true, intermediates: true });
    const file = localSnapFile(userId, id);

    // A crash may occur after the encrypted file is durable but before its
    // index entry is committed. Recover only when authenticated decryption
    // succeeds and the recovered bytes exactly match this retry's input.
    if (file.exists) {
      const orphanCiphertext = await file.bytes();
      let recovered: Uint8Array | null = null;
      try {
        recovered = await decryptLocalBytes(userId, orphanCiphertext);
        if (!sameBytes(recovered, plaintext)) {
          throw new Error("An unindexed private photo already exists with different contents. It was preserved; manual recovery is required.");
        }
        await setEncryptedItem(indexKey(userId), userId, JSON.stringify([record, ...existing]));
        return record;
      } finally {
        orphanCiphertext.fill(0);
        recovered?.fill(0);
      }
    }

    // Finish encryption before creating the target file.
    const encryptedAtRest = await encryptLocalBytes(userId, plaintext);
    try {
      file.create({ intermediates: true, overwrite: false });
      await file.write(encryptedAtRest);
      await setEncryptedItem(indexKey(userId), userId, JSON.stringify([record, ...existing]));
      return record;
    } finally {
      encryptedAtRest.fill(0);
    }
  });
}

export async function linkLocalSnapDelivery(userId: string, id: string, deliveryId: string): Promise<void> {
  await withVaultLock(userId, async () => {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || !/^[a-zA-Z0-9_-]{1,128}$/.test(deliveryId)) {
      throw new Error("Invalid private memory link.");
    }
    const existing = await readIndex(userId);
    const target = existing.find(item => item.id === id);
    if (!target) throw new Error("This private memory is no longer in your vault.");
    if (target.deliveryId && target.deliveryId !== deliveryId) {
      throw new Error("This private memory is already linked to a different delivery.");
    }
    const next = existing.map(item => item.id === id ? { ...item, deliveryId } : item);
    await setEncryptedItem(indexKey(userId), userId, JSON.stringify(next));
  });
}

export async function readLocalSnap(userId: string, record: LocalSnap): Promise<Uint8Array> {
  // Keep deletion/replacement from racing a preview while its bytes are read.
  return withVaultLock(userId, async () => {
    if (!isLocalSnapRecord(record)) throw new Error("Invalid private memory record.");
    const existing = await readIndex(userId);
    if (!existing.some(item => item.id === record.id)) {
      throw new Error("This private memory is no longer in your vault.");
    }
    const file = localSnapFile(userId, record.id);
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
    if (!isLocalSnapRecord(record)) throw new Error("Invalid private memory record.");
    const existing = await readIndex(userId);
    if (!existing.some(item => item.id === record.id)) {
      throw new Error("This private memory is no longer in your vault.");
    }
    // Commit the index removal first. If file deletion fails, the result is
    // an unreferenced encrypted file rather than a broken visible memory.
    await setEncryptedItem(indexKey(userId), userId, JSON.stringify(existing.filter(item => item.id !== record.id)));
    const file = localSnapFile(userId, record.id);
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
