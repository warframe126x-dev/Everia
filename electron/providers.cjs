const PROVIDERS = {
  igdb: {
    name: "IGDB",
    categories: ["games"],
    requiresCredentials: true,
    role: "primary",
  },
  rawg: {
    name: "RAWG",
    categories: ["games"],
    requiresCredentials: true,
    role: "backup",
  },
  tmdb: {
    name: "TMDB",
    categories: ["movies", "tv-series"],
    requiresCredentials: true,
    role: "primary",
  },
  omdb: {
    name: "OMDb",
    categories: ["movies", "tv-series"],
    requiresCredentials: true,
    role: "backup",
  },
  ranobedb: {
    name: "RanobeDB",
    categories: ["novels"],
    requiresCredentials: false,
    role: "primary",
  },
  tenrai: {
    name: "Tenrai",
    categories: ["anime", "manga"],
    requiresCredentials: false,
    role: "primary",
  },
  jikan: {
    name: "Jikan",
    categories: ["anime", "manga"],
    requiresCredentials: false,
    role: "backup",
  },
};

const PROVIDER_CHAINS = {
  games: ["igdb", "rawg"],
  movies: ["tmdb", "omdb"],
  "tv-series": ["tmdb", "omdb"],
  novels: ["ranobedb"],
  anime: ["tenrai", "jikan"],
  manga: ["tenrai", "jikan"],
};

const ALLOWED_IMAGE_HOSTS = new Set([
  "images.igdb.com",
  "image.tmdb.org",
  "media.rawg.io",
  "m.media-amazon.com",
  "images.ranobedb.org",
  "cdn.myanimelist.net",
]);
let credentialStore;
let igdbToken;
const connectionStates = new Map();

function configureCredentialStore(store) {
  credentialStore = store;
  igdbToken = undefined;
}

function credentialsFor(provider) {
  let stored;
  try {
    stored = credentialStore?.get(provider);
  } catch {
    return undefined;
  }
  if (stored) return stored;
  if (provider === "igdb") {
    const clientId = process.env.EVERIA_IGDB_CLIENT_ID;
    const clientSecret = process.env.EVERIA_IGDB_CLIENT_SECRET;
    const accessToken = process.env.EVERIA_IGDB_ACCESS_TOKEN;
    return clientId && (clientSecret || accessToken)
      ? { clientId, clientSecret, accessToken }
      : undefined;
  }
  if (provider === "tmdb" && process.env.EVERIA_TMDB_TOKEN)
    return { token: process.env.EVERIA_TMDB_TOKEN };
  if (provider === "rawg" && process.env.EVERIA_RAWG_API_KEY)
    return { token: process.env.EVERIA_RAWG_API_KEY };
  if (provider === "omdb" && process.env.EVERIA_OMDB_API_KEY)
    return { token: process.env.EVERIA_OMDB_API_KEY };
  return undefined;
}

class ProviderError extends Error {
  constructor(message, code, failoverEligible = false) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.failoverEligible = failoverEligible;
  }
}

function providerStatus(id) {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error("Unknown metadata provider.");
  const storedStatus = credentialStore?.status(id);
  const protectedStorageAvailable = credentialStore
    ? credentialStore.isProtected()
    : true;
  const configured = provider.requiresCredentials
    ? Boolean(credentialsFor(id))
    : true;
  const connectionState = connectionStates.get(id);
  const failed = connectionState === "connection-failed";
  return {
    id,
    ...provider,
    configured,
    available: configured,
    state: !configured
      ? "not-configured"
      : failed
        ? "connection-failed"
        : connectionState === "connected"
          ? "connected"
          : "unchecked",
    clientIdHint: storedStatus?.clientIdHint,
    reason: !configured
      ? storedStatus?.configured && !protectedStorageAvailable
        ? "Protected credential storage is unavailable on this device."
        : `${provider.name} is not connected. Configure ${provider.name} in Settings → Online Sources.`
      : failed
        ? `${provider.name} connection failed. Your Everia library is unaffected.`
        : undefined,
  };
}

