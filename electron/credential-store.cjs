const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
function credentialError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createCredentialStore({
  safeStorage,
  filePath,
  platform = process.platform,
}) {
  const assertProtected = () => {
    if (!safeStorage?.isEncryptionAvailable()) {
      throw credentialError(
        "Protected credential storage is unavailable on this device.",
        "protection-unavailable",
      );
    }
    if (
      platform === "linux" &&
      typeof safeStorage.getSelectedStorageBackend === "function" &&
      safeStorage.getSelectedStorageBackend() === "basic_text"
    ) {
      throw credentialError(
        "Protected credential storage is unavailable on this device.",
        "protection-unavailable",
      );
    }
  };

  const readDocument = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (
        parsed?.version !== 1 ||
        !parsed.providers ||
        typeof parsed.providers !== "object" ||
        Array.isArray(parsed.providers)
      ) throw new Error("Invalid credential document.");
      return parsed;
    } catch (error) {
      if (error?.code === "ENOENT") return { version: 1, providers: {} };
      throw credentialError("Saved provider credentials could not be read.", "credential-unreadable");
    }
  };

  const writeDocument = (document) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(document), {
      encoding: "utf8",
      mode: 0o600,
    });
  };
  const writeDocumentAtomically = (document) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const staged = `${filePath}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(staged, JSON.stringify(document), { flag: "wx", mode: 0o600 });
      const handle = fs.openSync(staged, "r+");
      try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
      fs.renameSync(staged, filePath);
    } finally { try { fs.unlinkSync(staged); } catch {} }
  };

  const encrypt = (value) => {
    assertProtected();
    return safeStorage.encryptString(value).toString("base64");
  };
  const decrypt = (value) => {
    assertProtected();
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  };

  return {
    isProtected() {
      try {
        assertProtected();
        return true;
      } catch {
        return false;
      }
    },
    status(provider) {
      const record = readDocument().providers[provider];
      return {
        configured: Boolean(
          provider === "igdb"
            ? record?.clientId && record?.clientSecret
            : record?.token,
        ),
        clientIdHint:
          provider === "igdb" && record?.clientId
            ? `${record.clientId.slice(0, 4)}••••`
            : undefined,
      };
    },
    get(provider) {
      const record = readDocument().providers[provider];
      if (!record) return undefined;
      if (provider === "igdb" && record.clientId && record.clientSecret) {
        return {
          clientId: record.clientId,
          clientSecret: decrypt(record.clientSecret),
        };
      }
      if (["tmdb", "rawg", "omdb"].includes(provider) && record.token)
        return { token: decrypt(record.token) };
      return undefined;
    },
    save(provider, input) {
      assertProtected();
      const document = readDocument();
      if (provider === "igdb") {
        const clientId = String(input?.clientId || "").trim();
        const clientSecret = String(input?.clientSecret || "").trim();
        if (!clientId || !clientSecret)
          throw credentialError("Client ID and Client Secret are required.", "credential-required");
        document.providers.igdb = {
          clientId,
          clientSecret: encrypt(clientSecret),
        };
      } else if (["tmdb", "rawg", "omdb"].includes(provider)) {
        const token = String(input?.token || "").trim();
        if (!token)
          throw credentialError(
            provider === "tmdb"
              ? "API Read Access Token is required."
              : "API key is required.",
            "credential-required",
          );
        document.providers[provider] = { token: encrypt(token) };
      } else {
        throw new Error("This provider does not use credentials.");
      }
      writeDocument(document);
    },
    remove(provider) {
      const document = readDocument();
      delete document.providers[provider];
      writeDocument(document);
    },
    applyBatch(operations) {
      if (!Array.isArray(operations) || operations.length < 1 || operations.length > 4)
        throw credentialError("Invalid credential operation.", "invalid-request");
      const document = readDocument();
      const seen = new Set();
      for (const operation of operations) {
        const provider = operation?.provider;
        if (!["igdb", "rawg", "tmdb", "omdb"].includes(provider) || seen.has(provider) ||
            !["save", "remove"].includes(operation?.kind))
          throw credentialError("Invalid credential operation.", "invalid-request");
        seen.add(provider);
        if (operation.kind === "remove") {
          if (Object.keys(operation).sort().join() !== "kind,provider")
            throw credentialError("Invalid credential operation.", "invalid-request");
          delete document.providers[provider];
          continue;
        }
        assertProtected();
        if (Object.keys(operation).sort().join() !== "credentials,kind,provider" ||
            !operation.credentials || typeof operation.credentials !== "object" ||
            Array.isArray(operation.credentials) ||
            Object.keys(operation.credentials).sort().join() !==
              (provider === "igdb" ? "clientId,clientSecret" : "token"))
          throw credentialError("Invalid credential operation.", "invalid-request");
        if (provider === "igdb") {
          const { clientId, clientSecret } = operation.credentials ?? {};
          if (typeof clientId !== "string" || typeof clientSecret !== "string" ||
              !clientId.trim() || !clientSecret.trim() ||
              clientId.length > 4096 || clientSecret.length > 4096)
            throw credentialError("Required credential fields are missing.", "credential-required");
          document.providers[provider] = { clientId: clientId.trim(), clientSecret: encrypt(clientSecret.trim()) };
        } else {
          const token = operation.credentials?.token;
          if (typeof token !== "string" || !token.trim() || token.length > 4096)
            throw credentialError("Required credential fields are missing.", "credential-required");
          document.providers[provider] = { token: encrypt(token.trim()) };
        }
      }
      writeDocumentAtomically(document);
    },
  };
}

module.exports = { createCredentialStore };
