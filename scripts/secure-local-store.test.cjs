const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "src", "lib", "secureLocalStore.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});

let storedValue = null;
let writes = 0;
let storageValue = "enc1:" + "00".repeat(24) + ":00";
let storageWrites = 0;
let rejectDecrypt = false;
let generatedBytes = 1;
const secureStore = {
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "device-only",
  getItemAsync: async () => storedValue,
  setItemAsync: async (_key, value) => {
    writes += 1;
    storedValue = value;
  },
};
const mocks = {
  "@react-native-async-storage/async-storage": {
    __esModule: true,
    default: {
      getItem: async () => storageValue,
      setItem: async (_key, value) => {
        storageWrites += 1;
        storageValue = value;
      },
    },
  },
  "expo-secure-store": secureStore,
  "expo-crypto": {
    getRandomBytes: length => new Uint8Array(length).fill(generatedBytes++),
  },
  "@noble/ciphers/chacha.js": {
    xchacha20poly1305: () => ({
      decrypt: () => {
        if (rejectDecrypt) throw new Error("authentication failed");
        return new Uint8Array([1]);
      },
      encrypt: () => new Uint8Array([1]),
    }),
  },
};
const moduleObject = { exports: {} };
vm.runInNewContext(compiled.outputText, {
  module: moduleObject,
  exports: moduleObject.exports,
  require: name => {
    if (!(name in mocks)) throw new Error("Unexpected test dependency: " + name);
    return mocks[name];
  },
});
const store = moduleObject.exports;

test("decrypting existing ciphertext with a missing key never creates a replacement", async () => {
  storedValue = null;
  writes = 0;
  await assert.rejects(
    store.getEncryptedItem("one-os-v2:test", "test"),
    /encryption key is missing/i,
  );
  assert.equal(writes, 0);
  assert.equal(storedValue, null);
});

test("fresh-key initialization is explicit, persisted, and verified", async () => {
  storedValue = null;
  writes = 0;
  await Promise.all([
    store.initializeUserKeyForFreshInstall("test"),
    store.initializeUserKeyForFreshInstall("test"),
  ]);
  assert.equal(writes, 1);
  assert.match(storedValue, /^(?:[0-9a-f]{2}){32}$/i);
});


test("a malformed existing key is never replaced during encrypted reads", async () => {
  storedValue = "not-a-valid-hex-key";
  writes = 0;
  await assert.rejects(
    store.getEncryptedItem("one-os-v2:test", "test"),
    /malformed/i,
  );
  assert.equal(writes, 0);
  assert.equal(storedValue, "not-a-valid-hex-key");
});

test("a correctly encoded key with the wrong length is rejected without replacement", async () => {
  storedValue = "ab".repeat(31);
  writes = 0;
  await assert.rejects(
    store.getEncryptedItem("one-os-v2:test", "test"),
    /invalid/i,
  );
  assert.equal(writes, 0);
  assert.equal(storedValue, "ab".repeat(31));
});


test("tampered ciphertext fails authentication and remains untouched", async () => {
  storedValue = "ab".repeat(32);
  storageValue = "enc1:" + "00".repeat(24) + ":00";
  storageWrites = 0;
  rejectDecrypt = true;
  await assert.rejects(
    store.getEncryptedItem("one-os-v2:test", "test"),
    /authentication failed/i,
  );
  assert.equal(storageWrites, 0);
  assert.equal(storageValue, "enc1:" + "00".repeat(24) + ":00");
  rejectDecrypt = false;
});

test("malformed encrypted envelopes are rejected without rewriting the original record", async () => {
  storedValue = "ab".repeat(32);
  storageValue = "enc1:not-a-valid-envelope";
  storageWrites = 0;
  await assert.rejects(
    store.getEncryptedItem("one-os-v2:test", "test"),
    /invalid format/i,
  );
  assert.equal(storageWrites, 0);
  assert.equal(storageValue, "enc1:not-a-valid-envelope");
});
