import { BookOpen, Grid2X2, List, Plus, Star } from "lucide-react";
import { categoryLabel, subtypeLabel } from "./data";
import { Cover } from "./Cover";
import { statusLabel, statusOptions } from "./mediaConfig";
import { useLocalization } from "./localization/Localization";
import {
  type Category,
  type MediaItem,
  type ReadingStatus,
  type SortKey,
  type ViewMode,
} from "./types";

export function LibraryView({
  title,
  subtitle,
  items,
  category,
  statusFilter,
  setStatusFilter,
  sort,
  setSort,
  viewMode,
  setViewMode,
  onSelect,
  onAdd,
}: {
  title: string;
  subtitle: string;
  items: MediaItem[];
  category?: Category;
  statusFilter: "All" | ReadingStatus;
  setStatusFilter: (status: "All" | ReadingStatus) => void;
  sort: SortKey;
  setSort: (sort: SortKey) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  onSelect: (item: MediaItem) => void;
  onAdd: () => void;
}) {
  const { locale, t, number } = useLocalization();
  return (
    <div className="page library-page">
      <div className="library-heading">
        <div>
          <p className="kicker">{t("library.collection")}</p>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="library-controls">
          <label className="sort-control">
            <span>{t("library.sortBy")}</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="dateAdded">{t("library.recentlyAdded")}</option>
              <option value="title">{t("library.title")}</option>
              <option value="releaseDate">{t("library.releaseDate")}</option>
              <option value="rating">{t("library.rating")}</option>
            </select>
          </label>
          <div className="view-toggle" aria-label={t("library.view")}>
            <button
              className={viewMode === "grid" ? "active" : ""}
              aria-label={t("library.gridView")}
              title={t("library.gridView")}
              onClick={() => setViewMode("grid")}
            >
              <Grid2X2 />
            </button>
            <button
              className={viewMode === "list" ? "active" : ""}
              aria-label={t("library.listView")}
              title={t("library.listView")}
              onClick={() => setViewMode("list")}
            >
              <List />
            </button>
          </div>
        </div>
      </div>
      {category && (
        <div
          className="status-filters"
          aria-label={t("library.filterByStatus")}
        >
          <button
            className={statusFilter === "All" ? "active" : ""}
            onClick={() => setStatusFilter("All")}
          >
            {t("library.all")}
          </button>
          {statusOptions(category, locale).map(({ value, label }) => (
            <button
              key={value}
              className={statusFilter === value ? "active" : ""}
              onClick={() => setStatusFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {items.length ? (
        <div className={viewMode === "list" ? "item-list" : "item-grid"}>
          {items.map((item) => (
            <button
              className="media-card"
              key={item.id}
              aria-label={t("accessibility.openEntry", { title: item.title })}
              onClick={() => onSelect(item)}
            >
              <Cover item={item} />
              <div className="media-info">
                <small>
                  {item.subtype
                    ? subtypeLabel(item.subtype, locale)
                    : categoryLabel(item.category, locale)}
                </small>
                <strong>{item.title}</strong>
                <span>{item.creator || t("library.unknownCreator")}</span>
                <div className="media-meta">
                  <i
                    className={`status ${item.status.toLowerCase().replace(" ", "-")}`}
                  />
                  {statusLabel(item.category, item.status, locale)}
                  {item.rating !== undefined && (
                    <b>
                      <Star size={13} fill="currentColor" />{" "}
                      {number(item.rating)}/10
                    </b>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span>
            <BookOpen />
          </span>
          <h3>{t(category ? "library.empty" : "favorites.empty")}</h3>
          <p>
            {statusFilter === "All"
              ? t(category ? "library.emptyPrompt" : "favorites.emptyPrompt")
              : t("library.noStatusMatches")}
          </p>
          {statusFilter === "All" && (
            <button className="primary" onClick={onAdd}>
              <Plus size={18} /> {t("library.addItem")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
