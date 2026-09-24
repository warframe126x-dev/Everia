const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");
const { createCredentialStore } = require("../electron/credential-store.cjs");
const { loadWindowState } = require("../electron/window-state.cjs");

app.setName("Everia");
app.whenReady().then(() => {
  const directory = app.getPath("userData");
  const credentialFile = path.join(directory, "provider-credentials.v1.json");
  const windowFile = path.join(directory, "window-state.v1.json");
  const store = createCredentialStore({ safeStorage, filePath: credentialFile });
  assert.equal(store.get("tmdb")?.token, "fixture-secret");
  const state = loadWindowState(windowFile);
  assert.equal(state?.version, 1);
  assert(state.bounds.width >= 960 && state.bounds.height >= 640);
  console.log("PROFILE_VERIFIED", JSON.stringify({
    directory, credentialBytes: fs.statSync(credentialFile).size,
    windowState: state,
  }));
  app.quit();
}).catch((error) => {
  console.error("PROFILE_VERIFICATION_FAILED", error);
  app.exit(1);
});
