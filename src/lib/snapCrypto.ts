import { getRandomBytes } from "expo-crypto";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const KEY_WRAP_INFO = Uint8Array.from("ONE-OS shared snap file-key envelope v1", character => character.charCodeAt(0));
const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");

function fromHex(value: string, expectedBytes: number): Uint8Array {
  if (!new RegExp("^(?:[0-9a-f]{2}){" + expectedBytes + "}$", "i").test(value)) {
    throw new Error("The encrypted snap envelope is malformed.");
  }
  return Uint8Array.from(value.match(/.{2}/g) ?? [], part => parseInt(part, 16));
}

export type EncryptedSnap = {
  ciphertext: Uint8Array;
  ephemeralPublicKey: string;
  wrapSalt: string;
  wrapNonce: string;
  wrappedFileKey: string;
  contentNonce: string;
};

/** XChaCha20-Poly1305 encrypts the image; ephemeral X25519 + HKDF-SHA256 wraps its random file key. */
export function encryptSnap(plaintext: Uint8Array, recipientPublicKeyHex: string): EncryptedSnap {
  if (!(plaintext instanceof Uint8Array) || plaintext.length === 0) {
    throw new Error("The selected photo is empty.");
  }
  const recipientPublicKey = fromHex(recipientPublicKeyHex, 32);
  const fileKey = getRandomBytes(32);
  const contentNonce = getRandomBytes(24);
  let ephemeralSecret: Uint8Array | null = null;
  let sharedSecret: Uint8Array | null = null;
  let wrapKey: Uint8Array | null = null;
  let ciphertext: Uint8Array | null = null;
  let completed = false;

  try {
    ciphertext = xchacha20poly1305(fileKey, contentNonce).encrypt(plaintext);
    ephemeralSecret = getRandomBytes(32);
    const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);
    sharedSecret = x25519.getSharedSecret(ephemeralSecret, recipientPublicKey);
    const wrapSalt = getRandomBytes(16);
    const wrapNonce = getRandomBytes(24);
    wrapKey = hkdf(sha256, sharedSecret, wrapSalt, KEY_WRAP_INFO, 32);
    const wrappedFileKey = xchacha20poly1305(wrapKey, wrapNonce).encrypt(fileKey);

    const result: EncryptedSnap = {
      ciphertext,
      ephemeralPublicKey: toHex(ephemeralPublic),
      wrapSalt: toHex(wrapSalt),
      wrapNonce: toHex(wrapNonce),
      wrappedFileKey: toHex(wrappedFileKey),
      contentNonce: toHex(contentNonce),
    };
    completed = true;
    return result;
  } finally {
    if (!completed) ciphertext?.fill(0);
    ephemeralSecret?.fill(0);
    sharedSecret?.fill(0);
    wrapKey?.fill(0);
    fileKey.fill(0);
    recipientPublicKey.fill(0);
  }
}

/** Recipient-only decryption. Authentication failure throws before plaintext can be saved. */
export function decryptSnap(
  ciphertext: Uint8Array,
  envelope: Omit<EncryptedSnap, "ciphertext">,
  recipientSecretKey: Uint8Array,
): Uint8Array {
  if (!(ciphertext instanceof Uint8Array) || recipientSecretKey.length !== 32) {
    throw new Error("This device's private key or encrypted snap is invalid.");
  }

  let ephemeralPublic: Uint8Array | null = null;
  let wrapSalt: Uint8Array | null = null;
  let wrapNonce: Uint8Array | null = null;
  let wrappedFileKey: Uint8Array | null = null;
  let contentNonce: Uint8Array | null = null;
  let sharedSecret: Uint8Array | null = null;
  let wrapKey: Uint8Array | null = null;
  let fileKey: Uint8Array | null = null;

  try {
    ephemeralPublic = fromHex(envelope.ephemeralPublicKey, 32);
    wrapSalt = fromHex(envelope.wrapSalt, 16);
    wrapNonce = fromHex(envelope.wrapNonce, 24);
    wrappedFileKey = fromHex(envelope.wrappedFileKey, 48);
    contentNonce = fromHex(envelope.contentNonce, 24);

    sharedSecret = x25519.getSharedSecret(recipientSecretKey, ephemeralPublic);
    wrapKey = hkdf(sha256, sharedSecret, wrapSalt, KEY_WRAP_INFO, 32);
    fileKey = xchacha20poly1305(wrapKey, wrapNonce).decrypt(wrappedFileKey);
    if (fileKey.length !== 32) throw new Error("The snap file key is invalid.");

    return xchacha20poly1305(fileKey, contentNonce).decrypt(ciphertext);
  } finally {
    ephemeralPublic?.fill(0);
    wrapSalt?.fill(0);
    wrapNonce?.fill(0);
    wrappedFileKey?.fill(0);
    contentNonce?.fill(0);
    sharedSecret?.fill(0);
    wrapKey?.fill(0);
    fileKey?.fill(0);
  }
}
