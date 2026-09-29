import { afterEach, expect, test, vi } from "vitest";
import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { LocalizationProvider } from "./localization/Localization";
import { translate } from "./localization/format";
import { createBackup } from "./backup";
import type { Locale } from "./localization/locale";
import App from "./App";

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
    testDraftCredentials: vi
      .fn()
      .mockResolvedValue({ ok: false, errorCode: "credential-unreadable" }),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
    removeCredentials: vi.fn().mockResolvedValue({ ok: true }),
  });
  return { saveCredentials };
}
const show = (locale: Locale) => {
  localStorage.setItem("everia.locale.v1", JSON.stringify(locale));
  const result = render(
    <LocalizationProvider initialLocale={locale}>
      <App />
    </LocalizationProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: translate(locale, "navigation.settings"),
    }),
  );
  return result;
};
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

for (const locale of ["en", "fr", "ar"] as const) {
  test(`${locale} scale control previews every supported value without persisting and keeps direction`, async () => {
    bridge();
    const setInterfaceScale = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("everiaWindow", {
      setInterfaceScale,
      onResponsiveScale: () => () => {},
    });
    show(locale);
    const select = screen.getByLabelText(
      translate(locale, "settings.interfaceScale"),
    ) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "100%",
      "110%",
      "125%",
    ]);
    for (const scale of ["1.1", "1.25", "1"]) {
      fireEvent.change(select, { target: { value: scale } });
      await waitFor(() =>
        expect(setInterfaceScale).toHaveBeenLastCalledWith(Number(scale)),
      );
      expect(localStorage.getItem("everia.interface-scale.v1")).toBeNull();
      expect(document.documentElement.dir).toBe(
        locale === "ar" ? "rtl" : "ltr",
      );
    }
  });
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

  test(`${locale} Settings form controls keep native semantics with independent indicators and start-aligned content`, () => {
    bridge();
    const { container } = show(locale);
    const language = screen.getByLabelText(
      translate(locale, "settings.language"),
    ) as HTMLSelectElement;
    const imageFit = screen.getByLabelText(
      translate(locale, "settings.imageFit"),
    ) as HTMLSelectElement;
    for (const select of [language, imageFit]) {
      const wrapper = select.closest(".control-select")!;
      expect(wrapper.querySelector("svg[aria-hidden='true']")).toBeTruthy();
      expect(wrapper.querySelectorAll("select")).toHaveLength(1);
    }
    fireEvent.change(imageFit, { target: { value: "contain" } });
    expect((imageFit as HTMLSelectElement).value).toBe("contain");
    expect(localStorage.getItem("everia.theme.v1")).toBeNull();
    const file = screen.getByLabelText(
      translate(locale, "settings.chooseWallpaper"),
    ) as HTMLInputElement;
    expect(file.type).toBe("file");
    expect(file.accept).toContain("image/png");
    const background = container.querySelector(".background-modes button")!;
    expect(background.querySelector("strong")).toBeTruthy();
    expect(background.querySelector("span")).toBeTruthy();
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
  });
}

test("a persisted former 150% choice starts at the supported 100% default", async () => {
  bridge();
  localStorage.setItem("everia.interface-scale.v1", "1.5");
  const setInterfaceScale = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("everiaWindow", {
    setInterfaceScale,
    onResponsiveScale: () => () => {},
  });
  show("en");
  expect(
    (screen.getByLabelText("Interface Scale") as HTMLSelectElement).value,
  ).toBe("1");
  await waitFor(() => expect(setInterfaceScale).toHaveBeenCalledWith(1));
});

test("scale Apply persists; dirty navigation Discard restores the committed zoom", async () => {
  bridge();
  const setInterfaceScale = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("everiaWindow", {
    setInterfaceScale,
    onResponsiveScale: () => () => {},
  });
  show("en");
  const scale = screen.getByLabelText("Interface Scale") as HTMLSelectElement;
  fireEvent.change(scale, { target: { value: "1.25" } });
  expect(localStorage.getItem("everia.interface-scale.v1")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Keep Editing" }));
  expect(
    (screen.getByLabelText("Interface Scale") as HTMLSelectElement).value,
  ).toBe("1.25");
  fireEvent.click(screen.getByRole("button", { name: "Apply Changes" }));
  await waitFor(() =>
    expect(localStorage.getItem("everia.interface-scale.v1")).toBe("1.25"),
  );
  fireEvent.change(screen.getByLabelText("Interface Scale"), {
    target: { value: "1.1" },
  });
  await waitFor(() => expect(setInterfaceScale).toHaveBeenLastCalledWith(1.1));
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Discard Changes",
    }),
  );
  await waitFor(() => expect(setInterfaceScale).toHaveBeenLastCalledWith(1.25));
  expect(localStorage.getItem("everia.interface-scale.v1")).toBe("1.25");
});

