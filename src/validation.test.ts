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