function allProviderConfigurations() {
  return Object.keys(PROVIDERS).map(providerStatus);
}
function resetProviderSession(provider) {
  connectionStates.delete(provider);
  if (provider === "igdb") igdbToken = undefined;
}
function validateRequest(provider, category) {
  const status = providerStatus(provider);
  if (!status.categories.includes(category))
    throw new Error(`${status.name} does not support this category.`);
  if (!status.available) throw new Error(status.reason);
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchResponse(
  url,
  init,
  providerName = "online source",
  { attempts = 1, timeoutMs = 15000 } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        redirect: "follow",
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (attempt + 1 < attempts) {
        await delay(350 * (attempt + 1));
        continue;
      }
      throw new ProviderError(
        `Unable to reach ${providerName} right now. Your Everia library is unaffected.`,
        error?.name === "TimeoutError" ? "timeout" : "network",
        true,
      );
    }
    if (response.status === 401 || response.status === 403)
      throw new ProviderError(
        `${providerName} rejected the saved credentials.`,
        "credentials",
        true,
      );
    if (
      (response.status === 429 || [502, 503, 504].includes(response.status)) &&
      attempt + 1 < attempts
    ) {
      const retryAfter = Number(response.headers?.get?.("retry-after"));
      await delay(
        Number.isFinite(retryAfter)
          ? Math.min(retryAfter * 1000, 2000)
          : 350 * (attempt + 1),
      );
      continue;
    }
    if (response.status === 429)
      throw new ProviderError(
        `${providerName} is busy. Please wait a moment and retry.`,
        "rate-limit",
        true,
      );
    if (response.status >= 500)
      throw new ProviderError(
        `${providerName} is temporarily unavailable because its upstream service did not respond. Your Everia library is unaffected.`,
        "unavailable",
        true,
      );
    if (!response.ok)
      throw new Error(
        `${providerName} returned an error. Your Everia library is unaffected.`,
      );
    return response;
  }
  throw new Error(
    `Unable to reach ${providerName} right now. Your Everia library is unaffected.`,
  );
}
async function fetchJson(url, init, providerName, options) {
  const response = await fetchResponse(url, init, providerName, options);
  try {
    return await response.json();
  } catch {
    throw new ProviderError(
      `${providerName || "The online source"} returned an unreadable response.`,
      "unavailable",
      true,
    );
  }
}

function epochDate(value) {
  if (!value || !Number.isFinite(Number(value))) return undefined;
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.valueOf())
    ? undefined
    : date.toISOString().slice(0, 10);
}
function compactDate(value) {
  const text = String(value || "");
  return /^\d{8}$/.test(text)
    ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
    : undefined;
}
function names(values) {
  return [
    ...new Set(
      (values || []).map((value) => value?.name || value).filter(Boolean),
    ),
  ];
}
function textOrUndefined(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function getIgdbToken() {
  const credentials = credentialsFor("igdb");
  if (!credentials) throw new Error(providerStatus("igdb").reason);
  if (credentials.accessToken) return credentials.accessToken;
  if (igdbToken && igdbToken.expiresAt > Date.now() + 60_000)
    return igdbToken.value;
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: "client_credentials",
  });
  const data = await fetchJson(
    `https://id.twitch.tv/oauth2/token?${params}`,
    { method: "POST" },
    "IGDB",
  );
  if (!data.access_token) throw new Error("IGDB authentication failed.");
  igdbToken = {
    value: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 0) * 1000,
  };
  return igdbToken.value;
}

