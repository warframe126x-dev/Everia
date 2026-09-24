import { beforeEach, afterEach, expect, test, vi } from "vitest";
import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import { createBackup, parseBackup, restoreBackup, recoverPendingRestore } from "./backup";
import { exportAssets, replaceAssets } from "./covers";

const item = (id: string, category = "games") => ({
  id, title: `Ünicode العربية ${id}`, category, status:"In progress", favorite:true,
  dateAdded:"2026-09-24", dateModified:"2026-09-25", rating:8, notes:"Note\nFR / AR",
  source:"IGDB", sourceId:"123", providerReference:{provider:"igdb", providerId:"123", importedAt:"2026-09-24"},
  genres:["Adventure"], coverUrl:"local-cover:cover", providerMetadata:{creators:["Name"]},
});
const theme = {accent:"#123456",background:"#081016",text:"#ffffff",backgroundMode:"custom",
  customWallpaperId:"local-wallpaper:wall",imageFit:"contain",backgroundDimming:22};
let pending: { backup: string; raw: (string | null)[] } | null;
let failFinish = false;
beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("createImageBitmap", async () => ({ close() {} }));
  vi.stubGlobal("__APP_VERSION__", "1.0.0");
  await replaceAssets([]);
  pending = null;
  failFinish = false;
  window.everiaBackup = {
    config: async () => ({version:1,enabled:true,destination:"/tmp",destinationSelected:true,lastSuccess:null,lastFailure:null}),
    isDue: async () => true, write: async () => "saved", chooseDestination: async () => null,
    setEnabled: async () => {}, selectBackup: async () => null,
    beginRestore: async (value) => { pending = value; },
    pendingRestore: async () => pending,
    finishRestore: async () => { if (failFinish) { failFinish = false; throw Error("injected finish failure"); } pending = null; },
  };
});
afterEach(() => { vi.unstubAllGlobals(); delete window.everiaBackup; });
async function populate() {
  localStorage.setItem("everia.items.v1", JSON.stringify([item("one"),item("two","manga")]));
  localStorage.setItem("everia.theme.v1",JSON.stringify(theme));
  localStorage.setItem("everia.sort.v1",JSON.stringify({games:"rating",manga:"title"}));
  localStorage.setItem("everia.views.v1",JSON.stringify({games:"list",manga:"grid"}));
  await replaceAssets([
    {store:"covers",id:"local-cover:cover",blob:new Blob([new Uint8Array([1,2,3])],{type:"image/png"})},
    {store:"wallpapers",id:"local-wallpaper:wall",blob:new Blob([new Uint8Array([4,5,6,7])],{type:"image/png"})},
  ]);
}
test("complete logical round trip preserves all fields, preferences and image bytes", async () => {
  await populate();
  const backup = await createBackup("1.0.0","2026-09-24T10:00:00.000Z");
  const parsed = await parseBackup(backup);
  expect(parsed.data.items).toHaveLength(2);
  expect(parsed.data.items[0]).toMatchObject(item("one"));
  expect(parsed.data.settings).toEqual({theme, sorts:{games:"rating",manga:"title"}, views:{games:"list",manga:"grid"}});
  expect(Array.from(new Uint8Array(await parsed.assets[0].blob.arrayBuffer()))).toEqual([1,2,3]);
  expect(Array.from(new Uint8Array(await parsed.assets[1].blob.arrayBuffer()))).toEqual([4,5,6,7]);
  expect(backup).not.toContain("clientSecret");
  expect(backup).not.toContain("provider-credentials");
});
test("empty library and unsupported, malformed, truncated or tampered backups", async () => {
  expect((await parseBackup(await createBackup("1.0.0"))).data.items).toEqual([]);
  await populate();
  const backup = await createBackup("1.0.0");
  await expect(parseBackup(backup.slice(0,-1))).rejects.toThrow();
  for (const mutation of [
    (doc: any) => { doc.manifest.schema = 2; },
    (doc: any) => { doc.data.items[0].rating = 99; },
    (doc: any) => { doc.assets[0].base64 = "AQIDAA=="; },
    (doc: any) => { doc.assets.push(doc.assets[0]); doc.manifest.assetCount++; },
  ]) {
    const doc = JSON.parse(backup); mutation(doc);
    await expect(parseBackup(JSON.stringify(doc))).rejects.toThrow();
  }
});
test("missing referenced image cannot export or restore", async () => {
  await populate();
  const good = await createBackup("1.0.0");
  await replaceAssets([]);
  await expect(createBackup("1.0.0")).rejects.toThrow(/missing cover/);
  const doc = JSON.parse(good);
  doc.data.items[0].coverUrl = "local-cover:lost";
  await expect(parseBackup(JSON.stringify(doc))).rejects.toThrow();
});
test("restore over populated library verifies read-back and keeps credentials outside transaction", async () => {
  await populate();
  const incoming = await createBackup("1.0.0");
  localStorage.setItem("everia.items.v1",JSON.stringify([{id:"old",title:"Old",category:"anime",status:"Planning",favorite:false,dateAdded:"2020-01-01"}]));
  localStorage.setItem("unrelated.credentials", "untouched");
  await restoreBackup(incoming);
  expect(JSON.parse(localStorage.getItem("everia.items.v1")!)).toHaveLength(2);
  expect(localStorage.getItem("unrelated.credentials")).toBe("untouched");
  expect(pending).toBeNull();
});
test("failed commit rolls back raw storage and assets; interrupted journal recovers", async () => {
  await populate();
  const incoming = await createBackup("1.0.0");
  localStorage.setItem("everia.items.v1",JSON.stringify([{id:"old",title:"Old",category:"anime",status:"Planning",favorite:false,dateAdded:"2020-01-01"}]));
  const original = localStorage.getItem("everia.items.v1");
  failFinish = true;
  await expect(restoreBackup(incoming)).rejects.toThrow(/injected/);
  expect(localStorage.getItem("everia.items.v1")).toBe(original);
  expect((await exportAssets()).length).toBe(2);
  expect(pending).toBeNull();
  await window.everiaBackup!.beginRestore({backup:incoming,raw:[original,null,null,null]});
  localStorage.removeItem("everia.items.v1");
  await recoverPendingRestore();
  expect(localStorage.getItem("everia.items.v1")).toBe(original);
});
