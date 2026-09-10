import type { Category, ProviderId } from "../types";
import type {
  ImportCandidate,
  MediaProvider,
  ProviderAvailability,
} from "./types";

const providerNames: Record<ProviderId, string> = {
  igdb: "IGDB",
  tmdb: "TMDB",
  ranobedb: "RanobeDB",
  jikan: "Jikan",
};

const providerCategories: Record<ProviderId, Category[]> = {
  igdb: ["games"],
  tmdb: ["movies", "tv-series"],
  ranobedb: ["novels"],
  jikan: ["anime", "manga"],
};

export class DesktopProvider implements MediaProvider {
  readonly name: string;

  constructor(readonly id: ProviderId) {
    this.name = providerNames[id];
  }

  supports(category: Category) {
    return providerCategories[this.id].includes(category);
  }

  async status(): Promise<ProviderAvailability> {
    if (!window.everiaProviders) {
      return {
        id: this.id,
        name: this.name,
        categories: providerCategories[this.id],
        available: false,
        reason: "Online search is available in the Everia desktop app.",
      };
    }
    const response = await window.everiaProviders.status(this.id);
    if (!response.ok || !response.data) {
      return {
        id: this.id,
        name: this.name,
        categories: providerCategories[this.id],
        available: false,
        reason: response.error ?? "Online search is currently unavailable.",
      };
    }
    return response.data;
  }

  async search(query: string, category: Category) {
    if (!this.supports(category)) return [];
    if (!window.everiaProviders)
      throw new Error("Online search is available in the Everia desktop app.");
    const response = await window.everiaProviders.search({
      provider: this.id,
      query,
      category,
    });
    if (!response.ok) throw new Error(response.error);
    return response.data ?? [];
  }

  async getDetails(providerId: string, category: Category) {
    if (!window.everiaProviders)
      throw new Error("Online search is available in the Everia desktop app.");
    const response = await window.everiaProviders.details({
      provider: this.id,
      providerId,
      category,
    });
    if (!response.ok || !response.data)
      throw new Error(response.error ?? "Details are currently unavailable.");
    return response.data;
  }
}
