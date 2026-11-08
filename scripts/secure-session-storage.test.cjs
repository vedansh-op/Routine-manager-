const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "src", "lib", "secureSessionStorage.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});

let secureValues = new Map();
let legacyValues = new Map();
let writeLog = [];
let deleteLog = [];
let failChunkWrite = 0;
let chunkWriteCount = 0;

const secureStore = {
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "device-only",
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only-unlocked",
  async getItemAsync(key) {
    return secureValues.has(key) ? secureValues.get(key) : null;
  },
  async setItemAsync(key, value) {
    if (key.includes(":chunk:")) {
      chunkWriteCount += 1;
      if (failChunkWrite === chunkWriteCount) throw new Error("simulated secure write failure");
    }
    writeLog.push(key);
    secureValues.set(key, value);
  },
  async deleteItemAsync(key) {
    deleteLog.push(key);
    secureValues.delete(key);
  },
};
const asyncStorage = {
  __esModule: true,
  default: {
    async getItem(key) {
      return legacyValues.has(key) ? legacyValues.get(key) : null;
    },
    async removeItem(key) {
      legacyValues.delete(key);
    },
  },
};
const mocks = {
  "@react-native-async-storage/async-storage": asyncStorage,
  "expo-secure-store": secureStore,
};
const moduleObject = { exports: {} };
vm.runInNewContext(compiled.outputText, {
  module: moduleObject,
  exports: moduleObject.exports,
  require(name) {
    if (!(name in mocks)) throw new Error("Unexpected test dependency: " + name);
    return mocks[name];
  },
});
const { createSecureSessionStorage } = moduleObject.exports;

function reset() {
  secureValues = new Map();
  legacyValues = new Map();
  writeLog = [];
  deleteLog = [];
  failChunkWrite = 0;
  chunkWriteCount = 0;
}

function createStore() {
  return createSecureSessionStorage("legacy-session");
}

test("secure session values round-trip across multiple chunks", async () => {
  reset();
  const store = createStore();
  const value = "x".repeat(805);
  await store.setItem("auth-token", value);
  assert.equal(await store.getItem("auth-token"), value);
  const manifest = JSON.parse(secureValues.get("auth-token:manifest"));
  assert.equal(manifest.chunks, 3);
  assert.equal(writeLog.at(-1), "auth-token:manifest");
  assert.equal(writeLog.filter(key => key.includes(":chunk:")).length, 3);
});

test("oversized sessions are rejected before the current manifest is replaced", async () => {
  reset();
  const store = createStore();
  await store.setItem("auth-token", "valid-session");
  const manifestBefore = secureValues.get("auth-token:manifest");
  const writesBefore = writeLog.length;
  await assert.rejects(store.setItem("auth-token", "x".repeat(40001)), /storage limit/i);
  assert.equal(secureValues.get("auth-token:manifest"), manifestBefore);
  assert.equal(writeLog.length, writesBefore);
  assert.equal(await store.getItem("auth-token"), "valid-session");
});

test("a failed new chunk write leaves the old committed session readable", async () => {
  reset();
  const store = createStore();
  await store.setItem("auth-token", "old-session");
  const oldManifest = secureValues.get("auth-token:manifest");
  failChunkWrite = chunkWriteCount + 2;
  await assert.rejects(store.setItem("auth-token", "n".repeat(805)), /simulated secure write failure/);
  assert.equal(secureValues.get("auth-token:manifest"), oldManifest);
  assert.equal(await store.getItem("auth-token"), "old-session");
});

test("a missing chunk fails closed instead of returning a partial session", async () => {
  reset();
  const store = createStore();
  await store.setItem("auth-token", "z".repeat(805));
  const manifest = JSON.parse(secureValues.get("auth-token:manifest"));
  secureValues.delete("auth-token:chunk:" + manifest.version + ":1");
  await assert.rejects(store.getItem("auth-token"), /incomplete/i);
});

test("a malformed or over-limit manifest is rejected", async () => {
  reset();
  const store = createStore();
  secureValues.set("auth-token:manifest", JSON.stringify({ version: "bad version", chunks: 1 }));
  await assert.rejects(store.getItem("auth-token"), /incomplete/i);
  secureValues.set("auth-token:manifest", JSON.stringify({ version: "validversion", chunks: 101 }));
  await assert.rejects(store.getItem("auth-token"), /incomplete/i);
});

test("legacy AsyncStorage session migrates only after secure chunks and manifest are written", async () => {
  reset();
  legacyValues.set("legacy-session", "legacy-token-value");
  const store = createStore();
  assert.equal(await store.getItem("auth-token"), "legacy-token-value");
  assert.equal(legacyValues.has("legacy-session"), false);
  assert.equal(secureValues.has("auth-token:manifest"), true);
  assert.equal(writeLog.at(-1), "auth-token:manifest");
});

test("removeItem deletes the active chunks and manifest", async () => {
  reset();
  const store = createStore();
  await store.setItem("auth-token", "remove-this-session");
  const manifest = JSON.parse(secureValues.get("auth-token:manifest"));
  await store.removeItem("auth-token");
  assert.equal(secureValues.has("auth-token:manifest"), false);
  assert.equal(secureValues.has("auth-token:chunk:" + manifest.version + ":0"), false);
});
