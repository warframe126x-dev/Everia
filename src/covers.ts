/** Store actual image bytes in IndexedDB, never a remote rendering dependency. */
const COVER_MAX_BYTES = 10 * 1024 * 1024;
const WALLPAPER_MAX_BYTES = 30 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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
}
async function validateImage(blob: Blob, maxBytes: number) {
  if (blob.size > maxBytes || !IMAGE_TYPES.includes(blob.type)) {
    throw new Error(
      `Choose a PNG, JPEG, WebP or GIF image smaller than ${maxBytes / 1024 / 1024} MB.`,
    );
  }
  const bitmap = await createImageBitmap(blob);
  bitmap.close();
}

async function putAsset(
  store: "covers" | "wallpapers",
  blob: Blob,
  id: string,
) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(store, "readwrite");
      transaction.objectStore(store).put(blob, id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function getAsset(store: "covers" | "wallpapers", id: string) {
  const db = await open();
  try {
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function storeCover(input: File | string): Promise<string> {
  let blob: Blob;
  if (typeof input === "string") {
    const url = new URL(input);
    if (url.protocol !== "https:")
      throw new Error("Use an HTTPS image URL or choose a local image.");
    if (window.everiaProviders) {
      const response = await window.everiaProviders.downloadImage(url.href);
      if (!response.ok || !response.data)
        throw new Error(
          response.error ??
            "Image download failed. Choose a local image instead.",
        );
      const bytes = new Uint8Array(response.data.bytes.byteLength);
      bytes.set(response.data.bytes);
      blob = new Blob([bytes.buffer], { type: response.data.type });
    } else {
      const response = await fetch(url, {
        credentials: "omit",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new Error("Image download failed. Choose a local image instead.");
      blob = await response.blob();
    }
  } else blob = input;
  await validateImage(blob, COVER_MAX_BYTES);
  const id = `local-cover:${crypto.randomUUID()}`;
  await putAsset("covers", blob, id);
  return id;
}
export async function readCover(id: string): Promise<Blob | undefined> {
  return getAsset("covers", id);
}

export async function storeWallpaper(file: File): Promise<string> {
  await validateImage(file, WALLPAPER_MAX_BYTES);
  const id = `local-wallpaper:${crypto.randomUUID()}`;
  await putAsset("wallpapers", file, id);
  return id;
}

export async function readWallpaper(id: string): Promise<Blob | undefined> {
  return getAsset("wallpapers", id);
}
