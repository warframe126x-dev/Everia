const SUPPORTED = new Set(["igdb", "rawg", "tmdb", "omdb"]);
const SAFE_CODES = new Set([
  "credentials",
  "credential-required",
  "timeout",
  "rate-limit",
  "network",
  "unavailable",
]);

function validateDraftRequest(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).sort().join() !== "credentials,provider" ||
    !SUPPORTED.has(input.provider)
  )
    return null;
  const values = input.credentials;
  if (!values || typeof values !== "object" || Array.isArray(values))
    return null;
  const expected =
    input.provider === "igdb" ? ["clientId", "clientSecret"] : ["token"];
  if (
    Object.keys(values).sort().join() !== expected.sort().join() ||
    !expected.every(
      (key) =>
        typeof values[key] === "string" &&
        values[key].trim().length > 0 &&
        values[key].length <= 4096,
    )
  )
    return null;
  return { provider: input.provider, credentials: values };
}

async function testDraftRequest(input, test) {
  const request = validateDraftRequest(input);
  if (!request) return { ok: false, errorCode: "invalid-request" };
  try {
    await test(request.provider, request.credentials);
    return { ok: true, code: "success" };
  } catch (error) {
    return {
      ok: false,
      errorCode: SAFE_CODES.has(error?.code) ? error.code : "connection-failed",
    };
  }
}

module.exports = { testDraftRequest, validateDraftRequest };
