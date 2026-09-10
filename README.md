# Everia v0.6

**Your Personal Universe** — a local-first Windows media Codex for Games, Movies, TV Shows, Novels, Manga and Anime.

## Development

```bash
npm install
npm run dev
```

Production and Windows test builds:

```bash
npm test
npm run test:ui
npm run build
npm run package:win
```

## v0.6 responsive scaling and provider reliability

- The approved v0.5 interface remains the visual baseline at normal window sizes.
- A display-aware scale now grows the complete interface progressively from the 1080p class through 2560×1440, including the sidebar, content, controls, cards, forms and typography.
- First launch uses a centered 16:9 window that fits within the current Windows work area.
- Everia remembers the last valid monitor, window bounds and maximized state, while preventing off-screen restoration after monitor changes.
- The Home category icons are 15% larger; Home branding, quote and Settings scale further at 2K while the approved composition remains unchanged.
- Expanded libraries stay anchored to the sidebar and allow their grid to use the available width.
- Jikan now uses bounded retries for transient gateway/rate-limit failures and reports real checked/failed health instead of claiming availability before a request succeeds.

## Preserved v0.5 online sources and refinements

- Home preserves the approved v0.4 composition while increasing the category icon/name/count group and aligning the quote with Settings.
- The cleaner Everia UI Mark is used for the window and multi-resolution Windows executable icon.
- The full-color UI Mark, rail width and icon sizes remain unchanged; main navigation spacing is increased.
- Category libraries and Entry Details use their corresponding artwork as heavily dimmed atmospheric backgrounds; Settings uses the Everia default universe artwork.
- Libraries include category-aware status filters and Grid/List modes remembered independently for each category.
- Entry Details is now a full content page with the persistent sidebar, an immediate status control, rating below the poster, quick Favorites and the existing Edit flow.
- Returning from Entry Details preserves the active library search, filter, sort, view mode and scroll position where practical.
- Appearance supports Everia Default, Solid Color and Custom Image backgrounds, Cover/Contain/Stretch fit and adjustable dimming.
- Existing accent, background and text colors remain customizable.
- Add Entry offers Online Search and Manual Entry without removing or restructuring the approved manual form.
- Replaceable IGDB, TMDB, RanobeDB and Jikan adapters normalize provider data before it reaches the UI.
- IGDB and TMDB credentials are entered locally in Settings → Online Sources and protected with Electron safeStorage (Windows DPAPI). Secrets never pass back through renderer IPC.
- Imported covers are copied into Everia's local IndexedDB cover store when the provider image host is approved; the source reference is retained separately.

## Local-first storage and upgrades

Everia keeps the original `everia.items.v1` metadata key so existing entries, ratings, notes, statuses and favorites remain available after upgrading. Metadata and preferences are saved to the Electron application profile. Cover images and custom wallpapers remain in the existing `everia-assets` IndexedDB database without resetting it.

Selected cover and wallpaper files are copied as image bytes into Everia's own local storage. Built-in artwork is packaged with the app. Runtime display does not depend on external image URLs. An optional HTTPS cover URL in the manual form is downloaded once and stored locally before the entry is saved.

The portable Windows build stores its profile under `%APPDATA%\Everia` by default. Do not delete that folder if it contains the only copy of a valuable test library. Export/backup and native SQLite storage are planned for a later revision and are not part of v0.6.

## Online source configuration

Provider traffic runs in Electron's isolated main process. Credentials are never returned to the renderer and missing providers fail closed while the local library and Manual Entry continue to work.

After installation, open **Settings → Online Sources**:

- IGDB: enter the Twitch Client ID and Client Secret. Everia obtains and refreshes the application access token automatically.
- TMDB: enter the API Read Access Token.
- RanobeDB and Jikan: no credentials are required.

Use **Test Connection** to verify each source. On Windows, credential values are encrypted with Electron `safeStorage` backed by DPAPI. If OS-protected storage is unavailable, Everia refuses to save them.

## Scope

v0.6 preserves the focused IGDB, TMDB, RanobeDB and Jikan search/import adapters while improving Jikan failure handling. It does not add cloud sync, account synchronization, social features, scraping, multi-provider merging, a full theme system, dashboards or recommendations. Manual entries remain supported permanently.
