import { FormEvent, useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Heart,
  Pencil,
  Trash2,
} from "lucide-react";
import { categoryLabel, subtypeLabel } from "./data";
import { Cover } from "./Cover";
import { storeCover } from "./covers";
import {
  contributorDisplayLabel,
  creatorDisplayLabel,
  statusOptions,
} from "./mediaConfig";
import { useLocalization } from "./localization/Localization";
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
  const { locale, t, number } = useLocalization();
  const fourth =
    item.category === "games"
      ? [t("details.platform"), item.platform]
      : item.category === "movies"
        ? [
            t("details.runtime"),
            item.providerMetadata?.runtimeMinutes
              ? t("details.minutes", {
                  count: number(item.providerMetadata.runtimeMinutes),
                })
              : undefined,
          ]
        : item.category === "tv-series"
          ? [
              t("details.seasons"),
              item.providerMetadata?.seasons === undefined
                ? undefined
                : number(item.providerMetadata.seasons),
            ]
          : item.category === "anime"
            ? [
                t("details.episodes"),
                item.providerMetadata?.episodes === undefined
                  ? undefined
                  : number(item.providerMetadata.episodes),
              ]
            : item.providerMetadata?.volumes !== undefined
              ? [t("details.volumes"), number(item.providerMetadata.volumes)]
              : [
                  t("details.chapters"),
                  item.providerMetadata?.chapters === undefined
                    ? undefined
                    : number(item.providerMetadata.chapters),
                ];
  const fields = [
    [creatorDisplayLabel(item.category, locale), item.creator],
    [t("details.genre"), item.genres?.join(", ")],
    [t("details.yearRelease"), item.releaseDate],
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
          <dt>{t("details.link")}</dt>
          <dd>
            <a href={safeLink(item.link)} target="_blank" rel="noreferrer">
              {item.linkLabel || t("details.official")} <ExternalLink />
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
  onSave: (item: MediaItem) => boolean;
  onDelete: () => void;
}) {
  const { locale, t } = useLocalization();
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
      if (!onSave({ ...draft, title: draft.title.trim(), coverUrl })) {
        setError("errors.changesSave");
        return;
      }
      setEditing(false);
    } catch {
      setError("errors.changesSave");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="detail-page">
      <article className="detail-panel" aria-label={t("details.entryDetails")}>
        <header className="detail-actions">
          <div>
            <button className="back-button" onClick={onClose}>
              <ArrowLeft /> {t("details.backTo", { destination: returnLabel })}
            </button>
            <button
              className={
                item.favorite
                  ? "icon-button favorite active"
                  : "icon-button favorite"
              }
              aria-label={
                item.favorite
                  ? t("details.removeFavorite")
                  : t("details.addFavorite")
              }
              onClick={() => onSave({ ...item, favorite: !item.favorite })}
            >
              <Heart fill={item.favorite ? "currentColor" : "none"} />
            </button>
          </div>
          <div>
            {!editing && (
              <button className="secondary edit-button" onClick={beginEdit}>
                <Pencil /> {t("details.edit")}
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
                <span>{t("details.myRating")}</span>
                <StarRating rating={item.rating} />
              </section>
            </div>
            <div className="detail-content">
              <div className="entry-title-row">
                <div>
                  <p className="kicker">
                    {item.subtype
                      ? subtypeLabel(item.subtype, locale)
                      : categoryLabel(item.category, locale)}
                  </p>
                  <h2>{item.title}</h2>
                </div>
                <label className="status-quick">
                  <span>{t("details.status")}</span>
                  <span className="status-select-wrap">
                    <i
                      className={`status ${item.status.toLowerCase().replace(" ", "-")}`}
                    />
                    <select
                      aria-label={t("details.status")}
                      value={item.status}
                      onChange={(event) =>
                        onSave({
                          ...item,
                          status: event.target.value as ReadingStatus,
                        })
                      }
                    >
                      {statusOptions(item.category, locale).map(
                        ({ value, label }) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                  </span>
                </label>
              </div>
              <Metadata item={item} />
              {item.description && (
                <section className="entry-copy">
                  <h3>{t("details.summary")}</h3>
                  <p>{item.description}</p>
                </section>
              )}
              <section className="entry-copy notes-display">
                <h3>{t("details.myNotes")}</h3>
                <p>{item.notes?.trim() || t("details.noNotes")}</p>
              </section>
              <p className="source-line">
                {t("details.savedLocally")} ·{" "}
                {item.source ?? t("editor.manualEntry")}
              </p>
            </div>
          </div>
        ) : (
          <form className="detail-edit" onSubmit={submit}>
            <div className="edit-heading">
              <div>
                <p className="kicker">{t("details.editEntry")}</p>
                <h2>{item.title}</h2>
              </div>
              <p>{t("details.saveHint")}</p>
            </div>
            {error && <p role="alert">{t("errors.changesSave")}</p>}
            <div className="edit-grid">
              <label className="wide">
                {t("details.replaceCover")}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => setCoverFile(e.target.files?.[0])}
                />
                {coverFile && (
                  <small>
                    {t("details.coverCopied", { filename: coverFile.name })}
                  </small>
                )}
              </label>
              <label className="wide">
                {t("editor.title")}
                <input
                  required
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
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
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {categoryLabel(category, locale)}
                    </option>
                  ))}
                </select>
              </label>
              {(draft.category === "novels" || draft.category === "manga") && (
                <label>
                  {t("editor.type")}
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
                      <option key={value} value={value}>
                        {subtypeLabel(
                          value as NonNullable<MediaItem["subtype"]>,
                          locale,
                        )}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {creatorDisplayLabel(draft.category, locale)}
                <input
                  value={draft.creator ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, creator: e.target.value })
                  }
                />
              </label>
              {contributorDisplayLabel(draft.category, locale) && (
                <label>
                  {contributorDisplayLabel(draft.category, locale)}
                  <input
                    value={draft.contributors ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, contributors: e.target.value })
                    }
                  />
                </label>
              )}
              <label>
                {t("details.yearRelease")}
                <input
                  value={draft.releaseDate ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, releaseDate: e.target.value })
                  }
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
                  />
                </label>
              )}
              <label>
                {t("details.status")}
                <select
                  aria-label={t("details.status")}
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
                {t("details.linkLabel")}
                <input
                  value={draft.linkLabel ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, linkLabel: e.target.value })
                  }
                  placeholder={t("details.official")}
                />
              </label>
              <label className="wide">
                {t("details.link")}
                <input
                  type="url"
                  value={draft.link ?? ""}
                  onChange={(e) => setDraft({ ...draft, link: e.target.value })}
                  placeholder="https://"
                />
              </label>
              <fieldset className="wide rating-editor">
                <legend>{t("details.myRating")}</legend>
                <StarRating
                  editable
                  rating={draft.rating}
                  onChange={(rating) => setDraft({ ...draft, rating })}
                />
              </fieldset>
              <label className="wide">
                {t("details.summary")}
                <textarea
                  rows={4}
                  value={draft.description ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                />
              </label>
              <label className="wide">
                {t("details.myNotes")}
                <textarea
                  aria-label={t("details.myNotes")}
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
                <Trash2 /> {t("details.remove")}
              </button>
              <div>
                <button
                  type="button"
                  className="secondary"
                  onClick={cancelEdit}
                  disabled={busy}
                >
                  {t("common.cancel")}
                </button>
                <button className="primary" disabled={busy}>
                  <Check />{" "}
                  {busy ? t("details.saving") : t("details.saveChanges")}
                </button>
              </div>
            </footer>
          </form>
        )}
      </article>
    </div>
  );
}
