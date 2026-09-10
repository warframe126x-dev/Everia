import { BookOpen, Grid2X2, List, Plus, Star } from "lucide-react";
import { categoryInfo } from "./data";
import { Cover } from "./Cover";
import { statusLabel, statusOptions } from "./mediaConfig";
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
  return (
    <div className="page library-page">
      <div className="library-heading">
        <div>
          <p className="kicker">COLLECTION</p>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="library-controls">
          <label className="sort-control">
            <span>Sort by</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="dateAdded">Recently added</option>
              <option value="title">Title</option>
              <option value="releaseDate">Release date</option>
              <option value="rating">Rating</option>
            </select>
          </label>
          <div className="view-toggle" aria-label="Library view">
            <button
              className={viewMode === "grid" ? "active" : ""}
              aria-label="Grid view"
              title="Grid view"
              onClick={() => setViewMode("grid")}
            >
              <Grid2X2 />
            </button>
            <button
              className={viewMode === "list" ? "active" : ""}
              aria-label="List view"
              title="List view"
              onClick={() => setViewMode("list")}
            >
              <List />
            </button>
          </div>
        </div>
      </div>
      {category && (
        <div className="status-filters" aria-label="Filter by status">
          <button
            className={statusFilter === "All" ? "active" : ""}
            onClick={() => setStatusFilter("All")}
          >
            All
          </button>
          {statusOptions(category).map(({ value, label }) => (
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
              aria-label={`Open ${item.title}`}
              onClick={() => onSelect(item)}
            >
              <Cover item={item} />
              <div className="media-info">
                <small>
                  {item.subtype ?? categoryInfo[item.category].label}
                </small>
                <strong>{item.title}</strong>
                <span>{item.creator || "Unknown creator"}</span>
                <div className="media-meta">
                  <i
                    className={`status ${item.status.toLowerCase().replace(" ", "-")}`}
                  />
                  {statusLabel(item.category, item.status)}
                  {item.rating !== undefined && (
                    <b>
                      <Star size={13} fill="currentColor" /> {item.rating}/10
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
          <h3>No entries here yet</h3>
          <p>
            {statusFilter === "All"
              ? "Add one manually now. Online search will join it in a future build."
              : "No entries match this status."}
          </p>
          {statusFilter === "All" && (
            <button className="primary" onClick={onAdd}>
              <Plus size={18} /> Add an item
            </button>
          )}
        </div>
      )}
    </div>
  );
}