function normalizeIgdb(game) {
  const developers = names(
    (game.involved_companies || [])
      .filter((x) => x.developer)
      .map((x) => x.company),
  );
  const publishers = names(
    (game.involved_companies || [])
      .filter((x) => x.publisher)
      .map((x) => x.company),
  );
  const platforms = names(game.platforms);
  return {
    provider: "igdb",
    providerName: "IGDB",
    providerId: String(game.id),
    providerUrl: game.url,
    category: "games",
    title: game.name,
    alternateTitle: game.alternative_names?.[0]?.name,
    creator: developers.join(", ") || undefined,
    contributors: publishers.join(", ") || undefined,
    releaseDate: epochDate(game.first_release_date),
    genres: names(game.genres),
    platform: platforms.join(", ") || undefined,
    description: game.summary,
    coverUrl: game.cover?.image_id
      ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg`
      : undefined,
    cacheCover: true,
    metadata: {
      developers,
      publishers,
      platforms,
      franchise: game.franchise?.name || game.collection?.name,
      alternateTitles: names(game.alternative_names),
    },
  };
}
async function igdbRequest(body) {
  const credentials = credentialsFor("igdb");
  const token = await getIgdbToken();
  return fetchJson(
    "https://api.igdb.com/v4/games",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Client-ID": credentials.clientId,
        Authorization: `Bearer ${token}`,
      },
      body,
    },
    "IGDB",
  );
}
const IGDB_FIELDS =
  "fields name,alternative_names.name,cover.image_id,first_release_date,genres.name,platforms.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,franchise.name,collection.name,summary,url;";
async function searchIgdb(query) {
  const escaped = query.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return (
    await igdbRequest(
      `${IGDB_FIELDS} search "${escaped}"; where version_parent = null; limit 20;`,
    )
  ).map(normalizeIgdb);
}
async function detailsIgdb(id) {
  if (!/^\d+$/.test(id)) throw new Error("Invalid IGDB item.");
  const games = await igdbRequest(`${IGDB_FIELDS} where id = ${id}; limit 1;`);
  if (!games[0]) throw new Error("This IGDB item is no longer available.");
  return normalizeIgdb(games[0]);
}

function rawgCredentials() {
  const credentials = credentialsFor("rawg");
  if (!credentials) throw new Error(providerStatus("rawg").reason);
  return credentials;
}
function normalizeRawg(game) {
  const developers = names(game.developers);
  const publishers = names(game.publishers);
  const platforms = names(
    (game.platforms || []).map((value) => value.platform),
  );
  return {
    provider: "rawg",
    providerName: "RAWG",
    providerId: String(game.id),
    providerUrl: game.slug
      ? `https://rawg.io/games/${game.slug}`
      : "https://rawg.io/",
    category: "games",
    title: game.name,
    creator: developers.join(", ") || undefined,
    contributors: publishers.join(", ") || undefined,
    releaseDate: textOrUndefined(game.released),
    genres: names(game.genres),
    platform: platforms.join(", ") || undefined,
    description: textOrUndefined(game.description_raw),
    coverUrl: textOrUndefined(game.background_image),
    cacheCover: Boolean(game.background_image),
    metadata: { developers, publishers, platforms },
  };
}
async function rawgRequest(pathname, params = {}) {
  const credentials = rawgCredentials();
  const query = new URLSearchParams({ key: credentials.token, ...params });
  return fetchJson(
    `https://api.rawg.io/api/${pathname}?${query}`,
    { headers: { Accept: "application/json" } },
    "RAWG",
    { attempts: 2, timeoutMs: 12000 },
  );
}
async function searchRawg(query) {
  const data = await rawgRequest("games", {
    search: query,
    search_precise: "true",
    page_size: "20",
  });
  return (data.results || []).map(normalizeRawg);
}
async function detailsRawg(id) {
  if (!/^\d+$/.test(id)) throw new Error("Invalid RAWG item.");
  return normalizeRawg(await rawgRequest(`games/${id}`));
}

