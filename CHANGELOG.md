# Changelog

> **Language / 語言切換：** [English](CHANGELOG.md) | [繁體中文](CHANGELOG_zh-TW.md)

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.5.4] — 2026-05-07

Install-time fix for a real customer report on Ubuntu 26.

### Fixed

- **`curl | sudo bash` install hung at the systemd prompt** on Ubuntu 26 / Debian 13 (and any sudoers config with `Defaults use_pty`). Sudo creates a private pty for the child, so the script's `/dev/tty` is writable (the prompt appears) but unreadable — the user's keystrokes flow to a different pty and `read` blocks forever. Customer pressed Enter and nothing happened.

### Changed

- **`ask_yes_no` in `install.sh` now reads with a 60-second timeout.** When `/dev/tty` is unreadable in the `use_pty` scenario above, the prompt times out, prints a warning naming `JT_GELFLOW_YES=1` as the recommended skip, and proceeds with the supplied default. Install completes instead of hanging indefinitely.
- **INSTALL.md / INSTALL_zh-TW.md** gain a troubleshooting row spelling out the symptom, the root cause, and the `JT_GELFLOW_YES=1` workaround.

---

## [1.5.3] — 2026-05-02

Sankey link-width semantics are now configurable, with a small UI tweak and docs to match.

### Added

