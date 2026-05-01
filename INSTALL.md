# JT-GELFLOW — Install SOP (English)

> **Language / 語言切換：** [English](INSTALL.md) | [繁體中文](INSTALL_zh-TW.md)

This is the operations-grade install procedure for **JT-GELFLOW v1.5.0+**. For a friendlier overview see [README.md](README.md).

---

## 0. Preconditions

| Item | Required | Notes |
|------|----------|-------|
| OS | Linux with `systemd` | Ubuntu / Debian / RHEL / Fedora / Arch / openSUSE all supported. macOS / Windows are **not** supported. |
| Python | **3.10+** | Installer auto-installs via apt/dnf/yum/pacman/zypper if missing. |
| Node.js | 18+ (optional) | Only needed if you plan to rebuild the frontend; the repo ships pre-built `dist/`. |
| Network | Outbound to `github.com`, `pypi.org`, `registry.npmjs.org` | Installer fail-fast checks these in the first 5 s. |
| Privileges | `root` (or `sudo`) | Required to write `/opt/jt-gelflow`, install packages, and register the systemd unit. |
| Free TCP/UDP ports | `8099` (HTTP), `12201` (GELF UDP), `12202` (GELF TCP) | Confirm nothing else is listening: `ss -tulnp \| grep -E ':(8099\|12201\|12202) '`. |
| Disk | ~50 MB | Repo + Python deps + node_modules. |

---

## 1. Install (one-line, recommended)

The canonical entry point is the install script in the GitHub repo. Run it as root:

```bash
curl -fsSL https://raw.githubusercontent.com/jasoncheng7115/jt-gelflow/main/install.sh | sudo bash
```

What this does, in order:

1. Verifies you are on Linux running as root.
2. Detects the package manager (apt / dnf / yum / pacman / zypper).
3. Network preflight — `HEAD` requests to GitHub / npm / PyPI; abort within 5 s if any fail.
4. Installs `git`, `python3` (with `pip`), `nodejs`, `npm` if missing.
5. Verifies Python 3.10+ (refuses to continue if older).
6. Clones `https://github.com/jasoncheng7115/jt-gelflow.git` into `/opt/jt-gelflow`.
7. Installs Python dependencies (`pip install -r requirements.txt`).
8. Builds the frontend (`npm install && npm run build`). Falls back to the committed `dist/` if Node is too old.
9. Seeds `config.json` from `config.example.json` if no `config.json` is present.
10. Installs the CLI shortcut to `/usr/local/bin/jt-gelflow`.
11. Asks (default `yes`) before installing and starting the `jt-gelflow.service` systemd unit.
12. Prints the reachable URL: `http://<server-ip>:8099`.

When it finishes, open the printed URL from another machine — this server is headless Linux, so `127.0.0.1:8099` will only work if you have a desktop on the box.

---

## 2. Install (manual)

If you cannot pipe `curl` to bash (corporate proxies, audit policy, etc.):

```bash
sudo git clone https://github.com/jasoncheng7115/jt-gelflow.git /opt/jt-gelflow
cd /opt/jt-gelflow

# Inspect install.sh first if you want — it's small and self-documenting.
cat install.sh

# Run it
sudo bash install.sh
```

---

## 3. Environment variable overrides (advanced)

The installer accepts these env vars:

