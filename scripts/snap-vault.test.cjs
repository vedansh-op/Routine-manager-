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
let failIndexWrite = false;
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
  setEncryptedItem: async (_key, _userId, value) => { if (failIndexWrite) throw new Error("index unavailable"); indexValue = value; },
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
  assert.deepEqual(Array.from(records, item => item.id).sort(), ["delivery-one", "delivery-two"]);
});

test("duplicate save is rejected without overwriting an existing snap file", async () => {
  files.clear();
  indexValue = null;
  const original = await vault.saveLocalSnap("user-a", "delivery-safe", "image/jpeg", "2026-01-01T00:00:00.000Z", "sent", new Uint8Array([7, 8, 9]));
  const before = Array.from(files.get(original.fileUri));
  const indexBefore = indexValue;
  await assert.rejects(
    vault.saveLocalSnap("user-a", "delivery-safe", "image/jpeg", "2026-01-01T00:00:00.000Z", "sent", new Uint8Array([4])),
    /already saved/i,
  );
  assert.deepEqual(Array.from(files.get(original.fileUri)), before);
  assert.equal(indexValue, indexBefore);
});

test("unsafe identifiers are rejected instead of being normalized into colliding filenames", async () => {
  await assert.rejects(
    vault.saveLocalSnap("user-a", "delivery/one", "image/jpeg", "2026-01-01T00:00:00.000Z", "sent", new Uint8Array([1])),
    /invalid local photo identifier/i,
  );
});


test("malformed encrypted index is rejected without being rewritten", async () => {
  files.clear();
  indexValue = "{broken";
  await assert.rejects(vault.getLocalSnaps("user-a"), /index is damaged/i);
  assert.equal(indexValue, "{broken");
});

test("invalid records and duplicate IDs are rejected", async () => {
  indexValue = JSON.stringify([{ id: "../outside", fileUri: "file:///outside", mimeType: "image/jpeg", capturedAt: "2026-01-01T00:00:00.000Z", direction: "sent" }]);
  await assert.rejects(vault.getLocalSnaps("user-a"), /invalid records/i);
  indexValue = JSON.stringify([
    { id: "same", fileUri: "file:///one", mimeType: "image/jpeg", capturedAt: "2026-01-01T00:00:00.000Z", direction: "sent" },
    { id: "same", fileUri: "file:///two", mimeType: "image/jpeg", capturedAt: "2026-01-02T00:00:00.000Z", direction: "received" },
  ]);
  await assert.rejects(vault.getLocalSnaps("user-a"), /duplicate IDs/i);
});


test("retry recovers an orphaned encrypted file after index commit failure", async () => {
  files.clear();
  indexValue = null;
  failIndexWrite = true;
  await assert.rejects(
    vault.saveLocalSnap("user-a", "delivery-recover", "image/jpeg", "2026-01-01T00:00:00.000Z", "sent", new Uint8Array([3, 4, 5])),
    /index unavailable/i,
  );
  failIndexWrite = false;
  const recovered = await vault.saveLocalSnap("user-a", "delivery-recover", "image/jpeg", "2026-01-01T00:00:00.000Z", "sent", new Uint8Array([3, 4, 5]));
  assert.equal((await vault.getLocalSnaps("user-a"))[0].id, "delivery-recover");
  assert.deepEqual(Array.from(await vault.readLocalSnap("user-a", recovered)), [3, 4, 5]);
});

test("mismatched orphaned file is preserved and never indexed", async () => {
  files.clear();
  indexValue = null;
  failIndexWrite = true;
  await assert.rejects(
    vault.saveLocalSnap("user-a", "delivery-orphan", "image/jpeg", "2026-01-01T00:00:00.000Z", "sent", new Uint8Array([1, 2])),
    /index unavailable/i,
  );
  failIndexWrite = false;
  const orphanPath = "/documents/oneos-private-snaps/user-a/delivery-orphan.enc";
  const before = Array.from(files.get(orphanPath));
  await assert.rejects(
    vault.saveLocalSnap("user-a", "delivery-orphan", "image/jpeg", "2026-01-01T00:00:00.000Z", "sent", new Uint8Array([9, 9])),
    /different contents/i,
  );
  assert.deepEqual(Array.from(files.get(orphanPath)), before);
  assert.equal(await vault.getLocalSnaps("user-a").then(items => items.length), 0);
});


test("read and delete reject records that are not in the encrypted index", async () => {
  files.clear();
  indexValue = null;
  const saved = await vault.saveLocalSnap("user-a", "delivery-owned", "image/jpeg", "2026-01-01T00:00:00.000Z", "sent", new Uint8Array([6]));
  const forged = { ...saved, id: "delivery-other", fileUri: saved.fileUri };
  await assert.rejects(vault.readLocalSnap("user-a", forged), /no longer in your vault/i);
  await assert.rejects(vault.deleteLocalSnap("user-a", forged), /no longer in your vault/i);
  assert.equal(files.has(saved.fileUri), true);
  assert.equal((await vault.getLocalSnaps("user-a")).length, 1);
});

test("delivery linking rejects missing IDs and conflicting relinks", async () => {
  files.clear();
  indexValue = null;
  await vault.saveLocalSnap("user-a", "delivery-link", "image/jpeg", "2026-01-01T00:00:00.000Z", "sent", new Uint8Array([6]));
  await assert.rejects(vault.linkLocalSnapDelivery("user-a", "missing", "delivery-link"), /no longer in your vault/i);
  await vault.linkLocalSnapDelivery("user-a", "delivery-link", "delivery-link");
  await assert.rejects(vault.linkLocalSnapDelivery("user-a", "delivery-link", "delivery-other"), /different delivery/i);
});
