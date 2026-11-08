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
      getItem: async () => "enc1:" + "00".repeat(24) + ":00",
      setItem: async () => {},
    },
  },
  "expo-secure-store": secureStore,
  "expo-crypto": {
    getRandomBytes: length => new Uint8Array(length).fill(generatedBytes++),
  },
  "@noble/ciphers/chacha.js": {
    xchacha20poly1305: () => ({
      decrypt: () => new Uint8Array([1]),
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
  await store.initializeUserKeyForFreshInstall("test");
  assert.equal(writes, 1);
  assert.match(storedValue, /^(?:[0-9a-f]{2}){32}$/i);
});
