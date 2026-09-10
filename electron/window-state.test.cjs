const test = require("node:test");
const assert = require("node:assert/strict");
const {
  centeredInitialBounds,
  resolveWindowState,
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
