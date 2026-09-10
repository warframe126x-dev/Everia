import type { MediaItem } from "./types";
const categories = ["games", "movies", "tv-series", "novels", "manga", "anime"];

export function validateItems(value: unknown): MediaItem[] {
  if (!Array.isArray(value))
    throw new Error("The collection is not a valid list.");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object")
      throw new Error("Invalid collection entry.");
    const item = { ...raw };
    if (item.category === "light-novels" || item.category === "web-novels") {
      item.subtype =
        item.category === "light-novels" ? "Light Novel" : "Web Novel";
      item.category = "novels";
    }
    if (
      !categories.includes(item.category) ||
      typeof item.id !== "string" ||
      typeof item.title !== "string" ||
      !item.title.trim() ||
      typeof item.dateAdded !== "string" ||
      !["Planning", "In progress", "Completed", "On hold", "Dropped"].includes(
        item.status,
      ) ||
      typeof item.favorite !== "boolean"
    )
      throw new Error(
        "Invalid collection entry. Original data has been preserved.",
      );
    for (const key of [
      "creator",
      "alternateTitle",
      "releaseDate",
      "coverUrl",
      "sourceCoverUrl",
      "notes",
      "description",
      "source",
      "sourceId",
      "platform",
      "contributors",
      "link",
      "linkLabel",
      "dateModified",
    ]) {
      if (item[key] !== undefined && typeof item[key] !== "string")
        throw new Error(`Invalid ${key}.`);
    }
    if (
      item.rating !== undefined &&
      (!Number.isFinite(item.rating) || item.rating < 1 || item.rating > 10)
    )
      throw new Error("Ratings must be between 1 and 10.");
    if (
      item.genres !== undefined &&
      (!Array.isArray(item.genres) ||
        !item.genres.every((genre: unknown) => typeof genre === "string"))
    )
      throw new Error("Invalid genres.");
    if (item.providerReference !== undefined) {
      const reference = item.providerReference;
      if (
        !reference ||
        typeof reference !== "object" ||
        !["igdb", "tmdb", "ranobedb", "jikan"].includes(reference.provider) ||
        typeof reference.providerId !== "string" ||
        !reference.providerId ||
        typeof reference.importedAt !== "string" ||
        (reference.providerUrl !== undefined &&
          typeof reference.providerUrl !== "string") ||
        (reference.lastRefreshedAt !== undefined &&
          typeof reference.lastRefreshedAt !== "string")
      )
        throw new Error("Invalid provider reference.");
    }
    if (item.providerMetadata !== undefined) {
      if (!item.providerMetadata || typeof item.providerMetadata !== "object")
        throw new Error("Invalid provider metadata.");
      const numericKeys = [
        "runtimeMinutes",
        "seasons",
        "episodes",
        "volumes",
        "chapters",
        "seasonYear",
      ];
      const arrayKeys = [
        "developers",
        "creators",
        "authors",
        "artists",
        "studios",
        "publishers",
        "productionCompanies",
        "platforms",
        "networks",
        "alternateTitles",
        "serialization",
      ];
      for (const key of numericKeys) {
        const value = item.providerMetadata[key];
        if (value !== undefined && (!Number.isFinite(value) || value < 0))
          throw new Error(`Invalid provider metadata: ${key}.`);
      }
      for (const key of arrayKeys) {
        const value = item.providerMetadata[key];
        if (
          value !== undefined &&
          (!Array.isArray(value) ||
            !value.every((entry: unknown) => typeof entry === "string"))
        )
          throw new Error(`Invalid provider metadata: ${key}.`);
      }
      for (const key of [
        "originalTitle",
        "franchise",
        "providerStatus",
        "format",
        "season",
        "sourceInformation",
      ]) {
        const value = item.providerMetadata[key];
        if (value !== undefined && typeof value !== "string")
          throw new Error(`Invalid provider metadata: ${key}.`);
      }
    }
    const allowed =
      item.category === "novels"
        ? ["Novel", "Light Novel", "Web Novel"]
        : item.category === "manga"
          ? ["Manga", "Manhwa", "Manhua"]
          : [];
    item.subtype = allowed.includes(item.subtype) ? item.subtype : allowed[0];
    return item as MediaItem;
  });
}
