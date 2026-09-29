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
  const handlers = new Map();
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
  FakeWindow.fromWebContents = (sender) =>
    sender === window?.webContents ? window : null;
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
          ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
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
  return { window, profile, setScale: (value) =>
    handlers.get("window:interface-scale")({ sender: window.webContents }, value) };
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

test("explicit interface scale composes once with current responsive target across transitions", async () => {
  const { window, profile, setScale } = await launchOnTwoK();
  try {
    for (const [scale, expected] of [[1, 1.333], [1.1, 1.466], [1.25, 1.666], [1.5, 1.999]]) {
      assert.equal(setScale(scale).ok, true);
      assert.equal(window.webContents.zoom, expected);
      for (let i = 0; i < 3; i++) window.emit("resize");
      assert.equal(window.webContents.zoom, expected);
    }
    window.contentBounds = { width: 1920, height: 1040 };
    window.bounds = { x: 0, y: 0, width: 1920, height: 1080 };
    window.emit("move");
    assert.equal(window.webContents.zoom, 1.5);
    window.contentBounds = { width: 2560, height: 1400 };
    window.bounds = { x: 1920, y: 0, width: 2560, height: 1400 };
    window.emit("maximize");
    assert.equal(window.webContents.zoom, 1.999);
    window.webContents.zoom = 1;
    window.webContents.emit("did-finish-load");
    assert.equal(window.webContents.zoom, 1.999);
    assert.equal(window.lastMessage.value.progress, 1);
    assert.throws(() => setScale(3), /Invalid interface scale/);
    assert.equal(window.webContents.zoom, 1.999);
  } finally {
    window.emit("closed");
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
