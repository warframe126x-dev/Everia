const SCALES = [1, 1.1, 1.25];
const MIN_ZOOM = 1;
const MAX_ZOOM = 2;

function isInterfaceScale(value) {
  return typeof value === "number" && SCALES.includes(value);
}

function effectiveZoom(automaticZoom, userScale) {
  if (!Number.isFinite(automaticZoom) || !isInterfaceScale(userScale))
    throw new Error("Invalid interface scale target.");
  return Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, automaticZoom * userScale)) * 1000) / 1000;
}

module.exports = { isInterfaceScale, effectiveZoom };
