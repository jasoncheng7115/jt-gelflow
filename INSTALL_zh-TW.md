# JT-GELFLOW — 安裝 SOP（繁體中文）

> **Language / 語言切換：** [English](INSTALL.md) | [繁體中文](INSTALL_zh-TW.md)

本文件為 **JT-GELFLOW v1.5.0+** 的 ops 等級安裝流程。功能總覽請見 [README_zh-TW.md](README_zh-TW.md)。

---

## 0. 前置條件

| 項目 | 必要 | 備註 |
|------|------|------|
| 作業系統 | 帶 `systemd` 的 Linux | Ubuntu / Debian / RHEL / Fedora / Arch / openSUSE 皆可。**不支援** macOS / Windows。 |
| Python | **3.10+** | 安裝程式會自動透過 apt/dnf/yum/pacman/zypper 安裝。 |
| Node.js | 18+（選用） | 僅需要重建前端時才需要；repo 已附預建 `dist/`。 |
| 網路 | 出站到 `github.com`、`pypi.org`、`registry.npmjs.org` | 安裝程式 5 秒內 fail-fast 檢查。 |
| 權限 | `root`（或 `sudo`） | 寫入 `/opt/jt-gelflow`、安裝套件、註冊 systemd 服務都需要。 |
| 空閒 TCP/UDP port | `8099`（HTTP）、`12201`（GELF UDP）、`12202`（GELF TCP） | 確認沒被佔用：`ss -tulnp \| grep -E ':(8099\|12201\|12202) '`。 |
| 磁碟 | 約 50 MB | repo + Python deps + node_modules。 |

---

## 1. 安裝（一行指令，建議）

正式入口為 GitHub repo 內的安裝腳本，以 root 執行：

```bash
curl -fsSL https://raw.githubusercontent.com/jasoncheng7115/jt-gelflow/main/install.sh | sudo bash
```

依序做的事：

1. 確認 OS 是 Linux 且以 root 執行。
2. 偵測套件管理員（apt / dnf / yum / pacman / zypper）。
3. 網路 preflight — 對 GitHub / npm / PyPI 發 `HEAD`，5 秒內失敗就中止。
4. 安裝缺漏的 `git`、`python3`（含 `pip`）、`nodejs`、`npm`。
5. 確認 Python 為 3.10+（不符合直接拒絕）。
6. 從 `https://github.com/jasoncheng7115/jt-gelflow.git` clone 至 `/opt/jt-gelflow`。
7. 安裝 Python 套件（`pip install -r requirements.txt`）。
8. 建置前端（`npm install && npm run build`）。Node 太舊時自動 fallback 到 repo 內預建的 `dist/`。
9. 若沒有 `config.json`，從 `config.example.json` 播種一份。
10. 安裝 CLI 至 `/usr/local/bin/jt-gelflow`。
11. 詢問（預設 `yes`）是否安裝並啟動 `jt-gelflow.service` systemd unit。
12. 印出實際可連線的 URL：`http://<伺服器-IP>:8099`。

跑完從**另一台機器**的瀏覽器打開印出的 URL — 此 server 為 headless Linux，`127.0.0.1:8099` 只在伺服器本機有桌面才能用。

---

## 2. 安裝（手動）

如果不能用 `curl | bash`（公司 proxy、稽核政策等等）：

```bash
sudo git clone https://github.com/jasoncheng7115/jt-gelflow.git /opt/jt-gelflow
cd /opt/jt-gelflow

# 想先看看 install.sh 內容也行 — 不長且自我說明
cat install.sh

# 執行
sudo bash install.sh
```

---

## 3. 環境變數覆寫（進階）

安裝程式接受以下環境變數：