function tmdbHeaders() {
  const credentials = credentialsFor("tmdb");
  if (!credentials) throw new Error(providerStatus("tmdb").reason);
  return {
    Accept: "application/json",
    Authorization: `Bearer ${credentials.token}`,
  };
}
function normalizeTmdb(item, category) {
  const movie = category === "movies";
  const creators = movie
    ? names(
        (item.credits?.crew || []).filter(
          (person) => person.job === "Director",
        ),
      )
    : names(item.created_by);
  const companies = names(item.production_companies);
  const networks = names(item.networks);
  const title = movie ? item.title : item.name;
  const originalTitle = movie ? item.original_title : item.original_name;
  const id = String(item.id);
  return {
    provider: "tmdb",
    providerName: "TMDB",
    providerId: id,
    providerUrl: `https://www.themoviedb.org/${movie ? "movie" : "tv"}/${id}`,
    category,
    title,
    alternateTitle: originalTitle !== title ? originalTitle : undefined,
    creator: creators.join(", ") || undefined,
    contributors: companies.join(", ") || networks.join(", ") || undefined,
    releaseDate: movie ? item.release_date : item.first_air_date,
    genres: names(item.genres),
    description: item.overview,
    coverUrl: item.poster_path
      ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
      : undefined,
    cacheCover: true,
    metadata: {
      creators,
      productionCompanies: companies,
      networks,
      originalTitle: originalTitle !== title ? originalTitle : undefined,
      runtimeMinutes: movie ? item.runtime : undefined,
      seasons: movie ? undefined : item.number_of_seasons,
      episodes: movie ? undefined : item.number_of_episodes,
      providerStatus: movie ? undefined : item.status,
    },
  };
}
async function searchTmdb(query, category) {
  const type = category === "movies" ? "movie" : "tv";
  const params = new URLSearchParams({
    query,
    include_adult: "false",
    page: "1",
  });
  const data = await fetchJson(
    `https://api.themoviedb.org/3/search/${type}?${params}`,
    { headers: tmdbHeaders() },
    "TMDB",
  );
  return (data.results || [])
    .slice(0, 20)
    .map((item) => normalizeTmdb(item, category));
}
async function detailsTmdb(id, category) {
  if (!/^\d+$/.test(id)) throw new Error("Invalid TMDB item.");
  const type = category === "movies" ? "movie" : "tv";
  const data = await fetchJson(
    `https://api.themoviedb.org/3/${type}/${id}?append_to_response=credits`,
    { headers: tmdbHeaders() },
    "TMDB",
  );
  return normalizeTmdb(data, category);
}

function omdbCredentials() {
  const credentials = credentialsFor("omdb");
  if (!credentials) throw new Error(providerStatus("omdb").reason);
  return credentials;
}
function omdbDate(value) {
  const text = textOrUndefined(value);
  if (!text || text === "N/A") return undefined;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString().slice(0, 10);
  const year = text.match(/\d{4}/)?.[0];
  return year;
}
function omdbValues(value) {
  return value && value !== "N/A"
    ? value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
}
function normalizeOmdb(item, category) {
  const id = String(item.imdbID);
  const creators = omdbValues(item.Director);
  const writers = omdbValues(item.Writer);
  const actors = omdbValues(item.Actors);
  const runtime = Number.parseInt(item.Runtime, 10);
  const seasons = Number.parseInt(item.totalSeasons, 10);
  return {
    provider: "omdb",
    providerName: "OMDb",
    providerId: id,
    providerUrl: `https://www.imdb.com/title/${id}/`,
    category,
    title: item.Title,
    creator: creators.join(", ") || undefined,
    contributors: [...writers, ...actors].join(", ") || undefined,
    releaseDate: omdbDate(item.Released || item.Year),
    genres: omdbValues(item.Genre),
    description: item.Plot !== "N/A" ? item.Plot : undefined,
    coverUrl: item.Poster && item.Poster !== "N/A" ? item.Poster : undefined,
    cacheCover: Boolean(item.Poster && item.Poster !== "N/A"),
    metadata: {
      creators,
      runtimeMinutes: Number.isFinite(runtime) ? runtime : undefined,
      seasons: Number.isFinite(seasons) ? seasons : undefined,
      providerStatus: item.Released,
    },
  };
}
async function omdbRequest(params) {
  const credentials = omdbCredentials();
  const query = new URLSearchParams({ apikey: credentials.token, ...params });
  const data = await fetchJson(
    `https://www.omdbapi.com/?${query}`,
    { headers: { Accept: "application/json" } },
    "OMDb",
    { attempts: 2, timeoutMs: 12000 },
  );
  if (data.Response === "False") {
    if (data.Error === "Movie not found!") return data;
    throw new Error(data.Error || "OMDb returned an error.");
  }
  return data;
}
async function searchOmdb(query, category) {
  const data = await omdbRequest({
    s: query,
    type: category === "movies" ? "movie" : "series",
    page: "1",
  });
  return (data.Search || [])
    .slice(0, 20)
    .map((item) => normalizeOmdb(item, category));
}
async function detailsOmdb(id, category) {
  if (!/^tt\d+$/.test(id)) throw new Error("Invalid OMDb item.");
  const data = await omdbRequest({ i: id, plot: "full" });
  if (data.Response === "False")
    throw new Error("This OMDb item is no longer available.");
  return normalizeOmdb(data, category);
}

