import { useEffect, useState } from "react";
import type { ProviderConfiguration } from "./providers/types";
import type { ProviderId } from "./types";
import { useLocalization } from "./localization/Localization";
import { isolateBidi } from "./localization/bidi";
import type { StringKey } from "./localization/format";
import type { CredentialChange, CredentialProvider } from "./settingsDraft";

const categoryKeys: Record<ProviderId, StringKey> = {
  igdb: "providers.games",
  rawg: "providers.games",
  tmdb: "providers.moviesTv",
  omdb: "providers.moviesTv",
  ranobedb: "providers.lightNovels",
  tenrai: "providers.animeManga",
  jikan: "providers.animeManga",
};
type Notice = { key: StringKey; provider?: string };
const failureKeys: Record<string, StringKey> = {
  "credential-unreadable": "providers.credentialUnreadable",
  "protection-unavailable": "providers.protectionUnavailable",
  "credential-required": "providers.credentialRequired",
  "not-configured": "providers.notConfiguredHelp",
  "connection-failed": "providers.connectionFailedHelp",
  credentials: "providers.credentialsRejected",
  timeout: "providers.timeout",
  "rate-limit": "providers.rateLimit",
  network: "providers.network",
};
const failureKey = (code?: string): StringKey =>
  (code && failureKeys[code]) || "providers.operationFailed";

