import { expect, test } from "vitest";
import { candidateToDraft, providerForCategory } from ".";

test("provider mapping remains category-specific and replaceable", () => {
  expect(providerForCategory("games")?.id).toBe("igdb");
  expect(providerForCategory("movies")?.id).toBe("tmdb");
  expect(providerForCategory("tv-series")?.id).toBe("tmdb");
  expect(providerForCategory("novels")?.id).toBe("ranobedb");
  expect(providerForCategory("anime")?.id).toBe("tenrai");
  expect(providerForCategory("manga")?.id).toBe("tenrai");
});

test("an import becomes an Everia-owned draft with separate provider linkage", () => {
  const draft = candidateToDraft({
    provider: "tmdb",
    providerName: "TMDB",
    providerId: "42",
    providerUrl: "https://www.themoviedb.org/movie/42",
    category: "movies",
    title: "Imported film",
    coverUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
    cacheCover: true,
  });
  expect(draft.status).toBe("Planning");
  expect(draft.favorite).toBe(false);
  expect(draft.notes).toBe("");
  expect(draft.providerReference).toMatchObject({
    provider: "tmdb",
    providerId: "42",
  });
  expect(draft.coverUrl).toContain("image.tmdb.org");
});
