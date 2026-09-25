import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { DetailPanel } from "./DetailPanel";
import { ItemEditor } from "./ItemEditor";
import { OnlineSearch } from "./OnlineSearch";
import { LocalizationProvider } from "./localization/Localization";
import { translate } from "./localization/format";
import type { Locale } from "./localization/locale";
import type { MediaItem } from "./types";

const item: MediaItem = {
  id: "one",
  title: "رحلة Étoile",
  category: "manga",
  subtype: "Manhwa",
  creator: "Auteur 原文",
  description: "Provider text remains untouched.",
  status: "Planning",
  favorite: false,
  dateAdded: "2026-01-01",
  notes: "Personal notes محفوظة",
  source: "Tenrai",
  sourceId: "provider-1",
  providerMetadata: { volumes: 12 },
};
const show = (locale: Locale, ui: React.ReactNode) =>
  render(
    <LocalizationProvider initialLocale={locale}>{ui}</LocalizationProvider>,
  );

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

for (const locale of ["en", "fr", "ar"] as const) {
  test(`${locale} details and edit preserve semantic status, subtype and user content`, () => {
    const save = vi.fn().mockReturnValue(true);
    show(
      locale,
      <DetailPanel
        item={item}
        returnLabel="Library"
        onClose={() => {}}
        onSave={save}
        onDelete={() => {}}
      />,
    );
    expect(
      screen.getByRole("article", {
        name: translate(locale, "details.entryDetails"),
      }),
    ).toBeDefined();
    expect(screen.getByText(item.title)).toBeDefined();
    expect(screen.getByText(item.description!)).toBeDefined();
    expect(screen.getByText(item.notes!)).toBeDefined();
    expect(screen.getByText("Tenrai", { exact: false })).toBeDefined();
    const quickStatus = screen.getByLabelText(
      translate(locale, "details.status"),
    ) as HTMLSelectElement;
    expect(quickStatus.value).toBe("Planning");
    fireEvent.change(quickStatus, { target: { value: "Completed" } });
    expect(save.mock.calls[0][0].status).toBe("Completed");
    fireEvent.click(
      screen.getByRole("button", { name: translate(locale, "details.edit") }),
    );
    expect(
      (
        screen.getByLabelText(
          translate(locale, "editor.type"),
        ) as HTMLSelectElement
      ).value,
    ).toBe("Manhwa");
    const notes = screen.getByLabelText(
      translate(locale, "details.myNotes"),
    ) as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: "New user note" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: translate(locale, "details.saveChanges"),
      }),
    );
    expect(save.mock.calls.at(-1)![0].notes).toBe("New user note");
    expect(save.mock.calls.at(-1)![0].subtype).toBe("Manhwa");
    expect(save.mock.calls.at(-1)![0].providerMetadata.volumes).toBe(12);
  });

  test(`${locale} manual Add preserves canonical option values`, () => {
    show(
      locale,
      <ItemEditor
        initial={{ ...item, title: "" }}
        onClose={() => {}}
        onSave={() => {}}
        onConfigure={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: translate(locale, "editor.manualEntry"),
      }),
    );
    expect(
      screen.getByRole("dialog", {
        name: translate(locale, "editor.addEntry"),
      }),
    ).toBeDefined();
    expect(
      (
        screen.getByLabelText(
          translate(locale, "editor.type"),
        ) as HTMLSelectElement
      ).value,
    ).toBe("Manhwa");
    expect(
      (
        screen.getByLabelText(
          translate(locale, "details.status"),
        ) as HTMLSelectElement
      ).value,
    ).toBe("Planning");
  });
}

function bridge(response: unknown) {
  const searchChain = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("everiaProviders", {
    status: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        id: "igdb",
        name: "IGDB",
        categories: ["games"],
        available: true,
      },
    }),
    searchChain,
  });
  return searchChain;
}
function performSearch(locale: Locale) {
  fireEvent.change(
    screen.getByPlaceholderText(translate(locale, "search.placeholder")),
    { target: { value: "Sample" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: translate(locale, "search.action") }),
  );
}

test("valid empty provider response stays successful without failure actions", async () => {
  const call = bridge({
    ok: true,
    data: { provider: "igdb", providerName: "IGDB", results: [] },
  });
  show(
    "fr",
    <OnlineSearch
      category="games"
      setCategory={() => {}}
      onUse={() => {}}
      onConfigure={() => {}}
    />,
  );
  performSearch("fr");
  expect(
    await screen.findByText(translate("fr", "search.empty")),
  ).toBeDefined();
  expect(call).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("button", { name: translate("fr", "search.retry") }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: translate("fr", "search.configure") }),
  ).toBeNull();
});

