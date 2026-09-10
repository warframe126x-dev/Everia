import { test } from "node:test";
import assert from "node:assert/strict";
import { validateItems } from "./validation.ts";

const base = {
  id: "test",
  title: "Test",
  category: "games",
  status: "Planning",
  dateAdded: "2026-09-08",
  favorite: false,
};
test("migrates old novels without losing notes", () => {
  assert.deepEqual(
    validateItems([{ ...base, category: "web-novels", notes: "Keep me" }])[0],
    { ...base, category: "novels", subtype: "Web Novel", notes: "Keep me" },
  );
});
test("removes incompatible subtype", () => {
  assert.equal(
    validateItems([{ ...base, subtype: "Manhwa" }])[0].subtype,
    undefined,
  );
});
test("assigns manga default", () => {
  assert.equal(
    validateItems([{ ...base, category: "manga" }])[0].subtype,
    "Manga",
  );
});
test("rejects malformed collections and out-of-range ratings", () => {
  for (const value of [
    null,
    {},
    [null],
    [{ ...base, rating: 11 }],
    [{ ...base, category: "unknown" }],
  ])
    assert.throws(() => validateItems(value));
});
test("accepts v0.7 provider references without changing local fields", () => {
  for (const provider of ["rawg", "omdb", "tenrai"]) {
    const item = validateItems([
      {
        ...base,
        notes: "Owned by Everia",
        providerReference: {
          provider,
          providerId: "source-id",
          importedAt: "2026-09-10",
        },
      },
    ])[0];
    assert.equal(item.notes, "Owned by Everia");
    assert.equal(item.providerReference?.provider, provider);
  }
});

test("accepts Manga with both volumes and chapters", () => {
  const item = validateItems([
    {
      ...base,
      category: "manga",
      providerMetadata: { volumes: 12, chapters: 64 },
    },
  ])[0];
  assert.deepEqual(item.providerMetadata, { volumes: 12, chapters: 64 });
});
test("accepts Manga with volumes and no chapters", () => {
  const item = validateItems([
    {
      ...base,
      category: "manga",
      providerMetadata: { volumes: 8, chapters: null },
    },
  ])[0];
  assert.equal(item.providerMetadata?.volumes, 8);
  assert.equal(item.providerMetadata?.chapters, undefined);
});
test("accepts Manga with unknown volume and chapter counts", () => {
  for (const providerMetadata of [
    {},
    { volumes: null, chapters: undefined },
    { volumes: "", chapters: "   " },
  ]) {
    const item = validateItems([
      { ...base, category: "manga", providerMetadata },
    ])[0];
    assert.equal(item.providerMetadata?.volumes, undefined);
    assert.equal(item.providerMetadata?.chapters, undefined);
  }
});
test("rejects malformed Manga volume and chapter counts", () => {
  for (const providerMetadata of [
    { volumes: "many" },
    { chapters: -1 },
    { volumes: 0 },
    { chapters: 1.5 },
  ])
    assert.throws(
      () =>
        validateItems([{ ...base, category: "manga", providerMetadata }]),
      /Invalid provider metadata/,
    );
});
test("Manga count handling does not change valid Anime metadata", () => {
  const item = validateItems([
    {
      ...base,
      category: "anime",
      providerMetadata: { episodes: 24, seasonYear: 2024 },
    },
  ])[0];
  assert.deepEqual(item.providerMetadata, { episodes: 24, seasonYear: 2024 });
});
