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
  const __APP_VERSION__: string;
  interface Window {
    everiaBackup?: {
      config(): Promise<{
        version: number;
        enabled: boolean;
        destination: string;
        destinationSelected: boolean;
        lastSuccess: string | null;
        lastFailure: { at: string; message: string } | null;
      }>;
      isDue(): Promise<boolean>;
      write(file: string): Promise<string>;
      chooseDestination(): Promise<{ destination: string } | null>;
      setEnabled(enabled: boolean): Promise<unknown>;
      selectBackup(): Promise<string | null>;
      beginRestore(snapshot: {
        backup: string;
        raw: (string | null)[];
      }): Promise<void>;
      pendingRestore(): Promise<{
        version?: number;
        backup: string;
        raw: (string | null)[];
      } | null>;
      finishRestore(): Promise<void>;
    };
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
