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

export async function getLocalSnaps(userId: string): Promise<LocalSnap[]> {
  const raw = await getEncryptedItem(indexKey(userId), userId);
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error("Your private photo index is invalid; it has not been overwritten.");
  return value as LocalSnap[];
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
  const directory = vaultDirectory(userId);
  directory.create({ idempotent: true, intermediates: true });
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  // Do not silently normalize IDs: two distinct delivery IDs must never map
  // to the same on-device filename.
  if (!safeId || safeId !== id) throw new Error("Invalid local photo identifier.");

  // Resolve the account key and finish encryption before opening the target
  // file. A missing/malformed key must never truncate an existing memory.
  const encryptedAtRest = await encryptLocalBytes(userId, plaintext);
  const file = new File(directory, safeId + ".enc");
  file.create({ intermediates: true, overwrite: true });
  await file.write(encryptedAtRest);

  const record: LocalSnap = { id, deliveryId, fileUri: file.uri, mimeType, capturedAt, direction };
  const existing = await getLocalSnaps(userId);
  const next = [record, ...existing.filter(item => item.id !== id)];
  await setEncryptedItem(indexKey(userId), userId, JSON.stringify(next));
  return record;
}

export async function linkLocalSnapDelivery(userId: string, id: string, deliveryId: string): Promise<void> {
  const existing = await getLocalSnaps(userId);
  const next = existing.map(item => item.id === id ? { ...item, deliveryId } : item);
  await setEncryptedItem(indexKey(userId), userId, JSON.stringify(next));
}

export async function readLocalSnap(userId: string, record: LocalSnap): Promise<Uint8Array> {
  const file = new File(record.fileUri);
  if (!file.exists) throw new Error("This photo is no longer present on this device.");
  return decryptLocalBytes(userId, await file.bytes());
}

export async function deleteLocalSnap(userId: string, record: LocalSnap): Promise<void> {
  const file = new File(record.fileUri);
  if (file.exists) file.delete();
  const existing = await getLocalSnaps(userId);
  await setEncryptedItem(indexKey(userId), userId, JSON.stringify(existing.filter(item => item.id !== record.id)));
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
