# JT-GELFLOW — 發版測試清單

> **Language / 語言切換：** [English](TESTS.md) | [繁體中文](TESTS_zh-TW.md)

每次推進版本 tag 之前，**整份清單都要跑過**。每項標記 ✅ 通過 / ❌ 失敗 / ⏭ 略過 / 👁 人工。清單分為可自動化（透過 SSH 對測試機執行）與視覺人工（需要瀏覽器）兩類。

建議目標：一台 ≥ Ubuntu 22.04 帶 `systemd` 的 Linux VM，能乾淨地安裝／升級／移除 jt-gelflow。共存測試可選。

---

## A. 安裝生命週期

| # | 測試 | 怎麼做 |
|---|------|--------|
| A1 | 在乾淨 Linux 上首次安裝 | 沒有舊安裝的主機上跑 `JT_GELFLOW_YES=1 curl -fsSL …/install.sh \| sudo bash` |
| A2 | 服務最終 `active + enabled` | `sudo jt-gelflow status` |
| A3 | 三個 port 都 listening | `ss -tulnp \| grep -E ':(8099\|12201\|12202) '` 顯示 3 條 |
| A4 | CLI 已安裝 | `which jt-gelflow` 回 `/usr/local/bin/jt-gelflow` |
| A5 | Web UI 回 HTTP 200 | `curl -sI http://127.0.0.1:8099/ \| head -1` 為 `HTTP/1.1 200 OK` |
| A6 | API 回完整 schema | `curl -s http://127.0.0.1:8099/api/config` 是合法 JSON，含 `transition_effect`、`sankey_active_columns`、`mapping.country_display` 等欄位 |
| A7 | systemd 權限隔離設定 | `systemctl cat jt-gelflow \| grep -E 'NoNewPrivileges\|ProtectSystem'` 看到隔離指令 |
| A8 | 在已存在 checkout 上重跑安裝不報錯 | 跑兩次 install.sh — 第二次走 git pull 路徑，應成功 |
| A9 | 重裝時 service 是 restart 而非僅 enable --now | `journalctl` 在第二次安裝看到 `Stopping`/`Started` |

## B. 升級

| # | 測試 | 怎麼做 |
|---|------|--------|
| B1 | 本地 `main` 落後於 upstream 時，`sudo jt-gelflow update` 成功 | 觸發 git fetch + ff-only |
| B2 | 升級後 service 用新 code 重啟 | `systemctl show jt-gelflow.service -p ActiveEnterTimestamp` 是最近時間 |
| B3 | 客戶 config 在 `jt-gelflow update` 後保留 | POST `/api/config {"flow_ttl_seconds": 23}`、跑 update、GET `/api/config` 仍回 23 |
| B4 | 客戶 config 在重跑 `install.sh` 後保留 | 同 B3 但用安裝程式觸發 |
| B5 | 向前相容：v1.5 之前帶 `sankey_stages` 的 config 不會炸 load | 把 `"sankey_stages": "ext_proto_int"` 注入 config.json、重啟服務、port 仍是 8099（沒掉回 8080），警告無害 |
| B6 | ff-only 失敗時走韌性路徑 | 變動本地 git 歷史（`git reset --hard $(git rev-parse HEAD~1)` 後重新 init upstream 為不同歷史），重跑 install.sh — 應該救援 config + reset --hard + 還原 |
| B7 | 釘住特定 tag | 乾淨 checkout 後 `JT_GELFLOW_BRANCH=v1.5.0 curl -fsSL …/install.sh \| sudo bash` — 本地 HEAD 指向 `v1.5.0` |

## C. 移除

| # | 測試 | 怎麼做 |
|---|------|--------|
| C1 | `sudo jt-gelflow uninstall`（不 purge）保留 config.json | 移除後 `/opt/jt-gelflow/config.json` 仍在；service unit 消失；port 關閉 |
| C2 | `sudo jt-gelflow uninstall --purge` 全清 | `/opt/jt-gelflow` 不存在；`/etc/systemd/system/jt-gelflow.service` 不存在；CLI 不存在 |
| C3 | 移除後重新安裝（不 purge）還原 config | 再裝一次、GET `/api/config` 顯示先前客製值 |

## D. 共存（可選，僅在共享主機上）

| # | 測試 | 怎麼做 |
|---|------|--------|
| D1 | 任何 jt-gelflow 操作前，先快照另一個專案狀態 | 對 `/opt/<其他>` 內容做 hash、列 port、`pip list` |
| D2 | jt-gelflow 安裝不改變另一專案的檔案 | 重新快照、diff |
| D3 | jt-gelflow 升級不改變另一專案的檔案 | 同上 |
| D4 | jt-gelflow 移除不動到另一專案 | 同上 |

## E. 資料管線

