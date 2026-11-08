const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "src", "lib", "snapCrypto.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});

const nobleCurves = import("@noble/curves/ed25519.js");
const nobleHashes = Promise.all([
  import("@noble/hashes/hkdf.js"),
  import("@noble/hashes/sha2.js"),
]);
const nobleCiphers = import("@noble/ciphers/chacha.js");

let generatedBuffers = [];
let failOnEncryptCall = 0;
let encryptCalls = 0;

const { x25519 } = await nobleCurves;
const [{ hkdf }, { sha256 }] = await nobleHashes;
const { xchacha20poly1305: realXChaCha } = await nobleCiphers;

const mocks = {
  "expo-crypto": {
    getRandomBytes(length) {
      const value = new Uint8Array(crypto.randomBytes(length));
      generatedBuffers.push(value);
      return value;
    },
  },
  "@noble/curves/ed25519.js": { x25519 },
  "@noble/hashes/hkdf.js": { hkdf },
  "@noble/hashes/sha2.js": { sha256 },
  "@noble/ciphers/chacha.js": {
    xchacha20poly1305(key, nonce) {
      const cipher = realXChaCha(key, nonce);
      return {
        encrypt(plaintext) {
          encryptCalls += 1;
          if (failOnEncryptCall === encryptCalls) {
            throw new Error("simulated native encryption failure");
          }
          return cipher.encrypt(plaintext);
        },
        decrypt(ciphertext) {
          return cipher.decrypt(ciphertext);
        },
      };
    },
  },
};

const moduleObject = { exports: {} };
vm.runInNewContext(compiled.outputText, {
  module: moduleObject,
  exports: moduleObject.exports,
  Uint8Array,
  require(name) {
    if (!(name in mocks)) throw new Error("Unexpected test dependency: " + name);
    return mocks[name];
  },
});
const { encryptSnap, decryptSnap } = moduleObject.exports;

function setup() {
  generatedBuffers = [];
  failOnEncryptCall = 0;
  encryptCalls = 0;
  const recipientSecret = new Uint8Array(crypto.randomBytes(32));
  const recipientPublic = x25519.getPublicKey(recipientSecret);
  const plaintext = new Uint8Array(crypto.randomBytes(2048));
  return { recipientSecret, recipientPublic, plaintext };
}

function flipHex(hex) {
  const first = hex.slice(0, 2);
  return (first === "00" ? "01" : "00") + hex.slice(2);
}

test("Snap encryption round-trips only for the intended recipient key", () => {
  const { recipientSecret, recipientPublic, plaintext } = setup();
  const encrypted = encryptSnap(plaintext, Buffer.from(recipientPublic).toString("hex"));
  const decrypted = decryptSnap(encrypted.ciphertext, encrypted, recipientSecret);
  assert.equal(Buffer.from(decrypted).equals(Buffer.from(plaintext)), true);
  assert.equal(encrypted.ciphertext.length, plaintext.length + 16);
});

test("ciphertext modification is rejected by authenticated decryption", () => {
  const { recipientSecret, recipientPublic, plaintext } = setup();
  const encrypted = encryptSnap(plaintext, Buffer.from(recipientPublic).toString("hex"));
  const damaged = new Uint8Array(encrypted.ciphertext);
  damaged[0] ^= 0x80;
  assert.throws(() => decryptSnap(damaged, encrypted, recipientSecret));
});

test("a different recipient private key cannot unwrap the Snap file key", () => {
  const { recipientPublic, plaintext } = setup();
  const encrypted = encryptSnap(plaintext, Buffer.from(recipientPublic).toString("hex"));
  const wrongSecret = new Uint8Array(crypto.randomBytes(32));
  assert.throws(() => decryptSnap(encrypted.ciphertext, encrypted, wrongSecret));
});

test("tampering with every envelope component is rejected", () => {
  const { recipientSecret, recipientPublic, plaintext } = setup();
  const encrypted = encryptSnap(plaintext, Buffer.from(recipientPublic).toString("hex"));
  const replacementPublic = x25519.getPublicKey(new Uint8Array(crypto.randomBytes(32)));
  const variations = [
    { ephemeralPublicKey: Buffer.from(replacementPublic).toString("hex") },
    { wrapSalt: flipHex(encrypted.wrapSalt) },
    { wrapNonce: flipHex(encrypted.wrapNonce) },
    { wrappedFileKey: flipHex(encrypted.wrappedFileKey) },
    { contentNonce: flipHex(encrypted.contentNonce) },
  ];
  for (const variation of variations) {
    assert.throws(() => decryptSnap(encrypted.ciphertext, { ...encrypted, ...variation }, recipientSecret));
  }
});

test("malformed key and envelope lengths are rejected before plaintext is returned", () => {
  const { recipientSecret, recipientPublic, plaintext } = setup();
  assert.throws(() => encryptSnap(plaintext, "abcd"));
  const encrypted = encryptSnap(plaintext, Buffer.from(recipientPublic).toString("hex"));
  assert.throws(() => decryptSnap(encrypted.ciphertext, {
    ...encrypted,
    wrappedFileKey: "00",
  }, recipientSecret));
  assert.throws(() => decryptSnap(encrypted.ciphertext, encrypted, new Uint8Array(16)));
});

test("an empty photo is rejected", () => {
  const { recipientPublic } = setup();
  assert.throws(() => encryptSnap(new Uint8Array(0), Buffer.from(recipientPublic).toString("hex")), /empty/i);
});

test("temporary file and ephemeral private keys are cleared when wrapping fails", () => {
  const { recipientPublic, plaintext } = setup();
  failOnEncryptCall = 2;
  assert.throws(
    () => encryptSnap(plaintext, Buffer.from(recipientPublic).toString("hex")),
    /simulated native encryption failure/,
  );
  assert.equal(generatedBuffers.length, 5);
  assert.equal(generatedBuffers[0].every(value => value === 0), true, "file key must be cleared");
  assert.equal(generatedBuffers[2].every(value => value === 0), true, "ephemeral private key must be cleared");
});