function ranobeCover(image) {
  return image?.filename
    ? `https://images.ranobedb.org/${encodeURIComponent(image.filename)}`
    : undefined;
}
function normalizeRanobeSearch(series) {
  const volumes = Number(series.volumes?.count ?? series.c_num_books);
  return {
    provider: "ranobedb",
    providerName: "RanobeDB",
    providerId: String(series.id),
    providerUrl: `https://ranobedb.org/series/${series.id}`,
    category: "novels",
    subtype: "Light Novel",
    title: series.title,
    alternateTitle: series.title_orig || series.romaji_orig || undefined,
    releaseDate: compactDate(series.c_start_date),
    coverUrl: ranobeCover(series.book?.image),
    cacheCover: Boolean(series.book?.image?.filename),
    metadata: {
      originalTitle: series.title_orig || undefined,
      alternateTitles: names([series.romaji_orig]),
      volumes: Number.isFinite(volumes) ? volumes : undefined,
    },
  };
}
async function searchRanobe(query) {
  const params = new URLSearchParams({
    q: query,
    limit: "20",
    sort: "Relevance desc",
  });
  const data = await fetchJson(
    `https://ranobedb.org/api/v0/series?${params}`,
    undefined,
    "RanobeDB",
  );
  return (data.series || []).map(normalizeRanobeSearch);
}
async function detailsRanobe(id) {
  if (!/^\d+$/.test(id)) throw new Error("Invalid RanobeDB item.");
  const response = await fetchJson(
    `https://ranobedb.org/api/v0/series/${id}`,
    undefined,
    "RanobeDB",
  );
  const data = response.series || response;
  const authors = names(
    (data.staff || []).filter((person) => person.role_type === "author"),
  );
  const artists = names(
    (data.staff || []).filter((person) => person.role_type === "artist"),
  );
  const books = (data.books || []).filter((book) => book.book_type === "main");
  const cover = books.find((book) => book.image)?.image;
  const publishers = names(data.publishers);
  const alternateTitles = names([
    ...(data.titles || []).map((x) => x.title),
    data.aliases,
    data.romaji_orig,
  ]).filter((x) => x !== data.title);
  return {
    ...normalizeRanobeSearch({
      ...data,
      book: { image: cover },
      volumes: { count: books.length },
    }),
    creator: authors.join(", ") || undefined,
    contributors: artists.join(", ") || undefined,
    releaseDate: compactDate(data.start_date) || epochDate(data.start_date),
    genres: names((data.tags || []).filter((tag) => tag.ttype === "genre")),
    description:
      textOrUndefined(data.description) ||
      textOrUndefined(data.book_description?.description),
    metadata: {
      authors,
      artists,
      publishers,
      originalTitle: data.title_orig || undefined,
      alternateTitles,
      providerStatus: data.publication_status,
      volumes: books.length || undefined,
      sourceInformation: data.web_novel || undefined,
    },
  };
}

