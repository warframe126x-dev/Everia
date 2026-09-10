import type { Category, ReadingStatus } from "./types";

export const statuses: ReadingStatus[] = [
  "Planning",
  "In progress",
  "Completed",
  "On hold",
  "Dropped",
];

const labels: Record<Category, Record<ReadingStatus, string>> = {
  games: {
    Planning: "Want to Play",
    "In progress": "Playing",
    Completed: "Played",
    "On hold": "On Hold",
    Dropped: "Dropped",
  },
  movies: {
    Planning: "Want to Watch",
    "In progress": "Watching",
    Completed: "Watched",
    "On hold": "On Hold",
    Dropped: "Dropped",
  },
  "tv-series": {
    Planning: "Want to Watch",
    "In progress": "Watching",
    Completed: "Completed",
    "On hold": "On Hold",
    Dropped: "Dropped",
  },
  novels: {
    Planning: "Want to Read",
    "In progress": "Reading",
    Completed: "Read",
    "On hold": "On Hold",
    Dropped: "Dropped",
  },
  manga: {
    Planning: "Want to Read",
    "In progress": "Reading",
    Completed: "Read",
    "On hold": "On Hold",
    Dropped: "Dropped",
  },
  anime: {
    Planning: "Want to Watch",
    "In progress": "Watching",
    Completed: "Completed",
    "On hold": "On Hold",
    Dropped: "Dropped",
  },
};

export function statusLabel(category: Category, status: ReadingStatus) {
  return labels[category][status];
}

export function statusOptions(category: Category) {
  return statuses.map((value) => ({
    value,
    label: statusLabel(category, value),
  }));
}

export const creatorLabel: Record<Category, string> = {
  games: "Developer",
  movies: "Director",
  "tv-series": "Creator",
  novels: "Author",
  manga: "Author",
  anime: "Studio",
};

export const contributorLabel: Partial<Record<Category, string>> = {
  movies: "Cast",
  "tv-series": "Cast",
  manga: "Artist",
};
