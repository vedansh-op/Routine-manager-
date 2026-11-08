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

const device = (status = "absent", revoked = false) =>
  status === "valid"
    ? { status, deviceIdPresent: true, secretPresent: true, revoked }
    : status === "absent"
      ? { status, deviceIdPresent: false, secretPresent: false }
      : { status, deviceIdPresent: true, secretPresent: false };

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

test("fresh candidate requires a positively visible empty inventory", () => {
  assert.equal(classifyRecoveryBootstrapState(device(), inventory()), "fresh-candidate");
  assert.equal(
    classifyRecoveryBootstrapState(device(), inventory({ snapVault: "not-visible" })),
    "needs-review",
  );
  assert.equal(
    classifyRecoveryBootstrapState(device(), inventory({ status: "unknown" })),
    "needs-review",
  );
});

test("existing encrypted data with a missing key requires recovery", () => {
  assert.equal(
    classifyRecoveryBootstrapState(
      device(),
      inventory({ appStoreRecord: "encrypted" }),
    ),
    "recover-existing",
  );
  assert.equal(
    classifyRecoveryBootstrapState(
      device(),
      inventory({ snapIndex: "encrypted", snapVault: "contains-entries" }),
    ),
    "recover-existing",
  );
});

test("a valid active device and valid data key are ready", () => {
  assert.equal(
    classifyRecoveryBootstrapState(
      device("valid"),
      inventory({ dataKey: "present-valid" }),
    ),
    "ready",
  );
});

test("revoked, malformed, and inconsistent key states fail closed", () => {
  assert.equal(
    classifyRecoveryBootstrapState(
      device("valid", true),
      inventory({ dataKey: "present-valid" }),
    ),
    "needs-review",
  );
  assert.equal(
    classifyRecoveryBootstrapState(
      device(),
      inventory({ dataKey: "present-malformed" }),
    ),
    "recover-existing",
  );
  assert.equal(
    classifyRecoveryBootstrapState(
      device("partial"),
      inventory({ dataKey: "present-valid" }),
    ),
    "needs-review",
  );
});
