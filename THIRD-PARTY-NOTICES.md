# Third-Party Notices

JT-GELFLOW depends on the following third-party components. Each component
remains under its own license; nothing in JT-GELFLOW's Apache 2.0 license
modifies the upstream terms below.

JT-GELFLOW 使用下列第三方套件。每個元件仍以其原本授權條款散布；本專案的
Apache 2.0 授權不變更上游條款。

---

## Python (runtime)

| Package | License | Project |
|---------|---------|---------|
| [aiohttp](https://pypi.org/project/aiohttp/) | Apache-2.0 | https://github.com/aio-libs/aiohttp |
| [aiohttp-cors](https://pypi.org/project/aiohttp-cors/) | Apache-2.0 | https://github.com/aio-libs/aiohttp-cors |

## JavaScript / TypeScript (runtime)

| Package | License | Project |
|---------|---------|---------|
| [react](https://www.npmjs.com/package/react) | MIT | https://github.com/facebook/react |
| [react-dom](https://www.npmjs.com/package/react-dom) | MIT | https://github.com/facebook/react |
| [d3](https://www.npmjs.com/package/d3) | ISC | https://github.com/d3/d3 |
| [d3-sankey](https://www.npmjs.com/package/d3-sankey) | BSD-3-Clause | https://github.com/d3/d3-sankey |
| [topojson-client](https://www.npmjs.com/package/topojson-client) | ISC | https://github.com/topojson/topojson-client |

## JavaScript / TypeScript (build / dev)

| Package | License | Project |
|---------|---------|---------|
| [vite](https://www.npmjs.com/package/vite) | MIT | https://github.com/vitejs/vite |
| [@vitejs/plugin-react](https://www.npmjs.com/package/@vitejs/plugin-react) | MIT | https://github.com/vitejs/vite-plugin-react |
| [typescript](https://www.npmjs.com/package/typescript) | Apache-2.0 | https://github.com/microsoft/TypeScript |
| [@types/react](https://www.npmjs.com/package/@types/react) | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| [@types/react-dom](https://www.npmjs.com/package/@types/react-dom) | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |

## Map data

The 2D Map and 3D Globe views fetch the world boundary GeoJSON at runtime
from `https://unpkg.com/world-atlas@2/countries-110m.json`
([world-atlas](https://github.com/topojson/world-atlas), public domain),
which derives from [Natural Earth](https://www.naturalearthdata.com/) public
domain map data.

地圖資料於執行期由 `unpkg.com/world-atlas` 載入，來源為公有領域的
[Natural Earth](https://www.naturalearthdata.com/) 資料。

## Geolocation lookup

The optional "Auto detect server location" feature calls
[ip-api.com](https://ip-api.com/) (free tier, no API key required). This call
is opt-in via the settings panel and is not invoked unless the user enables
`geoip.auto_detect_location`.

「自動偵測伺服器位置」選用功能會呼叫 [ip-api.com](https://ip-api.com/) 免費
方案，使用者於設定面板啟用時才會觸發。

---

For full license texts, see each project's repository linked above. Apache 2.0
contributors are noted in the respective NOTICE files of `aiohttp`,
`aiohttp-cors`, and `typescript`.