| # | 測試 | 怎麼做 |
|---|------|--------|
| E1 | UDP GELF（無 null byte）能進來 | `python3 -c 'import socket,json; sock=socket.socket(socket.AF_INET, socket.SOCK_DGRAM); sock.sendto(json.dumps({...}).encode(), ("127.0.0.1", 12201))'` → `/api/stats` messageCount > 0 |
| E2 | TCP GELF（null 結尾）能進來 | 改用 `SOCK_STREAM`、payload 加 `... + b'\x00'` |
| E3 | GZIP 過的 UDP 訊息可解碼 | 送 gzip 壓縮過的 payload |
| E4 | Chunked UDP 訊息可重組 | 送拆 2 chunk 的大訊息 |
| E5 | 欄位自動探索 | 送一筆含自訂 `_my_field` 的封包後 `/api/fields` 看得到 |
| E6 | 內外部分類 | inbound（8.8.8.8 → 10.0.0.10）和 outbound（10.0.0.10 → 8.8.8.8）正確進對應 zone |
| E7 | 跨內外網才進 Sankey | 只有「恰一邊內部」的 flow 才會進 Sankey aggregate |
| E8 | TTL 過期 | 等 `flow_ttl_seconds` 後 `/api/graph` 縮小 |
| E9 | 自訂 PTR 欄位名稱 | 設 `mapping.src_ptr_field = "my_dns"`、送有 `_my_dns` 的封包，Sankey ext_ip_ptr 欄顯示該值 |

## F. 檢視模式

| # | 測試 | 怎麼做 |
|---|------|--------|
| F1 | Flow 渲染 | 切到 Flow，Canvas 上的粒子有動畫 |
| F2 | 2D Map 渲染 | 切到 2D Map（需要 GeoIP 標記的 GELF），看到弧線 |
| F3 | 3D Globe 渲染 | 切到 3D Globe，球體含國界、有弧線 |
| F4 | 桑基圖渲染 | 切到桑基圖（需要跨內外網 GELF），看到帶狀 |
| F5 | 熱鍵 1/2/3/4 切換檢視 | 確認 |
| F6 | Spacebar 暫停 | 確認；粒子停止、狀態圖示切換 |
| F7 | 方向鍵 / +/-/0 工作 | 流量圖 / 2D 地圖 / 3D 地球（桑基圖不適用） |
| F8 | 過場特效=warp（預設）四檢視都套 | 設定 → 過場特效，切換檢視，看到掃描線 + 縮放 |
| F9 | 過場特效=matrix 四檢視都套 | 切設定後切檢視，看到 Matrix 字元雨蓋上 |

## G. 桑基圖專屬

| # | 測試 | 怎麼做 |
|---|------|--------|
| G1 | 6 個欄位 chip 都呈現 | 國別 / 來源 IP / 來源 IP 反解 / 協定 / 目的 IP / 目的 IP 反解 |
| G2 | 來源 IP + 目的 IP 為必要、鎖定 | 點擊無作用、樣式為 `is-mandatory` |
| G3 | 可選 chip 可開關 | 點選增加/移除自 `sankey_active_columns` 並 POST 設定 |
| G4 | 欄位左右順序固定 | 不論勾選順序，layout 為 `country → ext_ip → ext_ip_ptr → protocol → int_ip → int_ip_ptr` |
| G5 | 更新頻率拉桿 1–30s | 拉到 2 → 每 2 秒重排；拉到 30 → 幾乎不變 |
| G6 | 數字輸入框與拉桿同步 | 輸入 10 → 拉桿移到 10 |
| G7 | 內嵌 Top-N 自動把 sankey 加進 apply_to | 設 Top-N Ext = 5 → `zones.top_n_external_apply_to` 含 `sankey` |
| G8 | Hover 流量帶 → 整條鏈路點亮 | 從 `dns.google. → 192.168.1.x` 流量帶，整條 `US → 8.8.8.8 → dns.google → 192.168.1.x → dc1.jason.tools` 點亮 |
| G9 | Hover 節點 → 所有經過的鏈路點亮 | hover `192.168.1.105` 節點 → 進出該節點的每條流量帶都亮 |
| G10 | 依祖先分色 | 開啟 country 欄時，同一 country 的所有流量帶共用 10 色 palette 的同色 |
| G11 | 各欄上方有標題 | 每個 active 欄位顯示設定的顯示名稱、置中於該欄節點 bar 之上 |
| G12 | 標題來自 `mapping.*_display` | 編輯欄位對應的顯示名稱、儲存後標題更新 |
| G13 | 國碼標題來自 `mapping.country_display` | 編輯獨立的國碼顯示名稱欄 → 桑基圖國碼欄標題更新 |
| G14 | 沒跨內外網時顯示空狀態文字 | 無 inbound/outbound 流量時顯示「目前沒有跨內外網的流量」 |

## H. 設定面板

