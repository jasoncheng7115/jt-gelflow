# 更新記錄

> **Language / 語言切換：** [English](CHANGELOG.md) | [繁體中文](CHANGELOG_zh-TW.md)

本專案所有重要變更皆記錄於本檔案。格式遵循 [Keep a Changelog 1.1.0](https://keepachangelog.com/zh-TW/1.1.0/)，版本號採用 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

---

## [1.5.0] — 2026-05-01

桑基圖正式成為第 4 種檢視，欄位可自由組合、即時更新、滑鼠停在流量帶上會點亮整條鏈路、欄位顯示名稱整合進「欄位對應」設定。同時加入全域過場特效設定（光脈衝 / 字元雨）、向前相容的設定載入器（舊版 `config.json` 不會卡住 schema），並修掉長期遺留的 `install.sh` 升級時不會重啟 Python 的問題。

### 新增

- **桑基圖檢視（第 4 種檢視，熱鍵 `4`）** — 流量由左至右以「外網 → 內網」帶狀呈現，底層為 [`d3-sankey`](https://github.com/d3/d3-sankey)（BSD-3-Clause）。Snapshot 模式：graph 資料每 100ms 透過 ref 快取，但實際 layout / 重畫只在使用者設定的頻率（預設 5 秒，拉桿 1 → 30 秒）才跑，避免流量帶位置抖動。
- **桑基圖欄位可切換** — 六顆 chip：國別 / 來源 IP / 來源 IP 反解 / 協定 / 目的 IP / 目的 IP 反解。來源 IP、目的 IP 為必要、鎖定 active；其它四個獨立開關；畫面上左右排列固定，不論勾選順序。
- **依祖先分色** — 每條桑基圖路徑依其 `colorKey` 著色（有國別欄時用國別，否則用外網 IP）。10 色 categorical palette 依流量大小排序分配，主要流量拿到最具辨識度的顏色。節點統一薄荷綠，引導視線聚焦在流量帶。
- **Hover 整條鏈路點亮** — 滑鼠停在任何一條流量帶上，由 d3-sankey 注入的 `sourceLinks` / `targetLinks` 從兩端做 BFS，把整條鏈路頭尾全部點亮、其餘變暗。停在節點（rect 或文字標籤）上同樣點亮所有經過的鏈路。Tooltip 顯示總位元組數 + 事件數。
- **桑基圖各欄上方標題** — 每個 active 欄位上方顯示其設定的顯示名稱（置中於節點 bar 之上），按目前 active 欄位自動渲染。
- **桑基圖畫面內控制列** — 左下 bar 為欄位 chip + Top-N 外 / Top-N 內 數字輸入框（自動把 `sankey` 加進對應 `*_apply_to`，讓上限生效）；右下 bar 為更新頻率拉桿 + 數字輸入（1–30 秒，存於 `sankey_window_seconds`）。視覺語系統一於 `.zoom-controls`。
- **欄位顯示名稱併入「欄位對應」** — 每個 GELF 欄位輸入框旁邊配一個「顯示名稱」輸入框。顯示名稱即桑基圖該欄的標題，「讀哪個 GELF 欄位」與「畫面顯示什麼名稱」放在同一處避免不同步。
- **PTR 欄位對應** — 新增 `mapping.src_ptr_field`（預設 `source_ip_ptr`）與 `mapping.dst_ptr_field`（預設 `destination_ip_ptr`），告訴 aggregator 哪些 GELF 欄位儲存反向 DNS 值。桑基圖動態讀取 — 使用非 Graylog 預設欄位名（`my_dns`、`src_hostname` 等）的客戶可以直接指定，不必改 code。
- **全域過場特效設定** — 新增 `transition_effect: "warp" | "matrix"` config（預設 `warp`）。可選 光脈衝（掃描線 + 能量擴散圈）或 字元雨（Matrix Rain canvas）。現在的選擇套用於**全部四種**檢視切換，不再寫死在流量圖。
- **`apply_to` UI 第 4 顆「桑基圖」按鈕** — Internal Filter IPs / Top-N Internal / Top-N External 各列現在都能與流量圖 / 2D 地圖 / 3D 地球並列勾選桑基圖。
- **設定載入支援向前相容** — `Config.from_dict()` 透過 `__dataclass_fields__` 過濾掉未知 key。舊版 `config.json` 留有 schema 已不存在的 key（如本版移除的 `sankey_stages`）不再讓載入崩潰並掉回預設值。

### 變更

- **`install.sh` 結尾改用 `systemctl restart`**（不再只是 `enable --now`），讓 host 上若 service 已在跑，重跑安裝可立刻載入新版 code。修正前 `enable --now` 在已啟動的 service 上是 no-op，舊的 Python 程式會繼續處理請求。
- **install.sh 結尾摘要拿掉誤導的 `127.0.0.1` URL** — server 是 headless Linux，本機沒 GUI；改印 `http://<server-ip>:<port>`，IP 來自 `hostname -I`。
- **`/api/mapping` 改用 `asdict()` 回完整 `MappingConfig`**（不再寫死 8 個 key）。修正前新加的欄位（`*_display`、`*_ptr_field`、`country_display`）有寫進磁碟卻沒回傳，前端 SettingsPanel 表單會把這些欄位重置為空白，看起來像 Save 沒生效。

### 移除

- 暫定的 `sankey_stages` literal（`ext_int` / `ext_proto_int` / `country_ext_int` / …）已由 `sankey_active_columns`（字串陣列）取代。既有 `config.json` 若沒這個 key，會 fallback 到預設 `["country", "ext_ip", "ext_ip_ptr", "int_ip", "int_ip_ptr"]`。
- 獨立的 `sankey_columns` config dict 移除 — 欄位顯示名稱改放在 `MappingConfig` 中對應的 GELF 欄位旁邊（`*_display` 與 `country_display`）。

---

## [1.4.0] — 2026-01-09

首次公開 GitHub 發佈。新增 3D 地球自動旋轉、星空背景、狀態燈呼吸動畫、斷線停動，以及篩選器分檢視套用範圍。同時導入「升級安全」設定模型，客戶設定可在 `git pull` 與重跑 `install.sh` 時保留。

### 新增

- **3D 地球自動旋轉按鈕** — 右下角圖示鈕，啟用時圖示動畫旋轉。已節流至每 3 幀更新一次（約 20 fps），確保旋轉動畫不會卡住 WebSocket 訊息處理。
- **3D 地球星空背景** — 200 顆隨機分布、不同大小／顏色／透明度的星星，可於設定頁開關。
- **連線狀態呼吸燈** — 綠燈連線時呼吸，紅燈斷線時靜止並停止所有畫布動畫。讓卡住的 WebSocket 一眼能辨識。
- **篩選器分檢視套用範圍** — Internal Filter IPs / Top-N Internal / Top-N External 可獨立指定套用於 流量圖 / 2D 地圖 / 3D 地球。預設僅套用於流量圖。
- **升級安全的設定模型** — `config.json` 改為 `.gitignore`，repo 改附 `config.example.json` 範本。`install.sh` 僅在 `config.json` 不存在時以範本播種；重跑安裝（或 `sudo jt-gelflow update`）不會覆蓋使用者設定。

### 變更

- **預設地圖亮度** 提升至 75%，對 2D 地圖 / 3D 地球配色重新校正，弧線更清楚。
- **Top-N 標籤** 移除設定面板的「(左側)」「(右側)」字樣，位置由 UI 本身呈現。

### 修正

- **首次載入時縮放控制按鈕無作用** — 載入時即初始化 D3 zoom transform，使程式化縮放可正常觸發。先前按鈕需在使用者手動互動畫布後才會生效。
- **3D 地球弧線標籤在拖曳時位置漂移** — 改為保留 mid/before/after 三點資料，每幀重新計算螢幕座標與角度。
- **程式化縮放時的 `non-finite` 浮點錯誤** — 來源為合成事件無 `sourceEvent` 卻嘗試讀取滑鼠座標。現已對合成事件跳過此分支。

### 效能

- **自動旋轉節流**：每幀 → 每 3 幀，旋轉期間 DOM transform 寫入減少約 66%。

---

## [1.3.0] — 2026-01-08

### 新增

- **2D 地圖檢視**（麥卡托投影）與 **3D 地球檢視**（立體呈現，可拖曳旋轉 + 滾輪縮放）。
- **GeoIP 座標支援** — 來源／目的地欄位，並可為缺少 geo 資料的內部 IP 設定備用座標。
- **自動偵測伺服器位置** — 透過 `ip-api.com`，作為內部 IP 預設備用座標。
- **地圖／地球亮度** 滑桿與 **預設檢視** 選擇器加入設定。

### 變更

- **多語系**：UI 與設定全面支援 English / 繁體中文。
- **設定面板** 改版為可摺疊區塊。
- **節點標籤範本** 支援多重 fallback 語法（`{a||b||c|default}`）。

---

## [1.2.0] — 2026-01-07

### 新增

- 以可設定的 CIDR 範圍區分內部／外部區域分類。
- Top-N 節點篩選、即時搜尋、節點流量值顯示開關、內部對內部流量顯示開關。

### 變更

- Flow TTL 改為可設定。
- 節點標籤支援多行顯示。
- 整體渲染效能優化。

---

## [1.1.0] — 2026-01-06

### 新增

- 設定面板。
- GELF 欄位自動探索（記憶體快取 + TTL）。
- 使用各欄位最新值的即時範本預覽。
- 以最後一則 GELF 訊息時間戳驅動的七段顯示器時鐘。

### 變更

- WebSocket 重連更穩固。
- 節點布局演算法調整。

---

## [1.0.0] — 2026-01-05

### 新增

- 首次發佈。
- GELF UDP / TCP 收集器（支援 chunked 與 GZIP）。
- 2D 流量圖與動畫粒子（Canvas）。
- REST API + WebSocket（100ms 廣播）。
- 基本欄位對應設定。
