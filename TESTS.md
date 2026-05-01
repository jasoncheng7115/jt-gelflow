# JT-GELFLOW — Release test checklist

> **Language / 語言切換：** [English](TESTS.md) | [繁體中文](TESTS_zh-TW.md)

Run **the entire list** before bumping a version tag. Mark each item ✅ pass / ❌ fail / ⏭ skip / 👁 manual. The list is divided into automatable parts (run via SSH on a test box) and visual parts (require a browser).

Recommended target: a Linux VM ≥ Ubuntu 22.04 with `systemd`, on which jt-gelflow can be cleanly installed / upgraded / uninstalled. Coexistence test optional.

---

## A. Install lifecycle

| # | Test | How |
|---|------|-----|
| A1 | Fresh install on clean Linux | `JT_GELFLOW_YES=1 curl -fsSL …/install.sh \| sudo bash` on a host with no prior jt-gelflow |
| A2 | Service ends up `active + enabled` | `sudo jt-gelflow status` |
| A3 | All three ports listening | `ss -tulnp \| grep -E ':(8099\|12201\|12202) '` shows 3 entries |
| A4 | CLI installed | `which jt-gelflow` returns `/usr/local/bin/jt-gelflow` |
| A5 | Web UI HTTP 200 | `curl -sI http://127.0.0.1:8099/ \| head -1` is `HTTP/1.1 200 OK` |
| A6 | API returns full schema | `curl -s http://127.0.0.1:8099/api/config` parses as JSON, has `transition_effect`, `sankey_active_columns`, `mapping.country_display`, etc. |
| A7 | systemd unit hardening | `systemctl cat jt-gelflow \| grep -E 'NoNewPrivileges\|ProtectSystem'` shows the hardening directives |
| A8 | Re-running install on existing checkout doesn't error | run installer twice — second run should succeed (uses git pull path) |
| A9 | Service is restarted (not just `enable --now`) when re-installing | observe `journalctl` shows `Stopping`/`Started` lines on second install |

## B. Upgrade

| # | Test | How |
|---|------|-----|
| B1 | `sudo jt-gelflow update` succeeds when local `main` is behind upstream | trigger git fetch + ff-only |
| B2 | After update, service is restarted with new code | `systemctl show jt-gelflow.service -p ActiveEnterTimestamp` is recent |
| B3 | Customer config survives `jt-gelflow update` | POST `/api/config {"flow_ttl_seconds": 23}`, run update, GET `/api/config` still shows 23 |
| B4 | Customer config survives `install.sh` re-run | same as B3 but trigger via re-running installer |
| B5 | Forward-compat: pre-v1.5 config with `sankey_stages` doesn't break load | inject `"sankey_stages": "ext_proto_int"` into config.json, restart service, server still binds port 8099 (no fallback to 8080), and warning is benign |
| B6 | Resilient path takes over when ff-only fails | mutate local git history (`git reset --hard $(git rev-parse HEAD~1)` then re-init upstream as different history), re-run installer — should rescue config + reset --hard + restore |
| B7 | Pin to a specific tag | `JT_GELFLOW_BRANCH=v1.5.0 curl -fsSL …/install.sh \| sudo bash` after fresh checkout — local HEAD points at `v1.5.0` |

## C. Uninstall

| # | Test | How |
|---|------|-----|
| C1 | `sudo jt-gelflow uninstall` (no purge) preserves config.json | after uninstall, `/opt/jt-gelflow/config.json` still exists; service unit gone; ports closed |
| C2 | `sudo jt-gelflow uninstall --purge` deletes everything | `/opt/jt-gelflow` gone; `/etc/systemd/system/jt-gelflow.service` gone; CLI gone |
| C3 | Re-install after `uninstall` (no purge) restores config | install again, GET `/api/config` shows previous customisations |

## D. Coexistence (optional, only on shared hosts)

| # | Test | How |
|---|------|-----|
| D1 | Snapshot the other project's state before any jt-gelflow operation | hash `/opt/<other>` content, list ports, `pip list` |
| D2 | `jt-gelflow install` doesn't change the other project's files | re-snapshot, diff |
| D3 | `jt-gelflow update` doesn't change the other project's files | same |
| D4 | `jt-gelflow uninstall` doesn't touch the other project | same |

## E. Data pipeline

