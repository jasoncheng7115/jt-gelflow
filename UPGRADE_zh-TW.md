# JT-GELFLOW — 升級 SOP（繁體中文）

> **Language / 語言切換：** [English](UPGRADE.md) | [繁體中文](UPGRADE_zh-TW.md)

本文件為 **JT-GELFLOW v1.5.0+** 的 ops 等級升級流程。版本更新從公開 GitHub repo 拉取。

---

## 0. 升級安全保證

升級前先了解哪些事保證安全、哪些不保證：

| 保證 | 如何強制 |
|------|----------|
| **`config.json` 每次升級都保留** | `config.json` 已 `.gitignore`。`git pull` 不會動到。`install.sh` 在任何 reset 之前先救援 config，事後再放回。 |
| **未知 config key 被容忍** | `Config.from_dict()` 用 `__dataclass_fields__` 過濾。schema 中已不存在的舊 key 會被靜默忽略，不會崩潰。 |
| **Service 載入新 code** | `install.sh` 結尾用 `systemctl restart jt-gelflow.service`（不再只是 `enable --now`），確保跑著的 Python 程式被換掉。 |
| **UDP/TCP port 重綁無資料遺失** | service 重啟；約 1 秒 downtime 期間飛行中的 GELF 訊息會掉（UDP 本就是 best-effort）。要零損失請挑低流量時段執行 `sudo jt-gelflow update`。 |

**不保證**的部分：

- Python venv / 系統 pip 狀態與機器上其它程式共用。若有大版本 Python 改動使 `requirements.txt` bump 與其他 app 衝突，可能會摩擦。JT-GELFLOW 只用 `aiohttp` + `aiohttp-cors`，實務上很少衝突。
- 主要 UI 改動（如設定面板功能改名）可能需要升級後手動到設定頁確認一次。

---

## 1. 例行升級（建議）

minor / patch 版本更新，從機器任何位置用內建 CLI：

```bash
sudo jt-gelflow update
```

實際做：

1. `git -C /opt/jt-gelflow pull --ff-only`
2. `pip install --quiet -r requirements.txt`
3. `npm install && npm run build`（僅在有 Node 18+ 時）
4. `systemctl restart jt-gelflow.service`

`pull --ff-only` 成功（一般情況）這條路最快 — 含前端 build 通常 30 秒內完成。

---

## 2. 韌性升級（例行升級失敗時、或有 schema 變動時用）

`sudo jt-gelflow update` 若失敗（最常見錯誤：`fatal: Not possible to fast-forward, aborting`），改用完整安裝程式 — 它有更強的升級路徑：救援 config → fetch → reset 對齊 upstream → 還原 config。

```bash
curl -fsSL https://raw.githubusercontent.com/jasoncheng7115/jt-gelflow/main/install.sh | sudo bash
```

差異：

1. 偵測 `/opt/jt-gelflow` 的既有 checkout。
2. 先試 `git pull --ff-only`（乾淨升級路徑）。
3. 若失敗：
   - 把 `config.json` 複製到 tmp 目錄。
   - 一次性 migration：`git rm --cached config.json`（從 index 移除追蹤 — 只在從追蹤該檔的舊版升級才會有作用）。
   - `git fetch + git reset --hard origin/main`（強制對齊 upstream）。
   - `git clean -fd -e config.json`（清掉殘留檔，但保留我們要救的那個）。
   - 從 tmp 把 `config.json` 放回。
4. 重跑 pip + npm + systemctl restart。
5. 印出 URL。

即使 upstream 引入破壞性 schema 變更（例如 v1.4 → v1.5 移除 `sankey_stages` / `sankey_columns`），這條路依然安全。

---

## 3. 升級前檢查清單

動正式環境前：

```bash
# 1. 快照目前 config（萬一要手動比較或還原）
sudo cp /opt/jt-gelflow/config.json /opt/jt-gelflow/config.json.before-$(date +%Y%m%d)

# 2. 確認服務健康
sudo jt-gelflow status
curl -sI http://127.0.0.1:8099/ | head -1   # 預期 200

# 3. 看目前版本
grep VERSION /opt/jt-gelflow/src/client/App.tsx | head -1

# 4. 對 GitHub 看最新 tag / CHANGELOG
# https://github.com/jasoncheng7115/jt-gelflow/blob/main/CHANGELOG_zh-TW.md
```

