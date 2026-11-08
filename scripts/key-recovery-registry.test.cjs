const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "src", "lib", "keyRecoveryRegistry.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});

let secureRead = async () => null;
let asyncReads = new Map();
class File {}
class Directory {
  constructor(uri) {
    this.uri = uri;
    this.name = uri.split("/").pop();
    this.exists = true;
  }
  list() {
    if (this.uri === "documents") return [new Directory("documents/oneos-private-snaps")];
    if (this.uri === "documents/oneos-private-snaps") {
      return [new Directory("documents/oneos-private-snaps/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")];
    }
    return [];
  }
}
const mocks = {
  "@react-native-async-storage/async-storage": {
    __esModule: true,
    default: { getItem: key => asyncReads.has(key) ? asyncReads.get(key)() : Promise.resolve(null) },
  },
  "expo-secure-store": { getItemAsync: key => secureRead(key) },
  "expo-file-system": { Directory, File, Paths: { document: "documents" } },
  "@noble/curves/ed25519.js": { x25519: { getPublicKey: () => new Uint8Array(32) } },
  "@/lib/supabase": { supabase: null },
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
const { inspectLocalEncryptedData } = moduleObject.exports;
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("inventory preserves successful observations when SecureStore is inaccessible", async () => {
  secureRead = async () => { throw new Error("SecureStore unavailable"); };
  asyncReads = new Map([
    ["one-os-v2:" + userId, async () => null],
    ["one-os-v1", async () => null],
    ["one-os-snap-index-v1:" + userId, async () => "enc1:record"],
  ]);

  const result = await inspectLocalEncryptedData(userId);
  assert.equal(result.status, "unknown");
  assert.equal(result.dataKey, "unknown");
  assert.equal(result.appStoreRecord, "absent");
  assert.equal(result.legacyUnscopedAppStoreRecord, "absent");
  assert.equal(result.snapIndex, "encrypted");
  assert.equal(result.snapVault, "empty-visible");
});

test("inventory preserves a valid key observation when one AsyncStorage read fails", async () => {
  secureRead = async () => "ab".repeat(32);
  asyncReads = new Map([
    ["one-os-v2:" + userId, async () => { throw new Error("AsyncStorage unavailable"); }],
    ["one-os-v1", async () => null],
    ["one-os-snap-index-v1:" + userId, async () => null],
  ]);

  const result = await inspectLocalEncryptedData(userId);
  assert.equal(result.status, "unknown");
  assert.equal(result.dataKey, "present-valid");
  assert.equal(result.appStoreRecord, "unknown");
  assert.equal(result.legacyUnscopedAppStoreRecord, "absent");
  assert.equal(result.snapIndex, "absent");
});

test("an inaccessible document root remains unknown, never an empty vault", async () => {
  secureRead = async () => null;
  asyncReads = new Map([
    ["one-os-v2:" + userId, async () => null],
    ["one-os-v1", async () => null],
    ["one-os-snap-index-v1:" + userId, async () => null],
  ]);
  const originalExists = Directory.prototype;
  const list = Directory.prototype.list;
  Directory.prototype.list = function () {
    if (this.uri === "documents") throw new Error("Document root inaccessible");
    return list.call(this);
  };

  try {
    const result = await inspectLocalEncryptedData(userId);
    assert.equal(result.status, "unknown");
    assert.equal(result.snapVault, "unknown");
    assert.equal(result.snapVaultFileCount, null);
  } finally {
    Directory.prototype.list = list;
  }
});
