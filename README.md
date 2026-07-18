# MLB Tracker

A real-time baseball game tracker designed to help you catch the games that matter most.

## 🚀 Project Overview

This is my **first Antigravity project**! The goal is to solve a very specific challenge: **watching every MLB team play at least once a year.**

Last year, I managed to do this using a clever Google Sheet, but it was always a struggle to find which games were available to watch — especially as the season progressed and the list of "unseen" teams got smaller. This app directly streamlines that process by highlighting exactly which games feature teams I still need to see.

While built for personal use, it's also a great way for any fan to see what interesting matchups are coming up.

## ✨ Features

- **Real-time Game Tracking**: Fetches live data from the MLB Stats API.
- **Unseen Team Highlights**: Automatically identifies matchups with teams you haven't watched yet.
- **Priority Filtering**: Filter for "Top Priority" games where both teams are unseen.
- **Gemini AI Recommendations**: Uses AI to automatically identify and showcase 5 compelling games across the 3-day window.
- **Showcase Toast Notifications**: Visual confirmation when AI recommendations load or encounter errors.
- **Dynamic Electric Starters**: Automatically calculates the top 10 "electric" starting pitchers each day using a K/9 and K/BB percentile formula. Pitchers with at least 3 game starts qualify. Results are matched to probable starters by MLB player ID (not name), so accented names and common surnames match correctly.
- **Custom Starters**: A Settings panel (gear icon) lets you add your own pitchers to follow alongside the formula top 10. Custom starters are saved in browser storage and matched by MLB player ID via a searchable roster.
- **Broadcaster Preferences**: Toggle featured broadcasters on/off in Settings (Special Events, Banana Ball, MLB Network, Sportsnet, TSN). Disabled broadcasters' badges are hidden from game cards and excluded from the Featured Broadcasts filter. Preferences are included in share links.
- **Banana Ball Games**: Savannah Bananas games broadcast on YouTube are injected into the 3-day schedule as separate cards, marked with a banana icon. Times are converted to Eastern from local venue timezone.
- **Metrics Shelf**: Visual representation of your season progress.
- **Material Icons**: Clean, consistent UI using Material Design iconography.
- **Mobile Responsive**: Designed to look great on any device.
- **Welcome Popup**: A first-time user onboarding modal that explains the app's purpose, how to mark teams as seen via double-clicking in the standings, and how to access customization options through the settings menu. Dismissed on first interaction and not shown again (tracked via `localStorage`).

## 📡 API Usage

The application integrates data from multiple real-time sources to calculate the **Fun Score**:

- **MLB Stats API**:
  - `standings`: Fetches division ranks and win/loss records.
  - `stats/leaders`: Identifies "Hot Hitters" (league leaders in HR, SLG, OPS) and players near career milestones.
  - `schedule`: Retrieves the 3-day game window, hydrated with `probablePitcher` and `broadcasts`.

- **Google Gemini API**:
  - `gemini-3-flash-preview`: Securely proxied through a PHP backend (`gemini.php`) to fetch short, dynamic reasons to watch targeted MLB games and caches them locally for 6 hours to conserve API limits.
  - `gemini-3.1-flash-lite`: Serves as an automatic fallback if the primary model reaches its rate limit (429) or is unavailable (503). Also used automatically when `debugDate` is set to conserve quota during testing.

- **Canadian Broadcaster Scraping**:
  - `sportsnet.php`: Parses live and upcoming MLB matchups from Sportsnet's internal schedule API. Fetches up to 4 dates in parallel using `curl_multi` and caches results for 4 hours.
  - `tsn.php`: Parses the season-long MLB on TSN schedule from TSN's website. Caches results for 24 hours.
  - Both are geo-gated: a single `detectCanada()` call (cached in memory) runs before either fetch. If the user is not in Canada, both are skipped. Fails closed — if geo-detection is unavailable, both are skipped. Geo-detection is handled server-side by `ipinfo.php`, which resolves the client's real IP (including CDN-forwarded requests) and proxies it to the ipinfo.io `/lite` API using a Bearer token stored in `config.php`.

- **MLB Network Scraping**:
  - `mlbnetwork.php`: A backend scraper that fetches and parses the MLB Network live games schedule from `mlb.com`. Extracts game matchups, dates, and times and caches results for 24 hours. Games broadcast on MLB Network are surfaced as Featured Broadcasts in the UI.

- **Banana Ball (Savannah Bananas)**:
  - `bananas.php`: Scrapes the Savannah Bananas schedule page and returns games broadcast on YouTube within the next 14 days. Times are converted from local venue timezone (PST/CST/EST) to Eastern. Caches results for 4 hours. Banana Ball games are injected into the 3-day schedule as separate cards marked with a 🍌 yellow banana icon and bypass MLB-specific filters (fun score, unseen status, etc.).