test("restart loads only applied scale, and a failed Apply retains its preview", async () => {
  bridge();
  localStorage.setItem("everia.interface-scale.v1", "1.1");
  const setInterfaceScale = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("everiaWindow", {
    setInterfaceScale,
    onResponsiveScale: () => () => {},
  });
  const mounted = show("en");
  expect(
    (screen.getByLabelText("Interface Scale") as HTMLSelectElement).value,
  ).toBe("1.1");
  fireEvent.change(screen.getByLabelText("Interface Scale"), {
    target: { value: "1.25" },
  });
  expect(localStorage.getItem("everia.interface-scale.v1")).toBe("1.1");
  mounted.unmount();
  show("en");
  expect(
    (screen.getByLabelText("Interface Scale") as HTMLSelectElement).value,
  ).toBe("1.1");
  fireEvent.change(screen.getByLabelText("Interface Scale"), {
    target: { value: "1.25" },
  });
  const native = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(
    function (key, value) {
      if (key === "everia.interface-scale.v1") throw Error("write failed");
      return native.call(this, key, value);
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Apply Changes" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      translate("en", "settings.applyFailure"),
    ),
  );
  expect(
    (screen.getByLabelText("Interface Scale") as HTMLSelectElement).value,
  ).toBe("1.25");
  expect(localStorage.getItem("everia.interface-scale.v1")).toBe("1.1");
  expect(setInterfaceScale).toHaveBeenLastCalledWith(1.25);
});

for (const locale of ["en", "fr", "ar"] as const) {
  test(`${locale} validated Restore uses a themed dialog, cancel and Escape do not restore`, async () => {
    bridge();
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("__APP_VERSION__", "1.0.0");
    const backup = await createBackup("1.0.0");
    const beginRestore = vi.fn();
    const selectBackup = vi.fn().mockResolvedValue(backup);
    vi.stubGlobal("everiaBackup", {
      config: vi.fn().mockResolvedValue({
        enabled: true,
        destination: "C:\\Backups",
        lastSuccess: null,
        lastFailure: null,
        version: 1,
        destinationSelected: false,
      }),
      systemDrive: vi.fn().mockResolvedValue("C:\\"),
      selectBackup,
      beginRestore,
    });
    const nativeConfirm = vi.spyOn(window, "confirm").mockImplementation(() => {
      throw Error("Native dialog used");
    });
    show(locale);
    fireEvent.click(
      await screen.findByRole("button", {
        name: translate(locale, "backup.restore"),
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe(
      "restore-confirm-title",
    );
    expect(
      within(dialog).getByText(translate(locale, "backup.confirmRestore")),
    ).toBeDefined();
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: translate(locale, "backup.cancelRestore"),
      }),
    );
    expect(beginRestore).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: translate(locale, "backup.restore") }),
    );
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(beginRestore).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(selectBackup).toHaveBeenCalledTimes(2);
  });
}

test("Restore confirmation invokes the validated recovery engine once and surfaces failure", async () => {
  bridge();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("__APP_VERSION__", "1.0.0");
  const backup = await createBackup("1.0.0");
  let journal: { version: 2; backup: string; raw: (string | null)[] } | null =
    null;
  let firstFinish = true;
  const beginRestore = vi.fn(async (snapshot) => {
    journal = { version: 2, ...snapshot };
  });
  vi.stubGlobal("everiaBackup", {
    config: vi.fn().mockResolvedValue({
      enabled: true,
      destination: "C:\\Backups",
      lastSuccess: null,
      lastFailure: null,
      version: 1,
      destinationSelected: false,
    }),
    systemDrive: vi.fn().mockResolvedValue("C:\\"),
    selectBackup: vi.fn().mockResolvedValue(backup),
    beginRestore,
    pendingRestore: async () => journal,
    finishRestore: async () => {
      if (firstFinish) {
        firstFinish = false;
        throw Error("injected finish failure");
      }
      journal = null;
    },
  });
  show("en");
  fireEvent.click(
    await screen.findByRole("button", { name: "Restore Backup" }),
  );
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Restore Backup" }),
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Restore Backup" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(beginRestore).toHaveBeenCalledTimes(1);
  expect(journal).toBeNull();
  expect(
    screen.getByText(translate("en", "backup.restoreFailed")),
  ).toBeDefined();
});

