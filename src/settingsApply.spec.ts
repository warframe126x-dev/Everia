import { afterEach, expect, test, vi } from "vitest";
import "fake-indexeddb/auto";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { exportAssets, storeWallpaper, readWallpaper } from "./covers";
import { defaultTheme } from "./data";
import { applySettingsDraft } from "./settingsApply";
import { storage } from "./storage";
import {
  freshDraft,
  settingsDirty,
  type SettingsValues,
} from "./settingsDraft";

const committed: SettingsValues = {
  theme: defaultTheme,
  locale: "en",
  interfaceScale: 1,
  backupEnabled: true,
  backupDestination: "C:\\Everia Backups",
};
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("draft compares semantic values and reverting edits clears dirty state", () => {
  const draft = freshDraft(committed);
  expect(settingsDirty(committed, draft)).toBe(false);
  draft.locale = "fr";
  expect(settingsDirty(committed, draft)).toBe(true);
  draft.locale = "en";
  expect(settingsDirty(committed, draft)).toBe(false);
  draft.interfaceScale = 1.25;
  expect(settingsDirty(committed, draft)).toBe(true);
  draft.interfaceScale = 1;
  expect(settingsDirty(committed, draft)).toBe(false);
  draft.backupDestination = "D:\\Backup";
  expect(settingsDirty(committed, draft)).toBe(true);
  draft.backupDestination = committed.backupDestination;
  expect(settingsDirty(committed, draft)).toBe(false);
  draft.credentials.tmdb = { kind: "remove" };
  expect(settingsDirty(committed, draft)).toBe(true);
  delete draft.credentials.tmdb;
  expect(settingsDirty(committed, draft)).toBe(false);
});

test("missing and malformed interface scale default to 100%; supported values persist", () => {
  expect(storage.loadInterfaceScale()).toBe(1);
  for (const raw of ["invalid", "2", "null", '"125%"', "{}", "1.2"]) {
    localStorage.setItem("everia.interface-scale.v1", raw);
    expect(storage.loadInterfaceScale()).toBe(1);
  }
  for (const value of [1, 1.1, 1.25, 1.5] as const) {
    storage.saveInterfaceScale(value);
    expect(storage.loadInterfaceScale()).toBe(value);
  }
});

test("scale is only persisted by Apply, and failed credential Apply restores exact prior preference", async () => {
  localStorage.setItem("everia.interface-scale.v1", "1.1");
  const current = { ...committed, interfaceScale: 1.1 as const };
  const draft = freshDraft(current);
  draft.interfaceScale = 1.5;
  expect(localStorage.getItem("everia.interface-scale.v1")).toBe("1.1");
  vi.stubGlobal("everiaProviders", {
    applyDraftCredentials: vi
      .fn()
      .mockResolvedValue({ ok: false, errorCode: "credential-required" }),
  });
  draft.credentials.tmdb = { kind: "save", credentials: { token: "pending" } };
  await expect(applySettingsDraft(current, draft)).rejects.toThrow();
  expect(localStorage.getItem("everia.interface-scale.v1")).toBe("1.1");
  expect(draft.interfaceScale).toBe(1.5);
  delete draft.credentials.tmdb;
  const applied = await applySettingsDraft(current, draft);
  expect(applied.interfaceScale).toBe(1.5);
  expect(storage.loadInterfaceScale()).toBe(1.5);
});

