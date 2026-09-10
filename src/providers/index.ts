import type { Category, MediaItem, ProviderId } from "../types";
import { DesktopProvider } from "./desktopProvider";
import type { ImportCandidate, MediaProvider } from "./types";

const providers: Record<ProviderId, MediaProvider> = {
  igdb: new DesktopProvider("igdb"),
  tmdb: new DesktopProvider("tmdb"),
  ranobedb: new DesktopProvider("ranobedb"),
  jikan: new DesktopProvider("jikan"),
};

export function providerForCategory(category: Category) {
  return Object.values(providers).find((provider) =>
    provider.supports(category),
  );
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
