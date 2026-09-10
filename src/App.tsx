import { HomeView } from "./HomeView";
import { LibraryView } from "./LibraryView";
import { ItemEditor } from "./ItemEditor";
import { DetailPanel } from "./DetailPanel";
import { SettingsView } from "./SettingsView";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Clapperboard,
  Film,
  Gamepad2,
  Heart,
  Home,
  Library,
  Menu,
  MonitorPlay,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react";
import { categoryInfo } from "./data";
import { storage, storageWarning } from "./storage";

import { validateItems } from "./validation";
import {
  categories,
  type Category,
  type MediaItem,
  type ReadingStatus,
  type SortKey,
  type ThemeSettings,
  type ViewMode,
} from "./types";
import { useWallpaper } from "./useWallpaper";
import { assetUrl } from "./assetPaths";
import { categoryArtworkUrl, defaultArtworkUrl } from "./categoryAssets";

type LibraryRoute = "category" | "favorites";
type View = "home" | LibraryRoute | "details" | "settings";

const categoryIcons: Record<Category, typeof BookOpen> = {
  games: Gamepad2,
  movies: Clapperboard,
  "tv-series": MonitorPlay,
  novels: BookOpen,
  manga: Library,
  anime: Film,
};

const emptyDraft = (
  category: Category,
): Omit<MediaItem, "id" | "dateAdded"> => ({
  title: "",
  category,
  creator: "",
  releaseDate: "",
  description: "",
  status: "Planning",
  rating: undefined,
  notes: "",
  favorite: false,
  source: "Manual",
});

