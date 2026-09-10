const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const providers = require("./providers.cjs");

const originalFetch = global.fetch;
const originalEnv = {
  clientId: process.env.EVERIA_IGDB_CLIENT_ID,
  clientSecret: process.env.EVERIA_IGDB_CLIENT_SECRET,
  accessToken: process.env.EVERIA_IGDB_ACCESS_TOKEN,
  tmdbToken: process.env.EVERIA_TMDB_TOKEN,
  rawgKey: process.env.EVERIA_RAWG_API_KEY,
  omdbKey: process.env.EVERIA_OMDB_API_KEY,
};

afterEach(() => {
  global.fetch = originalFetch;
  for (const provider of [
    "igdb",
    "rawg",
    "tmdb",
    "omdb",
    "ranobedb",
    "tenrai",
    "jikan",
  ])
    providers.resetProviderSession(provider);
  const restore = (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore("EVERIA_IGDB_CLIENT_ID", originalEnv.clientId);
  restore("EVERIA_IGDB_CLIENT_SECRET", originalEnv.clientSecret);
  restore("EVERIA_IGDB_ACCESS_TOKEN", originalEnv.accessToken);
  restore("EVERIA_TMDB_TOKEN", originalEnv.tmdbToken);
  restore("EVERIA_RAWG_API_KEY", originalEnv.rawgKey);
  restore("EVERIA_OMDB_API_KEY", originalEnv.omdbKey);
});

test("credentialed providers fail closed without affecting RanobeDB", () => {
  delete process.env.EVERIA_IGDB_CLIENT_ID;
  delete process.env.EVERIA_IGDB_CLIENT_SECRET;
  delete process.env.EVERIA_IGDB_ACCESS_TOKEN;
  delete process.env.EVERIA_TMDB_TOKEN;
  delete process.env.EVERIA_RAWG_API_KEY;
  delete process.env.EVERIA_OMDB_API_KEY;
  assert.equal(providers.providerStatus("igdb").available, false);
  assert.equal(providers.providerStatus("tmdb").available, false);
  assert.equal(providers.providerStatus("rawg").available, false);
  assert.equal(providers.providerStatus("omdb").available, false);
  assert.equal(providers.providerStatus("ranobedb").available, true);
  assert.equal(providers.providerStatus("ranobedb").state, "unchecked");
  assert.equal(providers.providerStatus("jikan").state, "unchecked");
});

test("provider network failure returns a clean offline-safe error", async () => {
  global.fetch = async () => {
    throw new Error("socket details that must not escape");
  };
  await assert.rejects(
    providers.search({
      provider: "ranobedb",
      query: "slime",
      category: "novels",
    }),
    /library is unaffected/,
  );
});

test("image cache bridge only accepts approved provider hosts", async () => {
  await assert.rejects(
    providers.downloadImage("https://example.com/poster.jpg"),
    /cannot be cached/,
  );
});

test("TMDB responses are normalized without exposing provider shapes", async () => {
  process.env.EVERIA_TMDB_TOKEN = "test-token";
  global.fetch = async (url, init) => {
    assert.match(String(url), /search\/movie/);
    assert.equal(init.headers.Authorization, "Bearer test-token");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            id: 42,
            title: "The Answer",
            original_title: "Original Answer",
            release_date: "2026-01-02",
            poster_path: "/answer.jpg",
            overview: "A local-first test.",
          },
        ],
      }),
    };
  };
  const [result] = await providers.search({
    provider: "tmdb",
    query: "answer",
    category: "movies",
  });
  assert.deepEqual(
    {
      provider: result.provider,
      id: result.providerId,
      category: result.category,
      title: result.title,
    },
    {
      provider: "tmdb",
      id: "42",
      category: "movies",
      title: "The Answer",
    },
  );
});

test("RanobeDB search normalizes series-level light novel records", async () => {
  global.fetch = async (url) => {
    assert.match(String(url), /\/api\/v0\/series\?/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        series: [
          {
            id: 7,
            title: "A Light Novel",
            title_orig: "ライトノベル",
          },
        ],
      }),
    };
  };
  const [result] = await providers.search({
    provider: "ranobedb",
    query: "light novel",
    category: "novels",
  });
  assert.equal(result.providerId, "7");
  assert.equal(result.subtype, "Light Novel");
  assert.equal(result.cacheCover, false);
});

