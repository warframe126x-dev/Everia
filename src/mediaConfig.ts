import type { Category, ReadingStatus } from "./types";
import type { Locale } from "./localization/locale";
import { translate } from "./localization/format";

export const statuses: ReadingStatus[] = [
  "Planning",
  "In progress",
  "Completed",
  "On hold",
  "Dropped",
];

const statusKeys = {
  games: {
    Planning: "statuses.wantToPlay",
    "In progress": "statuses.playing",
    Completed: "statuses.played",
    "On hold": "statuses.onHold",
    Dropped: "statuses.dropped",
  },
  movies: {
    Planning: "statuses.wantToWatch",
    "In progress": "statuses.watching",
    Completed: "statuses.watched",
    "On hold": "statuses.onHold",
    Dropped: "statuses.dropped",
  },
  "tv-series": {
    Planning: "statuses.wantToWatch",
    "In progress": "statuses.watching",
    Completed: "statuses.completed",
    "On hold": "statuses.onHold",
    Dropped: "statuses.dropped",
  },
  novels: {
    Planning: "statuses.wantToRead",
    "In progress": "statuses.reading",
    Completed: "statuses.read",
    "On hold": "statuses.onHold",
    Dropped: "statuses.dropped",
  },
  manga: {
    Planning: "statuses.wantToRead",
    "In progress": "statuses.reading",
    Completed: "statuses.read",
    "On hold": "statuses.onHold",
    Dropped: "statuses.dropped",
  },
  anime: {
    Planning: "statuses.wantToWatch",
    "In progress": "statuses.watching",
    Completed: "statuses.completed",
    "On hold": "statuses.onHold",
    Dropped: "statuses.dropped",
  },
} as const satisfies Record<Category, Record<ReadingStatus, string>>;

export function statusLabel(
  category: Category,
  status: ReadingStatus,
  locale: Locale = "en",
) {
  return translate(locale, statusKeys[category][status]);
}

export function statusOptions(category: Category, locale: Locale = "en") {
  return statuses.map((value) => ({
    value,
    label: statusLabel(category, value, locale),
  }));
}

const creatorKeys = {
  games: "creators.developer",
  movies: "creators.director",
  "tv-series": "creators.creator",
  novels: "creators.author",
  manga: "creators.author",
  anime: "creators.studio",
} as const satisfies Record<Category, string>;
export function creatorDisplayLabel(category: Category, locale: Locale = "en") {
  return translate(locale, creatorKeys[category]);
}
// Detail/Edit are migrated in Batch 3; keep their existing English display contract.
export const creatorLabel: Record<Category, string> = {
  games: creatorDisplayLabel("games"),
  movies: creatorDisplayLabel("movies"),
  "tv-series": creatorDisplayLabel("tv-series"),
  novels: creatorDisplayLabel("novels"),
  manga: creatorDisplayLabel("manga"),
  anime: creatorDisplayLabel("anime"),
};

const contributorKeys = {
  movies: "contributors.cast",
  "tv-series": "contributors.cast",
  manga: "contributors.artist",
} as const;
export function contributorDisplayLabel(
  category: Category,
  locale: Locale = "en",
) {
  return category in contributorKeys
    ? translate(
        locale,
        contributorKeys[category as keyof typeof contributorKeys],
      )
    : undefined;
}
export const contributorLabel: Partial<Record<Category, string>> = {
  movies: contributorDisplayLabel("movies"),
  "tv-series": contributorDisplayLabel("tv-series"),
  manga: contributorDisplayLabel("manga"),
};
