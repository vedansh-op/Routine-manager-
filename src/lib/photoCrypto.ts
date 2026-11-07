import * as SecureStore from "expo-secure-store";
import { getRandomBytes } from "expo-crypto";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const KEY_PREFIX = "one-os-photo-x25519-v1:";
const utf8 = (value: string) => new Uint8Array(Array.from(value).map(char => char.charCodeAt(0)));
const toHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
function fromHex(value: string, expectedLength?: number): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error("Invalid cryptographic envelope.");
  const bytes = Uint8Array.from(value.match(/.{2}/g) ?? [], part => parseInt(part, 16));
  if (expectedLength !== undefined && bytes.length !== expectedLength) throw new Error("Invalid cryptographic key length.");
  return bytes;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

export type PhotoIdentity = { publicKeyHex: string };
export type EncryptedPhoto = { ciphertext: Uint8Array; wrappedFileKey: string; encryptionVersion: "xchacha20poly1305+x25519-v1" };

/** Creates one stable X25519 identity per account and shared space; private bytes never leave SecureStore. */
export async function getOrCreatePhotoIdentity(userId: string, spaceId: string): Promise<PhotoIdentity> {
  const alias = KEY_PREFIX + userId + ":" + spaceId;
  let secretHex = await SecureStore.getItemAsync(alias);
  if (!secretHex) {
    const secret = getRandomBytes(32);
    secretHex = toHex(secret);
    await SecureStore.setItemAsync(alias, secretHex, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }
  const secret = fromHex(secretHex, 32);
  const publicKey = x25519.getPublicKey(secret);
  return { publicKeyHex: toHex(publicKey) };
}

/** Encrypts photo bytes with a fresh random content key, then wraps that key to the recipient's X25519 public key. */
export function encryptPhotoForRecipient(plainBytes: Uint8Array, recipientPublicKeyHex: string): EncryptedPhoto {
  if (plainBytes.length < 1 || plainBytes.length > 15 * 1024 * 1024) throw new Error("Photo must be between 1 byte and 15 MB.");
  const recipientPublicKey = fromHex(recipientPublicKeyHex, 32);
  const fileKey = getRandomBytes(32);
  const fileNonce = getRandomBytes(24);
  const ciphertext = concat(fileNonce, xchacha20poly1305(fileKey, fileNonce).encrypt(plainBytes));

  const ephemeralSecret = getRandomBytes(32);
  const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);
  const sharedSecret = x25519.getSharedSecret(ephemeralSecret, recipientPublicKey);
  const salt = getRandomBytes(32);
  const wrapKey = hkdf(sha256, sharedSecret, salt, utf8("ONE-OS photo file-key wrap v1"), 32);
  const wrapNonce = getRandomBytes(24);
  const wrappedKey = xchacha20poly1305(wrapKey, wrapNonce).encrypt(fileKey);

  const envelope = {
    version: 1,
    ephemeralPublicKeyHex: toHex(ephemeralPublic),
    saltHex: toHex(salt),
    nonceHex: toHex(wrapNonce),
    ciphertextHex: toHex(wrappedKey),
  };
  fileKey.fill(0);
  ephemeralSecret.fill(0);
  sharedSecret.fill(0);
  wrapKey.fill(0);
  return {
    ciphertext,
    wrappedFileKey: JSON.stringify(envelope),
    encryptionVersion: "xchacha20poly1305+x25519-v1",
  };
}

/** Decrypts only on the intended recipient device using its SecureStore-held private key. */
export async function decryptReceivedPhoto(
  userId: string,
  spaceId: string,
  ciphertext: Uint8Array,
  wrappedFileKey: string,
): Promise<Uint8Array> {
  const alias = KEY_PREFIX + userId + ":" + spaceId;
  const secretHex = await SecureStore.getItemAsync(alias);
  if (!secretHex) throw new Error("This device has no private photo key for this shared space.");
  if (ciphertext.length < 24 + 16) throw new Error("Encrypted photo is incomplete.");

  const envelope = JSON.parse(wrappedFileKey) as {
    version?: number;
    ephemeralPublicKeyHex?: string;
    saltHex?: string;
    nonceHex?: string;
    ciphertextHex?: string;
  };
  if (envelope.version !== 1 || !envelope.ephemeralPublicKeyHex || !envelope.saltHex || !envelope.nonceHex || !envelope.ciphertextHex) {
    throw new Error("Unsupported photo key envelope.");
  }
  const secret = fromHex(secretHex, 32);
  const ephemeralPublic = fromHex(envelope.ephemeralPublicKeyHex, 32);
  const salt = fromHex(envelope.saltHex, 32);
  const wrapNonce = fromHex(envelope.nonceHex, 24);
  const sharedSecret = x25519.getSharedSecret(secret, ephemeralPublic);
  const wrapKey = hkdf(sha256, sharedSecret, salt, utf8("ONE-OS photo file-key wrap v1"), 32);
  const fileKey = xchacha20poly1305(wrapKey, wrapNonce).decrypt(fromHex(envelope.ciphertextHex));
  if (fileKey.length !== 32) throw new Error("Invalid wrapped photo key.");

  const fileNonce = ciphertext.slice(0, 24);
  const encryptedBytes = ciphertext.slice(24);
  const plaintext = xchacha20poly1305(fileKey, fileNonce).decrypt(encryptedBytes);
  secret.fill(0);
  sharedSecret.fill(0);
  wrapKey.fill(0);
  fileKey.fill(0);
  return plaintext;
}
