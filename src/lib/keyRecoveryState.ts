import type { LegacyDeviceKeyInspection, LocalEncryptedDataInventory } from "@/lib/keyRecoveryRegistry";

export type RecoveryBootstrapState =
  | "fresh-candidate"
  | "ready"
  | "recover-existing"
  | "needs-review";

/**
 * Conservative, side-effect-free decision over the two read-only inspections.
 * A fresh candidate may contain legacy plaintext that can be migrated, but
 * never encrypted records or files whose key is missing.
 */
export function classifyRecoveryBootstrapState(
  device: LegacyDeviceKeyInspection,
  inventory: LocalEncryptedDataInventory,
): RecoveryBootstrapState {
  if (inventory.status !== "complete") return "needs-review";
  if (device.status !== "absent" && device.status !== "valid") return "needs-review";
  if (device.status === "valid" && device.revoked) return "needs-review";

  if (inventory.dataKey === "present-valid") return "ready";

  const encryptedDataExists =
    inventory.appStoreRecord === "encrypted" ||
    inventory.snapIndex === "encrypted" ||
    inventory.snapVault === "contains-entries";

  if (
    encryptedDataExists &&
    (inventory.dataKey === "missing" || inventory.dataKey === "present-malformed")
  ) {
    return "recover-existing";
  }

  const legacyDataCanBeMigrated =
    inventory.appStoreRecord !== "encrypted" &&
    inventory.snapIndex !== "encrypted" &&
    inventory.snapVault === "empty-visible";

  if (
    inventory.dataKey === "missing" &&
    legacyDataCanBeMigrated
  ) {
    return "fresh-candidate";
  }

  return "needs-review";
}
