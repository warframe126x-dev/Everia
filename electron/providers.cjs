const PROVIDERS = {
  igdb: { name: "IGDB", categories: ["games"], requiresCredentials: true },
  tmdb: {
    name: "TMDB",
    categories: ["movies", "tv-series"],
    requiresCredentials: true,
  },
  ranobedb: {
    name: "RanobeDB",
    categories: ["novels"],
    requiresCredentials: false,
  },
  jikan: {
    name: "Jikan",
    categories: ["anime", "manga"],
    requiresCredentials: false,
  },
};

const ALLOWED_IMAGE_HOSTS = new Set([
  "images.igdb.com",
  "image.tmdb.org",
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
  return undefined;
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
    } catch {
      if (attempt + 1 < attempts) {
        await delay(350 * (attempt + 1));
        continue;
      }
      throw new Error(
        `Unable to reach ${providerName} right now. Your Everia library is unaffected.`,
      );
    }
    if (response.status === 401 || response.status === 403)
      throw new Error(`${providerName} rejected the saved credentials.`);
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
      throw new Error(`${providerName} is busy. Please wait a moment and retry.`);
    if ([502, 503, 504].includes(response.status))
      throw new Error(
        `${providerName} is temporarily unavailable because its upstream service did not respond. Your Everia library is unaffected.`,
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
    throw new Error(
      `${providerName || "The online source"} returned an unreadable response.`,
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
function normalizeJikan(item, category) {
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
    provider: "jikan",
    providerName: "Jikan",
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
      volumes: anime ? undefined : item.volumes,
      chapters: anime ? undefined : item.chapters,
      format: item.type,
      season: anime ? item.season : undefined,
      seasonYear: anime ? item.year : undefined,
    },
  };
}
async function searchJikan(query, category) {
  const type = category === "anime" ? "anime" : "manga";
  const params = new URLSearchParams({ q: query, limit: "20", sfw: "true" });
  const data = await fetchJson(
    `https://api.jikan.moe/v4/${type}?${params}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Everia/0.6 (Windows desktop media library)",
      },
    },
    "Jikan",
    { attempts: 2, timeoutMs: 12000 },
  );
  return (data.data || []).map((item) => normalizeJikan(item, category));
}
async function detailsJikan(id, category) {
  if (!/^\d+$/.test(id)) throw new Error("Invalid Jikan item.");
  const type = category === "anime" ? "anime" : "manga";
  const data = await fetchJson(
    `https://api.jikan.moe/v4/${type}/${id}/full`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Everia/0.6 (Windows desktop media library)",
      },
    },
    "Jikan",
    { attempts: 2, timeoutMs: 12000 },
  );
  if (!data.data) throw new Error("This Jikan item is no longer available.");
  return normalizeJikan(data.data, category);
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
        : provider === "tmdb"
          ? await searchTmdb(trimmed, category)
          : provider === "ranobedb"
            ? await searchRanobe(trimmed)
            : await searchJikan(trimmed, category);
    connectionStates.set(provider, "connected");
    return result;
  } catch (error) {
    connectionStates.set(provider, "connection-failed");
    throw error;
  }
}
async function details({ provider, providerId, category }) {
  validateRequest(provider, category);
  const id = String(providerId || "");
  try {
    const result =
      provider === "igdb"
        ? await detailsIgdb(id)
        : provider === "tmdb"
          ? await detailsTmdb(id, category)
          : provider === "ranobedb"
            ? await detailsRanobe(id)
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
    else if (provider === "tmdb")
      await fetchJson(
        "https://api.themoviedb.org/3/configuration",
        { headers: tmdbHeaders() },
        "TMDB",
      );
    else if (provider === "ranobedb")
      await fetchJson(
        "https://ranobedb.org/api/v0/series?limit=1",
        undefined,
        "RanobeDB",
      );
    else
      await fetchJson(
        "https://api.jikan.moe/v4/anime?limit=1&sfw=true",
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "Everia/0.6 (Windows desktop media library)",
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
  providerStatus,
  resetProviderSession,
  search,
  testConnection,
};
