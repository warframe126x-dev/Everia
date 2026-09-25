import type { Category, ThemeSettings } from "./types";
import type { Locale } from "./localization/locale";
import { translate } from "./localization/format";

const categoryKeys = {
  games: "categories.games",
  movies: "categories.movies",
  "tv-series": "categories.tv",
  novels: "categories.novels",
  manga: "categories.manga",
  anime: "categories.anime",
} as const satisfies Record<Category, string>;

const descriptionKeys = {
  games: "categories.gamesDescription",
  movies: "categories.moviesDescription",
  "tv-series": "categories.tvDescription",
  novels: "categories.novelsDescription",
  manga: "categories.mangaDescription",
  anime: "categories.animeDescription",
} as const satisfies Record<Category, string>;

export function categoryLabel(category: Category, locale: Locale = "en") {
  return translate(locale, categoryKeys[category]);
}
export function categoryDescription(category: Category, locale: Locale = "en") {
  return translate(locale, descriptionKeys[category]);
}

const subtypeKeys = {
  Novel: "subtypes.novel",
  "Light Novel": "subtypes.lightNovel",
  "Web Novel": "subtypes.webNovel",
  Manga: "subtypes.manga",
  Manhwa: "subtypes.manhwa",
  Manhua: "subtypes.manhua",
} as const;

export function subtypeLabel(
  subtype: keyof typeof subtypeKeys,
  locale: Locale = "en",
) {
  return translate(locale, subtypeKeys[subtype]);
}

export const categoryInfo: Record<
  Category,
  { label: string; eyebrow: string; hue: string }
> = {
  games: {
    label: categoryLabel("games"),
    eyebrow: categoryDescription("games"),
    hue: "#61a8ff",
  },
  movies: {
    label: categoryLabel("movies"),
    eyebrow: categoryDescription("movies"),
    hue: "#f0a85f",
  },
  "tv-series": {
    label: categoryLabel("tv-series"),
    eyebrow: categoryDescription("tv-series"),
    hue: "#61d8d3",
  },
  novels: {
    label: categoryLabel("novels"),
    eyebrow: categoryDescription("novels"),
    hue: "#d7b47b",
  },
  manga: {
    label: categoryLabel("manga"),
    eyebrow: categoryDescription("manga"),
    hue: "#d98568",
  },
  anime: {
    label: categoryLabel("anime"),
    eyebrow: categoryDescription("anime"),
    hue: "#9b71df",
  },
};

export const defaultTheme: ThemeSettings = {
  accent: "#5ea9f5",
  background: "#081016",
  text: "#edf3f7",
  backgroundMode: "default",
  imageFit: "cover",
  backgroundDimming: 42,
};
