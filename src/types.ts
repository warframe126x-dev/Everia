export const categories = [
  "games",
  "movies",
  "tv-series",
  "novels",
  "manga",
  "anime",
] as const;

export type Category = (typeof categories)[number];
export type ReadingStatus =
  "Planning" | "In progress" | "Completed" | "On hold" | "Dropped";

export type ProviderId =
  "igdb" | "rawg" | "tmdb" | "omdb" | "ranobedb" | "tenrai" | "jikan";
export interface ProviderReference {
  provider: ProviderId;
  providerId: string;
  providerUrl?: string;
  importedAt: string;
  lastRefreshedAt?: string;
}

export interface ProviderMetadata {
  developers?: string[];
  creators?: string[];
  authors?: string[];
  artists?: string[];
  studios?: string[];
  publishers?: string[];
  productionCompanies?: string[];
  platforms?: string[];
  networks?: string[];
  alternateTitles?: string[];
  originalTitle?: string;
  franchise?: string;
  providerStatus?: string;
  runtimeMinutes?: number;
  seasons?: number;
  episodes?: number;
  volumes?: number;
  chapters?: number;
  format?: string;
  serialization?: string[];
  season?: string;
  seasonYear?: number;
  sourceInformation?: string;
}

export interface MediaItem {
  id: string;
  title: string;
  alternateTitle?: string;
  category: Category;
  subtype?:
    "Light Novel" | "Web Novel" | "Novel" | "Manga" | "Manhwa" | "Manhua";
  creator?: string;
  releaseDate?: string;
  coverUrl?: string;
  sourceCoverUrl?: string;
  description?: string;
  status: ReadingStatus;
  rating?: number;
  notes?: string;
  favorite: boolean;
  dateAdded: string;
  dateModified?: string;
  providerReference?: ProviderReference;
  source?: string;
  sourceId?: string;
  genres?: string[];
  platform?: string;
  contributors?: string;
  link?: string;
  linkLabel?: string;
  providerMetadata?: ProviderMetadata;
}

export type BackgroundMode = "default" | "solid" | "custom";
export type BackgroundFit = "cover" | "contain" | "stretch";
export interface ThemeSettings {
  accent: string;
  background: string;
  text: string;
  backgroundMode: BackgroundMode;
  customWallpaperId?: string;
  imageFit: BackgroundFit;
  backgroundDimming: number;
}

export type SortKey = "title" | "releaseDate" | "rating" | "dateAdded";
export type ViewMode = "grid" | "list";
