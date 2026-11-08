import type { LegacyDeviceKeyInspection, LocalEncryptedDataInventory } from "@/lib/keyRecoveryRegistry";

export type RecoveryBootstrapState =
  | "fresh-candidate"
  | "ready"
  | "recover-existing"
  | "needs-review";

/**
 * Conservative, side-effect-free decision over the two read-only inspections.
 * "fresh-candidate" is only a candidate: callers must still obtain explicit
 * user confirmation before creating or replacing any key material.
 */
export function classifyRecoveryBootstrapState(
  device: LegacyDeviceKeyInspection,
  inventory: LocalEncryptedDataInventory,
): RecoveryBootstrapState {
  if (inventory.status !== "complete") return "needs-review";
  if (device.status !== "absent" && device.status !== "valid") return "needs-review";
  if (device.status === "valid" && device.revoked) return "needs-review";

  const hasData =
    inventory.dataKey !== "missing" ||
    inventory.appStoreRecord !== "absent" ||
    inventory.legacyUnscopedAppStoreRecord !== "absent" ||
    inventory.snapIndex !== "absent" ||
    inventory.snapVault !== "empty-visible";

  if (
    device.status === "valid" &&
    !device.revoked &&
    inventory.dataKey === "present-valid"
  ) {
    return "ready";
  }

  if (
    device.status === "absent" &&
    inventory.dataKey === "missing" &&
    inventory.appStoreRecord === "absent" &&
    inventory.legacyUnscopedAppStoreRecord === "absent" &&
    inventory.snapIndex === "absent" &&
    inventory.snapVault === "empty-visible"
  ) {
    return "fresh-candidate";
  }

  if (
    hasData &&
    (inventory.dataKey === "missing" ||
      inventory.dataKey === "present-malformed" ||
      device.status === "absent" ||
      device.status === "partial")
  ) {
    return "recover-existing";
  }

  return "needs-review";
}
