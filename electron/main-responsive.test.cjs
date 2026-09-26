const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");

async function launchOnTwoK() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "everia-responsive-"));
  fs.writeFileSync(
    path.join(profile, "window-state.v1.json"),
    JSON.stringify({
      version: 1,
      displayId: "2",
      maximized: true,
      bounds: { x: 3000, y: 100, width: 1600, height: 900 },
    }),
  );
  const display = {
    id: 2,
    scaleFactor: 1,
    workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
  };
  let window;
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      window = this;
      this.bounds = options;
      this.contentBounds = { width: options.width, height: options.height };
      this.webContents = new EventEmitter();
      this.webContents.zoom = 1;
      this.webContents.getZoomFactor = () => this.webContents.zoom;
      this.webContents.setZoomFactor = (zoom) => {
        this.webContents.zoom = zoom;
      };
      this.webContents.send = (channel, value) => {
        this.lastMessage = { channel, value };
      };
      this.webContents.setWindowOpenHandler = () => {};
    }
    isDestroyed() {
      return false;
    }
    isMaximized() {
      return this.maximized;
    }
    getBounds() {
      return this.bounds;
    }
    getNormalBounds() {
      return { x: 3000, y: 100, width: 1600, height: 900 };
    }
    getContentBounds() {
      return this.contentBounds;
    }
    loadFile() {
      this.loading = true;
    }
    maximize() {
      this.maximized = true;
      this.bounds = { x: 1920, y: 0, width: 2560, height: 1400 };
      this.contentBounds = { width: 2560, height: 1400 };
      this.emit("maximize");
    }
  }
  const screen = new EventEmitter();
  screen.getAllDisplays = () => [display];
  screen.getPrimaryDisplay = () => display;
  screen.getDisplayMatching = () => display;
  const app = new EventEmitter();
  app.setName = () => {};
  app.setAppUserModelId = () => {};
  app.getPath = (name) => (name === "userData" ? profile : profile);
  app.whenReady = () => Promise.resolve();
  const actualRequire = require;
  vm.runInNewContext(source, {
    __dirname,
    process,
    setTimeout,
    clearTimeout,
    require(name) {
      if (name === "electron")
        return {
          app,
          BrowserWindow: FakeWindow,
          screen,
          ipcMain: { handle() {} },
          safeStorage: {},
          shell: {},
          dialog: {},
        };
      if (name === "./backup-store.cjs")
        return { createBackupStore: () => ({}) };
      if (name === "./credential-store.cjs")
        return { createCredentialStore: () => ({}) };
      if (name === "./providers.cjs")
        return {
          configureCredentialStore() {},
          initializeProviders: async () => {},
        };
      return actualRequire(name);
    },
  });
  await Promise.resolve();
  assert.ok(window?.loading);
  return { window, profile };
}

test("cold 2K maximized load reapplies actual zoom after navigation", async () => {
  const { window, profile } = await launchOnTwoK();
  try {
    assert.equal(window.webContents.zoom, 1.333);
    // A navigation can restore the page's zoom after the early maximize event.
    window.webContents.zoom = 1;
    window.webContents.emit("did-finish-load");
    assert.equal(window.webContents.zoom, 1.333);
    assert.equal(window.lastMessage.channel, "window:responsive-scale");
    assert.equal(window.lastMessage.value.progress, 1);
  } finally {
    window.emit("closed");
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
