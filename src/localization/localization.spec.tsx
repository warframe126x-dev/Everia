import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { storage } from "../storage";
import { locales, type Locale } from "./locale";
import { LocalizationProvider, useLocalization } from "./Localization";
import { ar, en, fr, type PluralMessage } from "./catalogs";
import {
  formatCount,
  formatDate,
  formatNumber,
  messageFor,
  translate,
} from "./format";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.lang = "en";
  vi.restoreAllMocks();
});

const parameters = (text: string) =>
  [...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)]
    .map((match) => match[1])
    .sort();

test("all supported catalogs have English's exact keys and interpolation parameters", () => {
  expect(locales).toEqual(["en", "fr", "ar"]);
  for (const catalog of [fr, ar]) {
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const canonical = en[key];
      const translated = catalog[key];
      expect(typeof translated).toBe(typeof canonical);
      if (typeof canonical === "string" && typeof translated === "string") {
        expect(parameters(translated)).toEqual(parameters(canonical));
      } else if (
        typeof canonical !== "string" &&
        typeof translated !== "string"
      ) {
        const expected = parameters(canonical.other);
        expect(translated.other).toBeTruthy();
        for (const form of Object.values(translated as PluralMessage))
          expect(parameters(form)).toEqual(expected);
      }
    }
  }
});

test("interpolation, English fallback, numbers, dates and Arabic plural forms", () => {
  expect(translate("fr", "common.savedFor", { name: "Amélie" })).toBe(
    "Enregistré pour Amélie",
  );
  expect(messageFor("fr", "common.cancel", { fr: {} })).toBe("Cancel");
  expect(formatCount("en", "home.entryCount", 1)).toBe("1 entry");
  expect(formatCount("en", "home.entryCount", 2)).toBe("2 entries");
  expect(formatCount("fr", "home.entryCount", 2)).toBe("2 entrées");
  for (const [amount, category] of [
    [0, "zero"],
    [1, "one"],
    [2, "two"],
    [3, "few"],
    [11, "many"],
    [100, "other"],
  ] as const) {
    expect(new Intl.PluralRules("ar").select(amount)).toBe(category);
    expect(formatCount("ar", "home.entryCount", amount)).toBe(
      (ar["home.entryCount"] as PluralMessage)[category]!.replace(
        "{count}",
        formatNumber("ar", amount),
      ),
    );
  }
  expect(formatNumber("fr", 1234.5)).toBe(
    new Intl.NumberFormat("fr").format(1234.5),
  );
  const date = new Date("2026-09-25T12:00:00Z");
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "long",
    timeZone: "UTC",
  };
  for (const locale of locales)
    expect(formatDate(locale, date, options)).toBe(
      new Intl.DateTimeFormat(locale, options).format(date),
    );
});

test("missing, invalid and unreadable locale storage falls back without blocking startup", () => {
  expect(storage.loadLocale()).toBe("en");
  for (const malformed of ["not-json", "null", '"es"', "{}", "42"]) {
    localStorage.setItem("everia.locale.v1", malformed);
    expect(storage.loadLocale()).toBe("en");
  }
  for (const locale of locales) {
    storage.saveLocale(locale);
    expect(storage.loadLocale()).toBe(locale);
  }
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  expect(storage.loadLocale()).toBe("en");
});

let switchLocale: (next: Locale) => void;
function Probe() {
  const { locale, direction, setLocale, t, count, number, date } =
    useLocalization();
  switchLocale = setLocale;
  return (
    <div>
      <span data-testid="current">
        {locale}:{direction}
      </span>
      <span data-testid="translated">{t("common.cancel")}</span>
      <span data-testid="count">{count("home.entryCount", 2)}</span>
      <span data-testid="number">{number(1234)}</span>
      <span data-testid="date">
        {date(new Date("2026-09-25T12:00:00Z"), { timeZone: "UTC" })}
      </span>
      <button onClick={() => setLocale("ar")}>Switch to Arabic</button>
    </div>
  );
}

test("provider loads persisted locale, switches and synchronizes document language across remounts", () => {
  let app = render(
    <LocalizationProvider>
      <Probe />
    </LocalizationProvider>,
  );
  expect(screen.getByTestId("current").textContent).toBe("en:ltr");
  expect(document.documentElement.lang).toBe("en");
  app.unmount();
  storage.saveLocale("fr");
  app = render(
    <LocalizationProvider>
      <Probe />
    </LocalizationProvider>,
  );
  expect(screen.getByTestId("translated").textContent).toBe("Annuler");
  expect(document.documentElement.lang).toBe("fr");
  fireEvent.click(screen.getByRole("button", { name: "Switch to Arabic" }));
  expect(screen.getByTestId("current").textContent).toBe("ar:rtl");
  expect(screen.getByTestId("count").textContent).toBe(
    formatCount("ar", "home.entryCount", 2),
  );
  expect(screen.getByTestId("number").textContent).toBe(
    formatNumber("ar", 1234),
  );
  expect(screen.getByTestId("date").textContent).toBe(
    formatDate("ar", new Date("2026-09-25T12:00:00Z"), { timeZone: "UTC" }),
  );
  expect(document.documentElement.lang).toBe("ar");
  // RTL document layout is deliberately deferred to Stage 3.
  expect(document.documentElement.dir).not.toBe("rtl");
  expect(storage.loadLocale()).toBe("ar");
  app.unmount();
  render(
    <LocalizationProvider>
      <Probe />
    </LocalizationProvider>,
  );
  expect(screen.getByTestId("current").textContent).toBe("ar:rtl");
});

test("a failed locale write leaves the current locale active", () => {
  render(
    <LocalizationProvider>
      <Probe />
    </LocalizationProvider>,
  );
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("disk full");
  });
  expect(() => switchLocale("ar")).toThrow("disk full");
  expect(screen.getByTestId("current").textContent).toBe("en:ltr");
  expect(document.documentElement.lang).toBe("en");
});
