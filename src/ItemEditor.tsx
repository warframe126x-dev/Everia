import { useDialog } from "./useDialog";
import { FormEvent, useState } from "react";
import { Check, X } from "lucide-react";
import { categoryLabel, subtypeLabel } from "./data";
import { useLocalization } from "./localization/Localization";
import { statusOptions } from "./mediaConfig";

import { Cover } from "./Cover";
import { storeCover } from "./covers";
import { OnlineSearch } from "./OnlineSearch";
import { candidateToDraft } from "./providers";

import {
  categories,
  type Category,
  type MediaItem,
  type ReadingStatus,
} from "./types";

export function ItemEditor({
  initial,
  onClose,
  onSave,
  onConfigure,
}: {
  initial: Omit<MediaItem, "id" | "dateAdded">;
  onClose: () => void;
  onSave: (item: MediaItem) => void;
  onConfigure: () => void;
}) {
  const { locale, t } = useLocalization();
  const dialogRef = useDialog(onClose);
  const [draft, setDraft] = useState(initial);
  const [imageFile, setImageFile] = useState<File>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"online" | "manual">("online");
  const [importedNotice, setImportedNotice] = useState<string>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode !== "manual" || !draft.title.trim()) return;
    setBusy(true);
    try {
      const coverUrl =
        imageFile || draft.coverUrl
          ? await storeCover(imageFile ?? draft.coverUrl!)
          : undefined;
      onSave({
        ...draft,
        coverUrl,
        title: draft.title.trim(),
        id: crypto.randomUUID(),
        dateAdded: new Date().toISOString(),
      });
    } catch {
      setError("errors.entrySave");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("editor.addEntry")}
      className="modal-layer"
    >
      <button
        className="modal-scrim"
        aria-label={t("navigation.close")}
        onClick={onClose}
      />
      <form className="editor-modal" onSubmit={submit}>
        <div className="modal-header">
          <div>
            <p className="kicker">{t("editor.newEntry")}</p>
            <h2>{t("editor.addToEveria")}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t("navigation.close")}
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        <div className="add-mode-toggle" aria-label={t("editor.addMethod")}>
          <button
            type="button"
            className={mode === "online" ? "active" : ""}
            onClick={() => setMode("online")}
          >
            {t("editor.onlineSearch")}
          </button>
          <button
            type="button"
            className={mode === "manual" ? "active" : ""}
            onClick={() => setMode("manual")}
          >
            {t("editor.manualEntry")}
          </button>
        </div>
        {mode === "online" ? (
          <OnlineSearch
            category={draft.category}
            setCategory={(category) =>
              setDraft({ ...draft, category, subtype: undefined })
            }
            onUse={(candidate) => {
              setDraft(candidateToDraft(candidate));
              setImportedNotice(candidate.providerName);
              setMode("manual");
            }}
            onConfigure={onConfigure}
          />
        ) : (
          <>
            {importedNotice && (
              <p className="imported-notice">
                {t("editor.importedNotice", { provider: importedNotice })}
              </p>
            )}
            <div className="form-grid">
              {error && (
                <p role="alert" className="wide">
                  {t("errors.entrySave")}
                </p>
              )}
              <label className="wide">
                {t("editor.localCover")}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => setImageFile(e.target.files?.[0])}
                />
              </label>
              <label className="wide">
                {t("editor.title")}
                <input
                  autoFocus
                  required
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                  placeholder={t("editor.title")}
                />
              </label>
              <label>
                {t("editor.category")}
                <select
                  value={draft.category}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      category: e.target.value as Category,
                      subtype: undefined,
                    })
                  }
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {categoryLabel(c, locale)}
                    </option>
                  ))}
                </select>
              </label>
              {draft.category === "manga" && (
                <label>
                  {t("editor.type")}
                  <select
                    value={draft.subtype ?? "Manga"}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        subtype: e.target.value as MediaItem["subtype"],
                      })
                    }
                  >
                    {(["Manga", "Manhwa", "Manhua"] as const).map((value) => (
                      <option key={value} value={value}>
                        {subtypeLabel(value, locale)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {draft.category === "novels" && (
                <label>
                  {t("editor.type")}
                  <select
                    value={draft.subtype ?? "Novel"}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        subtype: e.target.value as MediaItem["subtype"],
                      })
                    }
                  >
                    {(["Novel", "Light Novel", "Web Novel"] as const).map(
                      (value) => (
                        <option key={value} value={value}>
                          {subtypeLabel(value, locale)}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              )}
              <label>
                {t("editor.authorCreator")}
                <input
                  value={draft.creator}
                  onChange={(e) =>
                    setDraft({ ...draft, creator: e.target.value })
                  }
                  placeholder={t("editor.optional")}
                />
              </label>
              <label>
                {t("library.releaseDate")}
                <input
                  value={draft.releaseDate}
                  onChange={(e) =>
                    setDraft({ ...draft, releaseDate: e.target.value })
                  }
                  placeholder={t("editor.releaseExample")}
                />
              </label>
              <label>
                {t("details.genre")}
                <input
                  value={draft.genres?.join(", ") ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      genres: e.target.value
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder={t("editor.optional")}
                />
              </label>
              {draft.category === "games" && (
                <label>
                  {t("details.platform")}
                  <input
                    value={draft.platform ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, platform: e.target.value })
                    }
                    placeholder={t("editor.optional")}
                  />
                </label>
              )}
              {draft.providerMetadata && (
                <label>
                  {draft.category === "movies"
                    ? t("editor.runtimeMinutes")
                    : draft.category === "tv-series"
                      ? t("details.seasons")
                      : draft.category === "anime"
                        ? t("details.episodes")
                        : draft.providerMetadata.volumes !== undefined
                          ? t("details.volumes")
                          : t("details.chapters")}
                  <input
                    type="number"
                    min="0"
                    value={
                      draft.category === "movies"
                        ? (draft.providerMetadata.runtimeMinutes ?? "")
                        : draft.category === "tv-series"
                          ? (draft.providerMetadata.seasons ?? "")
                          : draft.category === "anime"
                            ? (draft.providerMetadata.episodes ?? "")
                            : (draft.providerMetadata.volumes ??
                              draft.providerMetadata.chapters ??
                              "")
                    }
                    onChange={(e) => {
                      const value = e.target.value
                        ? Number(e.target.value)
                        : undefined;
                      const key =
                        draft.category === "movies"
                          ? "runtimeMinutes"
                          : draft.category === "tv-series"
                            ? "seasons"
                            : draft.category === "anime"
                              ? "episodes"
                              : draft.providerMetadata?.volumes !== undefined
                                ? "volumes"
                                : "chapters";
                      setDraft({
                        ...draft,
                        providerMetadata: {
                          ...draft.providerMetadata,
                          [key]: value,
                        },
                      });
                    }}
                  />
                </label>
              )}
              <label>
                {t("details.status")}
                <select
                  value={draft.status}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      status: e.target.value as ReadingStatus,
                    })
                  }
                >
                  {statusOptions(draft.category, locale).map(
                    ({ value, label }) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                {t("editor.rating")}
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={draft.rating ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      rating: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    })
                  }
                  placeholder="1–10"
                />
              </label>
              <label className="wide">
                {t("editor.coverUrl")}
                <input
                  value={draft.coverUrl ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, coverUrl: e.target.value })
                  }
                  placeholder={t("editor.optional")}
                />
              </label>
              <label className="wide">
                {t("editor.description")}
                <textarea
                  rows={3}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                  placeholder={t("editor.summaryPlaceholder")}
                />
              </label>
              <label className="wide">
                {t("details.myNotes")}
                <textarea
                  rows={3}
                  value={draft.notes}
                  onChange={(e) =>
                    setDraft({ ...draft, notes: e.target.value })
                  }
                  placeholder={t("editor.notesPlaceholder")}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={onClose}
              >
                {t("common.cancel")}
              </button>
              <button className="primary" disabled={busy}>
                <Check size={18} />{" "}
                {busy ? t("editor.savingLocal") : t("editor.saveToLibrary")}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