for (const code of [
  "all-unavailable",
  "credentials",
  "timeout",
  "rate-limit",
  "network",
  "unavailable",
]) {
  test(`structured ${code} recovery ignores diagnostic wording`, async () => {
    bridge({
      ok: false,
      errorCode: code,
      error:
        "Manual Entry unavailable configure? arbitrary developer diagnostic",
    });
    const configure = vi.fn();
    show(
      "ar",
      <OnlineSearch
        category="games"
        setCategory={() => {}}
        onUse={() => {}}
        onConfigure={configure}
      />,
    );
    performSearch("ar");
    await screen.findByText(
      translate(
        "ar",
        code === "network"
          ? "search.unavailable"
          : code === "rate-limit"
            ? "search.rateLimit"
            : code === "all-unavailable"
              ? "search.allUnavailable"
              : code === "credentials"
                ? "search.credentials"
                : code === "timeout"
                  ? "search.timeout"
                  : "search.unavailable",
      ),
    );
    const config = screen.queryByRole("button", {
      name: translate("ar", "search.configure"),
    });
    expect(Boolean(config)).toBe(
      ["all-unavailable", "credentials", "unavailable", "network"].includes(
        code,
      ),
    );
    if (config) fireEvent.click(config);
    expect(configure).toHaveBeenCalledTimes(config ? 1 : 0);
    expect(
      Boolean(
        screen.queryByRole("button", { name: translate("ar", "search.retry") }),
      ),
    ).toBe(["timeout", "rate-limit", "network", "unavailable"].includes(code));
    expect(screen.queryByText(/arbitrary developer diagnostic/)).toBeNull();
  });
}

test("failed edit keeps localized error and unsaved draft", async () => {
  show(
    "fr",
    <DetailPanel
      item={item}
      returnLabel="Bibliothèque"
      onClose={() => {}}
      onSave={() => false}
      onDelete={() => {}}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: translate("fr", "details.edit") }),
  );
  fireEvent.change(screen.getByLabelText(translate("fr", "details.myNotes")), {
    target: { value: "Brouillon" },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: translate("fr", "details.saveChanges"),
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      translate("fr", "errors.changesSave"),
    ),
  );
  expect(screen.getByDisplayValue("Brouillon")).toBeDefined();
});

test("fallback notice, source attribution and preview retain provider content", async () => {
  bridge({
    ok: true,
    data: {
      provider: "rawg",
      providerName: "RAWG",
      fallbackFrom: "IGDB",
      results: [
        {
          provider: "rawg",
          providerName: "RAWG",
          providerId: "7",
          category: "games",
          title: "Nom 原文",
          creator: "Studio X",
          metadata: { volumes: 2 },
        },
      ],
    },
  });
  show(
    "fr",
    <OnlineSearch
      category="games"
      setCategory={() => {}}
      onUse={() => {}}
      onConfigure={() => {}}
    />,
  );
  performSearch("fr");
  expect(
    await screen.findByText(
      translate("fr", "search.fallback", { from: "IGDB", to: "RAWG" }),
    ),
  ).toBeDefined();
  expect(screen.getByText("Nom 原文")).toBeDefined();
  expect(screen.getByText("Studio X · 2 tomes")).toBeDefined();
  expect(screen.getByRole("link", { name: "RAWG" }).getAttribute("href")).toBe(
    "https://rawg.io/",
  );
});

test("preview detail failure offers retry and return without diagnostic prose", async () => {
  bridge({
    ok: true,
    data: {
      provider: "igdb",
      providerName: "IGDB",
      results: [
        {
          provider: "igdb",
          providerName: "IGDB",
          providerId: "7",
          category: "games",
          title: "Entry",
        },
      ],
    },
  });
  window.everiaProviders!.details = vi.fn().mockResolvedValue({
    ok: false,
    errorCode: "timeout",
    error: "secret diagnostic Manual Entry",
  });
  show(
    "fr",
    <OnlineSearch
      category="games"
      setCategory={() => {}}
      onUse={() => {}}
      onConfigure={() => {}}
    />,
  );
  performSearch("fr");
  fireEvent.click(await screen.findByRole("button", { name: /Entry/ }));
  fireEvent.click(
    screen.getByRole("button", { name: translate("fr", "search.useEntry") }),
  );
  expect(
    await screen.findByText(translate("fr", "search.detailsUnavailable")),
  ).toBeDefined();
  expect(
    screen.getByRole("button", { name: translate("fr", "search.retry") }),
  ).toBeDefined();
  fireEvent.click(
    screen.getByRole("button", {
      name: translate("fr", "search.backToResults"),
    }),
  );
  expect(screen.getByRole("button", { name: /Entry/ })).toBeDefined();
  expect(screen.queryByText(/secret diagnostic/)).toBeNull();
});
