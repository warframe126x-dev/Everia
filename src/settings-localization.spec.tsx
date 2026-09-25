import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { LocalizationProvider } from "./localization/Localization";
import { translate } from "./localization/format";
import type { Locale } from "./localization/locale";
import { SettingsView } from "./SettingsView";
import { defaultTheme } from "./data";

const providers = [
  {
    id: "igdb",
    name: "IGDB",
    role: "primary",
    categories: ["games"],
    requiresCredentials: true,
    configured: true,
    state: "connection-failed",
    reasonCode: "credential-unreadable",
  },
  {
    id: "rawg",
    name: "RAWG",
    role: "backup",
    categories: ["games"],
    requiresCredentials: true,
    configured: false,
    state: "not-configured",
  },
  {
    id: "tmdb",
    name: "TMDB",
    role: "primary",
    categories: ["movies", "tv-series"],
    requiresCredentials: true,
    configured: false,
    state: "not-configured",
  },
  {
    id: "jikan",
    name: "Jikan",
    role: "backup",
    categories: ["anime", "manga"],
    requiresCredentials: false,
    configured: true,
    state: "connected",
  },
];
function bridge() {
  const saveCredentials = vi.fn().mockResolvedValue({
    ok: false,
    errorCode: "credential-unreadable",
    error: "untranslated developer diagnostic",
  });
  const configuration = vi
    .fn()
    .mockResolvedValue({ ok: true, data: providers });
  vi.stubGlobal("everiaProviders", {
    configuration,
    saveCredentials,
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
    removeCredentials: vi.fn().mockResolvedValue({ ok: true }),
  });
  return { saveCredentials };
}
const show = (locale: Locale) =>
  render(
    <LocalizationProvider initialLocale={locale}>
      <SettingsView theme={defaultTheme} setTheme={() => {}} />
    </LocalizationProvider>,
  );
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

for (const locale of ["en", "fr", "ar"] as const) {
  test(`${locale} Settings and Online Sources render localized labels and preserve provider names`, async () => {
    bridge();
    show(locale);
    expect(
      screen.getByRole("heading", {
        name: translate(locale, "settings.appearance"),
      }),
    ).toBeDefined();
    expect(
      screen.getByLabelText(translate(locale, "settings.accentColor")),
    ).toBeDefined();
    expect(
      screen.getByLabelText(translate(locale, "settings.dimming")),
    ).toBeDefined();
    expect(await screen.findByRole("heading", { name: "IGDB" })).toBeDefined();
    expect(
      screen.getByRole("heading", { name: "IGDB" }).getAttribute("dir"),
    ).toBe("ltr");
    expect(
      (
        screen.getByLabelText(
          translate(locale, "providers.clientId"),
        ) as HTMLInputElement
      ).dir,
    ).toBe("ltr");
    expect(
      (
        screen.getByLabelText(
          translate(locale, "providers.clientSecret"),
        ) as HTMLInputElement
      ).dir,
    ).toBe("ltr");
    expect(screen.getByRole("heading", { name: "RAWG" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Jikan" })).toBeDefined();
    expect(
      screen.getAllByText(translate(locale, "providers.primary")),
    ).toHaveLength(2);
    expect(
      screen.getAllByText(translate(locale, "providers.backup")),
    ).toHaveLength(2);
    expect(
      screen.getByText(translate(locale, "providers.credentialUnreadable")),
    ).toBeDefined();
    expect(screen.getByAltText("The Movie Database (TMDB)")).toBeDefined();
  });
}

test("language selector persists only semantic locale values and updates Settings immediately", () => {
  bridge();
  show("en");
  const select = screen.getByLabelText("Language") as HTMLSelectElement;
  expect(
    [...select.options].map((option) => [option.value, option.textContent]),
  ).toEqual([
    ["en", "English"],
    ["fr", "Français"],
    ["ar", "العربية"],
  ]);
  fireEvent.change(select, { target: { value: "fr" } });
  expect(localStorage.getItem("everia.locale.v1")).toBe('"fr"');
  expect(document.documentElement.lang).toBe("fr");
  expect(document.documentElement.dir).toBe("ltr");
  expect(screen.getByRole("heading", { name: "Apparence" })).toBeDefined();
  fireEvent.change(screen.getByLabelText("Langue"), {
    target: { value: "ar" },
  });
  expect(localStorage.getItem("everia.locale.v1")).toBe('"ar"');
  expect(document.documentElement.lang).toBe("ar");
  expect(document.documentElement.dir).toBe("rtl");
});

test("credential error code localizes without rendering diagnostic or altering secret", async () => {
  const { saveCredentials } = bridge();
  show("fr");
  const input = await screen.findByLabelText(
    translate("fr", "providers.readToken"),
  );
  fireEvent.change(input, { target: { value: "private-value" } });
  fireEvent.click(
    screen.getAllByRole("button", {
      name: translate("fr", "providers.saveConnect"),
    })[2],
  );
  await waitFor(() =>
    expect(saveCredentials).toHaveBeenCalledWith({
      provider: "tmdb",
      credentials: { token: "private-value" },
    }),
  );
  expect((input as HTMLInputElement).value).toBe("");
  expect(screen.queryByText("untranslated developer diagnostic")).toBeNull();
  expect(
    screen.getAllByText(translate("fr", "providers.credentialUnreadable"))
      .length,
  ).toBeGreaterThan(0);
});
test("failed locale persistence retains selection and shows localized error", () => {
  bridge();
  show("fr");
  const native = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(
    function (key, value) {
      if (key === "everia.locale.v1") throw new Error("disk full diagnostic");
      return native.call(this, key, value);
    },
  );
  fireEvent.change(screen.getByLabelText("Langue"), {
    target: { value: "ar" },
  });
  expect((screen.getByLabelText("Langue") as HTMLSelectElement).value).toBe(
    "fr",
  );
  expect(screen.getByRole("alert").textContent).toBe(
    translate("fr", "errors.localeSave"),
  );
  expect(screen.queryByText(/disk full diagnostic/)).toBeNull();
});
