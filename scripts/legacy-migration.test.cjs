const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "legacyMigration.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const moduleObject = { exports: {} };
vm.runInNewContext(compiled.outputText, { module: moduleObject, exports: moduleObject.exports });
const { migrateLegacyRecordForUser } = moduleObject.exports;

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async getItem(key) { return values.has(key) ? values.get(key) : null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
}

test("an unscoped legacy record can be claimed by only one account", async () => {
  const storage = createStorage({ "one-os-v1": JSON.stringify({ tasks: ["private task"] }) });
  const persisted = [];
  await Promise.all([
    migrateLegacyRecordForUser("account-a", storage, async value => persisted.push(["account-a", value])),
    migrateLegacyRecordForUser("account-b", storage, async value => persisted.push(["account-b", value])),
  ]);
  assert.equal(persisted.length, 1);
  assert.equal(storage.values.get("one-os-v1-owner"), persisted[0][0]);
  assert.equal(storage.values.has("one-os-v1"), false);
});

test("a different account cannot claim legacy data after ownership is established", async () => {
  const storage = createStorage({
    "one-os-v1": "legacy-data",
    "one-os-v1-owner": "account-a",
  });
  let writes = 0;
  const migrated = await migrateLegacyRecordForUser("account-b", storage, async () => { writes += 1; });
  assert.equal(migrated, false);
  assert.equal(writes, 0);
  assert.equal(storage.values.get("one-os-v1"), "legacy-data");
});

test("an interrupted encrypted write preserves the legacy record and permits owner retry", async () => {
  const storage = createStorage({ "one-os-v1": "legacy-data" });
  await assert.rejects(
    migrateLegacyRecordForUser("account-a", storage, async () => { throw new Error("disk full"); }),
    /disk full/,
  );
  assert.equal(storage.values.get("one-os-v1-owner"), "account-a");
  assert.equal(storage.values.get("one-os-v1"), "legacy-data");

  let persisted = null;
  const migrated = await migrateLegacyRecordForUser("account-a", storage, async value => { persisted = value; });
  assert.equal(migrated, true);
  assert.equal(persisted, "legacy-data");
  assert.equal(storage.values.has("one-os-v1"), false);
});


test("a cancelled startup does not claim or remove the legacy record", async () => {
  const storage = createStorage({ "one-os-v1": "legacy-data" });
  let writes = 0;
  const migrated = await migrateLegacyRecordForUser(
    "account-a",
    storage,
    async () => { writes += 1; },
    () => false,
  );
  assert.equal(migrated, false);
  assert.equal(writes, 0);
  assert.equal(storage.values.has("one-os-v1-owner"), false);
  assert.equal(storage.values.get("one-os-v1"), "legacy-data");
});

test("cancellation after encrypted persistence keeps the original for safe retry", async () => {
  const storage = createStorage({ "one-os-v1": "legacy-data" });
  let current = true;
  let persisted = null;
  const migrated = await migrateLegacyRecordForUser(
    "account-a",
    storage,
    async value => { persisted = value; current = false; },
    () => current,
  );
  assert.equal(migrated, false);
  assert.equal(persisted, "legacy-data");
  assert.equal(storage.values.get("one-os-v1-owner"), "account-a");
  assert.equal(storage.values.get("one-os-v1"), "legacy-data");
});
