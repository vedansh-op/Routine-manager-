import type { LocalEncryptedDataInventory } from "@/lib/keyRecoveryRegistry";

export type RecoveryBootstrapState =
  | "fresh-candidate"
  | "ready"
  | "recover-existing"
  | "needs-review";

/**
 * Classifies only the local data-key boundary. Device-key registration is a
 * separate Snap capability and must not block offline access to local tasks.
 */
export function classifyRecoveryBootstrapState(
  inventory: LocalEncryptedDataInventory,
): RecoveryBootstrapState {
  if (inventory.status !== "complete") return "needs-review";

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

  if (inventory.dataKey === "missing" && legacyDataCanBeMigrated) {
    return "fresh-candidate";
  }

  return "needs-review";
}