---

## 4. 升級後驗證

```bash
# 服務仍 active
sudo jt-gelflow status

# port 一樣 listening
ss -tulnp | grep -E ":(8099|12201|12202) "

# config 保留
diff /opt/jt-gelflow/config.json /opt/jt-gelflow/config.json.before-$(date +%Y%m%d)
# 預期：差異為空，或僅你自己改過的欄位

# 即時流量仍進來
curl -s http://127.0.0.1:8099/api/stats
# 約 10 秒內 messageCount 應該 > 0

# Web UI 可達
curl -sI http://$(hostname -I | awk '{print $1}'):8099/ | head -1
```

瀏覽器若已開著舊頁：**硬重新整理**（`Ctrl+Shift+R` / `Cmd+Shift+R`）丟掉舊 JS bundle。新版 bundle 有不同 hash，會自動載入。

---

## 5. 釘住特定版本

要鎖定某個 release（受規範環境不能自動跟 `main`）：

```bash
JT_GELFLOW_BRANCH=v1.5.0 \
  curl -fsSL https://raw.githubusercontent.com/jasoncheng7115/jt-gelflow/v1.5.0/install.sh | sudo bash
```

（把 `v1.5.0` 換成你要的 tag。）

要把既有 checkout 釘住：

```bash
cd /opt/jt-gelflow
sudo git fetch --tags origin
sudo git checkout v1.5.0
sudo systemctl restart jt-gelflow.service
```

`config.json` 跟其它升級一樣保留。

---

## 6. 回滾

回退到舊版：

```bash
cd /opt/jt-gelflow
# 列出可用 tag
sudo git tag -l 'v*' | sort -V

# Reset 到指定 tag（v1.4.0 換成你要的）
sudo git fetch --tags origin
sudo git reset --hard v1.4.0

# 重裝相依 + 重建
sudo python3 -m pip install --quiet -r requirements.txt
sudo npm install --silent && sudo npm run build --silent  # 若有 Node 18+
sudo systemctl restart jt-gelflow.service
```

`config.json` 因 `.gitignore` 不會被 reset 動到。即使新版的某個 key 留在 config.json 而舊版沒這個 key — 也沒關係，舊版 `Config.from_dict()`（v1.5.0+）會忽略未知 key。

---

## 7. 解除安裝（順帶說明）

```bash
sudo jt-gelflow uninstall          # 移除程式檔 + 服務單元；保留 config.json
sudo jt-gelflow uninstall --purge  # 連 config.json 一併刪除
```

`uninstall`（不帶 `--purge`）後再次跑 `install.sh`，會救援那份倖存的 `config.json` 並從中播種給 fresh checkout。**先解除再重裝是安全的。**

---

## 8. 升級常見地雷

| 症狀 | 原因 | 解法 |
|------|------|------|
| `fatal: Not possible to fast-forward, aborting.` | upstream 歷史不再從本地 commit 線性連通（force-push / re-init / 分支重組）。 | 用韌性升級：重跑 `install.sh`。 |
| 升級後 service 還跑舊 code | v1.5.0 之前的 `install.sh` bug — 用 `enable --now`（已執行時是 no-op）。 | v1.5.0 已修。較舊安裝請在升級後 `sudo systemctl restart jt-gelflow.service`。 |
| `Error loading config, using defaults: unexpected keyword argument 'X'` | v1.5.0 之前的 server — 嚴格 config 解析。 | v1.5.0+ 容忍未知 key。要消警告就手動把那個 key 從 `config.json` 移除。 |
| 升級後瀏覽器仍是舊 UI | 快取住的 JS bundle（hash 不同）。 | 硬重新整理（`Ctrl+Shift+R` / `Cmd+Shift+R`）。 |
| 設定頁的客製值消失 | config 沒留下 — 看 `journalctl -u jt-gelflow.service` 是否有 `Error loading config…`。 | 從第 3 節做的 `.before-DATE` 快照還原。 |

---

## 9. 延伸閱讀

- [INSTALL_zh-TW.md](INSTALL_zh-TW.md) — 首次安裝 SOP
- [README_zh-TW.md](README_zh-TW.md) — 功能總覽
- [CHANGELOG_zh-TW.md](CHANGELOG_zh-TW.md) — 版本更新記錄