function App() {
  const [items, setItems] = useState<MediaItem[]>(storage.loadItems);
  const [theme, setTheme] = useState<ThemeSettings>(storage.loadTheme);
  const [sorts, setSorts] = useState<Record<string, SortKey>>(
    storage.loadSorts,
  );
  const [viewModes, setViewModes] = useState<Record<string, ViewMode>>(
    storage.loadViews,
  );
  const [statusFilter, setStatusFilter] = useState<"All" | ReadingStatus>(
    "All",
  );
  const [view, setView] = useState<View>("home");
  const [activeCategory, setActiveCategory] = useState<Category>("games");
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [detailReturnView, setDetailReturnView] =
    useState<LibraryRoute>("category");
  const libraryScrollPosition = useRef(0);
  const [navOpen, setNavOpen] = useState(false);

  const [error, setError] = useState(storageWarning);
  const customWallpaper = useWallpaper(
    theme.backgroundMode === "custom" ? theme.customWallpaperId : undefined,
  );
  useEffect(() => {
    try {
      storage.saveTheme(theme);
    } catch {
      setError("Theme could not be saved.");
    }
  }, [theme]);
  useEffect(() => {
    try {
      storage.saveSorts(sorts);
    } catch {
      setError("Sort preference could not be saved.");
    }
  }, [sorts]);
  useEffect(() => {
    try {
      storage.saveViews(viewModes);
    } catch {
      setError("View preference could not be saved.");
    }
  }, [viewModes]);
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", theme.accent);
    document.documentElement.style.setProperty("--bg", theme.background);
    document.documentElement.style.setProperty("--text", theme.text);
  }, [theme]);
  useEffect(() => {
    const updateScale = ({ progress }: { progress: number }) => {
      const bounded = Math.max(0, Math.min(1, progress));
      document.documentElement.dataset.responsiveSize =
        bounded > 0.05 ? "expanded" : "baseline";
      document.documentElement.style.setProperty(
        "--home-brand-factor",
        String(1 + bounded * 0.125),
      );
      document.documentElement.style.setProperty(
        "--home-footer-factor",
        String(1 + bounded * 0.2),
      );
    };
    updateScale({ progress: 0 });
    return window.everiaWindow?.onResponsiveScale(updateScale);
  }, []);

  const navigate = (next: View, category?: Category) => {
    if (category) setActiveCategory(category);
    setView(next);
    setQuery("");
    setStatusFilter("All");
    setSelected(null);
    setNavOpen(false);
  };

  const openDetails = (item: MediaItem) => {
    libraryScrollPosition.current = window.scrollY;
    setDetailReturnView(view === "favorites" ? "favorites" : "category");
    setSelected(item);
    setView("details");
  };

  const closeDetails = () => {
    setView(detailReturnView);
    setSelected(null);
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        window.scrollTo(0, libraryScrollPosition.current),
      ),
    );
  };

  const upsertItem = (item: MediaItem) => {
    const savedItem = { ...item, dateModified: new Date().toISOString() };
    const next = validateItems(
      items.some((x) => x.id === savedItem.id)
        ? items.map((x) => (x.id === savedItem.id ? savedItem : x))
        : [savedItem, ...items],
    );
    storage.saveItems(next);
    setItems(next);
    setSelected(savedItem);
    return savedItem;
  };

  const removeItem = (id: string) => {
    if (!window.confirm("Remove this entry? This cannot be undone.")) return;
    const next = items.filter((item) => item.id !== id);
    try {
      storage.saveItems(next);
    } catch {
      setError("Entry could not be removed.");
      return;
    }
    setItems(next);
    setSelected(null);
    setView(detailReturnView);
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        window.scrollTo(0, libraryScrollPosition.current),
      ),
    );
  };

  const currentItems = useMemo(() => {
    const source =
      view === "favorites"
        ? items.filter((item) => item.favorite)
        : items.filter((item) => item.category === activeCategory);
    const filtered = source.filter((item) =>
      `${item.title} ${item.creator ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
    const statusFiltered =
      statusFilter === "All"
        ? filtered
        : filtered.filter((item) => item.status === statusFilter);
    const sortKey =
      sorts[view === "favorites" ? "favorites" : activeCategory] ?? "dateAdded";
    return [...statusFiltered].sort((a, b) => {
      if (sortKey === "rating") return (b.rating ?? -1) - (a.rating ?? -1);
      if (sortKey === "dateAdded")
        return b.dateAdded.localeCompare(a.dateAdded);
      return (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "");
    });
  }, [items, activeCategory, query, sorts, statusFilter, view]);

  const activeSortKey = view === "favorites" ? "favorites" : activeCategory;

  const wallpaper =
    theme.backgroundMode === "default"
      ? `url("${defaultArtworkUrl()}")`
      : theme.backgroundMode === "custom" && customWallpaper
        ? `url("${customWallpaper}")`
        : "none";

  const interiorCategory =
    view === "details" && selected ? selected.category : activeCategory;
  const interiorArtwork =
    view === "settings" || view === "favorites"
      ? defaultArtworkUrl()
      : categoryArtworkUrl(interiorCategory);
  const hasInteriorArtwork =
    view === "category" ||
    view === "favorites" ||
    view === "details" ||
    view === "settings";

  return (
    <div
      className={`${view === "home" ? "app-shell home-view" : "app-shell"}${hasInteriorArtwork ? " interior-art-view" : ""} background-${theme.backgroundMode}`}
      style={
        {
          "--app-wallpaper": wallpaper,
          "--wallpaper-fit":
            theme.imageFit === "stretch" ? "100% 100%" : theme.imageFit,
          "--wallpaper-dim": `${theme.backgroundDimming / 100}`,
          "--interior-art": `url("${interiorArtwork}")`,
        } as React.CSSProperties
      }
    >
      {view !== "home" && (
        <aside className={navOpen ? "sidebar open" : "sidebar"}>
          <button
            className="mobile-close"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          >
            <X />
          </button>
          <button
            className="brand"
            title="Everia home"
            onClick={() => navigate("home")}
          >
            <span className="brand-mark">
              <img
                src={assetUrl("assets/branding/everia-ui-mark.png")}
                alt=""
              />
            </span>
            <small>EVERIA</small>
          </button>

          <nav>
            <button
              title="Home"
              aria-label="Home"
              className="nav-item"
              onClick={() => navigate("home")}
            >
              <Home />
            </button>
            {categories.map((category) => {
              const Icon = categoryIcons[category];
              return (
                <button
                  title={categoryInfo[category].label}
                  aria-label={categoryInfo[category].label}
                  key={category}
                  className={
                    (view === "category" ||
                      (view === "details" &&
                        detailReturnView === "category")) &&
                    activeCategory === category
                      ? "nav-item active"
                      : "nav-item"
                  }
                  onClick={() => navigate("category", category)}
                >
                  <Icon />
                </button>
              );
            })}
            <button
              title="Favorites"
              aria-label="Favorites"
              className={
                view === "favorites" ||
                (view === "details" && detailReturnView === "favorites")
                  ? "nav-item active"
                  : "nav-item"
              }
              onClick={() => navigate("favorites")}
            >
              <Heart />
            </button>
          </nav>

          <button
            title="Settings"
            aria-label="Settings"
            className={
              view === "settings"
                ? "nav-item active settings-link"
                : "nav-item settings-link"
            }
            onClick={() => navigate("settings")}
          >
            <Settings />
          </button>
        </aside>
      )}

      {navOpen && (
        <button
          className="scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}

      <main>
        {error && <p role="alert">{error}</p>}
        {view !== "home" && view !== "details" && (
          <header className="topbar">
            <button
              className="menu-button"
              aria-label="Open navigation"
              onClick={() => setNavOpen(true)}
            >
              <Menu />
            </button>
            <div className="global-search">
              <Search size={18} />
              <input
                aria-label="Search your universe"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your universe..."
              />
            </div>
            <button className="add-button" onClick={() => setAddOpen(true)}>
              <Plus size={18} />
              <span>Add item</span>
            </button>
          </header>
        )}

        {view === "home" && (
          <HomeView
            items={items}
            onOpen={(category) => navigate("category", category)}
            onSettings={() => navigate("settings")}
          />
        )}
        {(view === "category" || view === "favorites") && (
          <LibraryView
            title={
              view === "favorites"
                ? "Favorites"
                : categoryInfo[activeCategory].label
            }
            subtitle={
              view === "favorites"
                ? "The stories and worlds you love most."
                : categoryInfo[activeCategory].eyebrow
            }
            items={currentItems}
            category={view === "favorites" ? undefined : activeCategory}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            sort={sorts[activeSortKey] ?? "dateAdded"}
            setSort={(sort) =>
              setSorts((current) => ({ ...current, [activeSortKey]: sort }))
            }
            viewMode={viewModes[activeSortKey] ?? "grid"}
            setViewMode={(mode) =>
              setViewModes((current) => ({ ...current, [activeSortKey]: mode }))
            }
            onSelect={openDetails}
            onAdd={() => setAddOpen(true)}
          />
        )}
        {view === "settings" && (
          <SettingsView theme={theme} setTheme={setTheme} />
        )}
        {view === "details" && selected && (
          <DetailPanel
            key={selected.id}
            item={selected}
            returnLabel={
              detailReturnView === "favorites"
                ? "Favorites"
                : categoryInfo[activeCategory].label
            }
            onClose={closeDetails}
            onSave={(item) => {
              try {
                upsertItem(item);
              } catch {
                setError(
                  "Changes could not be saved. Check storage space and retry.",
                );
              }
            }}
            onDelete={() => removeItem(selected.id)}
          />
        )}
      </main>

      {addOpen && (
        <ItemEditor
          initial={emptyDraft(activeCategory)}
          onClose={() => setAddOpen(false)}
          onConfigure={() => {
            setAddOpen(false);
            navigate("settings");
            requestAnimationFrame(() =>
              document
                .getElementById("online-sources")
                ?.scrollIntoView({ behavior: "smooth" }),
            );
          }}
          onSave={(item) => {
            const savedItem = upsertItem(item);
            setAddOpen(false);
            openDetails(savedItem);
          }}
        />
      )}
    </div>
  );
}

export default App;