test("language selector previews semantic locale values and persists only on Apply", async () => {
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
  expect(localStorage.getItem("everia.locale.v1")).toBe('"en"');
  expect(document.documentElement.lang).toBe("fr");
  expect(document.documentElement.dir).toBe("ltr");
  expect(screen.getByRole("heading", { name: "Apparence" })).toBeDefined();
  fireEvent.change(screen.getByLabelText("Langue"), {
    target: { value: "ar" },
  });
  expect(localStorage.getItem("everia.locale.v1")).toBe('"en"');
  expect(document.documentElement.lang).toBe("ar");
  expect(document.documentElement.dir).toBe("rtl");
  fireEvent.click(
    screen.getByRole("button", {
      name: translate("ar", "settings.applyChanges"),
    }),
  );
  await waitFor(() =>
    expect(localStorage.getItem("everia.locale.v1")).toBe('"ar"'),
  );
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
      name: translate("fr", "providers.testConnection"),
    })[2],
  );
  await waitFor(() =>
    expect(
      screen.getAllByText(translate("fr", "providers.credentialUnreadable"))
        .length,
    ).toBeGreaterThan(0),
  );
  expect(saveCredentials).not.toHaveBeenCalled();
  expect((input as HTMLInputElement).value).toBe("private-value");
  expect(screen.queryByText("untranslated developer diagnostic")).toBeNull();
  expect(
    screen.getAllByText(translate("fr", "providers.credentialUnreadable"))
      .length,
  ).toBeGreaterThan(0);
});
test("failed credential Apply reports a safe localized cause and keeps the pending secret", async () => {
  bridge();
  const applyDraftCredentials = vi.fn().mockResolvedValue({
    ok: false,
    errorCode: "protection-unavailable",
    error: "private-token",
  });
  vi.stubGlobal("everiaProviders", {
    ...window.everiaProviders,
    applyDraftCredentials,
  });
  show("ar");
  const input = await screen.findByLabelText(
    translate("ar", "providers.readToken"),
  );
  fireEvent.change(input, { target: { value: "private-token" } });
  fireEvent.click(
    screen.getByRole("button", {
      name: translate("ar", "settings.applyChanges"),
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      translate("ar", "providers.protectionUnavailable"),
    ),
  );
  expect((input as HTMLInputElement).value).toBe("private-token");
  expect(applyDraftCredentials).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("private-token")).toBeNull();
});
test("failed locale Apply retains draft and shows localized error", async () => {
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
  fireEvent.click(
    screen.getByRole("button", {
      name: translate("ar", "settings.applyChanges"),
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      translate("ar", "settings.applyFailure"),
    ),
  );
  expect(
    (
      screen.getByLabelText(
        translate("ar", "settings.language"),
      ) as HTMLSelectElement
    ).value,
  ).toBe("ar");
  expect(localStorage.getItem("everia.locale.v1")).toBe('"fr"');
  expect(screen.queryByText(/disk full diagnostic/)).toBeNull();
});

test("dirty Settings guards navigation with Keep Editing, Discard, and Apply", async () => {
  bridge();
  show("en");
  fireEvent.change(screen.getByLabelText("Language"), {
    target: { value: "ar" },
  });
  expect(document.documentElement.dir).toBe("rtl");
  fireEvent.click(
    screen.getByRole("button", { name: translate("ar", "navigation.home") }),
  );
  const dialog = screen.getByRole("dialog");
  fireEvent.click(
    screen.getByRole("button", {
      name: translate("ar", "settings.keepEditing"),
    }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole("heading", {
      name: translate("ar", "navigation.settings"),
    }),
  ).toBeDefined();
  fireEvent.click(
    screen.getByRole("button", { name: translate("ar", "navigation.home") }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: translate("ar", "settings.discardChanges"),
    }),
  );
  expect(document.documentElement.dir).toBe("ltr");
  expect(localStorage.getItem("everia.locale.v1")).toBe('"en"');
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.change(screen.getByLabelText("Language"), {
    target: { value: "fr" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: translate("fr", "navigation.home") }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: translate("fr", "settings.applyChanges"),
    }),
  );
  await waitFor(() =>
    expect(localStorage.getItem("everia.locale.v1")).toBe('"fr"'),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(dialog).toBeDefined();
});

test("backup location and automatic switch remain draft until Apply; OS-drive warning is factual", async () => {
  bridge();
  const setConfig = vi.fn().mockResolvedValue({});
  vi.stubGlobal("everiaBackup", {
    config: vi.fn().mockResolvedValue({
      enabled: true,
      destination: "C:\\Users\\Chris\\Documents\\Everia Backups",
      destinationSelected: false,
      lastSuccess: null,
      lastFailure: null,
      version: 1,
    }),
    systemDrive: vi.fn().mockResolvedValue("C:\\"),
    chooseDestination: vi.fn().mockResolvedValue("D:\\Everia Backups"),
    setConfig,
  });
  show("en");
  expect(
    await screen.findByText(translate("en", "backup.sameDriveWarning")),
  ).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Choose Location" }));
  await screen.findByText("D:\\Everia Backups");
  expect(
    screen.queryByText(translate("en", "backup.sameDriveWarning")),
  ).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Automatic backups" }));
  expect(setConfig).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply Changes" }));
  await waitFor(() =>
    expect(setConfig).toHaveBeenCalledWith({
      enabled: false,
      destination: "D:\\Everia Backups",
    }),
  );
});

test("dirty Settings must be resolved before Restore selects a backup", async () => {
  bridge();
  const selectBackup = vi.fn().mockResolvedValue("truncated backup");
  vi.stubGlobal("everiaBackup", {
    config: vi.fn().mockResolvedValue({
      enabled: true,
      destination: "C:\\Backups",
      destinationSelected: false,
      lastSuccess: null,
      lastFailure: null,
      version: 1,
    }),
    systemDrive: vi.fn().mockResolvedValue("C:\\"),
    selectBackup,
  });
  show("en");
  await screen.findByRole("button", { name: "Restore Backup" });
  fireEvent.change(screen.getByLabelText("Language"), {
    target: { value: "ar" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: translate("ar", "backup.restore") }),
  );
  expect(screen.getByRole("dialog")).toBeDefined();
  expect(selectBackup).not.toHaveBeenCalled();
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: translate("ar", "settings.keepEditing"),
    }),
  );
  expect(selectBackup).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: translate("ar", "backup.restore") }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: translate("ar", "settings.discardChanges"),
    }),
  );
  await waitFor(() => expect(selectBackup).toHaveBeenCalledTimes(1));
  expect(document.documentElement.dir).toBe("ltr");
  expect(localStorage.getItem("everia.locale.v1")).toBe('"en"');
  await screen.findByText(translate("en", "backup.invalid"));
});

