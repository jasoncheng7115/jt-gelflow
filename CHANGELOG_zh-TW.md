# 更新記錄

> **Language / 語言切換：** [English](CHANGELOG.md) | [繁體中文](CHANGELOG_zh-TW.md)

本專案所有重要變更皆記錄於本檔案。格式遵循 [Keep a Changelog 1.1.0](https://keepachangelog.com/zh-TW/1.1.0/)，版本號採用 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

---

## [1.5.4] — 2026-05-07

針對 Ubuntu 26 客戶實際回報的安裝卡關修正。

### 修正

- **`curl | sudo bash` 在 systemd 提示處卡住** — Ubuntu 26 / Debian 13（以及任何 sudoers 開了 `Defaults use_pty` 的設定）下，sudo 會替子程序開一個獨立 pty，腳本的 `/dev/tty` 寫得進去（提示有顯示）但讀不到 — 使用者的按鍵被 sudo 攔到另一個 pty，`read` 永遠拿不到輸入。客戶實際按了 Enter 沒反應。

### 變更

- **`install.sh` 的 `ask_yes_no` 加上 60 秒 timeout**。`/dev/tty` 讀不到時會逾時、印出警告並建議下次用 `JT_GELFLOW_YES=1` 跳過、然後以預設值繼續。安裝會走完，不會永遠卡住。
- **INSTALL.md / INSTALL_zh-TW.md** 疑難排解表多一條：症狀、根本原因、`JT_GELFLOW_YES=1` 的繞過寫法都列上去。

---

## [1.5.3] — 2026-05-02

桑基圖線寬計算方式可設定，配上一處 UI 微調與文件更新。

### 新增

- **設定面板新增「桑基圖設定」區塊**，可選擇「線寬計算方式」 — `value`（預設）或 `events`。後端對應新增 `Config.sankey_width_mode` 欄位。`value` 模式在沒有真實 byte 資料時會自然 fallback 到事件計數線寬（因為每筆流量都只貢獻 `value_default`，等於 1，導致每條 link 的 `value === events`）；`events` 模式則永遠用事件次數，即使有真實 byte 資料也是。桑基圖游標停留時 tooltip 對 `value === events` 的判斷在兩種模式下都會繼續省掉 byte 行。前端 App + SankeyCanvas 把這個模式傳下去，`buildSankeyData` 在 events 模式下把 `link.value` 替換成事件數。向前相容 — 舊的 `config.json` 沒這個 key 會用預設 `value`。
- **README 與 README_zh-TW** 在「Configuration」段下加了「桑基圖線寬計算」子章節，解釋兩種模式、自動 fallback 行為、設定位置。

### 變更

- **設定面板 checkbox 樣式**。原本自訂的 14×14 box 配上 5×9 並貼齊左上的白勾，框內明顯有空隙。改成 18×18 box + 6×11 勾，置中於 (5, 1) — 視覺上勾滿到框、滑鼠也比較好點到。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

---

## [1.5.2] — 2026-05-02

文件打磨與一處 UI 標題修正。沒有實際程式邏輯變動，dist/ rebuild 是為了讓修正過的設定面板標題能到使用者眼前。

### 變更

- **設定面板區塊標題**：`3D Globe / GeoIP Settings` → `2D Map / 3D Globe Settings`（中文：`3D 地球 / GeoIP 設定` → `2D 地圖 / 3D 地球 設定`）。裡面的所有設定（座標欄位名、內網 fallback 座標、地圖亮度、星空、stats Top-N、focus zoom）本來就同時影響 2D 跟 3D，標題寫成 3D 限定純粹是不準確。

### 文件

- **欄位對應範例擴充**。原本只列預設 Graylog 名稱（`network_bytes`、`protocol_name`、`source_ip_geolocation` …）容易讓讀者以為那些就是 JT-GELFLOW 唯一吃的字串。README 欄位對應表跟 landing page 的 Mapping 卡片都加了常見的替代命名 — IP（`src_ip` / `srcip` / `client_ip` / `suricata_srcip`）、Protocol（`proto` / `protocol` / `ip_proto` / `l4_proto`）、數值欄位（`bytes` / `length` / `datalen` / `octets`）、GeoIP（`src_geolocation` / `srcip_geolocation` / `geoip_src_location`）。
- **「pipeline」用詞釐清**。把「whichever your pipeline emits / 看你的 pipeline 實際送什麼」改成「whichever appears on incoming messages / 看實際收到的訊息上是哪一個」，避免熟 Graylog 的讀者誤以為是 Pipeline Rules 那個特定功能。Graylog 設定章節加了一段「關於欄位名稱」說明，解釋 JT-GELFLOW 看到的欄位名是 Graylog 的 Input → Extractors → Pipeline Rules → GeoIP processor → Stream Routing 累積結果。
- **landing page 的 `curl` 必要套件提示** 從原本一行 `·` 分隔的四個指令，改成兩欄表格（Debian/Ubuntu、RHEL/Fedora/Rocky/Alma、Arch/Manjaro、openSUSE 各自對應），讀者一眼看得出自己該用哪個。
- **Graylog → JT-GELFLOW 設定步驟** 加進 README（中英）並在 landing page 安裝區塊下方做成 callout：包含 System → Outputs → GELF Output、transport / host / port、stream 掛接、tcpdump 跟「已探索欄位」兩個 troubleshooting 步驟。
- **安裝區塊文字對比度**：`--text-dim`（#9ba8b8）在深色底下讀起來太淡，調亮成 #b4c0cf，安裝前置說明跟發行版欄則直接用 `--text` 全亮 — 這些是要讀的內容、不該是次要色。

---

## [1.5.1] — 2026-05-01

針對 v1.5.0 部署到客戶機後一連串浮現的問題集中修正：欄位對應的彈性大幅放寬（非標準 GELF schema 例如 Suricata 也能跑通）、安裝與升級流程修掉相依性 chicken-and-egg、儀表板在第一筆 log 進來之前也能正常操作。

### 新增

- **可設定的國碼 GELF 欄位** — 新增 `mapping.src_country_field`（預設 `source_ip_country_code`）、`mapping.dst_country_field`（預設 `destination_ip_country_code`）。設定面板「欄位對應」區出現一組「GELF 欄位 + 顯示名稱」配對輸入。2D 地圖／3D 地球的 Country Top-N 統計與桑基圖的國別欄位都會用這個。
- **欄位對應警告提示** — 「欄位對應」區頂端多一條琥珀色警告，提醒使用者改了這裡的欄位之後，下方「標籤範本」也要連動改成新的欄位名，否則節點與連線標籤會空白。
- **數值欄位的事件計數模式說明** — 「數值欄位」區頂端多一段提示，解釋給沒有封包長度欄位的來源（Suricata IDS、稽核 log）怎麼用：把 `value_field` 填一個訊息中不存在的名稱、預設值維持 1，每個事件就貢獻 1 個單位。桑基圖游標停留時的 tooltip 本來就會顯示 events 總數。
- **README 欄位對應指南** — 從原本 6 行表格擴成完整指南：五個設定區塊一覽（Field Mapping / Value Field / Label Templates / GeoIP / Zones）、改欄位時的注意事項、完整的 Suricata 範例（13 個欄位每個都列出該填什麼）。
- **網頁 Mapping 區塊** — Features 與 Hotkeys 之間新增「欄位對應」五張卡片，總結五個設定區塊的踩雷重點。導覽列也加了連結。
- **網頁 Hotkeys 區塊** — 列出鍵盤快速鍵（1/2/3/4 切檢視、Space 暫停、+/− 縮放、0 重設、方向鍵 pan）。
- **`curl` 必裝提示** — README、INSTALL、網頁 landing 的安裝指令上方都先點明 minimal Linux 沒預裝 curl 的話要先 `apt/dnf/pacman/zypper install curl`。
- **點選才載入的影片佔位 + poster** — `demo.mp4` 縮成 720p（33 MB → 4.8 MB），首次進站不抓影片。佔位用的是從同一支影片擷出來的一格，按下播放外框不會閃。
- **手機漢堡選單** — 行動版導覽列在 720px 以下變成漢堡 ☰，點下去從上方滑出選項，brand 不再被擠成兩行。

### 變更

- **CLI 改用 symlink，不再是檔案複本** — `/usr/local/bin/jt-gelflow` 現在指向 `/opt/jt-gelflow/bin/jt-gelflow`。修正前每次 CLI 修 bug 都要重跑 install.sh 才會生效，因為 user 路徑下的檔案是凍結的舊版；現在 `git pull` 一拉到新版立刻生效。
- **`bin/jt-gelflow` 自動 sudo** — 一般使用者跑 `start` / `stop` / `restart` / `update` / `uninstall` 時會自動以 `sudo` 重執行自己。沒裝 `sudo` 才會回 error。
- **`bin/jt-gelflow update` 偵測 Node 版本** — Vite 5 需要 Node 18+。修正前 Ubuntu 22.04 內建 npm 拉的是 Node 12，`update` 會在 build 那步炸 syntax error 導致整個 update 中止、service 沒重啟。現在跟 install.sh 一樣，遇到舊 Node 就直接用 `git pull` 拉到的 committed `dist/`。
- **Loading overlay 在 WebSocket 連上 2 秒後消失**，不再等到第一筆 GELF 訊息進來才放使用者進去。修正前還沒接 log 的客戶會永遠卡在「awaiting data」、無法打開設定。
- **設定面板 z-index 300 → 600**，蓋過 loading overlay，按齒輪一定打得開。
- **systemd unit 加 `TimeoutStopSec=10` + `KillMode=mixed`** — Python 收到 SIGTERM 沒乾淨退出時，10 秒內就會 SIGKILL，不會卡 systemd 預設的 90 秒。
- **Server shutdown 時主動關閉所有 WebSocket** — `runner.cleanup()` 不再卡在 handler 協程的 `async for msg in ws`。配上 TimeoutStopSec，`systemctl restart` 在瀏覽器還開著的情況下也能秒回。
- **截圖檔縮小** — 1723px → 1280px 寬，瀏覽器縮放比從 4.8× 降到 3.5×，鋸齒明顯改善。CSS 加上 `image-rendering: auto` 與 GPU 合成 hint。
- **Features 區塊鎖死 3×3 格** — 原本的 `auto-fit/minmax` 在桌機會跑出 4+4+1 的孤兒卡片。

### 修正

- **2D 地圖 / 3D 地球在非標準 GELF schema 下完全沒畫面。** `flow_aggregator` 只會把 canonical 名稱（`source_ip_geolocation`、`destination_ip_geolocation`）複製到傳給前端的 fields 字典，前端 `convertToGlobeData` 因此找不到值。現在連使用者設定的 `geoip.source_field` / `destination_field` 也會帶下去。
- **Country Top-N 統計面板就算地圖上有畫流量也是空的。** `convertToGlobeData` 寫死 `source_ip_country_code` / `destination_ip_country_code`，現在改成讀使用者設定的 `mapping.src_country_field` / `dst_country_field`。
- **External 節點標籤頂著內網 IP、外部 IP 只在括號裡** — 當 src/dst 不是 canonical 命名時，dst-side 欄位對調表是寫死的，現在會優先使用使用者設定的 `src_field` / `dst_field` / PTR / 國碼，沒對到才掉回 canonical 名稱。
- **Template 解出空字串時節點變成空盒** — 例如 template 仍寫 `{src_ip}` 但欄位已改名。現在會 fallback 到 `mapping.src_field` 取出來的原始 IP。
- **`install.sh` 在 vanilla Ubuntu 22.04 中段炸掉** — 因為 `python3` 預裝但 `python3-pip` 沒有。新增 `ensure_python_pip` 偵測並裝對應 distro 的套件。
- **Copy 按鈕跟著 `<pre>` 水平捲動而漂走** — 改放在不會 scroll 的外層 wrapper。
- **影片區按下播放時高度先塌再彈回** — `<video>` 元素 aspect-ratio 鎖 16:9，從第一幀就維持正確高度。
- **手機版 JT-GELFLOW 品牌字被切兩行、繁體中文按鈕被擠成一字一行** — 720px 以下整組導覽改成漢堡選單。
- **截圖 tile 上方頂到框邊** — 之前 lightbox 的 button reset 把 padding 蓋掉了，已修。
- **nginx 反向代理範例改用 `gelflow.example.com`** — 原本的 `flow.example.com` 跟專案的「Flow 檢視」名稱撞名容易誤解。

### 注意事項

- **沒有破壞性 schema 變更**。舊的 `config.json` 直接可以讀；新增的 `mapping.src_country_field` / `dst_country_field` 不存在時會用先前寫死的預設值。
- **客戶端升級方式**：`sudo bash <(curl -fsSL https://raw.githubusercontent.com/jasoncheng7115/jt-gelflow/main/install.sh)`（重跑一行 install.sh）一次拉到 CLI symlink、所有 fix 與重啟。

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
