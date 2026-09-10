const test = require("node:test");
const assert = require("node:assert/strict");
const {
  centeredInitialBounds,
  resolveWindowState,
  responsiveProgress,
  responsiveZoom,
} = require("./window-state.cjs");

const primary = {
  id: 1,
  scaleFactor: 1,
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};

test("first launch uses a centered 16:9 window inside the work area", () => {
  const bounds = centeredInitialBounds(primary.workArea);
  assert.equal(bounds.width, 1600);
  assert.equal(bounds.height, 900);
  assert.ok(bounds.x >= 0 && bounds.y >= 0);
});

test("a disconnected remembered monitor restores safely on the primary display", () => {
  const restored = resolveWindowState(
    {
      displayId: 7,
      maximized: true,
      bounds: { x: 3000, y: 200, width: 1500, height: 850 },
    },
    [primary],
    primary,
  );
  assert.equal(restored.maximized, true);
  assert.ok(restored.bounds.x + restored.bounds.width <= 1920);
  assert.ok(restored.bounds.y + restored.bounds.height <= 1040);
});

test("responsive zoom preserves baseline and reaches a bounded 2K scale", () => {
  assert.equal(
    responsiveZoom({ width: 1600, height: 900 }, primary),
    1,
  );
  assert.equal(
    responsiveZoom(
      { width: 2048, height: 1120 },
      { ...primary, scaleFactor: 1.25 },
    ),
    1.333,
  );
});

test("responsive UI progress reaches the approved endpoint near 1080p maximized", () => {
  const progress = responsiveProgress(
    { width: 1920, height: 1040 },
    primary,
  );
  assert.ok(progress > 0.95 && progress <= 1);
});

test("responsive UI progress preserves the 2K endpoint without over-scaling windowed views", () => {
  const display = {
    ...primary,
    scaleFactor: 1.25,
    workArea: { x: 0, y: 0, width: 2048, height: 1120 },
  };
  assert.equal(
    responsiveProgress({ width: 2048, height: 1120 }, display),
    1,
  );
  assert.ok(
    responsiveProgress({ width: 1600, height: 900 }, display) < 0.15,
  );
});

test("responsive UI progress is continuous between baseline and maximized sizes", () => {
  const samples = [
    { width: 1600, height: 900 },
    { width: 1700, height: 950 },
    { width: 1800, height: 1000 },
    { width: 1920, height: 1040 },
  ].map((bounds) => responsiveProgress(bounds, primary));
  assert.equal(samples[0], 0);
  assert.ok(samples.every((value, index) => index === 0 || value >= samples[index - 1]));
  assert.ok(samples.every((value) => value >= 0 && value <= 1));
});
