import { useEffect, useRef, useState, type RefObject } from "react";
import type { ProviderConfiguration } from "./providers/types";
import type { ProviderId } from "./types";

const categoryCopy: Record<ProviderId, string> = {
  igdb: "Games",
  rawg: "Games",
  tmdb: "Movies & TV Shows",
  omdb: "Movies & TV Shows",
  ranobedb: "Light Novels",
  tenrai: "Anime & Manga",
  jikan: "Anime & Manga",
};

export function OnlineSourcesSettings() {
  const [providers, setProviders] = useState<ProviderConfiguration[]>([]);
  const [busy, setBusy] = useState<ProviderId>();
  const [message, setMessage] = useState("");
  const igdbClientId = useRef<HTMLInputElement>(null);
  const igdbSecret = useRef<HTMLInputElement>(null);
  const tmdbToken = useRef<HTMLInputElement>(null);
  const rawgKey = useRef<HTMLInputElement>(null);
  const omdbKey = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    if (!window.everiaProviders?.configuration) {
      setMessage(
        "Online source configuration is available in the Everia desktop app.",
      );
      return;
    }
    const response = await window.everiaProviders.configuration();
    if (response.ok && response.data) setProviders(response.data);
    else
      setMessage(response.error ?? "Online source status could not be loaded.");
  };

  useEffect(() => {
    void refresh();
  }, []);

  const perform = async (
    provider: ProviderId,
    action: () => Promise<{ ok: boolean; error?: string }>,
  ) => {
    setBusy(provider);
    setMessage("");
    const response = await action();
    const providerName =
      providers.find((item) => item.id === provider)?.name ?? provider;
    setMessage(
      response.ok
        ? `${providerName} is connected.`
        : (response.error ?? "Connection failed."),
    );
    await refresh();
    setBusy(undefined);
  };

  const saveIgdb = () =>
    perform("igdb", async () => {
      const response = await window.everiaProviders!.saveCredentials({
        provider: "igdb",
        credentials: {
          clientId: igdbClientId.current?.value,
          clientSecret: igdbSecret.current?.value,
        },
      });
      if (igdbSecret.current) igdbSecret.current.value = "";
      return response;
    });

  const saveTmdb = () =>
    perform("tmdb", async () => {
      const response = await window.everiaProviders!.saveCredentials({
        provider: "tmdb",
        credentials: { token: tmdbToken.current?.value },
      });
      if (tmdbToken.current) tmdbToken.current.value = "";
      return response;
    });

  const saveKey = (
    provider: "rawg" | "omdb",
    input: RefObject<HTMLInputElement | null>,
  ) =>
    perform(provider, async () => {
      const response = await window.everiaProviders!.saveCredentials({
        provider,
        credentials: { token: input.current?.value },
      });
      if (input.current) input.current.value = "";
      return response;
    });

  const stateLabel = (provider: ProviderConfiguration) =>
    provider.state === "connected"
      ? "Connected"
      : provider.state === "connection-failed"
        ? "Connection failed"
        : provider.state === "unchecked"
          ? provider.requiresCredentials
            ? "Not checked"
            : "Available"
          : "Not configured";

  return (
    <div className="provider-settings-grid">
      {providers.map((provider) => (
        <article className="provider-setting" key={provider.id}>
          <div className="provider-setting-heading">
            <div>
              <div className="provider-name-row">
                <h3>{provider.name}</h3>
                <span className={`provider-role ${provider.role}`}>
                  {provider.role}
                </span>
              </div>
              <p>{categoryCopy[provider.id]}</p>
            </div>
            <span className={`connection-state ${provider.state}`}>
              {stateLabel(provider)}
            </span>
          </div>

          {provider.id === "igdb" && (
            <div className="provider-fields">
              <label>
                Client ID
                <input
                  ref={igdbClientId}
                  defaultValue=""
                  placeholder={provider.clientIdHint || "Twitch Client ID"}
                  autoComplete="off"
                />
              </label>
              <label>
                Client Secret
                <input
                  ref={igdbSecret}
                  type="password"
                  placeholder={
                    provider.configured
                      ? "Saved securely"
                      : "Twitch Client Secret"
                  }
                  autoComplete="new-password"
                />
              </label>
            </div>
          )}
          {provider.id === "tmdb" && (
            <div className="provider-fields one-field">
              <label>
                API Read Access Token
                <input
                  ref={tmdbToken}
                  type="password"
                  placeholder={
                    provider.configured
                      ? "Saved securely"
                      : "TMDB Read Access Token"
                  }
                  autoComplete="new-password"
                />
              </label>
            </div>
          )}
          {(provider.id === "rawg" || provider.id === "omdb") && (
            <div className="provider-fields one-field">
              <label>
                API Key
                <input
                  ref={provider.id === "rawg" ? rawgKey : omdbKey}
                  type="password"
                  placeholder={
                    provider.configured
                      ? "Saved securely"
                      : `${provider.name} API Key`
                  }
                  autoComplete="new-password"
                />
              </label>
            </div>
          )}
          {!provider.requiresCredentials && (
            <p className="no-configuration">No configuration required</p>
          )}

          <div className="provider-actions">
            {provider.id === "igdb" && (
              <button
                className="primary"
                disabled={busy === provider.id}
                onClick={() => void saveIgdb()}
              >
                Save / Connect
              </button>
            )}
            {provider.id === "tmdb" && (
              <button
                className="primary"
                disabled={busy === provider.id}
                onClick={() => void saveTmdb()}
              >
                Save / Connect
              </button>
            )}
            {provider.id === "rawg" && (
              <button
                className="primary"
                disabled={busy === provider.id}
                onClick={() => void saveKey("rawg", rawgKey)}
              >
                Save / Connect
              </button>
            )}
            {provider.id === "omdb" && (
              <button
                className="primary"
                disabled={busy === provider.id}
                onClick={() => void saveKey("omdb", omdbKey)}
              >
                Save / Connect
              </button>
            )}
            <button
              className="secondary"
              disabled={busy === provider.id}
              onClick={() =>
                void perform(provider.id, () =>
                  window.everiaProviders!.testConnection(provider.id),
                )
              }
            >
              Test Connection
            </button>
            {provider.requiresCredentials && (
              <button
                className="quiet-danger"
                disabled={!provider.configured || busy === provider.id}
                onClick={() =>
                  void perform(provider.id, () =>
                    window.everiaProviders!.removeCredentials(
                      provider.id as "igdb" | "rawg" | "tmdb" | "omdb",
                    ),
                  )
                }
              >
                Remove {provider.id === "igdb" ? "Credentials" : "Credential"}
              </button>
            )}
          </div>
        </article>
      ))}
      {message && (
        <p className="provider-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
