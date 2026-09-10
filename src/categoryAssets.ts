import { assetUrl } from "./assetPaths";
import type { Category } from "./types";

export const categoryArtwork: Record<Category, string> = {
  games: "assets/categories/games.png",
  movies: "assets/categories/movies.png",
  "tv-series": "assets/categories/tv-shows.png",
  novels: "assets/categories/novels.png",
  manga: "assets/categories/manga.png",
  anime: "assets/categories/anime.png",
};

export function categoryArtworkUrl(category: Category) {
  return assetUrl(categoryArtwork[category]);
}

export function defaultArtworkUrl() {
  return assetUrl("assets/backgrounds/everia-default.png");
}
