import { Image, Library, Palette, Plug } from "lucide-react";
import { defaultTheme } from "./data";
import { validateWallpaper } from "./covers";
import { useState } from "react";
import { type BackgroundFit, type ThemeSettings } from "./types";
import { OnlineSourcesSettings } from "./OnlineSourcesSettings";
import { assetUrl } from "./assetPaths";
import { useLocalization } from "./localization/Localization";
import { locales } from "./localization/locale";
import { ControlSelect } from "./ControlSelect";
import type { SettingsDraft } from "./settingsDraft";
import { BackupSettings } from "./BackupSettings";
import type { StringKey } from "./localization/format";

export function SettingsView({
  draft,
  onChange,
  onLocaleChange,
  onApply,
  onRestore,
  dirty,
  applying,
  applyError,
  backupConfig,
  systemDrive,
  restoreError,
}: {
  draft: SettingsDraft;
  onChange: (next: SettingsDraft) => void;
  onLocaleChange: (locale: (typeof locales)[number]) => void;
  onApply: () => void;
  onRestore: () => void;
  dirty: boolean;
  applying: boolean;
  applyError: StringKey | "";
  backupConfig: {
    destination: string;
    lastSuccess: string | null;
    lastFailure: { at: string; message: string } | null;
  } | null;
  systemDrive: string;
  restoreError: import("./localization/format").StringKey | "";
}) {
  const { t } = useLocalization();
  const theme = draft.theme;
  const setTheme = (value: ThemeSettings) =>
    onChange({ ...draft, theme: value });
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const chooseWallpaper = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError(false);
    try {
      await validateWallpaper(file);
      onChange({
        ...draft,
        wallpaperFile: file,
        theme: { ...theme, backgroundMode: "custom" },
      });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page settings-page">
      <div className="page-title">
        <div>
          <p className="kicker">{t("settings.personalize")}</p>
          <h1>{t("navigation.settings")}</h1>
          <p>{t("settings.intro")}</p>
        </div>
      </div>
      <section className="settings-card">
        <div className="settings-icon">
          <Palette />
        </div>
        <div className="settings-content">
          <h2>{t("settings.appearance")}</h2>
          <p>{t("settings.appearanceDescription")}</p>
          <div className="color-settings">
            {(
              [
                ["settings.accentColor", "accent"],
                ["settings.backgroundColor", "background"],
                ["settings.textColor", "text"],
              ] as const
            ).map(([label, key]) => (
              <label key={key}>
                {t(label)}
                <input
                  aria-label={t(label)}
                  type="color"
                  value={theme[key]}
                  onChange={(e) =>
                    setTheme({ ...theme, [key]: e.target.value })
                  }
                />
                <code dir="ltr">{theme[key]}</code>
              </label>
            ))}
          </div>
          <button
            className="secondary"
            onClick={() =>
              setTheme({
                ...theme,
                accent: defaultTheme.accent,
                background: defaultTheme.background,
                text: defaultTheme.text,
              })
            }
          >
            {t("settings.restoreColors")}
          </button>
          <label className="locale-setting">
            {t("settings.language")}
            <ControlSelect>
              <select
                value={draft.locale}
                onChange={(event) => {
                  onLocaleChange(
                    event.target.value as (typeof locales)[number],
                  );
                }}
              >
                {locales.map((value) => (
                  <option key={value} value={value}>
                    {value === "en"
                      ? "English"
                      : value === "fr"
                        ? "Français"
                        : "العربية"}
                  </option>
                ))}
              </select>
            </ControlSelect>
          </label>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon">
          <Image />
        </div>
        <div className="settings-content">
          <h2>{t("settings.background")}</h2>
          <p>{t("settings.backgroundDescription")}</p>
          {error && <p role="alert">{t("settings.wallpaperError")}</p>}
          <div className="background-modes">
            {(
              [
                ["default", "settings.defaultMode", "settings.defaultHelp"],
                ["solid", "settings.solidMode", "settings.solidHelp"],
                ["custom", "settings.customMode", "settings.customHelp"],
              ] as const
            ).map(([mode, label, help]) => (
              <button
                key={mode}
                className={theme.backgroundMode === mode ? "active" : ""}
                onClick={() => setTheme({ ...theme, backgroundMode: mode })}
                disabled={
                  mode === "custom" &&
                  !theme.customWallpaperId &&
                  !draft.wallpaperFile
                }
              >
                <strong>{t(label)}</strong>
                <span>{t(help)}</span>
              </button>
            ))}
          </div>
          <label className="wallpaper-picker">
            {t("settings.customImage")}
            <input
              aria-label={t("settings.chooseWallpaper")}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={busy}
              onChange={(e) => chooseWallpaper(e.target.files?.[0])}
            />
            <small>
              {busy
                ? t("settings.copying")
                : draft.wallpaperFile
                  ? t("settings.wallpaperPending")
                  : theme.customWallpaperId
                    ? t("settings.localCopyReady")
                    : t("settings.imageLimits")}
            </small>
          </label>
          <div className="background-controls">
            <label>
              {t("settings.imageFit")}
              <ControlSelect>
                <select
                  value={theme.imageFit}
                  onChange={(e) =>
                    setTheme({
                      ...theme,
                      imageFit: e.target.value as BackgroundFit,
                    })
                  }
                >
                  <option value="cover">{t("settings.fitCover")}</option>
                  <option value="contain">{t("settings.fitContain")}</option>
                  <option value="stretch">{t("settings.fitStretch")}</option>
                </select>
              </ControlSelect>
            </label>
            <label>
              {t("settings.dimming")}{" "}
              <strong dir="ltr">{theme.backgroundDimming}%</strong>
              <input
                aria-label={t("settings.dimming")}
                type="range"
                min="0"
                max="85"
                value={theme.backgroundDimming}
                onChange={(e) =>
                  setTheme({
                    ...theme,
                    backgroundDimming: Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <button
            className="secondary restore-appearance"
            onClick={() =>
              onChange({ ...draft, theme: defaultTheme, wallpaperFile: null })
            }
          >
            {t("settings.restoreAppearance")}
          </button>
        </div>
      </section>
      <section className="settings-card" id="online-sources">
        <div className="settings-icon">
          <Plug />
        </div>
        <div className="settings-content">
          <h2>{t("settings.onlineSources")}</h2>
          <p>{t("settings.onlineDescription")}</p>
          <OnlineSourcesSettings
            changes={draft.credentials}
            onChange={(credentials) => onChange({ ...draft, credentials })}
          />
        </div>
      </section>
      <BackupSettings
        draft={draft}
        onChange={onChange}
        committed={backupConfig}
        systemDrive={systemDrive}
        onRestore={onRestore}
        restoreError={restoreError}
      />
      {applyError && <p role="alert">{t(applyError)}</p>}
      <button
        className="primary settings-apply"
        disabled={!dirty || applying}
        onClick={onApply}
      >
        {applying ? t("settings.applying") : t("settings.applyChanges")}
      </button>
      <section className="settings-card">
        <div className="settings-icon">
          <Library />
        </div>
        <div className="settings-content">
          <h2>{t("settings.localLibrary")}</h2>
          <p>{t("settings.localDescription")}</p>
          <div className="provider-credits">
            <h3>{t("settings.credits")}</h3>
            <p>{t("settings.creditsDescription")}</p>
            <img
              className="tmdb-logo"
              src={assetUrl("assets/providers/tmdb-logo.svg")}
              alt={t("settings.tmdbAlt")}
            />
            <p className="tmdb-notice">{t("settings.tmdbNotice")}</p>
            <p>
              {t("settings.rawgIntro")}{" "}
              <a
                href="https://rawg.io/"
                target="_blank"
                rel="noreferrer"
                dir="ltr"
              >
                RAWG
              </a>
              {t("settings.omdbIntro")}{" "}
              <a
                href="https://creativecommons.org/licenses/by-nc/4.0/"
                target="_blank"
                rel="noreferrer"
                dir="ltr"
              >
                CC BY-NC 4.0
              </a>
              {t("settings.animeRights")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
