import { FormEvent, useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Heart,
  Pencil,
  Trash2,
} from "lucide-react";
import { categoryInfo } from "./data";
import { Cover } from "./Cover";
import { storeCover } from "./covers";
import { contributorLabel, creatorLabel, statusOptions } from "./mediaConfig";
import { StarRating } from "./StarRating";
import {
  categories,
  type Category,
  type MediaItem,
  type ReadingStatus,
} from "./types";

function safeLink(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function Metadata({ item }: { item: MediaItem }) {
  const fourth =
    item.category === "games"
      ? ["Platform", item.platform]
      : item.category === "movies"
        ? [
            "Runtime",
            item.providerMetadata?.runtimeMinutes
              ? `${item.providerMetadata.runtimeMinutes} min`
              : undefined,
          ]
        : item.category === "tv-series"
          ? ["Seasons", item.providerMetadata?.seasons?.toString()]
          : item.category === "anime"
            ? ["Episodes", item.providerMetadata?.episodes?.toString()]
            : item.providerMetadata?.volumes !== undefined
              ? ["Volumes", item.providerMetadata.volumes.toString()]
              : ["Chapters", item.providerMetadata?.chapters?.toString()];
  const fields = [
    [creatorLabel[item.category], item.creator],
    ["Genre", item.genres?.join(", ")],
    ["Year / Release", item.releaseDate],
    fourth,
  ].filter((field): field is [string, string] => Boolean(field[0] && field[1]));
  return (
    <dl className="metadata-list">
      {fields.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
      {safeLink(item.link) && (
        <div>
          <dt>Link</dt>
          <dd>
            <a href={safeLink(item.link)} target="_blank" rel="noreferrer">
              {item.linkLabel || "Official"} <ExternalLink />
            </a>
          </dd>
        </div>
      )}
    </dl>
  );
}

export function DetailPanel({
  item,
  returnLabel,
  onClose,
  onSave,
  onDelete,
}: {
  item: MediaItem;
  returnLabel: string;
  onClose: () => void;
  onSave: (item: MediaItem) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item);
  const [coverFile, setCoverFile] = useState<File>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(item);
  }, [item, editing]);

  const beginEdit = () => {
    setDraft(item);
    setCoverFile(undefined);
    setError("");
    setEditing(true);
  };
  const cancelEdit = () => {
    setDraft(item);
    setCoverFile(undefined);
    setError("");
    setEditing(false);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim()) return;
    setBusy(true);
    setError("");
    try {
      let coverUrl = draft.coverUrl;
      if (coverFile) coverUrl = await storeCover(coverFile);
      else if (coverUrl && !coverUrl.startsWith("local-cover:"))
        coverUrl = await storeCover(coverUrl);
      onSave({ ...draft, title: draft.title.trim(), coverUrl });
      setEditing(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Changes could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="detail-page">
      <article className="detail-panel" aria-label="Entry details">
        <header className="detail-actions">
          <div>
            <button className="back-button" onClick={onClose}>
              <ArrowLeft /> Back to {returnLabel}
            </button>
            <button
              className={
                item.favorite
                  ? "icon-button favorite active"
                  : "icon-button favorite"
              }
              aria-label={
                item.favorite ? "Remove from favorites" : "Add to favorites"
              }
              onClick={() => onSave({ ...item, favorite: !item.favorite })}
            >
              <Heart fill={item.favorite ? "currentColor" : "none"} />
            </button>
          </div>
          <div>
            {!editing && (
              <button className="secondary edit-button" onClick={beginEdit}>
                <Pencil /> Edit
              </button>
            )}
          </div>
        </header>

        {!editing ? (
          <div className="detail-layout">
            <div className="detail-art-column">
              <div className="detail-art">
                <Cover item={item} detail />
              </div>
              <section className="poster-rating">
                <span>My rating</span>
                <StarRating rating={item.rating} />
              </section>
            </div>
            <div className="detail-content">
              <div className="entry-title-row">
                <div>
                  <p className="kicker">
                    {item.subtype ?? categoryInfo[item.category].label}
                  </p>
                  <h2>{item.title}</h2>
                </div>
                <label className="status-quick">
                  <span>Status</span>
                  <span className="status-select-wrap">
                    <i
                      className={`status ${item.status.toLowerCase().replace(" ", "-")}`}
                    />
                    <select
                      aria-label="Status"
                      value={item.status}
                      onChange={(event) =>
                        onSave({
                          ...item,
                          status: event.target.value as ReadingStatus,
                        })
                      }
                    >
                      {statusOptions(item.category).map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              </div>
              <Metadata item={item} />
              {item.description && (
                <section className="entry-copy">
                  <h3>Summary</h3>
                  <p>{item.description}</p>
                </section>
              )}
              <section className="entry-copy notes-display">
                <h3>My notes</h3>
                <p>{item.notes?.trim() || "No personal notes yet."}</p>
              </section>
              <p className="source-line">
                Saved locally · {item.source ?? "Manual entry"}
              </p>
            </div>
          </div>
        ) : (
          <form className="detail-edit" onSubmit={submit}>
            <div className="edit-heading">
              <div>
                <p className="kicker">EDIT ENTRY</p>
                <h2>{item.title}</h2>
              </div>
              <p>Changes are stored only when you choose Save Changes.</p>
            </div>
            {error && <p role="alert">{error}</p>}
            <div className="edit-grid">
              <label className="wide">
                Replace cover
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => setCoverFile(e.target.files?.[0])}
                />
                {coverFile && (
                  <small>{coverFile.name} will be copied into Everia.</small>
                )}
              </label>
              <label className="wide">
                Title
                <input
                  required
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
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
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {categoryInfo[category].label}
                    </option>
                  ))}
                </select>
              </label>
              {(draft.category === "novels" || draft.category === "manga") && (
                <label>
                  Type
                  <select
                    value={
                      draft.subtype ??
                      (draft.category === "novels" ? "Novel" : "Manga")
                    }
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        subtype: e.target.value as MediaItem["subtype"],
                      })
                    }
                  >
                    {(draft.category === "novels"
                      ? ["Novel", "Light Novel", "Web Novel"]
                      : ["Manga", "Manhwa", "Manhua"]
                    ).map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {creatorLabel[draft.category]}
                <input
                  value={draft.creator ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, creator: e.target.value })
                  }
                />
              </label>
              {contributorLabel[draft.category] && (
                <label>
                  {contributorLabel[draft.category]}
                  <input
                    value={draft.contributors ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, contributors: e.target.value })
                    }
                  />
                </label>
              )}
              <label>
                Year / Release
                <input
                  value={draft.releaseDate ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, releaseDate: e.target.value })
                  }
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
                  />
                </label>
              )}
              <label>
                Status
                <select
                  aria-label="Status"
                  value={draft.status}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      status: e.target.value as ReadingStatus,
                    })
                  }
                >
                  {statusOptions(draft.category).map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Link label
                <input
                  value={draft.linkLabel ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, linkLabel: e.target.value })
                  }
                  placeholder="Official"
                />
              </label>
              <label className="wide">
                Link
                <input
                  type="url"
                  value={draft.link ?? ""}
                  onChange={(e) => setDraft({ ...draft, link: e.target.value })}
                  placeholder="https://"
                />
              </label>
              <fieldset className="wide rating-editor">
                <legend>My rating</legend>
                <StarRating
                  editable
                  rating={draft.rating}
                  onChange={(rating) => setDraft({ ...draft, rating })}
                />
              </fieldset>
              <label className="wide">
                Summary
                <textarea
                  rows={4}
                  value={draft.description ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                />
              </label>
              <label className="wide">
                My notes
                <textarea
                  aria-label="My notes"
                  rows={5}
                  value={draft.notes ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, notes: e.target.value })
                  }
                />
              </label>
            </div>
            <footer className="edit-actions">
              <button
                type="button"
                className="delete-button"
                onClick={onDelete}
              >
                <Trash2 /> Remove from Everia
              </button>
              <div>
                <button
                  type="button"
                  className="secondary"
                  onClick={cancelEdit}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button className="primary" disabled={busy}>
                  <Check /> {busy ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </footer>
          </form>
        )}
      </article>
    </div>
  );
}