test("RanobeDB details populate the review model instead of a blank form", async () => {
  global.fetch = async (url) => {
    assert.match(String(url), /\/api\/v0\/series\/3580/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        series: {
          id: 3580,
          title: "That Time I Got Reincarnated as a Slime",
          title_orig: "転生したらスライムだった件",
          start_date: 1398902400,
          publication_status: "completed",
          description: "A complete series description.",
          staff: [
            { role_type: "author", name: "Fuse" },
            { role_type: "artist", name: "Mitz Vah" },
          ],
          tags: [{ ttype: "genre", name: "Fantasy" }],
          books: [
            { book_type: "main", image: { filename: "slime.jpg" } },
            { book_type: "main", image: null },
          ],
          publishers: [{ name: "GC Novels" }],
        },
      }),
    };
  };
  const result = await providers.details({
    provider: "ranobedb",
    providerId: "3580",
    category: "novels",
  });
  assert.equal(result.creator, "Fuse");
  assert.equal(result.coverUrl, "https://images.ranobedb.org/slime.jpg");
  assert.equal(result.metadata.volumes, 2);
  assert.equal(result.metadata.providerStatus, "completed");
});

test("Jikan anime and manga normalize category-specific details", async () => {
  global.fetch = async (url, init) => {
    assert.equal(init.headers.Accept, "application/json");
    assert.match(init.headers["User-Agent"], /^Everia\/0\.8/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: String(url).includes("/anime/")
          ? {
              mal_id: 1,
              title: "Anime",
              title_japanese: "アニメ",
              studios: [{ name: "Studio Test" }],
              genres: [{ name: "Fantasy" }],
              episodes: 24,
              status: "Finished Airing",
              aired: { from: "2024-01-01T00:00:00+00:00" },
              images: {
                jpg: {
                  large_image_url: "https://cdn.myanimelist.net/anime.jpg",
                },
              },
            }
          : {
              mal_id: 2,
              title: "Manga",
              type: "Manhwa",
              authors: [{ name: "Author Test" }],
              genres: [{ name: "Drama" }],
              volumes: null,
              chapters: 80,
              published: { from: "2022-02-03T00:00:00+00:00" },
            },
      }),
    };
  };
  const anime = await providers.details({
    provider: "jikan",
    providerId: "1",
    category: "anime",
  });
  const manga = await providers.details({
    provider: "jikan",
    providerId: "2",
    category: "manga",
  });
  assert.equal(anime.creator, "Studio Test");
  assert.equal(anime.metadata.episodes, 24);
  assert.equal(manga.subtype, "Manhwa");
  assert.equal(manga.metadata.chapters, 80);
  assert.equal(providers.providerStatus("jikan").state, "connected");
});

test("RAWG search normalizes game metadata", async () => {
  process.env.EVERIA_RAWG_API_KEY = "rawg-test-key";
  global.fetch = async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("key"), "rawg-test-key");
    assert.equal(parsed.searchParams.get("search"), "portal");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            id: 3498,
            slug: "grand-theft-auto-v",
            name: "Grand Theft Auto V",
            released: "2013-09-17",
            background_image: "https://media.rawg.io/media/games/cover.jpg",
            genres: [{ name: "Action" }],
            platforms: [{ platform: { name: "PC" } }],
          },
        ],
      }),
    };
  };
  const [result] = await providers.search({
    provider: "rawg",
    query: "portal",
    category: "games",
  });
  assert.equal(result.provider, "rawg");
  assert.equal(result.providerId, "3498");
  assert.equal(result.platform, "PC");
  assert.equal(result.cacheCover, true);
});

