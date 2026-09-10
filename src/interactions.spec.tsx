import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import "fake-indexeddb/auto";
import App from "./App";
import { storeCover, readCover, readWallpaper } from "./covers";
import { Cover } from "./Cover";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
test("details are read-only until Edit, then save status, rating and notes", async () => {
  const app = render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Games/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  fireEvent.click(screen.getByRole("button", { name: "Manual entry" }));
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Offline adventure" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Save to library/ }));
  await screen.findByRole("article", { name: "Entry details" });
  expect(screen.queryByRole("dialog", { name: "Entry details" })).toBeNull();
  expect(screen.getByRole("complementary")).toBeDefined();
  fireEvent.change(screen.getByLabelText("Status"), {
    target: { value: "Completed" },
  });
  expect(JSON.parse(localStorage.getItem("everia.items.v1")!)[0].status).toBe(
    "Completed",
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("My notes"), {
    target: { value: "Keep these notes" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Rate 9 out of 10" }));
  fireEvent.click(screen.getByRole("button", { name: /Save Changes/ }));
  expect(screen.getAllByText("Played").length).toBeGreaterThan(0);
  expect(screen.getByLabelText("9 out of 10")).toBeDefined();
  app.unmount();
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Games/ }));
  fireEvent.click(
    screen.getByRole("button", { name: /Open Offline adventure/ }),
  );
  expect(screen.getAllByText("Played").length).toBeGreaterThan(0);
  expect(screen.getByText("Keep these notes")).toBeDefined();
  expect(screen.queryByLabelText("My notes")).toBeNull();
});

test("Home artwork resolves from the app document and outer branding is removed", () => {
  const { container } = render(<App />);
  expect(container.querySelector(".home-header")).toBeNull();
  const cards = [...container.querySelectorAll<HTMLElement>(".category-card")];
  expect(cards).toHaveLength(6);
  for (const card of cards) {
    expect(card.style.getPropertyValue("--category-art")).toContain(
      "/assets/categories/",
    );
  }
  const shell = container.querySelector<HTMLElement>(".app-shell")!;
  expect(shell.style.getPropertyValue("--app-wallpaper")).toContain(
    "/assets/backgrounds/everia-default.png",
  );
});

test("interior artwork follows category while the sidebar uses the UI mark", () => {
  const { container } = render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Games/ }));
  const shell = container.querySelector<HTMLElement>(".app-shell")!;
  expect(shell.className).toContain("interior-art-view");
  expect(shell.style.getPropertyValue("--interior-art")).toContain(
    "/assets/categories/games.png",
  );
  const sidebarMark =
    container.querySelector<HTMLImageElement>(".brand-mark img")!;
  expect(sidebarMark.src).toContain("/assets/branding/everia-ui-mark.png");
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(shell.style.getPropertyValue("--interior-art")).toContain(
    "/assets/backgrounds/everia-default.png",
  );
});

test("online source failure leaves manual entry available", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Games/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  expect(
    await screen.findByText(/available in the Everia desktop app/i),
  ).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Manual entry" }));
  expect(screen.getByLabelText("Title")).toBeDefined();
});

