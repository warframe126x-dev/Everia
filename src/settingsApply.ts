import { removeWallpaper, storeWallpaper } from "./covers";
import { storage } from "./storage";
import {
  credentialOperations,
  type SettingsDraft,
  type SettingsValues,
} from "./settingsDraft";

export class CredentialApplyFailure extends Error {
  constructor(readonly code: string) {
    super("Provider credential changes could not be applied.");
  }
}

/** Keep the protected credential batch last; no subsequent fallible write follows it. */
export async function applySettingsDraft(
  committed: SettingsValues,
  draft: SettingsDraft,
): Promise<SettingsValues> {
  const oldTheme = localStorage.getItem("everia.theme.v1");
  const oldLocale = localStorage.getItem("everia.locale.v1");
  let createdWallpaper: string | undefined;
  let settingsWritten = false;
  let backupWritten = false;
  let oldBackup:
    | Awaited<ReturnType<NonNullable<typeof window.everiaBackup>["config"]>>
    | undefined;
  const backupChanged =
    draft.backupEnabled !== committed.backupEnabled ||
    draft.backupDestination !== committed.backupDestination;
  const operations = credentialOperations(draft);
  try {
    if (draft.wallpaperFile)
      createdWallpaper = await storeWallpaper(draft.wallpaperFile);
    const theme = createdWallpaper
      ? { ...draft.theme, customWallpaperId: createdWallpaper }
      : draft.theme;
    // In-memory committed state is updated by the caller only after every write succeeds.
    storage.saveTheme(theme);
    settingsWritten = true;
    storage.saveLocale(draft.locale);
    if (backupChanged) {
      if (
        !window.everiaBackup ||
        draft.backupEnabled === null ||
        draft.backupDestination === null
      )
        throw new Error("Backup configuration is unavailable.");
      oldBackup = await window.everiaBackup.config();
      await window.everiaBackup.setConfig({
        ...(draft.backupEnabled !== committed.backupEnabled
          ? { enabled: draft.backupEnabled }
          : {}),
        ...(draft.backupDestination !== committed.backupDestination
          ? { destination: draft.backupDestination }
          : {}),
      });
      backupWritten = true;
    }
    if (operations.length) {
      const response =
        await window.everiaProviders?.applyDraftCredentials(operations);
      if (!response?.ok)
        throw new CredentialApplyFailure(
          response?.errorCode ?? "operation-failed",
        );
    }
    return {
      theme,
      locale: draft.locale,
      backupEnabled: draft.backupEnabled,
      backupDestination: draft.backupDestination,
    };
  } catch (error) {
    const recoveryErrors: unknown[] = [];
    if (backupWritten && oldBackup)
      try {
        await window.everiaBackup?.setConfig({
          enabled: oldBackup.enabled,
          destination: oldBackup.destination,
          destinationSelected: oldBackup.destinationSelected,
        });
      } catch (rollbackError) {
        recoveryErrors.push(rollbackError);
      }
    if (settingsWritten) {
      try {
        for (const [key, value] of [
          ["everia.theme.v1", oldTheme],
          ["everia.locale.v1", oldLocale],
        ] as const)
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
      } catch (rollbackError) {
        recoveryErrors.push(rollbackError);
      }
    }
    if (createdWallpaper)
      try {
        await removeWallpaper(createdWallpaper);
      } catch (rollbackError) {
        recoveryErrors.push(rollbackError);
      }
    if (recoveryErrors.length)
      throw new Error(
        "Settings apply and rollback failed; saved state needs recovery.",
        { cause: error },
      );
    throw error;
  }
}