export function OnlineSourcesSettings({
  changes,
  onChange,
}: {
  changes: Partial<Record<CredentialProvider, CredentialChange>>;
  onChange: (
    next: Partial<Record<CredentialProvider, CredentialChange>>,
  ) => void;
}) {
  const { t } = useLocalization();
  const [providers, setProviders] = useState<ProviderConfiguration[]>([]);
  const [busy, setBusy] = useState<ProviderId>();
  const [message, setMessage] = useState<Notice>();

  const refresh = async () => {
    if (!window.everiaProviders?.configuration) {
      setMessage({ key: "providers.desktopOnly" });
      return;
    }
    try {
      const response = await window.everiaProviders.configuration();
      if (response.ok && response.data) setProviders(response.data);
      else setMessage({ key: failureKey(response.errorCode) });
    } catch {
      setMessage({ key: "providers.operationFailed" });
    }
  };
  useEffect(() => {
    if (Object.values(changes).every((change) => !change)) void refresh();
  }, [changes]);

  const editToken = (provider: "tmdb" | "rawg" | "omdb", token: string) => {
    const next = { ...changes };
    if (token) next[provider] = { kind: "save", credentials: { token } };
    else delete next[provider];
    onChange(next);
  };
  const editIgdb = (key: "clientId" | "clientSecret", value: string) => {
    const current =
      changes.igdb?.kind === "save" && "clientId" in changes.igdb.credentials
        ? changes.igdb.credentials
        : { clientId: "", clientSecret: "" };
    const fields = { ...current, [key]: value };
    const next = { ...changes };
    if (fields.clientId || fields.clientSecret)
      next.igdb = { kind: "save", credentials: fields };
    else delete next.igdb;
    onChange(next);
  };
  const toggleRemoval = (provider: CredentialProvider) => {
    const next = { ...changes };
    if (next[provider]?.kind === "remove") delete next[provider];
    else next[provider] = { kind: "remove" };
    onChange(next);
  };
  const tokenValue = (provider: "tmdb" | "rawg" | "omdb") => {
    const change = changes[provider];
    return change?.kind === "save" && "token" in change.credentials
      ? change.credentials.token
      : "";
  };
  const test = async (provider: ProviderId) => {
    setBusy(provider);
    setMessage(undefined);
    const providerName =
      providers.find((item) => item.id === provider)?.name ?? provider;
    try {
      const pending = changes[provider as CredentialProvider];
      if (pending?.kind === "remove") {
        setMessage({
          key: "providers.notConfiguredHelp",
          provider: providerName,
        });
        return;
      }
      if (
        pending?.kind === "save" &&
        Object.values(pending.credentials).some((value) => !value.trim())
      ) {
        setMessage({
          key: "providers.credentialRequired",
          provider: providerName,
        });
        return;
      }
      const response =
        pending?.kind === "save"
          ? await window.everiaProviders!.testDraftCredentials({
              provider: provider as CredentialProvider,
              credentials: pending.credentials as { token: string },
            })
          : await window.everiaProviders!.testConnection(provider);
      setMessage({
        key: response.ok
          ? pending
            ? "providers.draftTestPassed"
            : "providers.connected"
          : failureKey(response.errorCode),
        provider: providerName,
      });
      if (!pending) await refresh();
    } catch {
      setMessage({ key: "providers.operationFailed", provider: providerName });
    } finally {
      setBusy(undefined);
    }
  };

  const stateLabel = (provider: ProviderConfiguration) =>
    provider.state === "connected"
      ? t("providers.stateConnected")
      : provider.state === "connection-failed"
        ? t("providers.stateFailed")
        : provider.state === "unchecked"
          ? t(
              provider.requiresCredentials
                ? "providers.stateUnchecked"
                : "providers.stateAvailable",
            )
          : t("providers.stateNotConfigured");

  return (
    <div className="provider-settings-grid">
      {providers.map((provider) => (
        <article className="provider-setting" key={provider.id}>
          <div className="provider-setting-heading">
            <div>
              <div className="provider-name-row">
                <h3 dir="ltr">{provider.name}</h3>
                <span className={`provider-role ${provider.role}`}>
                  {t(
                    provider.role === "primary"
                      ? "providers.primary"
                      : "providers.backup",
                  )}
                </span>
              </div>
              <p>{t(categoryKeys[provider.id])}</p>
            </div>
            <span className={`connection-state ${provider.state}`}>
              {stateLabel(provider)}
            </span>
          </div>
          {provider.reasonCode && provider.reasonCode !== "not-configured" && (
            <p className="no-configuration">
              {t(failureKey(provider.reasonCode), {
                provider: isolateBidi(provider.name),
              })}
            </p>
          )}
          {provider.id === "igdb" && (
            <div className="provider-fields">
              <label>
                {t("providers.clientId")}
                <input
                  dir="ltr"
                  value={
                    changes.igdb?.kind === "save" &&
                    "clientId" in changes.igdb.credentials
                      ? changes.igdb.credentials.clientId
                      : ""
                  }
                  onChange={(event) => editIgdb("clientId", event.target.value)}
                  placeholder={
                    provider.clientIdHint || t("providers.twitchClientId")
                  }
                  autoComplete="off"
                />
              </label>
              <label>
                {t("providers.clientSecret")}
                <input
                  dir="ltr"
                  type="password"
                  value={
                    changes.igdb?.kind === "save" &&
                    "clientSecret" in changes.igdb.credentials
                      ? changes.igdb.credentials.clientSecret
                      : ""
                  }
                  onChange={(event) =>
                    editIgdb("clientSecret", event.target.value)
                  }
                  placeholder={
                    provider.configured
                      ? t("providers.savedSecurely")
                      : t("providers.twitchSecret")
                  }
                  autoComplete="new-password"
                />
              </label>
            </div>
          )}
          {provider.id === "tmdb" && (
            <div className="provider-fields one-field">
              <label>
                {t("providers.readToken")}
                <input
                  dir="ltr"
                  type="password"
                  value={
                    changes.tmdb?.kind === "save" &&
                    "token" in changes.tmdb.credentials
                      ? changes.tmdb.credentials.token
                      : ""
                  }
                  onChange={(event) => editToken("tmdb", event.target.value)}
                  placeholder={
                    provider.configured
                      ? t("providers.savedSecurely")
                      : t("providers.tmdbToken")
                  }
                  autoComplete="new-password"
                />
              </label>
            </div>
          )}
          {(provider.id === "rawg" || provider.id === "omdb") && (
            <div className="provider-fields one-field">
              <label>
                {t("providers.apiKey")}
                <input
                  dir="ltr"
                  type="password"
                  value={tokenValue(provider.id as "rawg" | "omdb")}
                  onChange={(event) =>
                    editToken(
                      provider.id as "rawg" | "omdb",
                      event.target.value,
                    )
                  }
                  placeholder={
                    provider.configured
                      ? t("providers.savedSecurely")
                      : t("providers.providerApiKey", {
                          provider: provider.name,
                        })
                  }
                  autoComplete="new-password"
                />
              </label>
            </div>
          )}
          {!provider.requiresCredentials && (
            <p className="no-configuration">{t("providers.noConfiguration")}</p>
          )}
          <div className="provider-actions">
            {changes[provider.id as CredentialProvider] && (
              <span className="provider-pending">
                {t(
                  changes[provider.id as CredentialProvider]?.kind === "remove"
                    ? "providers.pendingRemoval"
                    : "providers.pending",
                )}
              </span>
            )}
            <button
              className="secondary"
              disabled={busy === provider.id}
              onClick={() => void test(provider.id)}
            >
              {busy === provider.id
                ? t("providers.testing")
                : t("providers.testConnection")}
            </button>
            {provider.requiresCredentials && (
              <button
                className="quiet-danger"
                disabled={
                  (!provider.configured &&
                    !changes[provider.id as CredentialProvider]) ||
                  busy === provider.id
                }
                onClick={() => toggleRemoval(provider.id as CredentialProvider)}
              >
                {t(
                  changes[provider.id as CredentialProvider]?.kind === "remove"
                    ? "providers.cancelRemoval"
                    : "providers.removeCredentials",
                )}
              </button>
            )}
          </div>
        </article>
      ))}
      {message && (
        <p className="provider-message" role="status">
          {t(message.key, {
            provider: message.provider ? isolateBidi(message.provider) : "",
          })}
        </p>
      )}
    </div>
  );
}
