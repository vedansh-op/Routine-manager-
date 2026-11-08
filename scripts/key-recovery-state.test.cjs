const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "src", "lib", "keyRecoveryState.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const moduleObject = { exports: {} };
vm.runInNewContext(compiled.outputText, { module: moduleObject, exports: moduleObject.exports });
const { classifyRecoveryBootstrapState } = moduleObject.exports;

const inventory = (overrides = {}) => ({
  status: "complete",
  dataKey: "missing",
  appStoreRecord: "absent",
  legacyUnscopedAppStoreRecord: "absent",
  snapIndex: "absent",
  snapVault: "empty-visible",
  snapVaultFileCount: 0,
  ...overrides,
});

test("fresh candidate requires a positively visible empty vault and allows plaintext migration", () => {
  assert.equal(classifyRecoveryBootstrapState(inventory()), "fresh-candidate");
  assert.equal(
    classifyRecoveryBootstrapState(inventory({ legacyUnscopedAppStoreRecord: "present" })),
    "fresh-candidate",
  );
  assert.equal(
    classifyRecoveryBootstrapState(
      inventory({ appStoreRecord: "legacy-plaintext", snapIndex: "legacy-plaintext" }),
    ),
    "fresh-candidate",
  );
  assert.equal(
    classifyRecoveryBootstrapState(inventory({ snapVault: "not-visible" })),
    "needs-review",
  );
  assert.equal(
    classifyRecoveryBootstrapState(inventory({ status: "unknown" })),
    "needs-review",
  );
});

test("existing encrypted data with a missing key requires recovery", () => {
  assert.equal(
    classifyRecoveryBootstrapState(inventory({ appStoreRecord: "encrypted" })),
    "recover-existing",
  );
  assert.equal(
    classifyRecoveryBootstrapState(
      inventory({ snapIndex: "encrypted", snapVault: "contains-entries" }),
    ),
    "recover-existing",
  );
});

test("a valid data key permits local data access without a Snap device registry lookup", () => {
  assert.equal(
    classifyRecoveryBootstrapState(inventory({ dataKey: "present-valid" })),
    "ready",
  );
});

test("malformed keys and inconsistent local inventories fail closed", () => {
  assert.equal(
    classifyRecoveryBootstrapState(inventory({ dataKey: "present-malformed" })),
    "needs-review",
  );
  assert.equal(
    classifyRecoveryBootstrapState(
      inventory({ appStoreRecord: "encrypted", dataKey: "present-malformed" }),
    ),
    "recover-existing",
  );
  assert.equal(
    classifyRecoveryBootstrapState(
      inventory({ appStoreRecord: "legacy-plaintext", snapVault: "contains-entries" }),
    ),
    "needs-review",
  );
});