function jikanTitles(item) {
  return names([
    ...(item.titles || []).map((x) => x.title),
    ...(item.title_synonyms || []),
    item.title_english,
    item.title_japanese,
  ]).filter((x) => x !== item.title);
}
function optionalPositiveInteger(value) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && !value.trim())
  )
    return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function normalizeMalCompatible(item, category, provider = "jikan") {
  const anime = category === "anime";
  const people = names(item.authors);
  const studios = names(item.studios);
  const serializations = names(item.serializations);
  const subtype = ["Manhwa", "Manhua"].includes(item.type)
    ? item.type
    : "Manga";
  const alternateTitles = jikanTitles(item);
  const originalTitle = item.title_japanese || undefined;
  return {
    provider,
    providerName: provider === "tenrai" ? "Tenrai" : "Jikan",
    providerId: String(item.mal_id),
    providerUrl: item.url,
    category,
    subtype: anime ? undefined : subtype,
    title: item.title_english || item.title,
    alternateTitle: originalTitle || alternateTitles[0],
    creator: (anime ? studios : people).join(", ") || undefined,
    contributors: anime ? undefined : serializations.join(", ") || undefined,
    releaseDate:
      item.aired?.from?.slice(0, 10) || item.published?.from?.slice(0, 10),
    genres: names([
      ...(item.genres || []),
      ...(item.explicit_genres || []),
      ...(item.themes || []),
    ]),
    description: item.synopsis,
    coverUrl:
      item.images?.jpg?.large_image_url || item.images?.webp?.large_image_url,
    cacheCover: Boolean(
      item.images?.jpg?.large_image_url || item.images?.webp?.large_image_url,
    ),
    metadata: {
      authors: anime ? undefined : people,
      studios: anime ? studios : undefined,
      serialization: anime ? undefined : serializations,
      originalTitle,
      alternateTitles,
      providerStatus: item.status,
      episodes: anime ? item.episodes : undefined,
      volumes: anime ? undefined : optionalPositiveInteger(item.volumes),
      chapters: anime ? undefined : optionalPositiveInteger(item.chapters),
      format: item.type,
      season: anime ? item.season : undefined,
      seasonYear: anime ? item.year : undefined,
    },
  };
}
async function searchTenrai(query, category) {
  const type = category === "anime" ? "anime" : "manga";
  const params = new URLSearchParams({ q: query, limit: "20", sfw: "true" });
  const data = await fetchJson(
    `https://api.tenrai.org/v1/${type}?${params}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Everia/0.8 (Windows desktop media library)",
      },
    },
    "Tenrai",
    { attempts: 2, timeoutMs: 12000 },
  );
  return (data.data || []).map((item) =>
    normalizeMalCompatible(item, category, "tenrai"),
  );
}
async function detailsTenrai(id, category) {
  if (!/^\d+$/.test(id)) throw new Error("Invalid Tenrai item.");
  const type = category === "anime" ? "anime" : "manga";
  const data = await fetchJson(
    `https://api.tenrai.org/v1/${type}/${id}/full`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Everia/0.8 (Windows desktop media library)",
      },
    },
    "Tenrai",
    { attempts: 2, timeoutMs: 12000 },
  );
  if (!data.data) throw new Error("This Tenrai item is no longer available.");
  return normalizeMalCompatible(data.data, category, "tenrai");
}
async function searchJikan(query, category) {
  const type = category === "anime" ? "anime" : "manga";
  const params = new URLSearchParams({ q: query, limit: "20", sfw: "true" });
  const data = await fetchJson(
    `https://api.jikan.moe/v4/${type}?${params}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Everia/0.8 (Windows desktop media library)",
      },
    },
    "Jikan",
    { attempts: 2, timeoutMs: 12000 },
  );
  return (data.data || []).map((item) =>
    normalizeMalCompatible(item, category, "jikan"),
  );
}
async function detailsJikan(id, category) {
  if (!/^\d+$/.test(id)) throw new Error("Invalid Jikan item.");
  const type = category === "anime" ? "anime" : "manga";
  const data = await fetchJson(
    `https://api.jikan.moe/v4/${type}/${id}/full`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Everia/0.8 (Windows desktop media library)",
      },
    },
    "Jikan",
    { attempts: 2, timeoutMs: 12000 },
  );
  if (!data.data) throw new Error("This Jikan item is no longer available.");
  return normalizeMalCompatible(data.data, category, "jikan");
}