test("provider initialization never blocks Add Item search", async () => {
  vi.stubGlobal("everiaProviders", {
    status: vi.fn().mockReturnValue(new Promise(() => {})),
    searchChain: vi.fn().mockResolvedValue({
      ok: true,
      data: { provider: "igdb", providerName: "IGDB", results: [] },
    }),
  });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Games/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  const query = await screen.findByPlaceholderText("Search by title...");
  expect((query as HTMLInputElement).disabled).toBe(false);
  fireEvent.change(query, { target: { value: "Ready" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(
    await screen.findByText("No matching entries were found."),
  ).toBeDefined();
  expect(screen.getByRole("button", { name: "Manual entry" })).toBeDefined();
});

test("normalized online result opens a preview then the existing manual review form", async () => {
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
    searchChain: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        provider: "igdb",
        providerName: "IGDB",
        results: [
          {
            provider: "igdb",
            providerName: "IGDB",
            providerId: "1",
            category: "games",
            title: "Online game",
            cacheCover: false,
          },
        ],
      },
    }),
    details: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        provider: "igdb",
        providerName: "IGDB",
        providerId: "1",
        providerUrl: "https://www.igdb.com/games/online-game",
        category: "games",
        title: "Online game",
        creator: "Example studio",
        description: "Imported preview details.",
        cacheCover: false,
      },
    }),
    downloadImage: vi.fn(),
  });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Games/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  const query = await screen.findByPlaceholderText("Search by title...");
  fireEvent.change(query, { target: { value: "Online" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(await screen.findByRole("button", { name: /Online game/ }));
  expect(
    await screen.findByRole("region", { name: "Import preview" }),
  ).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Use this entry" }));
  expect(
    ((await screen.findByLabelText("Title")) as HTMLInputElement).value,
  ).toBe("Online game");
  expect(screen.getByText(/metadata loaded/i)).toBeDefined();
});

test("Online Sources saves secrets through IPC and clears the password field", async () => {
  const saveCredentials = vi.fn().mockResolvedValue({
    ok: true,
    data: { id: "tmdb", state: "connected" },
  });
  vi.stubGlobal("everiaProviders", {
    configuration: vi.fn().mockResolvedValue({
      ok: true,
      data: [
        {
          id: "igdb",
          name: "IGDB",
          categories: ["games"],
          requiresCredentials: true,
          configured: false,
          state: "not-configured",
        },
        {
          id: "tmdb",
          name: "TMDB",
          categories: ["movies", "tv-series"],
          requiresCredentials: true,
          configured: false,
          state: "not-configured",
        },
        {
          id: "ranobedb",
          name: "RanobeDB",
          categories: ["novels"],
          requiresCredentials: false,
          configured: true,
          state: "connected",
        },
        {
          id: "jikan",
          name: "Jikan",
          categories: ["anime", "manga"],
          requiresCredentials: false,
          configured: true,
          state: "connected",
        },
      ],
    }),
    saveCredentials,
    testConnection: vi.fn(),
    removeCredentials: vi.fn(),
  });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const token = await screen.findByLabelText("API Read Access Token");
  fireEvent.change(token, { target: { value: "private-token" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save / Connect" })[1]);
  await waitFor(() =>
    expect(saveCredentials).toHaveBeenCalledWith({
      provider: "tmdb",
      credentials: { token: "private-token" },
    }),
  );
  expect((token as HTMLInputElement).value).toBe("");
  expect(screen.getByAltText("The Movie Database (TMDB)")).toBeDefined();
});
test("Escape closes add dialog", () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Games/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  fireEvent.click(screen.getByRole("button", { name: "Manual entry" }));
  fireEvent.keyDown(screen.getByLabelText("Title"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});
test("local cover survives database reopen and renders without network", async () => {
  // Image decoding is browser-only; storage itself uses an IndexedDB test implementation.
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ close() {} }));
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("everia-assets");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  const oldCover = new File(["v0.1 cover bytes"], "old.png", {
    type: "image/png",
  });
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("everia-assets", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("covers");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("covers", "readwrite");
      transaction.objectStore("covers").put(oldCover, "local-cover:v01");
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  });
  expect(await readCover("local-cover:v01")).toBeDefined();
  const fetchMock = vi.fn().mockRejectedValue(new Error("Offline"));
  vi.stubGlobal("fetch", fetchMock);
  const id = await storeCover(
    new File(["fixture bytes"], "cover.png", { type: "image/png" }),
  );
  expect(await readCover(id)).toBeDefined();
  URL.createObjectURL = vi.fn().mockReturnValue("blob:local-test");
  URL.revokeObjectURL = vi.fn();
  render(
    <Cover
      item={{
        id: "1",
        title: "Test",
        category: "games",
        status: "Planning",
        favorite: false,
        dateAdded: "2026-09-08",
        coverUrl: id,
      }}
    />,
  );
  await waitFor(() =>
    expect(screen.getByAltText("Cover of Test").getAttribute("src")).toBe(
      "blob:local-test",
    ),
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
test("rejects unsafe cover URL and unsupported file", async () => {
  await expect(storeCover("http://example.com/image.png")).rejects.toThrow(
    "HTTPS",
  );
  await expect(
    storeCover(new File(["text"], "file.txt", { type: "text/plain" })),
  ).rejects.toThrow("PNG");
});
test("search filters entries and canceled deletion preserves data", () => {
  localStorage.setItem(
    "everia.items.v1",
    JSON.stringify([
      {
        id: "1",
        title: "Searchable game",
        category: "games",
        status: "Planning",
        favorite: true,
        dateAdded: "2026-09-08",
      },
    ]),
  );
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Games/ }));
  fireEvent.change(screen.getByLabelText("Search your universe"), {
    target: { value: "missing" },
  });
  expect(screen.queryByRole("button", { name: /Searchable game/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("Search your universe"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Open Searchable game/ }));
  vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: /Remove from Everia/ }));
  expect(JSON.parse(localStorage.getItem("everia.items.v1")!)).toHaveLength(1);
});

