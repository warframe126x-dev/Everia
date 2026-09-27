const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { testDraftRequest } = require("./draft-credential-test.cjs");
const providers = require("./providers.cjs");

const originalFetch = global.fetch;
const originalEnv = process.env.EVERIA_TMDB_TOKEN;
afterEach(() => {
  global.fetch = originalFetch;
  providers.configureCredentialStore(undefined);
  providers.resetProviderSession("tmdb");
  providers.resetProviderSession("igdb");
  if (originalEnv === undefined) delete process.env.EVERIA_TMDB_TOKEN;
  else process.env.EVERIA_TMDB_TOKEN = originalEnv;
});

test("draft test uses submitted TMDB token once without reading or writing the saved store", async () => {
  const writes = [];
  const store = {
    get: () => ({ token: "saved-secret" }),
    status: () => ({ configured: true }),
    isProtected: () => true,
    save: (...args) => writes.push(args),
    remove: (...args) => writes.push(args),
  };
  providers.configureCredentialStore(store);
  process.env.EVERIA_TMDB_TOKEN = "environment-secret";
  const beforeEnv = process.env.EVERIA_TMDB_TOKEN;
  const seen = [];
  global.fetch = async (_url, init) => {
    seen.push(init.headers.Authorization);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const request = { provider: "tmdb", credentials: { token: "draft-secret" } };
  assert.deepEqual(
    await testDraftRequest(request, providers.testDraftCredentials),
    { ok: true, code: "success" },
  );
  assert.equal(providers.providerStatus("tmdb").state, "unchecked");
  await providers.testConnection("tmdb");
  assert.deepEqual(seen, ["Bearer draft-secret", "Bearer saved-secret"]);
  assert.deepEqual(writes, []);
  assert.equal(store.get("tmdb").token, "saved-secret");
  assert.equal(process.env.EVERIA_TMDB_TOKEN, beforeEnv);
});

test("failed draft test does not replace committed credentials, mutate session, or echo secrets", async () => {
  let writes = 0;
  providers.configureCredentialStore({
    get: () => ({ token: "saved-secret" }),
    status: () => ({ configured: true }),
    isProtected: () => true,
    save: () => writes++,
  });
  global.fetch = async (_url, init) => ({
    ok: init.headers.Authorization === "Bearer saved-secret",
    status: init.headers.Authorization === "Bearer saved-secret" ? 200 : 401,
    json: async () => ({}),
  });
  const captured = [];
  const previousLog = console.error;
  console.error = (...args) => captured.push(args);
  try {
    const result = await testDraftRequest(
      { provider: "tmdb", credentials: { token: "bad-draft-secret" } },
      providers.testDraftCredentials,
    );
    assert.deepEqual(result, { ok: false, errorCode: "credentials" });
    assert.equal(providers.providerStatus("tmdb").state, "unchecked");
    assert.equal(writes, 0);
    assert.equal((await providers.testConnection("tmdb")).state, "connected");
    assert.doesNotMatch(
      JSON.stringify({ result, captured }),
      /bad-draft-secret|saved-secret/,
    );
  } finally {
    console.error = previousLog;
  }
});

test("IGDB draft authentication neither overwrites the saved token nor fills its cache", async () => {
  providers.configureCredentialStore({
    get: () => ({ clientId: "saved-id", clientSecret: "saved-secret" }),
    status: () => ({ configured: true }),
    isProtected: () => true,
  });
  const requests = [];
  global.fetch = async (url) => {
    requests.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({ access_token: "test-access", expires_in: 3600 }),
    };
  };
  assert.deepEqual(
    await testDraftRequest(
      {
        provider: "igdb",
        credentials: { clientId: "draft-id", clientSecret: "draft-secret" },
      },
      providers.testDraftCredentials,
    ),
    { ok: true, code: "success" },
  );
  await providers.testConnection("igdb");
  assert.match(requests[0], /client_id=draft-id/);
  assert.match(requests[1], /client_id=saved-id/);
});

test("draft IPC validation rejects malformed input without invoking providers or leaking values", async () => {
  let calls = 0;
  const invoke = () => {
    calls++;
    throw new Error("secret in diagnostic");
  };
  for (const input of [
    { provider: "jikan", credentials: { token: "secret" } },
    { provider: "tmdb", credentials: { token: "" } },
    { provider: "igdb", credentials: { clientId: "id", token: "secret" } },
    { provider: "omdb", credentials: { token: "secret", extra: "secret" } },
  ])
    assert.deepEqual(await testDraftRequest(input, invoke), {
      ok: false,
      errorCode: "invalid-request",
    });
  assert.equal(calls, 0);
  assert.deepEqual(
    await testDraftRequest(
      { provider: "rawg", credentials: { token: "secret" } },
      invoke,
    ),
    { ok: false, errorCode: "connection-failed" },
  );
});

test("RAWG and OMDb draft checks use only submitted values", async () => {
  const reads = [];
  providers.configureCredentialStore({
    get: (provider) => {
      reads.push(provider);
      return { token: "saved-secret" };
    },
    status: () => ({ configured: true }),
    isProtected: () => true,
  });
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ Response: "True" }) };
  };
  for (const provider of ["rawg", "omdb"])
    assert.deepEqual(
      await testDraftRequest(
        { provider, credentials: { token: "draft-secret" } },
        providers.testDraftCredentials,
      ),
      { ok: true, code: "success" },
    );
  assert.equal(reads.length, 0);
  assert.ok(
    urls.every(
      (url) => url.includes("draft-secret") && !url.includes("saved-secret"),
    ),
  );
});

test("preload exposes only the named draft test IPC channel", async () => {
  const exposed = {};
  const invoked = [];
  vm.runInNewContext(
    readFileSync(path.join(__dirname, "preload.cjs"), "utf8"),
    {
      require: () => ({
        contextBridge: {
          exposeInMainWorld: (name, value) => {
            exposed[name] = value;
          },
        },
        ipcRenderer: {
          invoke: async (...args) => {
            invoked.push(args);
            return { ok: true, code: "success" };
          },
        },
      }),
    },
  );
  const request = { provider: "tmdb", credentials: { token: "draft-secret" } };
  assert.equal(
    (await exposed.everiaProviders.testDraftCredentials(request)).code,
    "success",
  );
  assert.equal(invoked[0][0], "providers:test-draft");
  assert.equal(invoked[0][1], request);
  assert.equal(exposed.everiaProviders.invoke, undefined);
});