test("failed Apply while navigating keeps the Settings draft and requested destination pending", async () => {
  bridge();
  show("en");
  fireEvent.change(screen.getByLabelText("Language"), {
    target: { value: "fr" },
  });
  const native = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(
    function (key, value) {
      if (key === "everia.locale.v1")
        throw new Error("disk full secret diagnostic");
      return native.call(this, key, value);
    },
  );
  fireEvent.click(
    screen.getByRole("button", { name: translate("fr", "navigation.home") }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: translate("fr", "settings.applyChanges"),
    }),
  );
  await waitFor(() => expect(screen.getByRole("dialog")).toBeDefined());
  expect(
    (
      screen.getByLabelText(
        translate("fr", "settings.language"),
      ) as HTMLSelectElement
    ).value,
  ).toBe("fr");
  expect(localStorage.getItem("everia.locale.v1")).toBe('"en"');
  expect(screen.queryByText("disk full secret diagnostic")).toBeNull();
});

test("reverted locale is clean and restart before Apply loads the committed locale", () => {
  bridge();
  const app = show("en");
  const apply = screen.getByRole("button", {
    name: "Apply Changes",
  }) as HTMLButtonElement;
  expect(apply.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Language"), {
    target: { value: "fr" },
  });
  expect(
    (
      screen.getByRole("button", {
        name: "Appliquer les modifications",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  fireEvent.change(screen.getByLabelText("Langue"), {
    target: { value: "en" },
  });
  expect(
    (screen.getByRole("button", { name: "Apply Changes" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Language"), {
    target: { value: "ar" },
  });
  expect(document.documentElement.dir).toBe("rtl");
  app.unmount();
  show("en");
  expect(document.documentElement.dir).toBe("ltr");
  expect((screen.getByLabelText("Language") as HTMLSelectElement).value).toBe(
    "en",
  );
  expect(localStorage.getItem("everia.locale.v1")).toBe('"en"');
});

test("a backup with a pending destination uses only the committed destination", async () => {
  bridge();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("__APP_VERSION__", "1.0.0");
  const config = vi.fn().mockResolvedValue({
    enabled: true,
    destination: "C:\\Backups",
    destinationSelected: false,
    lastSuccess: null,
    lastFailure: null,
    version: 1,
  });
  const write = vi.fn().mockResolvedValue("C:\\Backups\\snapshot.everiabackup");
  const setConfig = vi.fn();
  vi.stubGlobal("everiaBackup", {
    config,
    systemDrive: vi.fn().mockResolvedValue("C:\\"),
    chooseDestination: vi.fn().mockResolvedValue("D:\\Backups"),
    write,
    setConfig,
  });
  show("en");
  await screen.findByText("C:\\Backups");
  fireEvent.click(screen.getByRole("button", { name: "Choose Location" }));
  await screen.findByText("D:\\Backups");
  expect(
    screen.getByText(translate("en", "backup.usesCommittedLocation")),
  ).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Back Up Now" }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  expect(setConfig).not.toHaveBeenCalled();
});
