import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { categoryLabel } from "./data";
import {
  providerById,
  providerForCategory,
  ProviderSearchError,
  searchProviderChain,
  type ImportCandidate,
} from "./providers";
import { categories, type Category, type ProviderId } from "./types";
import { useLocalization } from "./localization/Localization";
import { isolateBidi } from "./localization/bidi";

type Notice = {
  kind:
    | "desktop-only"
    | "not-supported"
    | "empty"
    | "fallback"
    | "all-unavailable"
    | "credentials"
    | "timeout"
    | "rate-limit"
    | "unavailable"
    | "details-unavailable";
  from?: string;
  to?: string;
};

function searchFailure(error: unknown): Notice {
  const code =
    error instanceof ProviderSearchError ? error.code : "unavailable";
  return {
    kind: [
      "desktop-only",
      "all-unavailable",
      "credentials",
      "timeout",
      "rate-limit",
    ].includes(code)
      ? (code as Notice["kind"])
      : "unavailable",
  };
}

export function OnlineSearch({
  category,
  setCategory,
  onUse,
  onConfigure,
}: {
  category: Category;
  setCategory: (category: Category) => void;
  onUse: (candidate: ImportCandidate) => void;
  onConfigure: () => void;
}) {
  const { locale, t, count } = useLocalization();
  const provider = providerForCategory(category);
  const [query, setQuery] = useState("");
  const [available, setAvailable] = useState(Boolean(window.everiaProviders));
  const [message, setMessage] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ImportCandidate[]>([]);
  const [selected, setSelected] = useState<ImportCandidate>();
  const [detailsFailed, setDetailsFailed] = useState(false);
  const [resultSource, setResultSource] = useState<ProviderId>();

  useEffect(() => {
    let active = true;
    setResults([]);
    setSelected(undefined);
    setDetailsFailed(false);
    setResultSource(undefined);
    if (!provider) {
      setAvailable(false);
      setMessage({ kind: "not-supported" });
      return () => {
        active = false;
      };
    }
    provider
      .status()
      .then((status) => {
        if (!active) return;
        setAvailable(Boolean(window.everiaProviders));
        if (!window.everiaProviders) setMessage({ kind: "desktop-only" });
      })
      .catch(() => {
        if (active) setMessage({ kind: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [category, provider]);

  const search = async () => {
    if (!provider || !available || query.trim().length < 2) return;
    setBusy(true);
    setMessage(null);
    setSelected(undefined);
    try {
      const response = await searchProviderChain(query.trim(), category);
      setResults(response.results);
      setResultSource(response.provider);
      setMessage(
        response.results.length === 0
          ? {
              kind: "empty",
              from: response.fallbackFrom,
              to: response.providerName,
            }
          : response.fallbackFrom
            ? {
                kind: "fallback",
                from: response.fallbackFrom,
                to: response.providerName,
              }
            : null,
      );
    } catch (error) {
      setResults([]);
      setResultSource(undefined);
      setMessage(searchFailure(error));
    } finally {
      setBusy(false);
    }
  };

  const useSelected = async () => {
    if (!selected) return;
    const resultProvider = providerById(selected.provider);
    setBusy(true);
    setMessage(null);
    setDetailsFailed(false);
    try {
      onUse(await resultProvider.getDetails(selected.providerId, category));
    } catch (error) {
      setDetailsFailed(true);
      setMessage({ kind: "details-unavailable" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="online-search">
      <div className="online-search-controls">
        <label>
          {t("editor.category")}
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as Category)}
          >
            {categories.map((value) => (
              <option key={value} value={value}>
                {categoryLabel(value, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="online-query">
          {t("search.providerQuery", {
            provider: provider
              ? isolateBidi(provider.name)
              : t("search.online"),
          })}
          <span>
            <Search />
            <input
              dir="auto"
              value={query}
              disabled={!available || busy}
              placeholder={t("search.placeholder")}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void search();
                }
              }}
            />
          </span>
        </label>
        <button
          type="button"
          className="primary online-search-button"
          disabled={!available || busy || query.trim().length < 2}
          onClick={() => void search()}
        >
          {busy ? t("search.searching") : t("search.action")}
        </button>
      </div>

      {message && (
        <div className="online-message">
          {message.kind === "empty" && message.from && message.to && (
            <p>
              {t("search.fallback", {
                from: isolateBidi(message.from),
                to: isolateBidi(message.to),
              })}
            </p>
          )}
          <p>
            {t(
              message.kind === "empty"
                ? "search.empty"
                : message.kind === "fallback"
                  ? "search.fallback"
                  : message.kind === "desktop-only"
                    ? "search.desktopOnly"
                    : message.kind === "not-supported"
                      ? "search.notSupported"
                      : message.kind === "all-unavailable"
                        ? "search.allUnavailable"
                        : message.kind === "credentials"
                          ? "search.credentials"
                          : message.kind === "timeout"
                            ? "search.timeout"
                            : message.kind === "rate-limit"
                              ? "search.rateLimit"
                              : message.kind === "details-unavailable"
                                ? "search.detailsUnavailable"
                                : "search.unavailable",
              {
                from: message.from ? isolateBidi(message.from) : "",
                to: message.to ? isolateBidi(message.to) : "",
              },
            )}
          </p>
          {(category === "games" ||
            category === "movies" ||
            category === "tv-series") &&
            ["all-unavailable", "credentials", "unavailable"].includes(
              message.kind,
            ) && (
              <button type="button" className="secondary" onClick={onConfigure}>
                {t("search.configure")}
              </button>
            )}
          {["timeout", "rate-limit", "unavailable"].includes(message.kind) &&
            available &&
            query.trim().length >= 2 && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void search()}
              >
                {t("search.retry")}
              </button>
            )}
        </div>
      )}

      {selected ? (
        <section
          className="import-preview"
          aria-label={t("search.importPreview")}
        >
          {selected.coverUrl && (
            <img
              src={selected.coverUrl}
              alt={t("accessibility.coverOf", { title: selected.title })}
            />
          )}
          <div>
            <span className="source-badge" dir="ltr">
              {selected.providerName}
            </span>
            <h3 dir="auto">{selected.title}</h3>
            {selected.alternateTitle && (
              <small dir="auto">{selected.alternateTitle}</small>
            )}
            <p dir="auto">
              {[
                selected.creator,
                selected.releaseDate,
                selected.genres?.join(", "),
                selected.metadata?.volumes
                  ? count("search.volumes", selected.metadata.volumes)
                  : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {selected.description && <p dir="auto">{selected.description}</p>}
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void useSelected()}
            >
              {busy ? t("search.loadingDetails") : t("search.useEntry")}
            </button>
            {detailsFailed && (
              <div className="import-recovery">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void useSelected()}
                >
                  {t("search.retry")}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setSelected(undefined);
                    setMessage(null);
                    setDetailsFailed(false);
                  }}
                >
                  {t("search.backToResults")}
                </button>
              </div>
            )}
          </div>
        </section>
      ) : (
        results.length > 0 && (
          <div className="online-results" aria-label={t("search.results")}>
            {results.map((result) => (
              <button
                type="button"
                key={`${result.provider}:${result.providerId}`}
                onClick={() => {
                  setSelected(result);
                  setDetailsFailed(false);
                  setMessage(null);
                }}
              >
                {result.coverUrl ? (
                  <img src={result.coverUrl} alt="" />
                ) : (
                  <span className="result-cover-placeholder" />
                )}
                <span>
                  <small className="source-badge" dir="ltr">
                    {result.providerName}
                  </small>
                  <strong dir="auto">{result.title}</strong>
                  <small dir="auto">
                    {[
                      result.creator,
                      result.releaseDate,
                      result.metadata?.volumes
                        ? count("search.volumes", result.metadata.volumes)
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ") || t("search.additionalDetails")}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )
      )}
      {resultSource === "rawg" && results.length > 0 && (
        <p className="result-attribution">
          {t("search.rawgAttribution")}{" "}
          <a href="https://rawg.io/" target="_blank" rel="noreferrer" dir="ltr">
            RAWG
          </a>
        </p>
      )}
    </div>
  );
}
