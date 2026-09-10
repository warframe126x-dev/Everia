import type { Category, ThemeSettings } from "./types";

export const categoryInfo: Record<
  Category,
  { label: string; eyebrow: string; hue: string }
> = {
  games: { label: "Games", eyebrow: "Worlds you can explore", hue: "#61a8ff" },
  movies: {
    label: "Movies",
    eyebrow: "Stories for the big screen",
    hue: "#f0a85f",
  },
  "tv-series": {
    label: "TV Shows",
    eyebrow: "One episode at a time",
    hue: "#61d8d3",
  },
  novels: {
    label: "Novels",
    eyebrow: "Novel · Light Novel · Web Novel",
    hue: "#d7b47b",
  },
  manga: { label: "Manga", eyebrow: "Manga · Manhwa · Manhua", hue: "#d98568" },
  anime: { label: "Anime", eyebrow: "Worlds in motion", hue: "#9b71df" },
};

export const defaultTheme: ThemeSettings = {
  accent: "#5ea9f5",
  background: "#081016",
  text: "#edf3f7",
  backgroundMode: "default",
  imageFit: "cover",
  backgroundDimming: 42,
};
