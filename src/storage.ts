import { defaultTheme } from "./data";
import { validateItems } from "./validation";
import type { MediaItem, SortKey, ThemeSettings, ViewMode } from "./types";

const ITEMS_KEY = "everia.items.v1";
const THEME_KEY = "everia.theme.v1";
const SORT_KEY = "everia.sort.v1";
const VIEW_KEY = "everia.views.v1";

const blocked = new Set<string>();
export let storageWarning = "";
function read<T>(key: string, fallback: T, validate: (value: unknown) => T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? validate(JSON.parse(value)) : fallback;
  } catch {
    blocked.add(key);
    storageWarning =
      "Some saved data could not be loaded. It has been preserved; saving that data is disabled until repaired.";
    return fallback;
  }
}
function write(key: string, value: unknown) {
  if (blocked.has(key)) throw new Error(storageWarning);
  localStorage.setItem(key, JSON.stringify(value));
}

export const storage = {
  loadItems: () => read<MediaItem[]>(ITEMS_KEY, [], validateItems),
  saveItems: (items: MediaItem[]) => write(ITEMS_KEY, validateItems(items)),
  loadTheme: () =>
    read<ThemeSettings>(THEME_KEY, defaultTheme, (value) => {
      const theme = { ...defaultTheme, ...(value as Partial<ThemeSettings>) };
      if (
        !theme ||
        ![theme.accent, theme.background, theme.text].every((color) =>
          /^#[0-9a-f]{6}$/i.test(color),
        ) ||
        !["default", "solid", "custom"].includes(theme.backgroundMode) ||
        !["cover", "contain", "stretch"].includes(theme.imageFit) ||
        !Number.isFinite(theme.backgroundDimming) ||
        theme.backgroundDimming < 0 ||
        theme.backgroundDimming > 85 ||
        (theme.customWallpaperId !== undefined &&
          typeof theme.customWallpaperId !== "string")
      )
        throw new Error("Invalid theme");
      return theme;
    }),
  saveTheme: (theme: ThemeSettings) => write(THEME_KEY, theme),
  loadSorts: () =>
    read<Record<string, SortKey>>(SORT_KEY, {}, (value) => {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !Object.values(value).every((sort) =>
          ["title", "releaseDate", "rating", "dateAdded"].includes(sort),
        )
      )
        throw new Error("Invalid sorts");
      return value as Record<string, SortKey>;
    }),
  saveSorts: (sorts: Record<string, SortKey>) => write(SORT_KEY, sorts),
  loadViews: () =>
    read<Record<string, ViewMode>>(VIEW_KEY, {}, (value) => {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !Object.values(value).every((mode) => ["grid", "list"].includes(mode))
      )
        throw new Error("Invalid view preferences");
      return value as Record<string, ViewMode>;
    }),
  saveViews: (views: Record<string, ViewMode>) => write(VIEW_KEY, views),
};
