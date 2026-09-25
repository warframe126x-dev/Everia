import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "fake-indexeddb/auto";
import App from "./App";
import { Cover } from "./Cover";
import { StarRating } from "./StarRating";
import { categoryDescription, categoryLabel, subtypeLabel } from "./data";
import {
  contributorDisplayLabel,
  creatorDisplayLabel,
  statusLabel,
  statusOptions,
} from "./mediaConfig";
import {
  LocalizationProvider,
  useLocalization,
} from "./localization/Localization";
import { formatCount } from "./localization/format";
import type { Locale } from "./localization/locale";
import { categories } from "./types";

const items = [
  {
    id: "game-1",
    title: "Galaxy Quest",
    creator: "Ada",
    category: "games",
    status: "In progress",
    favorite: true,
    rating: 9,
    dateAdded: "2026-09-20",
  },
  {
    id: "novel-1",
    title: "Le Monde",
    category: "novels",
    subtype: "Light Novel",
    status: "Planning",
    favorite: false,
    dateAdded: "2026-09-21",
  },
] as const;

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function SwitchLocale() {
  const { locale, setLocale } = useLocalization();
  return (
    <button onClick={() => setLocale(locale === "en" ? "fr" : "ar")}>
      Test locale switch
    </button>
  );
}

function renderApp(locale: Locale, populated = true) {
  if (populated) localStorage.setItem("everia.items.v1", JSON.stringify(items));
  return render(
    <LocalizationProvider initialLocale={locale}>
      <App />
      <SwitchLocale />
    </LocalizationProvider>,
  );
}

const expected = {
  en: {
    home: "Home",
    games: "Games",
    tagline: "Your Personal Universe",
    sort: "Sort by",
    status: "Playing",
    favorites: "Favorites",
    empty: "No favorites yet",
    open: "Open Galaxy Quest",
  },
  fr: {
    home: "Accueil",
    games: "Jeux",
    tagline: "Votre univers personnel",
    sort: "Trier par",
    status: "En cours",
    favorites: "Favoris",
    empty: "Aucun favori pour le moment",
    open: "Ouvrir Galaxy Quest",
  },
  ar: {
    home: "الرئيسية",
    games: "الألعاب",
    tagline: "عالمك الخاص",
    sort: "ترتيب حسب",
    status: "ألعبها حاليًا",
    favorites: "المفضلة",
    empty: "لا توجد مفضلات بعد",
    open: "فتح Galaxy Quest",
  },
} as const;

for (const locale of ["en", "fr", "ar"] as const) {
  test(`shell, Home, Library and Favorites render in ${locale} without changing media text`, () => {
    const copy = expected[locale];
    renderApp(locale);
    expect(screen.getByText(copy.tagline)).toBeDefined();
    const gameCard = screen.getByRole("button", {
      name: new RegExp(copy.games),
    });
    expect(gameCard.textContent).toContain(
      formatCount(locale, "home.entryCount", 1),
    );
    fireEvent.click(gameCard);
    expect(screen.getByRole("button", { name: copy.home })).toBeDefined();
    for (const category of categories) {
      const nav = screen.getByRole("button", {
        name: categoryLabel(category, locale),
      });
      expect(nav.getAttribute("title")).toBe(categoryLabel(category, locale));
    }
    expect(
      screen.getByRole("button", {
        name:
          locale === "en"
            ? "Add item"
            : locale === "fr"
              ? "Ajouter"
              : "إضافة عنصر",
      }),
    ).toBeDefined();
    expect(
      screen.getByLabelText(
        locale === "en"
          ? "Search your universe"
          : locale === "fr"
            ? "Rechercher dans votre univers"
            : "ابحث في عالمك",
      ),
    ).toBeDefined();
    expect(screen.getByLabelText(copy.sort)).toBeDefined();
    expect(screen.getByRole("button", { name: copy.status })).toBeDefined();
    expect(screen.getByRole("button", { name: copy.open })).toBeDefined();
    expect(
      screen.getByRole("img", {
        name:
          locale === "en"
            ? "Cover of Galaxy Quest"
            : locale === "fr"
              ? "Couverture de Galaxy Quest"
              : "غلاف Galaxy Quest",
      }),
    ).toBeDefined();
    expect(screen.getByText("Galaxy Quest")).toBeDefined();
    expect(screen.getByText("Ada")).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: categoryLabel("novels", locale) }),
    );
    expect(
      screen.getByText(categoryDescription("novels", locale)),
    ).toBeDefined();
    expect(screen.getByText(subtypeLabel("Light Novel", locale))).toBeDefined();
    expect(
      screen.getByText(
        locale === "fr"
          ? "Créateur inconnu"
          : locale === "ar"
            ? "المُنشئ غير معروف"
            : "Unknown creator",
      ),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: copy.favorites }));
    expect(screen.getByRole("heading", { name: copy.favorites })).toBeDefined();
    expect(screen.getByRole("button", { name: copy.open })).toBeDefined();
  });

  test(`empty category and Favorites copy and accessibility are localized in ${locale}`, () => {
    const copy = expected[locale];
    renderApp(locale, false);
    const card = screen.getByRole("button", { name: new RegExp(copy.games) });
    expect(card.textContent).toContain(
      formatCount(locale, "home.entryCount", 0),
    );
    fireEvent.click(card);
    expect(screen.getByLabelText(expected[locale].sort)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: copy.favorites }));
    expect(screen.getByRole("heading", { name: copy.empty })).toBeDefined();
  });
}