async function search({ provider, query, category }) {
  validateRequest(provider, category);
  const trimmed = String(query || "").trim();
  if (trimmed.length < 2)
    throw new Error("Enter at least two characters to search.");
  if (trimmed.length > 120) throw new Error("The search is too long.");
  try {
    const result =
      provider === "igdb"
        ? await searchIgdb(trimmed)
        : provider === "rawg"
          ? await searchRawg(trimmed)
          : provider === "tmdb"
            ? await searchTmdb(trimmed, category)
            : provider === "omdb"
              ? await searchOmdb(trimmed, category)
              : provider === "ranobedb"
                ? await searchRanobe(trimmed)
                : provider === "tenrai"
                  ? await searchTenrai(trimmed, category)
                  : await searchJikan(trimmed, category);
    connectionStates.set(provider, "connected");
    return result;
  } catch (error) {
    connectionStates.set(provider, "connection-failed");
    throw error;
  }
}
async function searchChain({ query, category }) {
  const chain = PROVIDER_CHAINS[category];
  if (!chain)
    throw new Error("Online search is not available for this category.");
  const failures = [];
  for (const provider of chain) {
    const status = providerStatus(provider);
    if (!status.available) {
      failures.push({ provider, name: status.name, reason: status.reason });
      continue;
    }
    try {
      const results = await search({ provider, query, category });
      const firstFailure = failures[0];
      return {
        results,
        provider,
        providerName: status.name,
        fallbackFrom: firstFailure?.name,
        notice: firstFailure
          ? `${firstFailure.name} unavailable — using ${status.name}`
          : undefined,
      };
    } catch (error) {
      if (!(error instanceof ProviderError) || !error.failoverEligible)
        throw error;
      failures.push({ provider, name: status.name, reason: error.message });
    }
  }
  const names = chain.map((provider) => PROVIDERS[provider].name).join(" and ");
  throw new ProviderError(
    `${names} are temporarily unavailable. Manual Entry remains available.`,
    "all-unavailable",
  );
}
async function details({ provider, providerId, category }) {
  validateRequest(provider, category);
  const id = String(providerId || "");
  try {
    const result =
      provider === "igdb"
        ? await detailsIgdb(id)
        : provider === "rawg"
          ? await detailsRawg(id)
          : provider === "tmdb"
            ? await detailsTmdb(id, category)
            : provider === "omdb"
              ? await detailsOmdb(id, category)
              : provider === "ranobedb"
                ? await detailsRanobe(id)
                : provider === "tenrai"
                  ? await detailsTenrai(id, category)
                  : await detailsJikan(id, category);
    connectionStates.set(provider, "connected");
    return result;
  } catch (error) {
    connectionStates.set(provider, "connection-failed");
    throw error;
  }
}
async function testConnection(provider) {
  const status = providerStatus(provider);
  if (!status.available) throw new Error(status.reason);
  try {
    if (provider === "igdb") await getIgdbToken();
    else if (provider === "rawg")
      await rawgRequest("games", { page_size: "1" });
    else if (provider === "tmdb")
      await fetchJson(
        "https://api.themoviedb.org/3/configuration",
        { headers: tmdbHeaders() },
        "TMDB",
      );
    else if (provider === "omdb")
      await omdbRequest({ i: "tt0133093", plot: "short" });
    else if (provider === "ranobedb")
      await fetchJson(
        "https://ranobedb.org/api/v0/series?limit=1",
        undefined,
        "RanobeDB",
      );
    else if (provider === "tenrai")
      await fetchJson(
        "https://api.tenrai.org/v1/anime?limit=1&sfw=true",
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "Everia/0.8 (Windows desktop media library)",
          },
        },
        "Tenrai",
        { attempts: 2, timeoutMs: 12000 },
      );
    else
      await fetchJson(
        "https://api.jikan.moe/v4/anime?limit=1&sfw=true",
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "Everia/0.8 (Windows desktop media library)",
          },
        },
        "Jikan",
        { attempts: 2, timeoutMs: 12000 },
      );
    connectionStates.set(provider, "connected");
    return providerStatus(provider);
  } catch (error) {
    connectionStates.set(provider, "connection-failed");
    throw error;
  }
}
async function initializeProviders() {
  const available = Object.keys(PROVIDERS).filter(
    (provider) => providerStatus(provider).available,
  );
  await Promise.allSettled(
    available.map((provider) => testConnection(provider)),
  );
  return allProviderConfigurations();
}
async function downloadImage(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !ALLOWED_IMAGE_HOSTS.has(url.hostname))
    throw new Error("This source image cannot be cached by Everia.");
  const response = await fetchResponse(
    url.href,
    { credentials: "omit" },
    "image source",
  );
  const type = response.headers.get("content-type")?.split(";")[0] || "";
  if (!type.startsWith("image/"))
    throw new Error("The source did not return a supported image.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 10 * 1024 * 1024)
    throw new Error("The source image is too large to cache.");
  return { bytes, type };
}

module.exports = {
  allProviderConfigurations,
  configureCredentialStore,
  details,
  downloadImage,
  initializeProviders,
  providerStatus,
  resetProviderSession,
  search,
  searchChain,
  testConnection,
};