| # | Test | How |
|---|------|-----|
| E1 | UDP GELF (no null byte) is accepted | `python3 -c 'import socket,json; sock=socket.socket(socket.AF_INET, socket.SOCK_DGRAM); sock.sendto(json.dumps({...}).encode(), ("127.0.0.1", 12201))'` → `/api/stats` shows messageCount > 0 |
| E2 | TCP GELF (null-terminated) is accepted | similar but with `SOCK_STREAM` and `... + b'\x00'` |
| E3 | GZIP'd UDP message decoded | send gzip-compressed payload |
| E4 | Chunked UDP message reassembled | send a large message split into 2 chunks |
| E5 | Auto field discovery | after sending a packet with custom `_my_field`, `/api/fields` shows it |
| E6 | Internal/external classification | inbound (8.8.8.8 → 10.0.0.10) and outbound (10.0.0.10 → 8.8.8.8) zones populate as expected |
| E7 | Cross-boundary appears in Sankey | only flows where exactly one side is internal feed Sankey aggregate |
| E8 | TTL expiry | wait `flow_ttl_seconds` after last packet → `/api/graph` shrinks |
| E9 | Custom PTR field name | set `mapping.src_ptr_field = "my_dns"`, send packet with `_my_dns` populated, Sankey ext_ip_ptr column shows that value |

## F. View modes

| # | Test | How |
|---|------|-----|
| F1 | Flow renders | switch to Flow, verify particles animate on Canvas |
| F2 | 2D Map renders | switch to 2D Map (requires GeoIP-tagged GELF), arcs visible |
| F3 | 3D Globe renders | switch to 3D Globe, sphere with country borders, arcs |
| F4 | Sankey renders | switch to Sankey (requires cross-boundary GELF), bands visible |
| F5 | Hotkeys 1/2/3/4 switch views | confirmed |
| F6 | Spacebar toggles pause | confirmed; particles freeze + status icon swaps |
| F7 | Arrow keys / +/-/0 work | for Flow / 2D Map / 3D Globe (n/a for Sankey) |
| F8 | Transition effect = warp (default) animates between all 4 views | check Settings → Transition Effect, switch views, observe scanline + zoom |
| F9 | Transition effect = matrix animates between all 4 views | switch setting, switch views, observe Matrix rain canvas overlay |

## G. Sankey-specific

| # | Test | How |
|---|------|-----|
| G1 | All 6 column chips render | Country / Source IP / Source IP PTR / Protocol / Destination IP / Destination IP PTR |
| G2 | Source IP + Destination IP chips are mandatory + locked | clicking does nothing, visual is `is-mandatory` style |
| G3 | Optional chips toggle on/off | clicking each adds/removes from `sankey_active_columns` and POSTs config |
| G4 | Column ordering is fixed left-to-right | regardless of toggle order, layout is `country → ext_ip → ext_ip_ptr → protocol → int_ip → int_ip_ptr` |
| G5 | Update-frequency slider 1–30s | drag to 2 → bands re-layout every 2s; drag to 30 → barely changes |
| G6 | Update-frequency number input syncs with slider | typing 10 in number → slider thumb moves to 10 |
| G7 | Top-N inline inputs auto-add 'sankey' to apply_to | set Top-N Ext = 5 inline → `zones.top_n_external_apply_to` includes `sankey` |
| G8 | Hover band → entire chain highlights | from `dns.google. → 192.168.1.x` band, full path `US → 8.8.8.8 → dns.google → 192.168.1.x → dc1.jason.tools` lights up |
| G9 | Hover node → all chains touching highlight | hover `192.168.1.105` node → every band into/out of it lights up |
| G10 | Per-ancestor band colours | with country column on, all bands from same country share a colour from the 10-colour palette |
| G11 | Column headers render at top | each active column shows the configured display name centered above its node bar |
| G12 | Headers come from `mapping.*_display` | edit Field Mapping → display name field → header updates after settings save |
| G13 | Country header from `mapping.country_display` | edit standalone country display name → Sankey country column header updates |
| G14 | Empty state message appears when no cross-boundary traffic | with no inbound/outbound flows, view shows "目前沒有跨內外網的流量" / "No cross-boundary traffic right now." |

## H. Settings panel

