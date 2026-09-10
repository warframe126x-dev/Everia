/** Resolve packaged assets from the document, not from Vite's generated CSS directory. */
export function assetUrl(path: string) {
  return new URL(path, document.baseURI).href;
}
