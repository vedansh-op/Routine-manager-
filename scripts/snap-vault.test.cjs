const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "snapVault.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});

const files = new Map();
let indexValue = null;
let failEncryption = false;
class Directory {
  constructor(...parts) { this.uri = parts.map(part => typeof part === "string" ? part : part.uri).join("/"); }
  create() {}
}
class File {
  constructor(parent, name) {
    this.uri = name ? parent.uri + "/" + name : parent;
  }
  get exists() { return files.has(this.uri); }
  create({ overwrite } = {}) {
    if (files.has(this.uri) && !overwrite) throw new Error("File exists");
    files.set(this.uri, new Uint8Array());
  }
  async write(bytes) { files.set(this.uri, new Uint8Array(bytes)); }
  async bytes() { return new Uint8Array(files.get(this.uri) || []); }
  delete() { files.delete(this.uri); }
}
const secureStore = {
  getEncryptedItem: async () => indexValue,
  setEncryptedItem: async (_key, _userId, value) => { indexValue = value; },
  encryptLocalBytes: async (_userId, bytes) => {
    await new Promise(resolve => setTimeout(resolve, 5));
    if (failEncryption) throw new Error("key unavailable");
    return new Uint8Array(bytes);
  },
  decryptLocalBytes: async (_userId, bytes) => new Uint8Array(bytes),
};
const moduleObject = { exports: {} };
vm.runInNewContext(compiled.outputText, {
  module: moduleObject,
  exports: moduleObject.exports,
  require: name => {
    if (name === "expo-file-system") return { Directory, File, Paths: { document: "/documents" } };
    if (name === "@/lib/secureLocalStore") return secureStore;
    throw new Error("Unexpected dependency: " + name);
  },
});
const vault = moduleObject.exports;

test("concurrent saves preserve every entry in the encrypted index", async () => {
  files.clear();
  indexValue = null;
  await Promise.all([
    vault.saveLocalSnap("user-a", "delivery-one", "image/jpeg", "2026-01-01T00:00:00.000Z", "sent", new Uint8Array([1])),
    vault.saveLocalSnap("user-a", "delivery-two", "image/jpeg", "2026-01-02T00:00:00.000Z", "received", new Uint8Array([2])),
  ]);
  const records = await vault.getLocalSnaps("user-a");
  assert.deepEqual(records.map(item => item.id).sort(), ["delivery-one", "delivery-two"]);
});

test("encryption failure leaves an existing snap file unchanged", async () => {
  files.clear();
  indexValue = null;
  const original = await vault.saveLocalSnap("user-a", "delivery-safe", "image/jpeg", "2026-01-01T00:00:00.000Z", "sent", new Uint8Array([7, 8, 9]));
  const before = Array.from(files.get(original.fileUri));
  failEncryption = true;
  await assert.rejects(
    vault.saveLocalSnap("user-a", "delivery-safe", "image/jpeg", "2026-01-01T00:00:00.000Z", "sent", new Uint8Array([4])),
    /key unavailable/,
  );
  failEncryption = false;
  assert.deepEqual(Array.from(files.get(original.fileUri)), before);
});

test("unsafe identifiers are rejected instead of being normalized into colliding filenames", async () => {
  await assert.rejects(
    vault.saveLocalSnap("user-a", "delivery/one", "image/jpeg", "2026-01-01T00:00:00.000Z", "sent", new Uint8Array([1])),
    /invalid local photo identifier/i,
  );
});