| # | Test | How |
|---|------|-----|
| H1 | Settings panel opens / closes | gear icon → modal opens; X / Esc / outside click closes |
| H2 | Field Mapping section: each input has paired display-name input | left = GELF field, right = display name |
| H3 | Save persists to config.json | edit → save → page reload → values intact |
| H4 | apply_to has 4th Sankey button on Internal Filter / Top-N Internal / Top-N External | confirmed visually |
| H5 | Default-view dropdown includes Sankey | options: Flow / 2D Map / 3D Globe / Sankey |
| H6 | Transition-effect dropdown 2 options | Warp Transition (default) / Matrix Rain |
| H7 | Country display-name placeholder is English | "Source Country" |
| H8 | Display-name input shared placeholder is i18n'd | EN: "Display name" / zh-TW: "顯示名稱" |

## I. UX / visuals (manual)

| # | Test | How |
|---|------|-----|
| I1 | Connection light breathes when connected | green dot animates |
| I2 | Connection light static red when disconnected | kill server, dot turns red, animation halts |
| I3 | Loading overlay on first connect | hard refresh, spinner fills to 100% then fades |
| I4 | Header FLW/EXT/INT counts update live | watch counts increment as GELF arrives |
| I5 | Seven-segment clock advances on new GELF | clock shows last-message timestamp |
| I6 | Search bar filters | type IP/port/proto, flows filter |
| I7 | Empty state on Flow view | clear data → "Waiting for data" appears |
| I8 | Language toggle (EN/zh-TW) | header lang button → all UI strings switch |
| I9 | Zoom controls work on Flow / 2D Map / 3D Globe | + / - / preset buttons |
| I10 | 3D Globe auto-rotate works | toggle button bottom-right of globe |
| I11 | 3D Globe starfield toggle | settings → enable/disable → background changes |

## J. Documentation / artefacts

| # | Test | How |
|---|------|-----|
| J1 | All 8 doc files present | `ls github/*.md` shows CHANGELOG, INSTALL+zh, README+zh, THIRD-PARTY-NOTICES, TESTS+zh, UPGRADE+zh |
| J2 | All bilingual pairs match in section structure | quick `grep '^## '` count parity |
| J3 | HTML pages parse | `python3 -c "from html.parser import HTMLParser; HTMLParser().feed(open(...).read())"` for both `docs/index*.html` |
| J4 | No internal IPs in user-facing files | `grep -rE '192\.168\.[0-9]+\.[0-9]+'` on `*.md` `*.html` returns only RFC1918 documentation cases |
| J5 | No mainland-CN-only words in zh-TW docs | targeted grep for `信息`/`軟件`/`默認`/`用戶`/`數據`/`服務器`/`緩存`/`屏幕` returns nothing in `*_zh-TW.md` and `index_zh-TW.html` |
| J6 | `package.json`, `App.tsx:VERSION`, `SettingsPanel.tsx:VERSION`, README headers, landing footers all on the same version | grep all five and diff |
| J7 | CHANGELOG has an entry for this release | `grep "^## \[$(jq -r .version package.json)\]" CHANGELOG.md` |

## K. Build / bundle

| # | Test | How |
|---|------|-----|
| K1 | `npx vite build` succeeds with no errors | exit code 0, dist/ populated |
| K2 | All four view chunks present | `dist/client/assets/` contains `SankeyCanvas-*.js`, `GlobeCanvas-*.js`, `transform-*.js`, main `index-*.js` |
| K3 | Bundle size hasn't ballooned | main `index-*.js` < 300 kB, gz < 90 kB; Sankey lazy chunk < 25 kB |

---

## How to run

For a typical release (minor / patch bump):

1. Run K (build) locally.
2. Sync to test box: `bash sync-to-github.sh --build && rsync … && ssh … bash install.sh`.
3. Run A, B (upgrade subset), E, G (Sankey via API), H (settings via API), J (artefacts), via SSH.
4. Open the test box's URL in a browser, run F, I.
5. Run C (uninstall) only at end of cycle if you're going to re-test from clean.

For a major release: run **everything**, including D (coexistence) on a host that has another project deployed.

Record results in this file's history (or a `TESTS_RESULTS_v<X.Y.Z>.md` snapshot) so future maintainers can see what was actually verified per release.

---

## See also

- [INSTALL.md](INSTALL.md) — install procedure
- [UPGRADE.md](UPGRADE.md) — upgrade procedure
- [CHANGELOG.md](CHANGELOG.md) — release history
