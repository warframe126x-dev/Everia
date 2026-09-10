import { useDialog } from "./useDialog";
import { FormEvent, useState } from "react";
import { Check, X } from "lucide-react";
import { categoryInfo } from "./data";

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

const statuses: ReadingStatus[] = [
  "Planning",
  "In progress",
  "Completed",
  "On hold",
  "Dropped",
];

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
  const dialogRef = useDialog(onClose);
  const [draft, setDraft] = useState(initial);
  const [imageFile, setImageFile] = useState<File>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"online" | "manual">("online");
  const [importedNotice, setImportedNotice] = useState("");
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
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not save. Try a local image file.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Add an entry"
      className="modal-layer"
    >
      <button className="modal-scrim" aria-label="Close" onClick={onClose} />
      <form className="editor-modal" onSubmit={submit}>
        <div className="modal-header">
          <div>
            <p className="kicker">NEW ENTRY</p>
            <h2>Add to Everia</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="add-mode-toggle" aria-label="Add entry method">
          <button
            type="button"
            className={mode === "online" ? "active" : ""}
            onClick={() => setMode("online")}
          >
            Online search
          </button>
          <button
            type="button"
            className={mode === "manual" ? "active" : ""}
            onClick={() => setMode("manual")}
          >
            Manual entry
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
              setImportedNotice(
                `${candidate.providerName} metadata loaded. Review it before saving your local Everia entry.`,
              );
              setMode("manual");
            }}
            onConfigure={onConfigure}
            onManual={() => setMode("manual")}
          />
        ) : (
          <>
            {importedNotice && (
              <p className="imported-notice">{importedNotice}</p>
            )}
            <div className="form-grid">
              {error && (
                <p role="alert" className="wide">
                  {error}
                </p>
              )}
              <label className="wide">
                Local cover image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => setImageFile(e.target.files?.[0])}
                />
              </label>
              <label className="wide">
                Title
                <input
                  autoFocus
                  required
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                  placeholder="Title"
                />
              </label>
              <label>
                Category
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
                      {categoryInfo[c].label}
                    </option>
                  ))}
                </select>
              </label>
              {draft.category === "manga" && (
                <label>
                  Type
                  <select
                    value={draft.subtype ?? "Manga"}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        subtype: e.target.value as MediaItem["subtype"],
                      })
                    }
                  >
                    <option>Manga</option>
                    <option>Manhwa</option>
                    <option>Manhua</option>
                  </select>
                </label>
              )}
              {draft.category === "novels" && (
                <label>
                  Type
                  <select
                    value={draft.subtype ?? "Novel"}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        subtype: e.target.value as MediaItem["subtype"],
                      })
                    }
                  >
                    <option>Novel</option>
                    <option>Light Novel</option>
                    <option>Web Novel</option>
                  </select>
                </label>
              )}
              <label>
                Author / creator
                <input
                  value={draft.creator}
                  onChange={(e) =>
                    setDraft({ ...draft, creator: e.target.value })
                  }
                  placeholder="Optional"
                />
              </label>
              <label>
                Release date
                <input
                  value={draft.releaseDate}
                  onChange={(e) =>
                    setDraft({ ...draft, releaseDate: e.target.value })
                  }
                  placeholder="2024 or 2024-05-12"
                />
              </label>
              <label>
                Genre
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
                  placeholder="Optional"
                />
              </label>
              {draft.category === "games" && (
                <label>
                  Platform
                  <input
                    value={draft.platform ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, platform: e.target.value })
                    }
                    placeholder="Optional"
                  />
                </label>
              )}
              {draft.providerMetadata && (
                <label>
                  {draft.category === "movies"
                    ? "Runtime (minutes)"
                    : draft.category === "tv-series"
                      ? "Seasons"
                      : draft.category === "anime"
                        ? "Episodes"
                        : draft.providerMetadata.volumes !== undefined
                          ? "Volumes"
                          : "Chapters"}
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
                Status
                <select
                  value={draft.status}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      status: e.target.value as ReadingStatus,
                    })
                  }
                >
                  {statuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>
              <label>
                Rating
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
                Cover image URL
                <input
                  value={draft.coverUrl ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, coverUrl: e.target.value })
                  }
                  placeholder="Optional"
                />
              </label>
              <label className="wide">
                Description
                <textarea
                  rows={3}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                  placeholder="A short summary..."
                />
              </label>
              <label className="wide">
                My notes
                <textarea
                  rows={3}
                  value={draft.notes}
                  onChange={(e) =>
                    setDraft({ ...draft, notes: e.target.value })
                  }
                  placeholder="Thoughts, progress, reminders..."
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
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                <Check size={18} />{" "}
                {busy ? "Saving local copy…" : "Save to library"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