test("status filters and per-category view preferences work and persist", () => {
  localStorage.setItem(
    "everia.items.v1",
    JSON.stringify([
      {
        id: "1",
        title: "Playing now",
        category: "games",
        status: "In progress",
        favorite: false,
        dateAdded: "2026-09-08",
      },
      {
        id: "2",
        title: "Finished",
        category: "games",
        status: "Completed",
        favorite: false,
        dateAdded: "2026-09-07",
      },
    ]),
  );
  const app = render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Games/ }));
  fireEvent.click(screen.getByRole("button", { name: "Playing" }));
  expect(
    screen.getByRole("button", { name: /Open Playing now/ }),
  ).toBeDefined();
  expect(screen.queryByRole("button", { name: /Open Finished/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "List view" }));
  expect(document.querySelector(".item-list")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  expect(screen.getByRole("button", { name: "Grid view" }).className).toBe(
    "active",
  );
  app.unmount();
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Games/ }));
  expect(screen.getByRole("button", { name: "List view" }).className).toBe(
    "active",
  );
});

test("returning from details preserves library query, filter, sort and view", async () => {
  const scrollMock = vi
    .spyOn(window, "scrollTo")
    .mockImplementation(() => undefined);
  localStorage.setItem(
    "everia.items.v1",
    JSON.stringify([
      {
        id: "1",
        title: "Alpha world",
        creator: "Studio",
        category: "games",
        status: "In progress",
        favorite: false,
        dateAdded: "2026-09-08",
      },
    ]),
  );
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Games/ }));
  fireEvent.change(screen.getByLabelText("Search your universe"), {
    target: { value: "Alpha" },
  });
  fireEvent.change(screen.getByLabelText("Sort by"), {
    target: { value: "title" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Playing" }));
  fireEvent.click(screen.getByRole("button", { name: "List view" }));
  fireEvent.click(screen.getByRole("button", { name: /Open Alpha world/ }));
  expect(screen.queryByLabelText("Search your universe")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back to Games" }));
  expect(
    (screen.getByLabelText("Search your universe") as HTMLInputElement).value,
  ).toBe("Alpha");
  expect((screen.getByLabelText("Sort by") as HTMLSelectElement).value).toBe(
    "title",
  );
  expect(screen.getByRole("button", { name: "Playing" }).className).toBe(
    "active",
  );
  expect(screen.getByRole("button", { name: "List view" }).className).toBe(
    "active",
  );
  await waitFor(() => expect(scrollMock).toHaveBeenCalled());
});

test("custom wallpaper is copied into local storage", async () => {
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ close() {} }));
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.change(screen.getByLabelText("Choose custom wallpaper"), {
    target: {
      files: [new File(["wallpaper bytes"], "mine.png", { type: "image/png" })],
    },
  });
  await waitFor(() =>
    expect(
      JSON.parse(localStorage.getItem("everia.theme.v1")!).backgroundMode,
    ).toBe("custom"),
  );
  const saved = JSON.parse(localStorage.getItem("everia.theme.v1")!);
  expect(saved.customWallpaperId).toMatch(/^local-wallpaper:/);
  expect(await readWallpaper(saved.customWallpaperId)).toBeDefined();
  expect(localStorage.getItem("everia.theme.v1")).not.toContain("mine.png");
});

test("legacy v0.1 appearance migrates and Cancel discards entry edits", () => {
  localStorage.setItem(
    "everia.theme.v1",
    JSON.stringify({
      accent: "#112233",
      background: "#081016",
      text: "#ddeeff",
    }),
  );
  localStorage.setItem(
    "everia.items.v1",
    JSON.stringify([
      {
        id: "old",
        title: "Kept title",
        category: "games",
        status: "Planning",
        rating: 8,
        notes: "Kept note",
        favorite: true,
        dateAdded: "2026-01-01",
      },
    ]),
  );
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Games/ }));
  fireEvent.click(screen.getByRole("button", { name: /Open Kept title/ }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Discard me" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("heading", { name: "Kept title" })).toBeDefined();
  expect(JSON.parse(localStorage.getItem("everia.items.v1")!)[0].title).toBe(
    "Kept title",
  );
  expect(
    JSON.parse(localStorage.getItem("everia.theme.v1")!).backgroundMode,
  ).toBe("default");
});
