/// <reference types="vite/client" />

import type { Category, ProviderId } from "./types";
import type {
  ImportCandidate,
  ProviderAvailability,
  ProviderConfiguration,
  ProviderResponse,
  ProviderSearchResult,
} from "./providers/types";

declare global {
  interface Window {
    everiaWindow?: {
      onResponsiveScale(
        callback: (value: {
          zoom: number;
          progress: number;
          homeProgress: number;
        }) => void,
      ): () => void;
    };
    everiaProviders?: {
      status(
        provider: ProviderId,
      ): Promise<ProviderResponse<ProviderAvailability>>;
      search(input: {
        provider: ProviderId;
        query: string;
        category: Category;
      }): Promise<ProviderResponse<ImportCandidate[]>>;
      searchChain(input: {
        query: string;
        category: Category;
      }): Promise<ProviderResponse<ProviderSearchResult>>;
      details(input: {
        provider: ProviderId;
        providerId: string;
        category: Category;
      }): Promise<ProviderResponse<ImportCandidate>>;
      downloadImage(
        url: string,
      ): Promise<ProviderResponse<{ bytes: Uint8Array; type: string }>>;
      configuration(): Promise<ProviderResponse<ProviderConfiguration[]>>;
      saveCredentials(input: {
        provider: "igdb" | "rawg" | "tmdb" | "omdb";
        credentials: {
          clientId?: string;
          clientSecret?: string;
          token?: string;
        };
      }): Promise<ProviderResponse<ProviderConfiguration>>;
      testConnection(
        provider: ProviderId,
      ): Promise<ProviderResponse<ProviderConfiguration>>;
      removeCredentials(
        provider: "igdb" | "rawg" | "tmdb" | "omdb",
      ): Promise<ProviderResponse<ProviderConfiguration>>;
    };
  }
}
