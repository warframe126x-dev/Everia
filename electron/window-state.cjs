const fs = require("node:fs");

const DEFAULT_WIDTH = 1600;
const DEFAULT_HEIGHT = 900;
const MIN_WIDTH = 960;
const MIN_HEIGHT = 640;
const BASELINE_PHYSICAL_WIDTH = 1920;
const BASELINE_PHYSICAL_HEIGHT = 1050;
const MAX_ZOOM = 4 / 3;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function centeredInitialBounds(workArea) {
  const availableWidth = Math.max(MIN_WIDTH, workArea.width - 48);
  const availableHeight = Math.max(MIN_HEIGHT, workArea.height - 48);
  const fit = Math.min(
    1,
    availableWidth / DEFAULT_WIDTH,
    availableHeight / DEFAULT_HEIGHT,
  );
  const width = Math.max(MIN_WIDTH, Math.floor(DEFAULT_WIDTH * fit));
  const height = Math.max(MIN_HEIGHT, Math.floor((width * 9) / 16));
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  };
}

function intersectsWorkArea(bounds, workArea) {
  const width = Math.max(
    0,
    Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
      Math.max(bounds.x, workArea.x),
  );
  const height = Math.max(
    0,
    Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
      Math.max(bounds.y, workArea.y),
  );
  return width >= 120 && height >= 80;
}

function clampBoundsToWorkArea(bounds, workArea) {
  const width = clamp(bounds.width, MIN_WIDTH, workArea.width);
  const height = clamp(bounds.height, MIN_HEIGHT, workArea.height);
  return {
    x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - height),
    width,
    height,
  };
}

function resolveWindowState(saved, displays, primaryDisplay) {
  if (!saved?.bounds || !Number.isFinite(saved.bounds.width)) {
    return {
      bounds: centeredInitialBounds(primaryDisplay.workArea),
      maximized: false,
    };
  }

  const rememberedDisplay = displays.find(
    (display) => String(display.id) === String(saved.displayId),
  );
  const visibleDisplay = displays.find((display) =>
    intersectsWorkArea(saved.bounds, display.workArea),
  );
  const target = rememberedDisplay || visibleDisplay || primaryDisplay;
  return {
    bounds: clampBoundsToWorkArea(saved.bounds, target.workArea),
    maximized: Boolean(saved.maximized),
  };
}

function responsiveZoom(contentBounds, display) {
  const scaleFactor = Number(display?.scaleFactor) || 1;
  const physicalWidth = contentBounds.width * scaleFactor;
  const physicalHeight = contentBounds.height * scaleFactor;
  const zoom = Math.min(
    physicalWidth / BASELINE_PHYSICAL_WIDTH,
    physicalHeight / BASELINE_PHYSICAL_HEIGHT,
  );
  return Math.round(clamp(zoom, 1, MAX_ZOOM) * 1000) / 1000;
}

function loadWindowState(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed?.version === 1 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function saveWindowState(filePath, state) {
  try {
    fs.mkdirSync(require("node:path").dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({ version: 1, ...state }),
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  centeredInitialBounds,
  clampBoundsToWorkArea,
  intersectsWorkArea,
  loadWindowState,
  resolveWindowState,
  responsiveZoom,
  saveWindowState,
};
