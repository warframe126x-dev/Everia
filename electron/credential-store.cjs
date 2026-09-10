const fs = require("node:fs");
const path = require("node:path");

function createCredentialStore({
  safeStorage,
  filePath,
  platform = process.platform,
}) {
  const assertProtected = () => {
    if (!safeStorage?.isEncryptionAvailable()) {
      throw new Error(
        "Protected credential storage is unavailable on this device.",
      );
    }
    if (
      platform === "linux" &&
      typeof safeStorage.getSelectedStorageBackend === "function" &&
      safeStorage.getSelectedStorageBackend() === "basic_text"
    ) {
      throw new Error(
        "Protected credential storage is unavailable on this device.",
      );
    }
  };

  const readDocument = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return parsed?.version === 1 && parsed.providers
        ? parsed
        : { version: 1, providers: {} };
    } catch (error) {
      if (error?.code === "ENOENT") return { version: 1, providers: {} };
      throw new Error("Saved provider credentials could not be read.");
    }
  };

  const writeDocument = (document) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(document), {
      encoding: "utf8",
      mode: 0o600,
    });
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
      if (provider === "tmdb" && record.token)
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
          throw new Error("Client ID and Client Secret are required.");
        document.providers.igdb = {
          clientId,
          clientSecret: encrypt(clientSecret),
        };
      } else if (provider === "tmdb") {
        const token = String(input?.token || "").trim();
        if (!token) throw new Error("API Read Access Token is required.");
        document.providers.tmdb = { token: encrypt(token) };
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
  };
}

module.exports = { createCredentialStore };