test("Apply persists changed locale, appearance, backup config, and credential batch", async () => {
  const setConfig = vi.fn().mockResolvedValue({});
  const applyDraftCredentials = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("everiaBackup", {
    setConfig,
    config: vi.fn().mockResolvedValue({
      ...committed,
      enabled: true,
      destination: committed.backupDestination,
      destinationSelected: false,
    }),
  });
  vi.stubGlobal("everiaProviders", { applyDraftCredentials });
  const draft = freshDraft(committed);
  draft.locale = "ar";
  draft.theme = { ...defaultTheme, accent: "#001122" };
  draft.backupDestination = "D:\\Copies";
  draft.credentials.tmdb = { kind: "save", credentials: { token: "private" } };
  expect(localStorage.getItem("everia.locale.v1")).toBeNull();
  const applied = await applySettingsDraft(committed, draft);
  expect(applied.locale).toBe("ar");
  expect(localStorage.getItem("everia.locale.v1")).toBe('"ar"');
  expect(JSON.parse(localStorage.getItem("everia.theme.v1")!).accent).toBe(
    "#001122",
  );
  expect(setConfig).toHaveBeenCalledWith({ destination: "D:\\Copies" });
  expect(applyDraftCredentials).toHaveBeenCalledWith([
    { provider: "tmdb", kind: "save", credentials: { token: "private" } },
  ]);
  expect(settingsDirty(applied, freshDraft(applied))).toBe(false);
});

test("failed credential Apply rolls back locale, theme and backup configuration while retaining caller draft", async () => {
  localStorage.setItem("everia.theme.v1", JSON.stringify(defaultTheme));
  localStorage.setItem("everia.locale.v1", '"en"');
  const setConfig = vi.fn().mockResolvedValue({});
  vi.stubGlobal("everiaBackup", {
    setConfig,
    config: vi.fn().mockResolvedValue({
      enabled: true,
      destination: committed.backupDestination,
      destinationSelected: false,
    }),
  });
  vi.stubGlobal("everiaProviders", {
    applyDraftCredentials: vi
      .fn()
      .mockResolvedValue({ ok: false, errorCode: "credential-required" }),
  });
  const draft = freshDraft(committed);
  draft.locale = "fr";
  draft.theme = { ...defaultTheme, background: "#123456" };
  draft.backupEnabled = false;
  draft.credentials.igdb = {
    kind: "save",
    credentials: { clientId: "id", clientSecret: "" },
  };
  await expect(applySettingsDraft(committed, draft)).rejects.toMatchObject({
    code: "credential-required",
  });
  expect(localStorage.getItem("everia.locale.v1")).toBe('"en"');
  expect(JSON.parse(localStorage.getItem("everia.theme.v1")!)).toEqual(
    defaultTheme,
  );
  expect(setConfig).toHaveBeenLastCalledWith({
    enabled: true,
    destination: committed.backupDestination,
    destinationSelected: false,
  });
  expect(draft.locale).toBe("fr");
  expect(settingsDirty(committed, draft)).toBe(true);
});

test("failed Apply removes only its staged wallpaper and preserves a previously committed image", async () => {
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ close() {} }));
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("File", NodeFile);
  const original = await storeWallpaper(
    new File(["old bytes"], "original.png", { type: "image/png" }),
  );
  const before = await exportAssets();
  const oldTheme = {
    ...defaultTheme,
    backgroundMode: "custom" as const,
    customWallpaperId: original,
  };
  localStorage.setItem("everia.theme.v1", JSON.stringify(oldTheme));
  const current = { ...committed, theme: oldTheme };
  const draft = freshDraft(current);
  draft.wallpaperFile = new File(["new bytes"], "pending.png", {
    type: "image/png",
  });
  draft.credentials.tmdb = { kind: "save", credentials: { token: "pending" } };
  vi.stubGlobal("everiaProviders", {
    applyDraftCredentials: vi
      .fn()
      .mockResolvedValue({ ok: false, errorCode: "credential-required" }),
  });
  await expect(applySettingsDraft(current, draft)).rejects.toMatchObject({
    code: "credential-required",
  });
  expect(localStorage.getItem("everia.theme.v1")).toBe(
    JSON.stringify(oldTheme),
  );
  expect(await readWallpaper(original)).toBeDefined();
  expect((await exportAssets()).map(({ id }) => id)).toEqual(
    before.map(({ id }) => id),
  );
  expect(draft.wallpaperFile).toBeDefined();
});
