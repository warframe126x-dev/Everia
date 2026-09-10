import { useEffect, useRef, useState } from "react";
import type { ProviderConfiguration } from "./providers/types";
import type { ProviderId } from "./types";

const categoryCopy: Record<ProviderId, string> = {
  igdb: "Games",
  tmdb: "Movies & TV Shows",
  ranobedb: "Light Novels",
  jikan: "Anime & Manga",
};

export function OnlineSourcesSettings() {
  const [providers, setProviders] = useState<ProviderConfiguration[]>([]);
  const [busy, setBusy] = useState<ProviderId>();
  const [message, setMessage] = useState("");
  const igdbClientId = useRef<HTMLInputElement>(null);
  const igdbSecret = useRef<HTMLInputElement>(null);
  const tmdbToken = useRef<HTMLInputElement>(null);

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
    setMessage(
      response.ok
        ? `${provider.toUpperCase()} is connected.`
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

  const stateLabel = (provider: ProviderConfiguration) =>
    provider.state === "connected"
      ? "Connected"
      : provider.state === "connection-failed"
        ? "Connection failed"
        : provider.state === "unchecked"
          ? "Not checked"
          : "Not configured";

  return (
    <div className="provider-settings-grid">
      {providers.map((provider) => (
        <article className="provider-setting" key={provider.id}>
          <div className="provider-setting-heading">
            <div>
              <h3>{provider.name}</h3>
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
                      provider.id as "igdb" | "tmdb",
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
