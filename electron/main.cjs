const {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  screen,
  shell,
} = require("electron");
const path = require("node:path");
const providers = require("./providers.cjs");
const { createCredentialStore } = require("./credential-store.cjs");
const {
  loadWindowState,
  resolveWindowState,
  responsiveZoom,
  saveWindowState,
} = require("./window-state.cjs");

app.setName("Everia");
app.setAppUserModelId("com.everia.app");

let windowStatePath;

function createWindow() {
  const restored = resolveWindowState(
    loadWindowState(windowStatePath),
    screen.getAllDisplays(),
    screen.getPrimaryDisplay(),
  );
  const window = new BrowserWindow({
    ...restored.bounds,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#081016",
    title: "Everia — Your Personal Universe",
    icon: path.join(
      __dirname,
      "..",
      "dist",
      "assets",
      "branding",
      "everia-ui-mark.png",
    ),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  let saveTimer;
  let lastZoom;
  let rendererReady = false;
  const persistWindowState = () => {
    const bounds = window.isMaximized()
      ? window.getNormalBounds()
      : window.getBounds();
    const display = screen.getDisplayMatching(window.getBounds());
    saveWindowState(windowStatePath, {
      displayId: String(display.id),
      bounds,
      maximized: window.isMaximized(),
    });
  };
  const queueStateSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistWindowState, 250);
  };
  const applyResponsiveScale = () => {
    if (window.isDestroyed()) return;
    const display = screen.getDisplayMatching(window.getBounds());
    const zoom = responsiveZoom(window.getContentBounds(), display);
    if (zoom !== lastZoom) {
      lastZoom = zoom;
      window.webContents.setZoomFactor(zoom);
    }
    const progress = Math.max(0, Math.min(1, (zoom - 1) / (1 / 3)));
    if (rendererReady)
      window.webContents.send("window:responsive-scale", { zoom, progress });
  };

  for (const event of ["resize", "move", "maximize", "unmaximize"]) {
    window.on(event, () => {
      queueStateSave();
      applyResponsiveScale();
    });
  }
  window.on("close", () => {
    clearTimeout(saveTimer);
    persistWindowState();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file:")) event.preventDefault();
  });
  const handleDisplayChange = () => applyResponsiveScale();
  screen.on("display-metrics-changed", handleDisplayChange);
  window.on("closed", () => {
    clearTimeout(saveTimer);
    screen.removeListener("display-metrics-changed", handleDisplayChange);
  });
  window.webContents.on("did-finish-load", () => {
    rendererReady = true;
    applyResponsiveScale();
  });
  window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  if (restored.maximized) window.maximize();
}

function safeProviderHandler(action) {
  return async (_event, input) => {
    try {
      return { ok: true, data: await action(input) };
    } catch (error) {
      return {
        ok: false,
        errorCode: error?.code,
        error:
          error instanceof Error
            ? error.message
            : "Online search is currently unavailable.",
      };
    }
  };
}

ipcMain.handle(
  "providers:status",
  safeProviderHandler((provider) => providers.providerStatus(provider)),
);
ipcMain.handle("providers:search", safeProviderHandler(providers.search));
ipcMain.handle(
  "providers:search-chain",
  safeProviderHandler(providers.searchChain),
);
ipcMain.handle("providers:details", safeProviderHandler(providers.details));
ipcMain.handle(
  "providers:download-image",
  safeProviderHandler(providers.downloadImage),
);
ipcMain.handle(
  "providers:configuration",
  safeProviderHandler(() => providers.allProviderConfigurations()),
);
ipcMain.handle(
  "providers:save-credentials",
  safeProviderHandler(async (input) => {
    if (!input || !["igdb", "rawg", "tmdb", "omdb"].includes(input.provider))
      throw new Error("Invalid credential request.");
    credentialStore.save(input.provider, input.credentials);
    providers.resetProviderSession(input.provider);
    return providers.testConnection(input.provider);
  }),
);
ipcMain.handle(
  "providers:test",
  safeProviderHandler((provider) => providers.testConnection(provider)),
);
ipcMain.handle(
  "providers:remove-credentials",
  safeProviderHandler((provider) => {
    if (!["igdb", "rawg", "tmdb", "omdb"].includes(provider))
      throw new Error("Invalid credential request.");
    credentialStore.remove(provider);
    providers.resetProviderSession(provider);
    return providers.providerStatus(provider);
  }),
);

let credentialStore;

app.whenReady().then(() => {
  windowStatePath = path.join(app.getPath("userData"), "window-state.v1.json");
  credentialStore = createCredentialStore({
    safeStorage,
    filePath: path.join(
      app.getPath("userData"),
      "provider-credentials.v1.json",
    ),
  });
  providers.configureCredentialStore(credentialStore);
  createWindow();
  void providers.initializeProviders();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
