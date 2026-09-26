const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { responsiveProgress, responsiveZoom } = require("./window-state.cjs");

const preload = readFileSync(path.join(__dirname, "preload.cjs"), "utf8");
const displays = {
  "1080p": {
    width: 1920,
    height: 1080,
    scaleFactor: 1,
    workArea: { width: 1920, height: 1040 },
  },
  "2K": {
    width: 2560,
    height: 1440,
    scaleFactor: 1,
    workArea: { width: 2560, height: 1400 },
  },
};

function responsiveState(name, bounds) {
  const display = displays[name];
  bounds ??= { width: display.width, height: display.height - 40 };
  const zoom = responsiveZoom(bounds, display);
  return {
    zoom,
    progress: responsiveProgress(bounds, display),
    homeProgress: Math.max(0, Math.min(1, (zoom - 1) / (1 / 3))),
  };
}

function subscription() {
  const events = new EventEmitter();
  let resolveCurrent;
  const current = new Promise((resolve) => {
    resolveCurrent = resolve;
  });
  const exposed = {};
  vm.runInNewContext(preload, {
    require(name) {
      assert.equal(name, "electron");
      return {
        contextBridge: {
          exposeInMainWorld: (key, value) => {
            exposed[key] = value;
          },
        },
        ipcRenderer: {
          on: events.on.bind(events),
          removeListener: events.removeListener.bind(events),
          invoke: (channel) =>
            channel === "window:responsive-scale-current"
              ? current
              : Promise.resolve(),
        },
      };
    },
  });
  const applied = [];
  const stop = exposed.everiaWindow.onResponsiveScale((state) =>
    applied.push(state),
  );
  return { events, resolveCurrent, applied, stop };
}

async function flush() {
  await Promise.resolve();
}

test("cold startup applies the requested 1080p or 2K state without a resize", async () => {
  for (const target of ["1080p", "2K"]) {
    const session = subscription();
    const expected = responsiveState(target);
    session.resolveCurrent(expected);
    await flush();
    assert.deepEqual(session.applied, [expected]);
    assert.ok(
      target === "2K" ? expected.progress >= 0.98 : expected.progress >= 0.65,
    );
    session.stop();
  }
});

test("cold 2K maximize cannot be undone by its earlier windowed startup reply", async () => {
  const session = subscription();
  const compact = responsiveState("2K", { width: 1600, height: 900 });
  const expanded = responsiveState("2K");
  assert.equal(compact.progress, 0);
  session.events.emit("window:responsive-scale", {}, expanded);
  session.resolveCurrent(compact);
  await flush();
  assert.deepEqual(session.applied, [expanded]);
  session.events.emit("window:responsive-scale", {}, compact);
  session.events.emit("window:responsive-scale", {}, expanded);
  assert.deepEqual(session.applied, [expanded, compact, expanded]);
  session.stop();
});

test("repeated 1080p and 2K display notifications converge on the destination", async () => {
  const session = subscription();
  const fullHD = responsiveState("1080p");
  const twoK = responsiveState("2K");
  session.resolveCurrent(fullHD);
  await flush();
  for (const target of [twoK, fullHD, twoK, fullHD]) {
    session.events.emit("window:responsive-scale", {}, target);
    assert.deepEqual(session.applied.at(-1), target);
  }
  session.stop();
});

test("a delayed startup reply cannot undo a newer 2K to 1080p notification", async () => {
  const session = subscription();
  const expanded = responsiveState("2K");
  const compact = responsiveState("1080p");
  session.events.emit("window:responsive-scale", {}, compact);
  session.resolveCurrent(expanded);
  await flush();
  assert.deepEqual(session.applied, [compact]);
  session.stop();
});
