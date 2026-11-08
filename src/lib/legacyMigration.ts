type LegacyStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const LEGACY_KEY = "one-os-v1";
const LEGACY_OWNER_KEY = "one-os-v1-owner";

// Only one account on this installation may claim the old unscoped record.
// Serialize claims in-process so two account bootstrap effects cannot both
// copy the same legacy data into different account namespaces.
let migrationQueue: Promise<void> = Promise.resolve();

export function migrateLegacyRecordForUser(
  userId: string,
  storage: LegacyStorage,
  persistEncrypted: (value: string) => Promise<void>,
): Promise<boolean> {
  const operation = migrationQueue.catch(() => undefined).then(async () => {
    const legacy = await storage.getItem(LEGACY_KEY);
    if (legacy === null) return false;

    let owner = await storage.getItem(LEGACY_OWNER_KEY);
    if (owner !== null && owner !== userId) return false;

    if (owner === null) {
      await storage.setItem(LEGACY_OWNER_KEY, userId);
      owner = await storage.getItem(LEGACY_OWNER_KEY);
      if (owner !== userId) {
        throw new Error("Legacy data ownership could not be verified; the original data was preserved.");
      }
    }

    // Re-read after the ownership claim. Persist the encrypted copy before
    // removing the original so an interrupted migration remains retryable.
    const currentLegacy = await storage.getItem(LEGACY_KEY);
    if (currentLegacy === null) return false;
    await persistEncrypted(currentLegacy);
    await storage.removeItem(LEGACY_KEY);
    return true;
  });

  migrationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