- **Dynamic Electric Starters**:
  - `electric.php`: Fetches all pitchers with at least 3 game starts (`playerPool=All`, GS≥3) from the MLB Stats API. Calculates an Electric Score for each: `(K/9 percentile × 1.3) + K/BB percentile`. Returns the top 10 by score. Caches daily.
  - `pitchers.php`: Returns all pitchers with any season stats as `{id, name, team}` for use in the Settings modal autocomplete. Caches daily.
  - Electric starter detection uses MLB player IDs (not name strings), so accented names and common surnames never cause false matches or misses.

## 🔗 URL Parameters

You can customize the application state using the following parameters:

| Parameter | Value | Description |
| :--- | :--- | :--- |
| `u` | `s` | **Owner Mode**: Initializes your local device as the "Owner" to sync with the master Google Sheet. |
| `seen` | `CSV` (e.g., `ARI,ATL`) | **Share Mode**: Overrides local seen status with a specific list of team abbreviations (ideal for sharing with friends). |
| `electric` | `CSV` of player IDs | **Shared Custom Starters**: Passed alongside `seen` — resolves player IDs against the active pitcher roster and adds them to the recipient's custom starters in local storage. |
| `exclude_broadcasters` | `CSV` (e.g., `MLB Network,Sportsnet`) | **Shared Broadcaster Preferences**: Passed with share links to apply the sharer's disabled broadcasters to the recipient. Recipient's disabled broadcasters are automatically updated when opening the link. |
| `debugDate`| `YYYY-MM-DD` | **Debug Mode**: Mocks the "current" date to view historical or future schedules. Also switches to a lighter Gemini model to conserve API quota. |

## 🛠️ Tech Stack

- **Frontend**: Vanilla HTML5, JavaScript (ES6+), CSS3.
- **Backend Proxy**: PHP (`index.php` for session/CSRF token seeding; `gemini.php`, `sportsnet.php`, `tsn.php`, `mlbnetwork.php`, `electric.php`, `pitchers.php`, `sheet.php`, `ipinfo.php` for proxying external APIs; `token.php` as a shared auth helper; `config.php` for centralized secrets — gitignored, never committed). PowerShell (`server.ps1`) for local development.
- **Data Source**: MLB Stats API, Google Gemini API.
- **Icons**: [Material Icons](https://fonts.google.com/icons)

## 🔒 Security

The backend proxy scripts include several layers of security to prevent unauthorized usage and quota abuse:

- **Session-Based CSRF Tokens**: `index.php` generates a cryptographically random token per PHP session and injects it into the page as `window.CSRF_TOKEN`. Every request to a proxy endpoint must include this token in the `X-CSRF-Token` header, verified server-side with `hash_equals()`. Unlike a hardcoded static token, this cannot be replayed without a valid session cookie.
- **Secure Session Cookies**: PHP sessions use `secure`, `httponly`, and `SameSite=Lax` cookie parameters. `Lax` (rather than `Strict`) is used so that shared links work correctly on first click from an external page.
- **Origin Validation**: All proxy scripts validate the `Origin` header and only set CORS headers for `mlb.sanvash.com` or local development environments.
- **Geo-Gated Canadian Broadcasters**: Sportsnet and TSN broadcasts are only surfaced to confirmed Canadian users. A single geo-detection call is shared between both fetches (result cached in memory) so the IP lookup only fires once per page load. The check is fail-closed — if detection fails for any reason, both Canadian broadcaster fetches are skipped entirely.
- **Centralized Secrets**: All API keys and tokens (`gemini_api_key`, `sheet_id`, `ipinfo_token`) are stored in a single `config.php` file. It is gitignored and never committed to the repository. Each proxy script loads its key from this file with a safe fallback if the file is absent.
- **HTTP Security Headers** (via `.htaccess`): `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `Referrer-Policy`, and a strict `Content-Security-Policy` are set on every response. Direct HTTP access to `config.php`, legacy secret files, and cache `.json` files is blocked at the Apache layer — so even if PHP were misconfigured, those files could never be served as plaintext.
- **Stale Cache Fallback**: If an external API call fails on a cold server load, `gemini.php`, `sportsnet.php`, and `mlbnetwork.php` automatically fall back to the most recent cached response rather than returning an error. The client logs a `console.warn` when stale data is being served. `sheet.php` has no cache — the owner's Google Sheet is always fetched live so team updates are reflected immediately.

## 🎯 Goal

The primary goal of this project is to turn a manual tracking process into a seamless, automated experience. It's a practical use case for developing AI-assisted coding skills while building a tool that provides real, daily value to a baseball fan.