test("OMDb search normalizes movie and television records", async () => {
  process.env.EVERIA_OMDB_API_KEY = "omdb-test-key";
  global.fetch = async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("apikey"), "omdb-test-key");
    assert.equal(parsed.searchParams.get("type"), "series");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        Response: "True",
        Search: [
          {
            Title: "A Series",
            Year: "2020–2024",
            imdbID: "tt1234567",
            Type: "series",
            Poster: "https://m.media-amazon.com/images/test.jpg",
          },
        ],
      }),
    };
  };
  const [result] = await providers.search({
    provider: "omdb",
    query: "series",
    category: "tv-series",
  });
  assert.equal(result.provider, "omdb");
  assert.equal(result.providerId, "tt1234567");
  assert.equal(result.releaseDate, "2020");
});

test("Tenrai normalizes its documented Jikan-compatible response", async () => {
  global.fetch = async (url, init) => {
    assert.match(String(url), /^https:\/\/api\.tenrai\.org\/v1\/manga\?/);
    assert.match(init.headers["User-Agent"], /^Everia\/0\.8/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            mal_id: 77,
            title: "Primary Manga",
            type: "Manhua",
            authors: [{ name: "Creator" }],
            chapters: 12,
            images: {
              jpg: {
                large_image_url: "https://cdn.myanimelist.net/tenrai.jpg",
              },
            },
          },
        ],
      }),
    };
  };
  const [result] = await providers.search({
    provider: "tenrai",
    query: "primary",
    category: "manga",
  });
  assert.equal(result.provider, "tenrai");
  assert.equal(result.providerName, "Tenrai");
  assert.equal(result.subtype, "Manhua");
  assert.equal(result.metadata.chapters, 12);
});

test("Tenrai safely normalizes optional Manga volume and chapter counts", async () => {
  const cases = new Map([
    ["1", { volumes: 9, chapters: 47 }],
    ["2", { volumes: 6, chapters: null }],
    ["3", { volumes: null }],
    ["4", { volumes: "unknown", chapters: -3 }],
  ]);
  global.fetch = async (url) => {
    const id = String(url).match(/\/manga\/(\d+)\/full/)?.[1];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          mal_id: Number(id),
          title: `Manga ${id}`,
          type: "Manga",
          ...cases.get(id),
        },
      }),
    };
  };

  const details = [];
  for (const providerId of cases.keys())
    details.push(
      await providers.details({
        provider: "tenrai",
        providerId,
        category: "manga",
      }),
    );

  assert.deepEqual(details[0].metadata, {
    authors: [],
    studios: undefined,
    serialization: [],
    originalTitle: undefined,
    alternateTitles: [],
    providerStatus: undefined,
    episodes: undefined,
    volumes: 9,
    chapters: 47,
    format: "Manga",
    season: undefined,
    seasonYear: undefined,
  });
  assert.equal(details[1].metadata.volumes, 6);
  assert.equal(details[1].metadata.chapters, undefined);
  assert.equal(details[2].metadata.volumes, undefined);
  assert.equal(details[2].metadata.chapters, undefined);
  assert.equal(details[3].metadata.volumes, undefined);
  assert.equal(details[3].metadata.chapters, undefined);
});

test("a valid empty primary response does not query the backup", async () => {
  process.env.EVERIA_IGDB_CLIENT_ID = "client";
  process.env.EVERIA_IGDB_ACCESS_TOKEN = "token";
  process.env.EVERIA_RAWG_API_KEY = "backup";
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => [] };
  };
  const result = await providers.searchChain({
    query: "missing",
    category: "games",
  });
  assert.deepEqual(result.results, []);
  assert.equal(result.provider, "igdb");
  assert.equal(result.notice, undefined);
  assert.equal(calls, 1);
});

