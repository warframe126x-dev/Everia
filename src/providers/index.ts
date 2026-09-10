import type { Category, MediaItem, ProviderId } from "../types";
import { DesktopProvider } from "./desktopProvider";
import type {
  ImportCandidate,
  MediaProvider,
  ProviderSearchResult,
} from "./types";

const providers: Record<ProviderId, MediaProvider> = {
  igdb: new DesktopProvider("igdb"),
  rawg: new DesktopProvider("rawg"),
  tmdb: new DesktopProvider("tmdb"),
  omdb: new DesktopProvider("omdb"),
  ranobedb: new DesktopProvider("ranobedb"),
  tenrai: new DesktopProvider("tenrai"),
  jikan: new DesktopProvider("jikan"),
};

const providerChains: Record<Category, ProviderId[]> = {
  games: ["igdb", "rawg"],
  movies: ["tmdb", "omdb"],
  "tv-series": ["tmdb", "omdb"],
  novels: ["ranobedb"],
  anime: ["tenrai", "jikan"],
  manga: ["tenrai", "jikan"],
};

export function providerForCategory(category: Category) {
  return providers[providerChains[category][0]];
}

export function providerById(provider: ProviderId) {
  return providers[provider];
}

export function providersForCategory(category: Category) {
  return providerChains[category].map((provider) => providers[provider]);
}

export async function searchProviderChain(
  query: string,
  category: Category,
): Promise<ProviderSearchResult> {
  if (!window.everiaProviders)
    throw new Error("Online search is available in the Everia desktop app.");
  const response = await window.everiaProviders.searchChain({
    query,
    category,
  });
  if (!response.ok || !response.data)
    throw new Error(
      response.error ?? "Online sources are temporarily unavailable.",
    );
  return response.data;
}

export function candidateToDraft(
  candidate: ImportCandidate,
): Omit<MediaItem, "id" | "dateAdded"> {
  const now = new Date().toISOString();
  return {
    title: candidate.title,
    alternateTitle: candidate.alternateTitle,
    category: candidate.category,
    subtype: candidate.subtype,
    creator: candidate.creator,
    contributors: candidate.contributors,
    releaseDate: candidate.releaseDate,
    coverUrl: candidate.cacheCover ? candidate.coverUrl : undefined,
    sourceCoverUrl: candidate.coverUrl,
    description: candidate.description,
    genres: candidate.genres,
    platform: candidate.platform,
    link: candidate.providerUrl,
    linkLabel: candidate.providerName,
    status: "Planning",
    rating: undefined,
    notes: "",
    favorite: false,
    source: candidate.providerName,
    sourceId: candidate.providerId,
    dateModified: now,
    providerReference: {
      provider: candidate.provider,
      providerId: candidate.providerId,
      providerUrl: candidate.providerUrl,
      importedAt: now,
      lastRefreshedAt: now,
    },
    providerMetadata: candidate.metadata,
  };
}

export type { ImportCandidate, MediaProvider } from "./types";
