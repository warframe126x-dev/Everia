import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { categoryInfo } from "./data";
import {
  providerById,
  providerForCategory,
  searchProviderChain,
  type ImportCandidate,
} from "./providers";
import { categories, type Category, type ProviderId } from "./types";

export function OnlineSearch({
  category,
  setCategory,
  onUse,
  onConfigure,
  onManual,
}: {
  category: Category;
  setCategory: (category: Category) => void;
  onUse: (candidate: ImportCandidate) => void;
  onConfigure: () => void;
  onManual: () => void;
}) {
  const provider = providerForCategory(category);
  const [query, setQuery] = useState("");
  const [available, setAvailable] = useState(Boolean(window.everiaProviders));
  const [message, setMessage] = useState("");
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
      setMessage(
        "Online search is not configured for this category. Manual entry remains available.",
      );
      return () => {
        active = false;
      };
    }
    provider.status().then((status) => {
      if (!active) return;
      setAvailable(Boolean(window.everiaProviders));
      if (!window.everiaProviders) setMessage(status.reason ?? "");
    });
    return () => {
      active = false;
    };
  }, [category, provider]);

  const search = async () => {
    if (!provider || !available || query.trim().length < 2) return;
    setBusy(true);
    setMessage("");
    setSelected(undefined);
    try {
      const response = await searchProviderChain(query.trim(), category);
      setResults(response.results);
      setResultSource(response.provider);
      setMessage(
        response.notice ||
          (!response.results.length ? "No matching entries were found." : ""),
      );
    } catch (error) {
      setResults([]);
      setResultSource(undefined);
      setMessage(
        error instanceof Error
          ? error.message
          : "Online search is currently unavailable.",
      );
    } finally {
      setBusy(false);
    }
  };

  const useSelected = async () => {
    if (!selected) return;
    const resultProvider = providerById(selected.provider);
    setBusy(true);
    setMessage("");
    setDetailsFailed(false);
    try {
      onUse(await resultProvider.getDetails(selected.providerId, category));
    } catch (error) {
      setDetailsFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Complete details are currently unavailable.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="online-search">
      <div className="online-search-controls">
        <label>
          Category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as Category)}
          >
            {categories.map((value) => (
              <option key={value} value={value}>
                {categoryInfo[value].label}
              </option>
            ))}
          </select>
        </label>
        <label className="online-query">
          Search {provider?.name ?? "online"}
          <span>
            <Search />
            <input
              value={query}
              disabled={!available || busy}
              placeholder="Search by title..."
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
          {busy ? "Searching…" : "Search"}
        </button>
      </div>

      {message && (
        <div className="online-message">
          <p>{message}</p>
          {(category === "games" ||
            category === "movies" ||
            category === "tv-series") &&
            message.includes("unavailable") && (
              <button type="button" className="secondary" onClick={onConfigure}>
                Configure
              </button>
            )}
          {message.includes("Manual Entry") && (
            <button type="button" className="secondary" onClick={onManual}>
              Manual Entry
            </button>
          )}
        </div>
      )}

      {selected ? (
        <section className="import-preview" aria-label="Import preview">
          {selected.coverUrl && (
            <img src={selected.coverUrl} alt={`Cover of ${selected.title}`} />
          )}
          <div>
            <span className="source-badge">{selected.providerName}</span>
            <h3>{selected.title}</h3>
            {selected.alternateTitle && (
              <small>{selected.alternateTitle}</small>
            )}
            <p>
              {[
                selected.creator,
                selected.releaseDate,
                selected.genres?.join(", "),
                selected.metadata?.volumes
                  ? `${selected.metadata.volumes} volumes`
                  : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {selected.description && <p>{selected.description}</p>}
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void useSelected()}
            >
              {busy ? "Loading complete details…" : "Use this entry"}
            </button>
            {detailsFailed && (
              <div className="import-recovery">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void useSelected()}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setSelected(undefined);
                    setMessage("");
                    setDetailsFailed(false);
                  }}
                >
                  Back to Results
                </button>
                <button type="button" className="secondary" onClick={onManual}>
                  Manual Entry
                </button>
              </div>
            )}
          </div>
        </section>
      ) : (
        results.length > 0 && (
          <div className="online-results" aria-label="Online search results">
            {results.map((result) => (
              <button
                type="button"
                key={`${result.provider}:${result.providerId}`}
                onClick={() => {
                  setSelected(result);
                  setDetailsFailed(false);
                  setMessage("");
                }}
              >
                {result.coverUrl ? (
                  <img src={result.coverUrl} alt="" />
                ) : (
                  <span className="result-cover-placeholder" />
                )}
                <span>
                  <small className="source-badge">{result.providerName}</small>
                  <strong>{result.title}</strong>
                  <small>
                    {[
                      result.creator,
                      result.releaseDate,
                      result.metadata?.volumes
                        ? `${result.metadata.volumes} volumes`
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Additional details available"}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )
      )}
      {resultSource === "rawg" && results.length > 0 && (
        <p className="result-attribution">
          Game metadata by{" "}
          <a href="https://rawg.io/" target="_blank" rel="noreferrer">
            RAWG
          </a>
        </p>
      )}
    </div>
  );
}
