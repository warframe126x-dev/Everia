const assert = require("node:assert/strict");
const test = require("node:test");
const { effectiveZoom, isInterfaceScale } = require("./interface-scale.cjs");

test("interface scale validates fixed choices and bounds the effective zoom", () => {
  for (const scale of [1, 1.1, 1.25])
    assert.equal(isInterfaceScale(scale), true);
  for (const value of [0, 1.2, 1.5, 2, "1.5", NaN, Infinity, null])
    assert.equal(isInterfaceScale(value), false);
  assert.equal(effectiveZoom(1.333, 1.25), 1.666);
  assert.equal(effectiveZoom(2, 1.25), 2);
  assert.equal(effectiveZoom(0.5, 1), 1);
  assert.throws(() => effectiveZoom(Infinity, 1));
  assert.throws(() => effectiveZoom(1, 1.5));
  assert.throws(() => effectiveZoom(1, 2));
});