| Var | Default | Use |
|-----|---------|-----|
| `JT_GELFLOW_REPO_URL` | `https://github.com/jasoncheng7115/jt-gelflow.git` | Point at a fork or local mirror (file:// also works). |
| `JT_GELFLOW_BRANCH` | `main` | Pin to a tag or branch. |
| `JT_GELFLOW_DIR` | `/opt/jt-gelflow` | Custom install location. |
| `JT_GELFLOW_NO_SERVICE` | `0` | `1` skips the systemd unit (run manually with `python3 run.py`). |
| `JT_GELFLOW_YES` | `0` | `1` answers yes to every interactive prompt — required when piping through CI / cloud-init. |

Example unattended install:

```bash
JT_GELFLOW_YES=1 curl -fsSL https://raw.githubusercontent.com/jasoncheng7115/jt-gelflow/main/install.sh | sudo bash
```

---

## 4. Post-install verification

```bash
# Service is up and listening on the right ports
sudo jt-gelflow status
ss -tulnp | grep -E ":(8099|12201|12202) "

# HTTP returns the SPA
curl -sI http://127.0.0.1:8099/ | head -1   # expect: HTTP/1.1 200 OK

# REST returns config (this confirms the Python side parsed it)
curl -s http://127.0.0.1:8099/api/config | head -c 200; echo

# Send a synthetic GELF UDP packet
python3 -c '
import socket, json
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.sendto(json.dumps({
  "version":"1.1","host":"smoke","short_message":"install-test",
  "source_ip":"8.8.8.8","destination_ip":"10.0.0.10",
  "protocol_name":"TCP","destination_port":443,"network_bytes":1024
}).encode(), ("127.0.0.1", 12201))
'

# /api/stats should now show messageCount > 0
curl -s http://127.0.0.1:8099/api/stats
```

---

## 5. First-run configuration

1. Open `http://<server-ip>:8099` in your browser.
2. Click the gear icon → Settings.
3. Adjust **Field Mapping** so the left inputs match your GELF source's field names. The right inputs are display names that show up as the Sankey column headers.
4. Adjust **Internal CIDRs** to match your network.
5. Save. Settings persist to `/opt/jt-gelflow/config.json`.

`config.json` is `.gitignore`d — `sudo jt-gelflow update` and re-runs of `install.sh` never overwrite it.

---

## 6. Network ports / firewall

JT-GELFLOW needs the following on the host's firewall:

### Inbound

| Port | Proto | Used by | Required? | Notes |
|------|-------|---------|-----------|-------|
| `8099` | TCP | Operators' browsers (Web UI + WebSocket) | yes | Configurable via `http_port` in `config.json`. Bind to `127.0.0.1` if you front it with a reverse proxy on 443/tcp. |
| `12201` | UDP | GELF UDP listeners (Graylog / Logstash / Filebeat / custom) | one of UDP / TCP | Configurable via `gelf_udp_port`. |
| `12202` | TCP | GELF TCP listeners (null-byte-delimited) | one of UDP / TCP | Configurable via `gelf_tcp_port`. |

Open at least the GELF protocol(s) your sources actually use, plus 8099 (or your reverse-proxy frontend port).

### Outbound

| Destination | Port | When | Required? |
|-------------|------|------|-----------|
| `github.com` | 443/TCP | install + `sudo jt-gelflow update` | yes (only during install/update) |
| `pypi.org`, `files.pythonhosted.org` | 443/TCP | `pip install -r requirements.txt` during install/update | yes (only during install/update) |
| `registry.npmjs.org` | 443/TCP | `npm install` during install/update — only when rebuilding the frontend | recommended |
| `ip-api.com` | 80/TCP | runtime, only if `geoip.auto_detect_location` is enabled | optional |
| `unpkg.com` | 443/TCP | **operator's browser**, not the server (loads `world-atlas` map data) | n/a server-side |

In closed-network deployments you can disable `auto_detect_location` and pre-set `internal_fallback_lat`/`_lng` to avoid any runtime egress.

### Quick firewall examples

`ufw` (Ubuntu / Debian):

```bash
sudo ufw allow 8099/tcp     comment "jt-gelflow web UI"
sudo ufw allow 12201/udp    comment "jt-gelflow GELF UDP"
sudo ufw allow 12202/tcp    comment "jt-gelflow GELF TCP"
```

`firewalld` (RHEL / Fedora):

```bash
sudo firewall-cmd --add-port=8099/tcp  --permanent
sudo firewall-cmd --add-port=12201/udp --permanent
sudo firewall-cmd --add-port=12202/tcp --permanent
sudo firewall-cmd --reload
```

If you restrict source addresses, scope each rule to the operator subnet (8099) and the GELF source subnet (12201/12202) separately — they're typically different.

---

## 7. Reverse proxy (optional — HTTPS via nginx)

```nginx
server {
  listen 443 ssl http2;
  server_name flow.example.com;
  ssl_certificate     /etc/ssl/certs/example.com.crt;
  ssl_certificate_key /etc/ssl/private/example.com.key;
  client_max_body_size 100M;

  location / {
    proxy_pass         http://127.0.0.1:8099;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   Upgrade           $http_upgrade;
    proxy_set_header   Connection        "upgrade";
    proxy_read_timeout 300s;
  }
}
```

Common gotchas:

- **`client_max_body_size 100M`** is required — settings POSTs can otherwise hit `413 Request Entity Too Large`.
- **Mount at `/`, not `/jt-gelflow/`** — the frontend uses absolute paths.
- **WebSocket headers (`Upgrade`, `Connection`)** must be forwarded.
- **`proxy_read_timeout 300s`** prevents idle WebSockets from being killed.

---

## 7. Troubleshooting

| Symptom | First check |
|---------|-------------|
| `connection refused` | `sudo jt-gelflow status` — was the service ever started? `sudo jt-gelflow logs`. |
| Port 8099 unreachable from another host | Firewall (`ufw status`, `iptables -L INPUT`). |
| HTTP loads but WebSocket disconnected | Reverse proxy is missing `Upgrade` / `Connection` headers, or `proxy_read_timeout` too short. |
| API returns empty | Check `journalctl -u jt-gelflow.service` for `Error loading config, using defaults: …`. |
| GELF traffic not appearing | Verify `mapping.src_field` / `dst_field` match the GELF field names you actually emit. |

For anything else: `journalctl -u jt-gelflow.service -n 200 --no-pager`.

---

## 8. See also

- [UPGRADE.md](UPGRADE.md) — version-update SOP
- [README.md](README.md) — feature overview
- [CHANGELOG.md](CHANGELOG.md) — release history