- **Sankey Settings panel section** with `Link width metric` selector — `value` (default) or `events`. New `Config.sankey_width_mode` field on the server side. The `value` mode auto-falls-back to event-count widths when no real byte data is in play (because every flow's `value` contributes the `value_default` of 1, so per-link `value === events`); the `events` mode forces event counts even when byte data exists. The Sankey hover-tooltip's existing `value === events` heuristic continues to elide the bytes line in both cases. Frontend `App` + `SankeyCanvas` thread the mode through; `buildSankeyData` overrides `link.value` to events when mode is `events`. Forward-compatible — older `config.json` without the key defaults to `value`.
- **README + README_zh-TW** gain a `Sankey width metric` subsection under Configuration explaining the two modes, the auto-fallback behaviour, and where to set it.

### Changed

- **Settings checkbox styling.** The custom checkbox glyph (the white tick on the cyan checked-state square) was 5×9 inside a 14×14 box, positioned at top-left, leaving an obvious gap around the tick. Box bumped to 18×18 with a 6×11 tick centred at (5, 1) — visually filled and easier to click.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

---

## [1.5.2] — 2026-05-02

Documentation polish and a small UI label correction. No code-path changes; the dist/ rebuild is so the corrected settings-panel title reaches users.

### Changed

- **Settings section title** — `3D Globe / GeoIP Settings` → `2D Map / 3D Globe Settings` (zh-TW: `3D 地球 / GeoIP 設定` → `2D 地圖 / 3D 地球 設定`). The settings inside it (geolocation field names, internal fallback coordinate, map brightness, starfield, stats Top-N, focus-zoom) all already affected both views; the title was just inaccurate.

### Documentation

- **Field-mapping examples broadened.** Showing only canonical Graylog names (`network_bytes`, `protocol_name`, `source_ip_geolocation`, …) implied those were the strings JT-GELFLOW actually required. Both the README field-mapping table and the landing-page Mapping cards now list common alternatives — IPs (`src_ip` / `srcip` / `client_ip` / `suricata_srcip`), protocol (`proto` / `protocol` / `ip_proto` / `l4_proto`), value field (`bytes` / `length` / `datalen` / `octets`), GeoIP (`src_geolocation` / `srcip_geolocation` / `geoip_src_location`).
- **"pipeline" wording clarified.** Replaced ambiguous "whichever your pipeline emits" with "whichever appears on incoming messages" so Graylog readers don't misread it as the Pipeline Rules feature. Added an "About field names" callout in the Graylog setup section explaining that field names visible at JT-GELFLOW reflect the cumulative result of Graylog's Input → Extractors → Pipeline Rules → GeoIP processor → Stream Routing chain.
- **`curl` prerequisite hint** on the landing page is now a labelled distro/command table (Debian/Ubuntu, RHEL/Fedora/Rocky/Alma, Arch/Manjaro, openSUSE) instead of four commands separated by middle dots — readers couldn't tell which was theirs.
- **Graylog → JT-GELFLOW setup walkthrough** added to README (EN + zh-TW) and surfaced as a callout on the landing page below the post-install summary. Covers System → Outputs → GELF Output, transport / host / port, stream attachment, plus tcpdump and Discovered Fields troubleshooting.
- **Install-section text contrast** — `--text-dim` (#9ba8b8) was below comfortable reading contrast on the dark background; bumped to #b4c0cf, and switched the install prereq body + distro-label column to full `--text` since they're meant to be read carefully.

---

## [1.5.1] — 2026-05-01

Field-mapping flexibility plus a stack of operational fixes that surfaced when v1.5.0 was put on a customer box. Non-canonical GELF schemas (Suricata, vendor exports) now flow correctly through every view; install and upgrade are no longer susceptible to chicken-and-egg dependency gaps; the dashboard is operable before the first log lands.

### Added

- **Configurable country GELF field names** — new `mapping.src_country_field` (default `source_ip_country_code`) and `mapping.dst_country_field` (default `destination_ip_country_code`). Settings UI exposes them as a paired GELF-field-name + display-name row in Field Mapping. The 2D Map / 3D Globe Country Top-N panel and Sankey Country column both honour these.
- **Field Mapping warning hint** — amber callout at the top of the Field Mapping section reminding users that renaming fields here also requires updating Label Templates that reference them, otherwise node and edge labels render empty.
- **Value Field event-count mode hint** — explicit guidance in the Value Field section explaining how to use event counting for sources without a byte-length field (Suricata IDS, audit logs): point `value_field` at a name that doesn't exist in messages, leave Default at 1, every event then contributes 1 unit. The Sankey hover tooltip already shows the events total.
- **README field-mapping guide** — replaces the minimal table with a five-section overview (Field Mapping, Value Field, Label Templates, GeoIP, Zones), the cross-section dependencies, and a complete worked Suricata example listing every settings field.
- **Landing-page Mapping section** — five-card overview between Features and Hotkeys covering the same five settings blocks with their gotchas and defaults; nav gets a "Mapping" link.
- **Landing-page Hotkeys section** — list of the keyboard shortcuts (1/2/3/4 view switch, Space pause, +/− zoom, 0 reset, arrows pan).
- **`curl` prerequisite hint** — README, INSTALL, and the landing page now spell out, ahead of the one-line install, that minimal Linux images may not ship `curl` and need `apt/dnf/pacman/zypper install curl` first.
- **Click-to-load video facade with poster** — `demo.mp4` (down from 33 MB to 4.8 MB at 720p) is no longer fetched on first paint. The facade displays a frame extracted from the actual video so there's no chrome/no-chrome mismatch when the user hits Play.
- **Mobile hamburger nav** — landing nav collapses into a drawer below 720px instead of horizontally scrolling and clipping items; brand stays put.

### Changed

- **CLI is symlinked, not copied** — `/usr/local/bin/jt-gelflow` now points at `/opt/jt-gelflow/bin/jt-gelflow`. Pre-fix, every CLI bug fix had to wait for an explicit re-run of `install.sh` because the user-facing copy was frozen; now `git pull` refreshes the active CLI immediately.
- **`bin/jt-gelflow` auto-elevates via `sudo`** — running any privileged subcommand (`start`/`stop`/`restart`/`update`/`uninstall`) as a non-root user now re-execs the script under `sudo` with the original argv. Errors out only if `sudo` itself isn't installed.
- **`bin/jt-gelflow update` skips frontend rebuild on old Node** — Vite 5 requires Node 18+. Pre-fix, Ubuntu 22.04's apt `npm` (Node 12) made `update` abort with `SyntaxError: Unexpected reserved word` and the service was never restarted. Now mirrors `install.sh`'s behaviour: log a notice, fall back to the committed `dist/` that `git pull` already refreshed.
- **Loading overlay drops 2 s after WebSocket connects** even without GELF data. The dashboard is fully operable (incl. settings panel) before any log arrives. Prior to this, the overlay only hid when the first event landed, trapping users who hadn't pointed a log source at the box yet.
- **Settings panel z-index 300 → 600** — above the loading overlay, so the gear button always opens a usable panel.
- **systemd unit** sets `TimeoutStopSec=10` and `KillMode=mixed` — a slow Python shutdown gets SIGKILL'd at 10 s instead of the systemd default 90 s.
- **Server explicitly closes live WebSockets on shutdown** — `runner.cleanup()` no longer parks waiting on handler coroutines stuck in `async for msg in ws`. With the WS-close fix, `systemctl restart` returns in subseconds even with a browser tab open.
- **Demo screenshots downscaled** — 1723px → 1280px wide PNGs reduce browser scaling ratio from 4.8× to 3.5× in the thumbnail grid; visibly less aliasing. CSS adds `image-rendering: auto` and a GPU-compositing hint.
- **Features grid pinned to 3×3** on desktop (was `auto-fit/minmax` producing a stranded 9th card).

### Fixed

- **2D Map / 3D Globe rendered nothing on non-canonical GELF schemas.** `flow_aggregator` only copied canonical names (`source_ip_geolocation`, `destination_ip_geolocation`) into the per-flow `fields` blob it sends to the frontend; `convertToGlobeData` then found nothing to read. Configured `geoip.source_field` / `destination_field` are now passed through.
- **Country Top-N panel was empty even when the map showed flows.** `convertToGlobeData` was hardcoded to `source_ip_country_code` / `destination_ip_country_code`. Now reads via configured `mapping.src_country_field` / `dst_country_field`.
- **External node label showed the internal IP on the headline with the external IP only in parens** when src/dst weren't canonical names. The dst-side field-swap list in `flow_aggregator` is now seeded from the user's configured `src_field` / `dst_field` / PTR / country before falling back to canonical names.
- **Empty node boxes when `node_label_template` referenced a field that doesn't exist in the user's messages.** Aggregator now falls back to the raw IP (already extracted from `mapping.src_field`) when the template renders to empty / whitespace.
- **`install.sh` failed mid-flight on a vanilla Ubuntu 22.04** because `python3` is preinstalled but `python3-pip` isn't. New `ensure_python_pip` step installs the right per-distro package when `python3 -m pip` isn't available.
- **Copy button drifted with horizontal `<pre>` scroll** — moved onto a non-scrolling wrapper.
- **Video element height collapsed and snapped back** the moment the user clicked Play. Aspect ratio 16:9 now locked from frame zero.
- **Mobile nav: brand wrapped to two lines and 繁體中文 button broke into vertical characters** — replaced horizontal-scroll nav with a hamburger drawer below 720px.
- **Screenshot tile padding restored** (was clobbered by the lightbox button reset, leaving thumbnails flush against the card edge).
- **`nginx` reverse-proxy example uses `gelflow.example.com`** — the previous `flow.example.com` collided with the project's Flow view name.

### Notes

- **No schema breaking changes.** Existing `config.json` files load unchanged; new `mapping.src_country_field` / `dst_country_field` keys default to the previous hardcoded values.
- **Customer-side upgrade path:** `sudo bash <(curl -fsSL https://raw.githubusercontent.com/jasoncheng7115/jt-gelflow/main/install.sh)` (one-line re-run) installs the CLI symlink and pulls all of the above in a single pass.

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