| 變數 | 預設 | 用途 |
|------|------|------|
| `JT_GELFLOW_REPO_URL` | `https://github.com/jasoncheng7115/jt-gelflow.git` | 指向 fork 或本地鏡像（`file://` 亦可）。 |
| `JT_GELFLOW_BRANCH` | `main` | 釘住 tag 或分支。 |
| `JT_GELFLOW_DIR` | `/opt/jt-gelflow` | 自訂安裝目錄。 |
| `JT_GELFLOW_NO_SERVICE` | `0` | `1` 跳過 systemd 安裝（之後手動 `python3 run.py`）。 |
| `JT_GELFLOW_YES` | `0` | `1` 對所有互動詢問都回 yes — CI 或 cloud-init 必須。 |

範例：無人值守安裝：

```bash
JT_GELFLOW_YES=1 curl -fsSL https://raw.githubusercontent.com/jasoncheng7115/jt-gelflow/main/install.sh | sudo bash
```

---

## 4. 安裝後驗證

```bash
# 服務啟用、port 正確
sudo jt-gelflow status
ss -tulnp | grep -E ":(8099|12201|12202) "

# HTTP 回 SPA
curl -sI http://127.0.0.1:8099/ | head -1   # 預期：HTTP/1.1 200 OK

# REST 回 config（確認 Python 那邊有正確 parse）
curl -s http://127.0.0.1:8099/api/config | head -c 200; echo

# 送一筆合成 GELF UDP 訊息
python3 -c '
import socket, json
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.sendto(json.dumps({
  "version":"1.1","host":"smoke","short_message":"install-test",
  "source_ip":"8.8.8.8","destination_ip":"10.0.0.10",
  "protocol_name":"TCP","destination_port":443,"network_bytes":1024
}).encode(), ("127.0.0.1", 12201))
'

# /api/stats 的 messageCount 應該 > 0
curl -s http://127.0.0.1:8099/api/stats
```

---

## 5. 首次設定

1. 從瀏覽器打開 `http://<伺服器-IP>:8099`。
2. 點齒輪 icon → 設定。
3. 調整「**欄位對應**」：左邊輸入符合你 GELF 來源的欄位名稱；右邊輸入要顯示在桑基圖欄位標題上的名稱。
4. 調整「**內部 CIDR**」符合你的網路範圍。
5. 儲存。設定持久化到 `/opt/jt-gelflow/config.json`。

`config.json` 已被 `.gitignore` — `sudo jt-gelflow update` 與重跑 `install.sh` 都不會覆蓋。

---

## 6. 反向代理（可選 — nginx 提供 HTTPS）

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

常見地雷：

- **必設 `client_max_body_size 100M`** — 設定 POST 過大會撞 `413 Request Entity Too Large`。
- **必須掛 `/` root**，不要 `/jt-gelflow/` — 前端用的是絕對路徑。
- **WebSocket header（`Upgrade`、`Connection`）必須轉發。**
- **`proxy_read_timeout 300s`** 防止安靜時段的 WebSocket 被砍。

---

## 7. 疑難排解

| 症狀 | 第一步檢查 |
|------|-------------|
| `connection refused` | `sudo jt-gelflow status` — 服務啟動過嗎？看 `sudo jt-gelflow logs`。 |
| 從別台連 8099 不通 | 防火牆（`ufw status`、`iptables -L INPUT`）。 |
| HTTP 載入但 WebSocket Disconnected | 反向代理沒帶 `Upgrade` / `Connection` header，或 `proxy_read_timeout` 太短。 |
| API 回空 | 看 `journalctl -u jt-gelflow.service` 是否出現 `Error loading config, using defaults: …`。 |
| GELF 流量不顯示 | 確認 `mapping.src_field` / `dst_field` 跟你實際送出的 GELF 欄位名稱一致。 |

其它問題：`journalctl -u jt-gelflow.service -n 200 --no-pager`。

---

## 8. 延伸閱讀

- [UPGRADE_zh-TW.md](UPGRADE_zh-TW.md) — 升級 SOP
- [README_zh-TW.md](README_zh-TW.md) — 功能總覽
- [CHANGELOG_zh-TW.md](CHANGELOG_zh-TW.md) — 版本更新記錄
