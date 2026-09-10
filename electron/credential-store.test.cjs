const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCredentialStore } = require("./credential-store.cjs");

test("credentials are encrypted on disk and secrets are never returned by status", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "everia-credentials-"),
  );
  const filePath = path.join(directory, "credentials.json");
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${value}`),
    decryptString: (value) => value.toString().replace(/^protected:/, ""),
  };
  const store = createCredentialStore({
    safeStorage,
    filePath,
    platform: "win32",
  });
  store.save("igdb", { clientId: "client-123", clientSecret: "secret-456" });
  const disk = fs.readFileSync(filePath, "utf8");
  assert.doesNotMatch(disk, /secret-456/);
  assert.deepEqual(store.get("igdb"), {
    clientId: "client-123",
    clientSecret: "secret-456",
  });
  assert.deepEqual(store.status("igdb"), {
    configured: true,
    clientIdHint: "clie••••",
  });
});

test("credential storage fails closed when OS encryption is unavailable", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "everia-credentials-"),
  );
  const store = createCredentialStore({
    safeStorage: { isEncryptionAvailable: () => false },
    filePath: path.join(directory, "credentials.json"),
    platform: "win32",
  });
  assert.throws(
    () => store.save("tmdb", { token: "token" }),
    /Protected credential storage/,
  );
});

test("RAWG and OMDb API keys use the same protected storage boundary", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "everia-provider-keys-"),
  );
  const filePath = path.join(directory, "credentials.json");
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${value}`),
    decryptString: (value) => value.toString().replace(/^protected:/, ""),
  };
  const store = createCredentialStore({
    safeStorage,
    filePath,
    platform: "win32",
  });
  store.save("rawg", { token: "rawg-secret" });
  store.save("omdb", { token: "omdb-secret" });
  const disk = fs.readFileSync(filePath, "utf8");
  assert.doesNotMatch(disk, /rawg-secret|omdb-secret/);
  assert.deepEqual(store.get("rawg"), { token: "rawg-secret" });
  assert.deepEqual(store.get("omdb"), { token: "omdb-secret" });
  assert.deepEqual(store.status("rawg"), {
    configured: true,
    clientIdHint: undefined,
  });
});
