import type { ThemeSettings } from "./types";
import type { Locale } from "./localization/locale";

export type CredentialProvider = "igdb" | "rawg" | "tmdb" | "omdb";
export type CredentialChange =
  | {
      kind: "save";
      credentials:
        { clientId: string; clientSecret: string } | { token: string };
    }
  | { kind: "remove" };

export type SettingsValues = {
  theme: ThemeSettings;
  locale: Locale;
  backupEnabled: boolean | null;
  backupDestination: string | null;
};
export type SettingsDraft = SettingsValues & {
  wallpaperFile: File | null;
  credentials: Partial<Record<CredentialProvider, CredentialChange>>;
};

export function freshDraft(values: SettingsValues): SettingsDraft {
  return {
    ...values,
    theme: { ...values.theme },
    wallpaperFile: null,
    credentials: {},
  };
}

export function settingsDirty(
  values: SettingsValues,
  draft: SettingsDraft,
): boolean {
  const keys: (keyof ThemeSettings)[] = [
    "accent",
    "background",
    "text",
    "backgroundMode",
    "customWallpaperId",
    "imageFit",
    "backgroundDimming",
  ];
  return (
    draft.locale !== values.locale ||
    draft.backupEnabled !== values.backupEnabled ||
    draft.backupDestination !== values.backupDestination ||
    keys.some((key) => draft.theme[key] !== values.theme[key]) ||
    draft.wallpaperFile !== null ||
    Object.values(draft.credentials).some(Boolean)
  );
}

export function credentialOperations(draft: SettingsDraft) {
  return (
    Object.entries(draft.credentials) as [
      CredentialProvider,
      CredentialChange | undefined,
    ][]
  )
    .filter((entry): entry is [CredentialProvider, CredentialChange] =>
      Boolean(entry[1]),
    )
    .map(([provider, change]) => ({ provider, ...change }));
}
