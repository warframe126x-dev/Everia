import { Image, Library, Palette, Plug } from "lucide-react";
import { defaultTheme } from "./data";
import { storeWallpaper } from "./covers";
import { useState } from "react";
import {
  type BackgroundFit,
  type BackgroundMode,
  type ThemeSettings,
} from "./types";
import { OnlineSourcesSettings } from "./OnlineSourcesSettings";
import { assetUrl } from "./assetPaths";

export function SettingsView({
  theme,
  setTheme,
}: {
  theme: ThemeSettings;
  setTheme: (theme: ThemeSettings) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const chooseWallpaper = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const customWallpaperId = await storeWallpaper(file);
      setTheme({ ...theme, backgroundMode: "custom", customWallpaperId });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The wallpaper could not be stored.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page settings-page">
      <div className="page-title">
        <div>
          <p className="kicker">PERSONALIZE</p>
          <h1>Settings</h1>
          <p>Shape Everia into a universe that feels like yours.</p>
        </div>
      </div>
      <section className="settings-card">
        <div className="settings-icon">
          <Palette />
        </div>
        <div className="settings-content">
          <h2>Appearance</h2>
          <p>
            Keep Everia readable while choosing the colors that feel like yours.
          </p>
          <div className="color-settings">
            {(
              [
                ["Accent color", "accent"],
                ["Background color", "background"],
                ["Text color", "text"],
              ] as const
            ).map(([label, key]) => (
              <label key={key}>
                {label}
                <input
                  aria-label={label}
                  type="color"
                  value={theme[key]}
                  onChange={(e) =>
                    setTheme({ ...theme, [key]: e.target.value })
                  }
                />
                <code>{theme[key]}</code>
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
            Restore default colors
          </button>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon">
          <Image />
        </div>
        <div className="settings-content">
          <h2>Background</h2>
          <p>
            Use Everia’s approved wallpaper, a solid color, or a personal image
            copied into local storage.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="background-modes">
            {(
              [
                ["default", "Everia Default", "The built-in Everia universe."],
                [
                  "solid",
                  "Solid Color",
                  "Uses your selected background color.",
                ],
                [
                  "custom",
                  "Custom Image",
                  "Uses a locally stored personal image.",
                ],
              ] as [BackgroundMode, string, string][]
            ).map(([mode, label, help]) => (
              <button
                key={mode}
                className={theme.backgroundMode === mode ? "active" : ""}
                onClick={() => setTheme({ ...theme, backgroundMode: mode })}
                disabled={mode === "custom" && !theme.customWallpaperId}
              >
                <strong>{label}</strong>
                <span>{help}</span>
              </button>
            ))}
          </div>
          <label className="wallpaper-picker">
            Custom image
            <input
              aria-label="Choose custom wallpaper"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={busy}
              onChange={(e) => chooseWallpaper(e.target.files?.[0])}
            />
            <small>
              {busy
                ? "Copying into Everia…"
                : theme.customWallpaperId
                  ? "A local copy is ready."
                  : "PNG, JPEG, WebP or GIF up to 30 MB."}
            </small>
          </label>
          <div className="background-controls">
            <label>
              Image fit
              <select
                value={theme.imageFit}
                onChange={(e) =>
                  setTheme({
                    ...theme,
                    imageFit: e.target.value as BackgroundFit,
                  })
                }
              >
                <option value="cover">Cover</option>
                <option value="contain">Contain</option>
                <option value="stretch">Stretch</option>
              </select>
            </label>
            <label>
              Background dimming <strong>{theme.backgroundDimming}%</strong>
              <input
                aria-label="Background dimming"
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
            onClick={() => setTheme(defaultTheme)}
          >
            Restore appearance defaults
          </button>
        </div>
      </section>
      <section className="settings-card" id="online-sources">
        <div className="settings-icon">
          <Plug />
        </div>
        <div className="settings-content">
          <h2>Online Sources</h2>
          <p>
            Connect metadata providers for discovery and import. Saved entries
            remain local and independent of every provider.
          </p>
          <OnlineSourcesSettings />
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon">
          <Library />
        </div>
        <div className="settings-content">
          <h2>Local-first library</h2>
          <p>
            Your entries, covers, personal information and custom wallpaper are
            stored on this device. Online sources can help you discover items,
            but losing a source will never remove what you already saved.
          </p>
          <div className="provider-credits">
            <h3>Metadata credits</h3>
            <p>
              Provider attribution is kept here, separate from your personal
              library. Everia supports IGDB, TMDB, RanobeDB and Jikan adapters.
            </p>
            <img
              className="tmdb-logo"
              src={assetUrl("assets/providers/tmdb-logo.svg")}
              alt="The Movie Database (TMDB)"
            />
            <p className="tmdb-notice">
              This product uses the TMDB API but is not endorsed or certified by
              TMDB.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