for (const [label, primaryResponse] of [
  [
    "network error",
    () => {
      throw new TypeError("offline");
    },
  ],
  [
    "timeout",
    () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    },
  ],
  [
    "HTTP 429",
    () => ({ ok: false, status: 429, headers: { get: () => null } }),
  ],
  [
    "HTTP 5xx",
    () => ({ ok: false, status: 500, headers: { get: () => null } }),
  ],
]) {
  test(`provider chain falls back on ${label}`, async () => {
    process.env.EVERIA_IGDB_CLIENT_ID = "client";
    process.env.EVERIA_IGDB_ACCESS_TOKEN = "token";
    process.env.EVERIA_RAWG_API_KEY = "backup";
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      if (calls === 1) return primaryResponse();
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [{ id: 9, name: "Backup Game" }] }),
      };
    };
    const result = await providers.searchChain({
      query: "game",
      category: "games",
    });
    assert.equal(result.provider, "rawg");
    assert.equal(result.results[0].provider, "rawg");
    assert.equal(result.notice, "IGDB unavailable — using RAWG");
  });
}

test("both unavailable providers leave the manual path explicit", async () => {
  delete process.env.EVERIA_IGDB_CLIENT_ID;
  delete process.env.EVERIA_IGDB_ACCESS_TOKEN;
  delete process.env.EVERIA_IGDB_CLIENT_SECRET;
  delete process.env.EVERIA_RAWG_API_KEY;
  await assert.rejects(
    providers.searchChain({ query: "game", category: "games" }),
    /Manual Entry remains available/,
  );
});

test("one provider chain failure does not affect an unrelated category", async () => {
  delete process.env.EVERIA_IGDB_CLIENT_ID;
  delete process.env.EVERIA_IGDB_ACCESS_TOKEN;
  delete process.env.EVERIA_IGDB_CLIENT_SECRET;
  delete process.env.EVERIA_RAWG_API_KEY;
  await assert.rejects(
    providers.searchChain({ query: "game", category: "games" }),
  );
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ series: [{ id: 4, title: "Independent Novel" }] }),
  });
  const result = await providers.searchChain({
    query: "novel",
    category: "novels",
  });
  assert.equal(result.provider, "ranobedb");
  assert.equal(result.results[0].title, "Independent Novel");
});

test("provider configuration exposes deterministic roles and initial states", () => {
  const configurations = providers.allProviderConfigurations();
  assert.equal(
    configurations.find((item) => item.id === "tenrai").role,
    "primary",
  );
  assert.equal(
    configurations.find((item) => item.id === "jikan").role,
    "backup",
  );
  assert.equal(
    configurations.find((item) => item.id === "rawg").state,
    "not-configured",
  );
});

test("startup initializes available providers independently", async () => {
  delete process.env.EVERIA_IGDB_CLIENT_ID;
  delete process.env.EVERIA_IGDB_CLIENT_SECRET;
  delete process.env.EVERIA_IGDB_ACCESS_TOKEN;
  delete process.env.EVERIA_RAWG_API_KEY;
  delete process.env.EVERIA_TMDB_TOKEN;
  delete process.env.EVERIA_OMDB_API_KEY;
  global.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () =>
      String(url).includes("ranobedb") ? { series: [] } : { data: [] },
  });
  const configurations = await providers.initializeProviders();
  for (const provider of ["ranobedb", "tenrai", "jikan"])
    assert.equal(
      configurations.find((item) => item.id === provider).state,
      "connected",
    );
  assert.equal(
    configurations.find((item) => item.id === "rawg").state,
    "not-configured",
  );
});

test("Jikan retries transient gateway failures and reports real health", async () => {
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    if (attempts < 2)
      return {
        ok: false,
        status: 504,
        headers: { get: () => null },
      };
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    };
  };
  const results = await providers.search({
    provider: "jikan",
    query: "slime",
    category: "anime",
  });
  assert.deepEqual(results, []);
  assert.equal(attempts, 2);
  assert.equal(providers.providerStatus("jikan").state, "connected");
});

test("Jikan reports an honest isolated failure after retry exhaustion", async () => {
  global.fetch = async () => ({
    ok: false,
    status: 504,
    headers: { get: () => null },
  });
  await assert.rejects(
    providers.search({
      provider: "jikan",
      query: "slime",
      category: "manga",
    }),
    /temporarily unavailable.*library is unaffected/i,
  );
  assert.equal(providers.providerStatus("jikan").state, "connection-failed");
  assert.equal(providers.providerStatus("ranobedb").available, true);
});