test("shared labels translate display only; category, status and subtype IDs remain stable", () => {
  expect(categoryLabel("tv-series", "fr")).toBe("Séries TV");
  expect(categoryDescription("games", "ar")).toBe("عوالم تستكشفها");
  expect(subtypeLabel("Light Novel", "fr")).toBe("Light novel");
  expect(subtypeLabel("Manhua", "ar")).toBe("مانهوا صينية");
  expect(statusLabel("games", "Completed", "en")).toBe("Played");
  expect(statusLabel("games", "Completed", "fr")).toBe("Terminé");
  expect(statusLabel("movies", "Completed", "fr")).toBe("Vu");
  expect(statusLabel("novels", "Completed", "ar")).toBe("قرأتها");
  expect(statusOptions("games", "ar").map(({ value }) => value)).toEqual([
    "Planning",
    "In progress",
    "Completed",
    "On hold",
    "Dropped",
  ]);
  expect(creatorDisplayLabel("games", "fr")).toBe("Développeur");
  expect(creatorDisplayLabel("novels", "ar")).toBe("المؤلف");
  expect(contributorDisplayLabel("movies", "fr")).toBe("Distribution");
  expect(contributorDisplayLabel("manga", "ar")).toBe("الرسّام");
  expect(contributorDisplayLabel("games", "ar")).toBeUndefined();
});

test("changing locale updates browsing copy without rewriting persisted library data", () => {
  renderApp("en");
  const original = localStorage.getItem("everia.items.v1");
  fireEvent.click(screen.getByRole("button", { name: /Games/ }));
  expect(screen.getByRole("button", { name: "Playing" })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Test locale switch" }));
  expect(screen.getByRole("button", { name: "En cours" })).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Ouvrir Galaxy Quest" }),
  ).toBeDefined();
  expect((screen.getByLabelText("Trier par") as HTMLSelectElement).value).toBe(
    "dateAdded",
  );
  expect(localStorage.getItem("everia.items.v1")).toBe(original);
  expect(JSON.parse(original!)[0].status).toBe("In progress");
  fireEvent.click(screen.getByRole("button", { name: "Test locale switch" }));
  expect(screen.getByRole("button", { name: "ألعبها حاليًا" })).toBeDefined();
  expect(localStorage.getItem("everia.items.v1")).toBe(original);
  expect(localStorage.getItem("everia.locale.v1")).toBe('"ar"');
});

test("cover and rating accessibility localize media titles and numbers", async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("everia-assets", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("covers"))
        request.result.createObjectStore("covers");
      if (!request.result.objectStoreNames.contains("wallpapers"))
        request.result.createObjectStore("wallpapers");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("covers", "readwrite");
    tx.objectStore("covers").put(
      new Blob(["image"], { type: "image/png" }),
      "local-cover:localized",
    );
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL() {
        return "blob:localized";
      }
      static revokeObjectURL() {}
    },
  );
  render(
    <LocalizationProvider initialLocale="fr">
      <Cover item={{ ...items[0], coverUrl: "local-cover:localized" }} />
      <StarRating rating={9} editable />
    </LocalizationProvider>,
  );
  await waitFor(() =>
    expect(screen.getByAltText("Couverture de Galaxy Quest")).toBeDefined(),
  );
  expect(screen.getByLabelText("9 sur 10")).toBeDefined();
  expect(screen.getByRole("button", { name: "Noter 9 sur 10" })).toBeDefined();
});
