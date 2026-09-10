# Everia online source configuration

Everia remains fully usable without provider credentials. Manual Entry, existing entries, covers, ratings, statuses, favorites, notes and editing are local and do not depend on these services.

## Credentialed providers

Enter credentials in **Settings → Online Sources**. They are encrypted on disk with Electron `safeStorage`, remain available only to Electron's main process and are never returned through IPC. Do not commit real values to source control.

### IGDB — Games

Provide a Twitch Client ID and Client Secret. Everia obtains and temporarily caches the OAuth application token in memory. It is not written to the library database.

### TMDB — Movies and TV Shows

Provide the API Read Access Token. Everia uses it as a Bearer token for application authentication; it does not connect a TMDB user account.

### RanobeDB v0 — Light Novels

RanobeDB's read-only public API does not currently require a credential. Everia limits search result volume and treats the API as non-authoritative discovery metadata.

### Jikan v4 — Anime and Manga

Jikan's public API does not require a credential. Anime seasons, movies, OVAs and other entries remain independently selectable. Manga, Manhwa and Manhua share Everia's Manga category.

## Provider boundaries

- External results are normalized into a common import candidate.
- Selecting a result opens a preview before it enters the manual review form.
- Saving creates a new Everia ID and locally owned status, rating, favorite, notes, dates and manual edits.
- Provider name, provider ID, provider URL and refresh time are stored in a separate reference object.
- Approved provider cover URLs are downloaded once into Everia's local IndexedDB cover store before the entry is saved.
- Provider failure produces a contained message and never blocks Manual Entry or local records.
- Provider production/publication/airing status stays separate from Everia's personal tracking status.
- Provider community ratings are never imported as Everia personal ratings.

## Compliance notes

- IGDB requires server-side/proxy-style authentication and does not support direct browser requests.
- TMDB attribution, its approved logo and required non-endorsement notice are included in Settings/About.
- RanobeDB API v0 is read-only, non-commercial, and its data is provided under the Open Database License and Database Contents License.
- Jikan is an unofficial MyAnimeList API and provider availability is never required to use saved Everia entries.

Re-check each provider's current terms, caching rules and branding requirements before distributing Everia beyond private testing.
