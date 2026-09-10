import type {
  Category,
  MediaItem,
  ProviderId,
  ProviderMetadata,
} from "../types";

export interface ProviderAvailability {
  id: ProviderId;
  name: string;
  categories: Category[];
  available: boolean;
  reason?: string;
  role?: "primary" | "backup";
}

export interface ImportCandidate {
  provider: ProviderId;
  providerName: string;
  providerId: string;
  providerUrl?: string;
  category: Category;
  title: string;
  alternateTitle?: string;
  subtype?: MediaItem["subtype"];
  creator?: string;
  contributors?: string;
  releaseDate?: string;
  genres?: string[];
  platform?: string;
  description?: string;
  coverUrl?: string;
  cacheCover: boolean;
  metadata?: ProviderMetadata;
}

export type ProviderConnectionState =
  "not-configured" | "unchecked" | "connected" | "connection-failed";

export interface ProviderConfiguration {
  id: ProviderId;
  name: string;
  categories: Category[];
  requiresCredentials: boolean;
  configured: boolean;
  state: ProviderConnectionState;
  reason?: string;
  clientIdHint?: string;
  role: "primary" | "backup";
}

export interface ProviderResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
}

export interface ProviderSearchResult {
  results: ImportCandidate[];
  provider: ProviderId;
  providerName: string;
  fallbackFrom?: string;
  notice?: string;
}

export interface MediaProvider {
  readonly id: ProviderId;
  readonly name: string;
  supports(category: Category): boolean;
  status(): Promise<ProviderAvailability>;
  search(query: string, category: Category): Promise<ImportCandidate[]>;
  getDetails(providerId: string, category: Category): Promise<ImportCandidate>;
}