| # | 測試 | 怎麼做 |
|---|------|--------|
| H1 | 設定面板開／關 | 齒輪 icon → modal 開；X / Esc / 點外面 → 關 |
| H2 | 欄位對應每行有並排顯示名稱輸入框 | 左=GELF 欄位、右=顯示名稱 |
| H3 | 儲存持久化到 config.json | 編輯 → 儲存 → 重新整理 → 值仍在 |
| H4 | apply_to 第 4 顆 Sankey 按鈕 | Internal Filter / Top-N Internal / Top-N External 三處都有 |
| H5 | 預設檢視下拉含 Sankey | 選項：Flow / 2D 地圖 / 3D 地球 / 桑基圖 |
| H6 | 過場特效下拉 2 個選項 | Warp Transition（預設）/ Matrix Rain |
| H7 | 國碼顯示名稱範例文字為英文 | "Source Country" |
| H8 | 顯示名稱共用 placeholder 跟著 i18n | EN: "Display name" / zh-TW: "顯示名稱" |

## I. 視覺／UX（人工）

| # | 測試 | 怎麼做 |
|---|------|--------|
| I1 | 連線時呼吸燈 | 綠點呼吸動畫 |
| I2 | 斷線時靜止紅燈 | 殺 server，紅點靜止、動畫停 |
| I3 | 首次連線載入畫面 | 硬重新整理，spinner 跑到 100% 後淡出 |
| I4 | header FLW/EXT/INT 即時更新 | 看著計數隨 GELF 進來增加 |
| I5 | 七段顯示器時鐘隨新 GELF 跳動 | 時鐘顯示最後一筆訊息時間 |
| I6 | 搜尋列過濾 | 輸入 IP/port/proto，flows 過濾 |
| I7 | Flow 視圖空狀態 | 清資料 → 出現「Waiting for data」 |
| I8 | 語系切換（EN/zh-TW） | 點 header 語言 → UI 全切換 |
| I9 | 流量圖 / 2D 地圖 / 3D 地球 縮放控制 | + / - / preset 按鈕 |
| I10 | 3D Globe 自動旋轉 | 球體右下按鈕 |
| I11 | 3D Globe 星空背景開關 | 設定切換、背景跟著變 |

## J. 文件 / 製品

| # | 測試 | 怎麼做 |
|---|------|--------|
| J1 | 8 份文件齊全 | `ls github/*.md` 含 CHANGELOG、INSTALL+zh、README+zh、THIRD-PARTY-NOTICES、TESTS+zh、UPGRADE+zh |
| J2 | 雙語對應結構一致 | `grep '^## '` 計數對齊 |
| J3 | HTML 頁面解析 | `python3 -c "from html.parser import HTMLParser; HTMLParser().feed(open(...).read())"` 對 `docs/index*.html` 兩份 |
| J4 | 對外文件無內網 IP | `grep -rE '192\.168\.[0-9]+\.[0-9]+'` 對 `*.md` `*.html` 僅看到 RFC1918 範例 |
| J5 | 繁中文件無大陸用語 | 對 `信息`/`軟件`/`默認`/`用戶`/`數據`/`服務器`/`緩存`/`屏幕` 在 `*_zh-TW.md` 與 `index_zh-TW.html` grep 為空 |
| J6 | `package.json`、`App.tsx:VERSION`、`SettingsPanel.tsx:VERSION`、README header、landing footer 版本一致 | 全部 grep 後 diff |
| J7 | CHANGELOG 有此版條目 | `grep "^## \[$(jq -r .version package.json)\]" CHANGELOG.md` |

## K. Build / bundle

| # | 測試 | 怎麼做 |
|---|------|--------|
| K1 | `npx vite build` 無錯成功 | exit code 0、dist/ 有產物 |
| K2 | 四個 view chunk 都在 | `dist/client/assets/` 含 `SankeyCanvas-*.js`、`GlobeCanvas-*.js`、`transform-*.js`、主 `index-*.js` |
| K3 | Bundle 大小未爆 | 主 `index-*.js` < 300 kB、gz < 90 kB；Sankey lazy chunk < 25 kB |

---

## 怎麼跑

一般 minor / patch bump：

1. 本機跑 K（build）。
2. 同步到測試機：`bash sync-to-github.sh --build && rsync … && ssh … bash install.sh`。
3. 透過 SSH 跑 A、B（升級子集）、E、G（Sankey 透過 API）、H（設定透過 API）、J（製品）。
4. 在測試機 URL 開瀏覽器跑 F、I。
5. 只在循環尾端要重測時跑 C（移除）。

major release：跑**全部**，包含 D（共存）— 在另有專案的主機上做。

把結果記到本檔案的歷史（或快照成 `TESTS_RESULTS_v<X.Y.Z>.md`）讓未來維護者看得到該版本實際驗證過什麼。

---

## 延伸閱讀

- [INSTALL_zh-TW.md](INSTALL_zh-TW.md) — 安裝流程
- [UPGRADE_zh-TW.md](UPGRADE_zh-TW.md) — 升級流程
- [CHANGELOG_zh-TW.md](CHANGELOG_zh-TW.md) — 版本更新記錄
