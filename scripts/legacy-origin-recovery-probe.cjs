const { app, BrowserWindow, protocol } = require("electron");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const oldUrl = process.argv[2];
if (!oldUrl?.startsWith("file:")) throw new Error("Pass a legacy file URL");
app.setName("Everia");
app.whenReady().then(async () => {
  const filename = require("node:url").fileURLToPath(oldUrl);
  const parent = require("node:path").dirname(filename);
  // Probe only: serve a harmless document under the deleted v0.9 document URL.
  // Do not read or alter any Chromium storage files.
  fs.rmSync(parent, { recursive: true, force: true });
  protocol.handle("file", (request) => {
    if (request.url === oldUrl)
      return new Response("<!doctype html><title>Recovery probe</title>", {
        headers: { "content-type": "text/html" },
      });
    return new Response("Forbidden", { status: 403 });
  });
  const window = new BrowserWindow({ show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: true,
  }});
  await window.loadURL(oldUrl);
  const value = await window.webContents.executeJavaScript(
    '({ url: location.href, items: localStorage.getItem("everia.items.v1"), theme: localStorage.getItem("everia.theme.v1") })'
  );
  console.log("LEGACY_VIRTUAL_ORIGIN", JSON.stringify(value));
  app.quit();
}).catch((error) => { console.error("LEGACY_VIRTUAL_ORIGIN_ERROR", error); app.exit(1); });
