import { useEffect, useRef, useState, type RefObject } from "react";
import type {
  ProviderConfiguration,
  ProviderResponse,
} from "./providers/types";
import type { ProviderId } from "./types";
import { useLocalization } from "./localization/Localization";
import { isolateBidi } from "./localization/bidi";
import type { StringKey } from "./localization/format";

const categoryKeys: Record<ProviderId, StringKey> = {
  igdb: "providers.games",
  rawg: "providers.games",
  tmdb: "providers.moviesTv",
  omdb: "providers.moviesTv",
  ranobedb: "providers.lightNovels",
  tenrai: "providers.animeManga",
  jikan: "providers.animeManga",
};
type Action = "save" | "test" | "remove";
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

export function OnlineSourcesSettings() {
  const { t } = useLocalization();
  const [providers, setProviders] = useState<ProviderConfiguration[]>([]);
  const [busy, setBusy] = useState<ProviderId>();
  const [busyAction, setBusyAction] = useState<Action>();
  const [message, setMessage] = useState<Notice>();
  const igdbClientId = useRef<HTMLInputElement>(null);
  const igdbSecret = useRef<HTMLInputElement>(null);
  const tmdbToken = useRef<HTMLInputElement>(null);
  const rawgKey = useRef<HTMLInputElement>(null);
  const omdbKey = useRef<HTMLInputElement>(null);

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
    void refresh();
  }, []);

  const perform = async (
    provider: ProviderId,
    action: Action,
    operation: () => Promise<ProviderResponse<unknown>>,
  ) => {
    setBusy(provider);
    setBusyAction(action);
    setMessage(undefined);
    const providerName =
      providers.find((item) => item.id === provider)?.name ?? provider;
    try {
      const response = await operation();
      setMessage({
        key: response.ok
          ? action === "remove"
            ? "providers.removed"
            : "providers.connected"
          : failureKey(response.errorCode),
        provider: providerName,
      });
      await refresh();
    } catch {
      setMessage({ key: "providers.operationFailed", provider: providerName });
    } finally {
      setBusy(undefined);
      setBusyAction(undefined);
    }
  };

  const saveIgdb = () =>
    perform("igdb", "save", async () => {
      try {
        return await window.everiaProviders!.saveCredentials({
          provider: "igdb",
          credentials: {
            clientId: igdbClientId.current?.value,
            clientSecret: igdbSecret.current?.value,
          },
        });
      } finally {
        if (igdbSecret.current) igdbSecret.current.value = "";
      }
    });
  const saveTmdb = () =>
    perform("tmdb", "save", async () => {
      try {
        return await window.everiaProviders!.saveCredentials({
          provider: "tmdb",
          credentials: { token: tmdbToken.current?.value },
        });
      } finally {
        if (tmdbToken.current) tmdbToken.current.value = "";
      }
    });
  const saveKey = (
    provider: "rawg" | "omdb",
    input: RefObject<HTMLInputElement | null>,
  ) =>
    perform(provider, "save", async () => {
      try {
        return await window.everiaProviders!.saveCredentials({
          provider,
          credentials: { token: input.current?.value },
        });
      } finally {
        if (input.current) input.current.value = "";
      }
    });

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
  const actionLabel = (
    provider: ProviderId,
    action: Action,
    idle: StringKey,
  ) =>
    busy === provider && busyAction === action
      ? t(
          action === "test"
            ? "providers.testing"
            : action === "remove"
              ? "providers.removing"
              : "providers.saving",
        )
      : t(idle);

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
                  ref={igdbClientId}
                  dir="ltr"
                  defaultValue=""
                  placeholder={
                    provider.clientIdHint || t("providers.twitchClientId")
                  }
                  autoComplete="off"
                />
              </label>
              <label>
                {t("providers.clientSecret")}
                <input
                  ref={igdbSecret}
                  dir="ltr"
                  type="password"
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
                  ref={tmdbToken}
                  dir="ltr"
                  type="password"
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
                  ref={provider.id === "rawg" ? rawgKey : omdbKey}
                  dir="ltr"
                  type="password"
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
            {provider.id === "igdb" && (
              <button
                className="primary"
                disabled={busy === provider.id}
                onClick={() => void saveIgdb()}
              >
                {actionLabel(provider.id, "save", "providers.saveConnect")}
              </button>
            )}
            {provider.id === "tmdb" && (
              <button
                className="primary"
                disabled={busy === provider.id}
                onClick={() => void saveTmdb()}
              >
                {actionLabel(provider.id, "save", "providers.saveConnect")}
              </button>
            )}
            {provider.id === "rawg" && (
              <button
                className="primary"
                disabled={busy === provider.id}
                onClick={() => void saveKey("rawg", rawgKey)}
              >
                {actionLabel(provider.id, "save", "providers.saveConnect")}
              </button>
            )}
            {provider.id === "omdb" && (
              <button
                className="primary"
                disabled={busy === provider.id}
                onClick={() => void saveKey("omdb", omdbKey)}
              >
                {actionLabel(provider.id, "save", "providers.saveConnect")}
              </button>
            )}
            <button
              className="secondary"
              disabled={busy === provider.id}
              onClick={() =>
                void perform(provider.id, "test", () =>
                  window.everiaProviders!.testConnection(provider.id),
                )
              }
            >
              {actionLabel(provider.id, "test", "providers.testConnection")}
            </button>
            {provider.requiresCredentials && (
              <button
                className="quiet-danger"
                disabled={!provider.configured || busy === provider.id}
                onClick={() =>
                  void perform(provider.id, "remove", () =>
                    window.everiaProviders!.removeCredentials(
                      provider.id as "igdb" | "rawg" | "tmdb" | "omdb",
                    ),
                  )
                }
              >
                {actionLabel(
                  provider.id,
                  "remove",
                  "providers.removeCredentials",
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
