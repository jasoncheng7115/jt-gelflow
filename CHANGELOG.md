# Changelog

> **Language / 語言切換：** [English](CHANGELOG.md) | [繁體中文](CHANGELOG_zh-TW.md)

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.5.0] — 2026-05-01

Sankey diagram lands as the fourth view mode, with composable columns, real-time refresh, full-chain hover highlight, and customisable column headers integrated into Field Mapping. Same release adds a global transition-effect setting (Warp / Matrix), a forward-compatible config loader (so older `config.json` files don't break the schema), and the long-needed `install.sh` fix that actually replaces the running Python on upgrade.

### Added

- **Sankey view (4th view mode, hotkey `4`)** — flows render as left-to-right bands from external network to internal network, powered by [`d3-sankey`](https://github.com/d3/d3-sankey) (BSD-3-Clause). Snapshot-mode rendering: graph data buffers via ref every 100 ms, but layout / re-render runs only on the configured cadence (default 5 s, slider 1 → 30 s) so band positions don't jitter.
- **Toggleable Sankey columns** — six column chips (Country / Source IP / Source IP PTR / Protocol / Destination IP / Destination IP PTR). Source IP and Destination IP are mandatory and rendered as locked-active. The other four are independently togglable; on-screen left-to-right order is fixed regardless of toggle order.
- **Per-ancestor band colours** — each Sankey path coloured by its `colorKey` (country if the country column is on, otherwise external IP). 10-colour categorical palette assigned in flow-volume order so dominant flows get the most distinctive colours. Nodes are uniformly mint green so the eye reads the bands, not the nodes.
- **Hover full-chain highlight** — hovering any band runs BFS via d3-sankey's injected `sourceLinks` / `targetLinks` from both endpoints, lighting up the entire flow chain end-to-end and dimming everything else. Hovering a node (rect or text label) lights up every chain that passes through it. Tooltip shows total bytes + event count.
- **Sankey column headers at top** — each active column displays its configured display name (centred above the node bar). Auto-rendered for whichever columns are toggled on.
- **Sankey in-canvas controls** — bottom-left bar holds the column chips + Top-N Ext / Top-N Int numeric inputs (auto-add `sankey` to the corresponding `*_apply_to` so the cap takes effect); bottom-right bar holds the update-frequency range slider + numeric input (1–30 s, persisted via `sankey_window_seconds`). Visual language matches `.zoom-controls`.
- **Column display names live in Field Mapping** — every GELF-field input is paired with a "display name" input in the same Field Mapping section. The display name is what the Sankey diagram shows as the column header, co-locating "what GELF field do I read?" with "what label do I show?" so they don't drift apart.
- **PTR field mapping** — new `mapping.src_ptr_field` (default `source_ip_ptr`) and `mapping.dst_ptr_field` (default `destination_ip_ptr`) tell the aggregator which GELF fields hold reverse-DNS values. Sankey reads these dynamically — customers using non-Graylog-default field names (`my_dns`, `src_hostname`, etc.) can point Sankey at their fields without code changes.
- **Global transition effect setting** — new `transition_effect: "warp" | "matrix"` config (default `warp`). Choose between Light Pulse (scanline + energy ripple) or Matrix Rain (green character rain canvas overlay). Choice now applies to **all four** view-mode switches uniformly, not just Flow.
- **`apply_to` UI gains a 4th "Sankey" button** — Internal Filter IPs / Top-N Internal / Top-N External all now have an explicit Sankey toggle alongside Flow / 2D Map / 3D Globe.
- **Forward-compatible config loading** — `Config.from_dict()` silently drops unknown keys via `__dataclass_fields__` filter. An older `config.json` carrying keys that no longer exist in the schema (e.g. `sankey_stages` after we removed it) won't crash the load and revert to defaults.

### Changed

- **`install.sh` ends with `systemctl restart`** (not just `enable --now`) so re-running the installer on a host where the service is already running picks up the new code immediately. Pre-fix, `enable --now` was a no-op when the service was already up, leaving old Python serving requests.
- **Install summary drops the misleading `127.0.0.1` URL** — JT-GELFLOW runs on a headless Linux box; loopback isn't reachable from operators' browsers. Output now uses `http://<server-ip>:<port>` derived from `hostname -I`.
- **`/api/mapping` returns the full `MappingConfig`** via `asdict()` instead of an explicitly enumerated 8-key dict. Pre-fix, newly added fields (`*_display`, `*_ptr_field`, `country_display`) were saved by the server but excluded from the GET / POST response — the SettingsPanel form would then re-initialise those inputs as empty, making it look like Save didn't persist anything.

### Removed

- The provisional `sankey_stages` literal (`ext_int` / `ext_proto_int` / …) is replaced by `sankey_active_columns` (string array). Existing `config.json` files lacking the new key fall back to the default `["country", "ext_ip", "ext_ip_ptr", "int_ip", "int_ip_ptr"]`.
- The standalone `sankey_columns` config dict is gone — column display names are now part of `MappingConfig` (`*_display` siblings + `country_display`).

---

## [1.4.0] — 2026-01-09

First public GitHub release. Adds 3D globe auto-rotation, starfield, status-light breathing animation, animation freeze on disconnect, and per-view filter scoping. Also lands an upgrade-safe configuration model so customer settings survive `git pull` and re-running `install.sh`.

### Added

- **3D Globe auto-rotate toggle** — bottom-right icon button with rotating-arrow animation when enabled. Throttled to one update every 3 frames (≈20 fps) so rotation never blocks WebSocket message handling.
- **Starfield background for 3D Globe** — 200 randomly positioned stars with varied size, colour and opacity. Toggleable in Settings.
- **Connection-light breathing animation** — green status light breathes when connected; red goes static and halts all canvas animation while disconnected. Makes a stuck WebSocket visually unmistakable.
- **Per-view filter scope** — Internal Filter IPs / Top-N Internal / Top-N External can independently apply to Flow / 2D Map / 3D Globe. Default scope: Flow only.
- **Upgrade-safe configuration** — `config.json` is now `.gitignore`d; the repo ships `config.example.json` as the template. `install.sh` seeds `config.json` from the example only when no `config.json` exists. Re-running the installer (or `sudo jt-gelflow update`) preserves user settings end-to-end.

### Changed

- **Default map brightness** raised to 75%, calibrated against the 2D Map / 3D Globe colour stack for better arc visibility.
- **Top-N labels** dropped the “(left)” / “(right)” suffix in the settings panel — position is already conveyed by the surrounding UI.

### Fixed

- **Zoom controls were unresponsive on first load** — D3 zoom transform is now initialised on mount so programmatic zoom-in/out can dispatch correctly. Previously the buttons did nothing until the user manually interacted with the canvas.
- **3D Globe arc labels drifted on drag** — store mid/before/after geo points and recompute screen position + angle each frame instead of caching screen coordinates.
- **`The provided float value is non-finite`** error during programmatic zoom — caused by attempting to read mouse coordinates when the zoom event has no `sourceEvent`. Now skipped for synthetic events.

### Performance

- **Auto-rotate throttle**: every-frame → every 3rd frame, removing ~66% of DOM transform writes during rotation.

---

## [1.3.0] — 2026-01-08

### Added

- **2D Map view** (Mercator projection) and **3D Globe view** (orthographic projection with drag rotation + scroll zoom).
- **GeoIP coordinate support** for source / destination fields, with configurable fallback coordinates for internal IPs that have no geo data.
- **Auto-detect server location** via `ip-api.com`, used as the default fallback for internal-IP coordinates.
- **Map / globe brightness** slider and **default-view** selector in Settings.

### Changed

- **i18n**: full English / Traditional Chinese parity across UI and Settings.
- **Settings panel** redesigned into collapsible sections.
- **Node label templates** now support fallback chains (`{a||b||c|default}`).

---

## [1.2.0] — 2026-01-07

### Added

- Internal / External zone classification via configurable CIDR ranges.
- Top-N node filtering, real-time search filter, optional traffic-value display on nodes, optional internal-to-internal traffic toggle.

### Changed

- Flow TTL is now configurable.
- Multi-line node labels.
- General render-performance pass.

---

## [1.1.0] — 2026-01-06

### Added

- Settings panel.
- Automatic GELF field discovery (in-memory cache with TTL).
- Live template preview using the latest seen value of each discovered field.
- Seven-segment-style clock driven by the latest GELF message timestamp.

### Changed

- More resilient WebSocket reconnection.
- Improved node layout algorithm.

---

## [1.0.0] — 2026-01-05

### Added

- Initial release.
- GELF UDP / TCP collector (with chunked + GZIP support).
- 2D flow diagram with animated particles (Canvas).
- REST API + WebSocket (100 ms broadcast loop).
- Basic field-mapping configuration.
