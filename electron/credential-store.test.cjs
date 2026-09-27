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
    (error) => error.code === "protection-unavailable" && /Protected credential storage/.test(error.message),
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

test("truncated credentials are preserved and cannot be silently replaced", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "everia-corrupt-"));
  const filePath = path.join(directory, "credentials.json");
  const original = '{"version":1,"providers":';
  fs.writeFileSync(filePath, original);
  const store = createCredentialStore({
    filePath,
    platform: "win32",
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    },
  });
  assert.throws(() => store.status("tmdb"), (error) => error.code === "credential-unreadable");
  assert.throws(() => store.get("tmdb"), /could not be read/);
  assert.throws(() => store.save("tmdb", { token: "new secret" }), /could not be read/);
  assert.throws(() => store.remove("tmdb"), /could not be read/);
  assert.equal(fs.readFileSync(filePath, "utf8"), original);
});

test("unsupported credential document shape is preserved", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "everia-schema-"));
  const filePath = path.join(directory, "credentials.json");
  const original = '{"version":2,"providers":{}}';
  fs.writeFileSync(filePath, original);
  const store = createCredentialStore({
    filePath,
    platform: "win32",
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
    },
  });
  assert.throws(() => store.save("tmdb", { token: "new" }), /could not be read/);
  assert.equal(fs.readFileSync(filePath, "utf8"), original);
});

test("credential write failure does not report a successful save", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "everia-write-"));
  const store = createCredentialStore({
    filePath: directory,
    platform: "win32",
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
    },
  });
  assert.throws(() => store.save("tmdb", { token: "secret" }));
  assert.equal(fs.statSync(directory).isDirectory(), true);
});

test("draft credential batch is atomic, encrypted, and leaves old secrets after failure", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "everia-credential-batch-"));
  const filePath = path.join(directory, "credentials.json");
  let fail = false;
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      if (fail && value === "failure") throw new Error("encryption failed");
      return Buffer.from(`protected:${value}`);
    },
    decryptString: (value) => value.toString().replace(/^protected:/, ""),
  };
  const store = createCredentialStore({ filePath, safeStorage, platform: "win32" });
  store.save("tmdb", { token: "original" });
  const before = fs.readFileSync(filePath);
  fail = true;
  assert.throws(() => store.applyBatch([
    { provider: "tmdb", kind: "save", credentials: { token: "replacement" } },
    { provider: "rawg", kind: "save", credentials: { token: "failure" } },
  ]));
  assert.deepEqual(fs.readFileSync(filePath), before);
  assert.deepEqual(store.get("tmdb"), { token: "original" });
  fail = false;
  store.applyBatch([
    { provider: "tmdb", kind: "save", credentials: { token: "replacement" } },
    { provider: "omdb", kind: "remove" },
  ]);
  assert.deepEqual(store.get("tmdb"), { token: "replacement" });
  assert.doesNotMatch(fs.readFileSync(filePath, "utf8"), /replacement|original/);
  assert.throws(() => store.applyBatch([
    { provider: "tmdb", kind: "save", credentials: { token: "another" } },
    { provider: "tmdb", kind: "remove" },
  ]), (error) => error.code === "invalid-request");
  assert.deepEqual(store.get("tmdb"), { token: "replacement" });
});
