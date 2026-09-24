import { exportAssets, replaceAssets, type StoredAsset } from "./covers";
import { storage, storageWarning } from "./storage";
import { validateItems } from "./validation";
import type { MediaItem, ThemeSettings, SortKey, ViewMode } from "./types";

const KEYS = ["everia.items.v1", "everia.theme.v1", "everia.sort.v1", "everia.views.v1"] as const;
const MAX_FILE = 128 * 1024 * 1024;
const MAX_ASSETS = 2000;
const MAX_RECORDS = 10000;
const MAX_ASSET_BYTES = 96 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
type AssetEntry = { store: "covers" | "wallpapers"; id: string; mime: string; bytes: number; sha256: string; base64: string };
type Data = {
  items: MediaItem[];
  settings: { theme: ThemeSettings; sorts: Record<string, SortKey>; views: Record<string, ViewMode> };
};
type Document = {
  manifest: {
    format: "EveriaBackup"; schema: 1; appVersion: string; createdAt: string;
    recordCount: number; assetCount: number; payloadSha256: string;
    assets: { store: string; id: string; bytes: number; sha256: string }[];
  };
  data: Data;
  assets: AssetEntry[];
};
type RawState = (string | null)[];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid Everia backup: ${message}`);
}
async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
const hashText = (text: string) => hash(new TextEncoder().encode(text));
function toBase64(bytes: Uint8Array): string {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    output += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(output);
}
function fromBase64(value: string, length: number): Uint8Array {
  assert(typeof value === "string" && value.length <= Math.ceil(length / 3) * 4 + 4 && /^[A-Za-z0-9+/]*={0,2}$/.test(value), "asset encoding");
  const binary = atob(value);
  assert(binary.length === length && toBase64(Uint8Array.from(binary, (c) => c.charCodeAt(0))) === value, "asset length or encoding");
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
function validId(store: string, id: string) {
  return typeof id === "string" && id.length <= 128 &&
    new RegExp(`^local-${store === "covers" ? "cover" : "wallpaper"}:[A-Za-z0-9_-]+$`).test(id);
}
function rawState(): RawState { return KEYS.map((key) => localStorage.getItem(key)); }
function loadData(): Data {
  const data = { items: storage.loadItems(), settings: {
    theme: storage.loadTheme(), sorts: storage.loadSorts(), views: storage.loadViews(),
  } };
  if (storageWarning) throw new Error(storageWarning);
  assert(data.items.length <= MAX_RECORDS, "too many records");
  return data;
}
async function entries(assets: StoredAsset[]): Promise<AssetEntry[]> {
  assert(assets.length <= MAX_ASSETS, "too many assets");
  let total = 0;
  const seen = new Set<string>();
  const result: AssetEntry[] = [];
  for (const asset of assets.sort((a, b) => `${a.store}/${a.id}`.localeCompare(`${b.store}/${b.id}`))) {
    assert(validId(asset.store, asset.id) && !seen.has(`${asset.store}/${asset.id}`), "asset identifier");
    seen.add(`${asset.store}/${asset.id}`);
    assert(IMAGE_TYPES.includes(asset.blob.type) && asset.blob.size > 0 &&
      asset.blob.size <= (asset.store === "covers" ? 10 : 30) * 1024 * 1024, "asset type or size");
    total += asset.blob.size;
    assert(total <= MAX_ASSET_BYTES, "assets exceed size limit");
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    result.push({ store: asset.store, id: asset.id, mime: asset.blob.type,
      bytes: bytes.length, sha256: await hash(bytes), base64: toBase64(bytes) });
  }
  return result;
}
function referencedAssets(data: Data, assets: AssetEntry[]) {
  const ids = new Set(assets.map((asset) => `${asset.store}/${asset.id}`));
  for (const item of data.items)
    if (item.coverUrl?.startsWith("local-cover:"))
      assert(ids.has(`covers/${item.coverUrl}`), `missing cover for ${item.id}`);
  const wallpaper = data.settings.theme.customWallpaperId;
  if (wallpaper)
    assert(ids.has(`wallpapers/${wallpaper}`), "missing wallpaper");
}
export async function createBackup(appVersion: string, createdAt = new Date().toISOString()): Promise<string> {
  const before = rawState();
  const data = loadData();
  const assets = await entries(await exportAssets());
  assert(JSON.stringify(rawState()) === JSON.stringify(before), "live library changed during snapshot; retry");
  referencedAssets(data, assets);
  const manifest: Document["manifest"] = {
    format: "EveriaBackup", schema: 1, appVersion, createdAt,
    recordCount: data.items.length, assetCount: assets.length,
    payloadSha256: await hashText(JSON.stringify({ data, assets })),
    assets: assets.map(({ store, id, bytes, sha256 }) => ({ store, id, bytes, sha256 })),
  };
  const file = JSON.stringify({ manifest, data, assets });
  assert(new TextEncoder().encode(file).length <= MAX_FILE, "file too large");
  await parseBackup(file); // A successful export must be independently readable.
  return file;
}
export async function parseBackup(file: string): Promise<{ data: Data; assets: StoredAsset[]; fingerprint: string }> {
  assert(typeof file === "string" && new TextEncoder().encode(file).length <= MAX_FILE, "file too large");
  let doc: Document;
  try { doc = JSON.parse(file); } catch { throw new Error("Invalid Everia backup: truncated or malformed JSON"); }
  assert(doc && typeof doc === "object" && Object.keys(doc).sort().join() === "assets,data,manifest", "document shape");
  const { manifest, data, assets } = doc;
  assert(manifest && manifest.format === "EveriaBackup" && manifest.schema === 1, "unsupported backup schema");
  assert(typeof manifest.appVersion === "string" && manifest.appVersion.length <= 40 &&
    typeof manifest.createdAt === "string" && !Number.isNaN(Date.parse(manifest.createdAt)), "manifest metadata");
  assert(data && Object.keys(data).sort().join() === "items,settings" && Array.isArray(data.items) &&
    data.items.length <= MAX_RECORDS && Array.isArray(assets) && assets.length <= MAX_ASSETS &&
    Array.isArray(manifest.assets), "payload shape");
  assert(manifest.recordCount === data.items.length && manifest.assetCount === assets.length &&
    manifest.assets.length === assets.length, "manifest counts");
  assert(typeof manifest.payloadSha256 === "string" &&
    manifest.payloadSha256 === await hashText(JSON.stringify({ data, assets })), "payload integrity");
  assert(JSON.stringify(validateItems(data.items)) === JSON.stringify(data.items), "invalid library records");
  // Existing storage validators are authoritative for settings. Validate without writing.
  assert(data.settings && Object.keys(data.settings).sort().join() === "sorts,theme,views", "settings shape");
  const { theme, sorts, views } = data.settings;
  assert(theme && typeof theme === "object" &&
    [theme.accent, theme.background, theme.text].every((v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) &&
    ["default", "solid", "custom"].includes(theme.backgroundMode) &&
    ["cover", "contain", "stretch"].includes(theme.imageFit) &&
    Number.isFinite(theme.backgroundDimming) && theme.backgroundDimming >= 0 && theme.backgroundDimming <= 85 &&
    (theme.customWallpaperId === undefined || typeof theme.customWallpaperId === "string"), "theme");
  assert(sorts && typeof sorts === "object" && !Array.isArray(sorts) &&
    Object.values(sorts).every((v) => ["title", "releaseDate", "rating", "dateAdded"].includes(v)), "sorts");
  assert(views && typeof views === "object" && !Array.isArray(views) &&
    Object.values(views).every((v) => ["grid", "list"].includes(v)), "views");
  let total = 0;
  const seen = new Set<string>();
  const restored: StoredAsset[] = [];
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    assert(asset && ["covers", "wallpapers"].includes(asset.store) && validId(asset.store, asset.id) &&
      !seen.has(`${asset.store}/${asset.id}`) && IMAGE_TYPES.includes(asset.mime) &&
      Number.isSafeInteger(asset.bytes) && asset.bytes > 0 &&
      asset.bytes <= (asset.store === "covers" ? 10 : 30) * 1024 * 1024, "asset inventory");
    seen.add(`${asset.store}/${asset.id}`);
    total += asset.bytes;
    assert(total <= MAX_ASSET_BYTES, "asset total size");
    const bytes = fromBase64(asset.base64, asset.bytes);
    assert(asset.sha256 === await hash(bytes) &&
      JSON.stringify(manifest.assets[i]) === JSON.stringify({store: asset.store, id: asset.id, bytes: asset.bytes, sha256: asset.sha256}), "asset integrity");
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: asset.mime });
    if (typeof createImageBitmap === "function") {
      try { (await createImageBitmap(blob)).close(); }
      catch { throw new Error("Invalid Everia backup: corrupt image"); }
    }
    restored.push({ store: asset.store, id: asset.id, blob });
  }
  referencedAssets(data, assets);
  return { data, assets: restored, fingerprint: manifest.payloadSha256 };
}

function applyRaw(raw: RawState) {
  KEYS.forEach((key, index) => {
    if (raw[index] === null) localStorage.removeItem(key);
    else localStorage.setItem(key, raw[index]!);
  });
}
async function apply(data: Data, assets: StoredAsset[]) {
  await replaceAssets(assets);
  localStorage.setItem(KEYS[0], JSON.stringify(data.items));
  localStorage.setItem(KEYS[1], JSON.stringify(data.settings.theme));
  localStorage.setItem(KEYS[2], JSON.stringify(data.settings.sorts));
  localStorage.setItem(KEYS[3], JSON.stringify(data.settings.views));
}
export async function recoverPendingRestore(): Promise<void> {
  const api = window.everiaBackup;
  if (!api) return;
  const pending = await api.pendingRestore();
  if (!pending) return;
  const previous = await parseBackup(pending.backup);
  await replaceAssets(previous.assets);
  assert(Array.isArray(pending.raw) && pending.raw.length === KEYS.length &&
    pending.raw.every((v) => v === null || typeof v === "string"), "rollback journal");
  applyRaw(pending.raw);
  await api.finishRestore();
}
export async function restoreBackup(file: string): Promise<void> {
  const api = window.everiaBackup;
  if (!api) throw new Error("Backup is available in the desktop app.");
  const incoming = await parseBackup(file);
  const previous = await createBackup(__APP_VERSION__);
  const raw = rawState();
  await api.beginRestore({ backup: previous, raw });
  try {
    await apply(incoming.data, incoming.assets);
    const readBack = await parseBackup(await createBackup(__APP_VERSION__));
    assert(readBack.fingerprint === incoming.fingerprint, "restored data read-back mismatch");
    await api.finishRestore();
  } catch (error) {
    await recoverPendingRestore(); // Journal remains if recovery fails or the process dies.
    throw error;
  }
}
export async function backUpNow(): Promise<string> {
  const api = window.everiaBackup;
  if (!api) throw new Error("Backup is available in the desktop app.");
  return api.write(await createBackup(__APP_VERSION__));
}
export async function restoreSelectedBackup(): Promise<boolean> {
  const file = await window.everiaBackup?.selectBackup();
  if (!file) return false;
  await restoreBackup(file);
  window.location.reload(); // Recreate React state from the verified authoritative storage.
  return true;
}
export async function scheduleAutomaticBackup(): Promise<void> {
  const api = window.everiaBackup;
  if (!api || !(await api.isDue())) return;
  try { await backUpNow(); }
  catch (error) { console.error("Automatic backup failed:", error); }
}
