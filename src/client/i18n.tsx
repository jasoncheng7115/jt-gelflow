import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';

export type Language = 'en' | 'zh-TW';

// Translation dictionary
const translations: Record<Language, Record<string, string>> = {
  'en': {
    // Header
    'header.status': 'Status',
    'header.connected': 'WebSocket Connected',
    'header.disconnected': 'WebSocket Disconnected',
    'header.messages': 'Events',
    'header.flows': 'Flows',
    'header.internal': 'Internal',
    'header.external': 'External',
    // Stats panel short labels
    'stats.evt': 'EVT',
    'stats.flw': 'FLW',
    'stats.int': 'INT',
    'stats.ext': 'EXT',

    // View modes
    'view.flow': 'Flow',
    'view.2dMap': '2D Map',
    'view.3dGlobe': '3D Globe',
    'view.sankey': 'Sankey',
    'view.flowWithHotkey': 'Flow (Key 1)',
    'view.2dMapWithHotkey': '2D Map (Key 2)',
    'view.3dGlobeWithHotkey': '3D Globe (Key 3)',
    'view.sankeyWithHotkey': 'Sankey (Key 4)',
    'sankey.empty': 'No cross-boundary traffic right now.',
    'sankey.stage.ext_int': 'External IP → Internal IP',
    'sankey.stage.ext_proto_int': 'External IP → Protocol → Internal IP',
    'sankey.stage.country_ext_int': 'Country → External IP → Internal IP',
    'sankey.stage.country_ext_int_dptr': 'Country → External IP → Internal IP → Internal PTR',
    'sankey.stage.country_ext_sptr_int_dptr': 'Country → External IP → External PTR → Internal IP → Internal PTR',
    'sankey.unknownCountry': 'Unknown',
    'sankey.window': 'Update every',
    'sankey.columns': 'Columns',
    'sankey.topNExt': 'Top-N Ext',
    'sankey.topNInt': 'Top-N Int',
    'sankey.col.country': 'Source Country',
    'sankey.col.extIp': 'Source IP',
    'sankey.col.extIpPtr': 'Source IP PTR',
    'sankey.col.protocol': 'Protocol',
    'sankey.col.intIp': 'Destination IP',
    'sankey.col.intIpPtr': 'Destination IP PTR',
    'settings.sankeyColumns': 'Sankey column headers',
    'settings.sankeyColumnsHint': 'Column display names. Toggle which columns appear via the chips inside the Sankey view (Source IP and Destination IP are always shown).',

    // Context menu
    'flow.focusOnLabel': 'Focus on this Label',
    'globe.focusOnNode': 'Focus on this node',

    // Buttons
    'btn.pause': 'Pause',
    'btn.resume': 'Resume',
    'btn.pauseWithHotkey': 'Pause (Space)',
    'btn.resumeWithHotkey': 'Resume (Space)',
    'btn.clearData': 'Clear Data',
    'btn.settings': 'Settings',
    'btn.save': 'Save Settings',
    'btn.saving': 'Saving...',
    'btn.saveSuccess': 'Settings saved successfully!',
    'btn.autoDetect': 'Auto Detect',
    'btn.detecting': 'Detecting...',

    // Filter
    'filter.placeholder': '192.168.1.68 443 -10.0.0.1',
    'filter.usage': 'Filter Usage',
    'filter.showIp': 'Show IP (src or dst)',
    'filter.showPort': 'Show port',
    'filter.ipAndPort': 'IP AND port',
    'filter.multipleIps': 'Multiple IPs (OR)',
    'filter.excludeIp': 'Exclude IP',
    'filter.excludePort': 'Exclude port',
    'filter.matchLabel': 'Match label text',

    // Legend
    'legend.networkZones': 'Network Zones',
    'legend.internal': 'Internal',
    'legend.external': 'External',
    'legend.noGeoIP': 'No GeoIP',

    // Empty state
    'empty.title': 'Waiting for data...',
    'empty.description': 'Send GELF messages to start visualizing network flows. The visualization will update automatically.',
    'empty.udp': 'UDP',
    'empty.tcp': 'TCP',

    // Settings sections
    'settings.title': 'Settings',
    'settings.gelfPorts': 'GELF Ports',
    'settings.udpPort': 'UDP Port',
    'settings.tcpPort': 'TCP Port',
    'settings.flowSettings': 'Flow Settings',
    'settings.flowTtl': 'Flow TTL (seconds)',
    'settings.flowTtlHint': 'How long flows stay visible without new traffic',
    'settings.fieldMapping': 'Field Mapping',
    'settings.sourceIpField': 'Source IP Field',
    'settings.destIpField': 'Destination IP Field',
    'settings.protoField': 'Protocol Field',
    'settings.srcPtrField': 'Source IP PTR Field',
    'settings.dstPtrField': 'Destination IP PTR Field',
    'settings.srcCountryField': 'Source IP Country Field',
    'settings.dstCountryField': 'Destination IP Country Field',
    'settings.fieldMappingHint': 'Left: GELF field name to read from messages. Right: display name shown as the Sankey column header (and elsewhere when applicable).',
    'settings.fieldMappingTemplateReminder': 'If you change the field names here (e.g. src_ip → suricata_srcip), update the Label Templates section below to match — otherwise node and edge labels will render empty.',
    'settings.displayNamePlaceholder': 'Display name',
    'settings.countryDisplayLabel': 'Country column display name',
    'settings.countryDisplayHint': 'Sankey shows the external endpoint\'s country. The display name on the right is shared across both source/destination country fields.',
    'settings.dstCountrySharesDisplay': 'shares display name above',
    'settings.valueField': 'Value Field (bytes/count)',
    'settings.valueDefault': 'Default Value',
    'settings.valueTransform': 'Value Transform',
    'settings.transformNone': 'None',
    'settings.transformLog': 'Logarithmic',
    'settings.transformSqrt': 'Square Root',
    'settings.transformHint': 'Apply transformation to handle large value ranges',
    'settings.labelTemplates': 'Label Templates',
    'settings.templateHint': 'Use {field} or {field||default} syntax',
    'settings.nodeLabelTemplate': 'Node Label Template',
    'settings.edgeLabelTemplate': 'Edge Label Template',
    'settings.preview': 'Preview',
    'settings.noData': '(no data)',
    'settings.discoveredFields': 'Discovered Fields',
    'settings.clearFields': 'Clear',
    'settings.clearFieldsTooltip': 'Clear cached field names',
    'settings.fieldName': 'Field',
    'settings.fieldType': 'Type',
    'settings.fieldCount': 'Count',

    // Zone settings
    'settings.zoneSettings': 'Zone / Display Settings',
    'settings.internalCidrs': 'Internal CIDRs',
    'settings.internalCidrsHint': 'One CIDR per line (e.g., 192.168.0.0/16)',
    'settings.internalFilterIps': 'Internal Filter IPs',
    'settings.internalFilterIpsHint': 'Only show these internal IPs (one per line, empty = show all)',
    'settings.internalFilterApplyTo': 'Apply filter to',
    'settings.minTraffic': 'Minimum Traffic Threshold',
    'settings.minTrafficHint': 'Hide flows below this value',
    'settings.topNInternal': 'Top N Internal',
    'settings.topNInternalHint': 'Show only top N internal IPs by traffic. 0 = show all.',
    'settings.topNExternal': 'Top N External',
    'settings.topNExternalHint': 'Show only top N external IPs by traffic. 0 = show all.',
    'settings.showInternalTraffic': 'Show internal-to-internal traffic',
    'settings.showInternalTrafficHint': 'Display connections between internal network nodes (can be noisy).',
    'settings.showTrafficValue': 'Show traffic value on nodes',
    'settings.showTrafficValueHint': 'Display traffic value at the bottom of node labels.',

    // GeoIP settings
    'settings.geoipSettings': '3D Globe / GeoIP Settings',
    'settings.sourceGeoField': 'Source GeoIP Field',
    'settings.sourceGeoFieldHint': 'Field containing source coordinates (format: "lat,lng")',
    'settings.destGeoField': 'Destination GeoIP Field',
    'settings.destGeoFieldHint': 'Field containing destination coordinates (format: "lat,lng")',
    'settings.hideNoGeo': 'Hide external nodes without geolocation',
    'settings.hideNoGeoHint': 'If unchecked, external nodes without geo data are shown at origin (0,0)',
    'settings.internalLocation': 'Internal Network Location (Fallback)',
    'settings.latitude': 'Latitude',
    'settings.longitude': 'Longitude',
    'settings.internalLocationHint': 'Coordinates used for internal IPs on the globe',
    'settings.mapBrightness': 'Map/Globe Brightness',
    'settings.mapBrightnessHint': 'Adjust the brightness of the map and globe (0-100)',
    'settings.showStarfield': 'Show starfield background',
    'settings.showStarfieldHint': 'Display starfield effect behind the 3D globe',
    'settings.statsTopN': 'Statistics Top N',
    'settings.statsTopNHint': 'Number of items to display in statistics panel (Flow, 2D Map, 3D Globe)',
    'settings.focusZoomLevel': 'Focus Zoom Level',
    'settings.focusZoomLevelHint': 'Zoom level when double-clicking a node to focus (2D Map/3D Globe)',

    // Zoom controls
    'zoom.out': 'Zoom Out (Key -)',
    'zoom.in': 'Zoom In (Key +)',
    'zoom.reset': 'Reset Zoom (Key 0)',
    'zoom.to': 'Zoom to',

    // Globe/Map
    'globe.loading': 'Loading World Map...',
    'globe.nodes': 'Nodes',
    'globe.arcs': 'Arcs',
    'globe.dragRotate': 'Drag to rotate',
    'globe.dragPan': 'Drag to pan',
    'globe.scrollZoom': 'Scroll to zoom',
    'globe.noGeoData': 'No geo data in current flows',
    'globe.autoRotate': 'Auto Rotate',
    'globe.tooltip.location': 'Location',
    'globe.tooltip.coords': 'Coords',
    'globe.tooltip.in': 'In',
    'globe.tooltip.out': 'Out',
    'globe.stats': 'Statistics',

    // Status popup
    'status.connectionInfo': 'Connection Info',
    'status.status': 'Status',
    'status.wsUrl': 'WebSocket URL',
    'status.httpUrl': 'HTTP URL',
    'status.gelfUdp': 'GELF UDP Port',
    'status.gelfTcp': 'GELF TCP Port',

    // Language
    'lang.en': 'English',
    'lang.zh-TW': '繁體中文',

    // Clock
    'clock.lastLogTimestamp': 'Last received log timestamp',

    // Default View
    'settings.defaultView': 'Default View',
    'settings.defaultViewHint': 'The view mode to show when page loads',
    'settings.transitionEffect': 'Transition Effect',
    'settings.transitionEffect.warp': 'Light Pulse',
    'settings.transitionEffect.matrix': 'Matrix Rain',
    'settings.transitionEffectHint': 'Animation when switching between view modes. Applies to all four views.',
  },

  'zh-TW': {
    // Header
    'header.status': '狀態',
    'header.connected': 'WebSocket 連線正常',
    'header.disconnected': 'WebSocket 已斷線',
    'header.messages': '事件',
    'header.flows': '流量',
    'header.internal': '內部',
    'header.external': '外部',
    // Stats panel short labels
    'stats.evt': '事件',
    'stats.flw': '流量',
    'stats.int': '內部',
    'stats.ext': '外部',

    // View modes
    'view.flow': '流量圖',
    'view.2dMap': '2D 地圖',
    'view.3dGlobe': '3D 地球',
    'view.sankey': '桑基圖',
    'view.flowWithHotkey': '流量圖 (按鍵 1)',
    'view.2dMapWithHotkey': '2D 地圖 (按鍵 2)',
    'view.3dGlobeWithHotkey': '3D 地球 (按鍵 3)',
    'view.sankeyWithHotkey': '桑基圖 (按鍵 4)',
    'sankey.empty': '目前沒有跨內外網的流量。',
    'sankey.stage.ext_int': '外網 IP → 內網 IP',
    'sankey.stage.ext_proto_int': '外網 IP → 協定 → 內網 IP',
    'sankey.stage.country_ext_int': '國別 → 外網 IP → 內網 IP',
    'sankey.stage.country_ext_int_dptr': '國別 → 外網 IP → 內網 IP → 內網 PTR',
    'sankey.stage.country_ext_sptr_int_dptr': '國別 → 外網 IP → 外網 PTR → 內網 IP → 內網 PTR',
    'sankey.unknownCountry': '未知',
    'sankey.window': '更新頻率',
    'sankey.columns': '欄位',
    'sankey.topNExt': 'Top-N 外',
    'sankey.topNInt': 'Top-N 內',
    'sankey.col.country': '來源國碼',
    'sankey.col.extIp': '來源 IP',
    'sankey.col.extIpPtr': '來源 IP 反解',
    'sankey.col.protocol': '協定',
    'sankey.col.intIp': '目的 IP',
    'sankey.col.intIpPtr': '目的 IP 反解',
    'settings.sankeyColumns': '桑基圖欄位標題',
    'settings.sankeyColumnsHint': '欄位顯示名稱。在桑基圖畫面內以下方按鈕切換出現的欄位（來源 IP 與目的 IP 為必要恆顯示）。',

    // Context menu
    'flow.focusOnLabel': '只看此 Label',
    'globe.focusOnNode': '聚焦此節點',

    // Buttons
    'btn.pause': '暫停',
    'btn.resume': '繼續',
    'btn.pauseWithHotkey': '暫停 (空白鍵)',
    'btn.resumeWithHotkey': '繼續 (空白鍵)',
    'btn.clearData': '清除資料',
    'btn.settings': '設定',
    'btn.save': '儲存設定',
    'btn.saving': '儲存中...',
    'btn.saveSuccess': '設定已儲存成功！',
    'btn.autoDetect': '自動偵測',
    'btn.detecting': '偵測中...',

    // Filter
    'filter.placeholder': '192.168.1.68 443 -10.0.0.1',
    'filter.usage': '篩選用法',
    'filter.showIp': '顯示 IP（來源或目的）',
    'filter.showPort': '顯示連接埠',
    'filter.ipAndPort': 'IP 且 連接埠',
    'filter.multipleIps': '多個 IP（或）',
    'filter.excludeIp': '排除 IP',
    'filter.excludePort': '排除連接埠',
    'filter.matchLabel': '比對標籤文字',

    // Legend
    'legend.networkZones': '網路區域',
    'legend.internal': '內部',
    'legend.external': '外部',
    'legend.noGeoIP': '無地理位置',

    // Empty state
    'empty.title': '等待資料中...',
    'empty.description': '傳送 GELF 訊息以開始視覺化網路流量。視覺化將自動更新。',
    'empty.udp': 'UDP',
    'empty.tcp': 'TCP',

    // Settings sections
    'settings.title': '設定',
    'settings.gelfPorts': 'GELF 連接埠',
    'settings.udpPort': 'UDP 連接埠',
    'settings.tcpPort': 'TCP 連接埠',
    'settings.flowSettings': '流量設定',
    'settings.flowTtl': '流量 TTL（秒）',
    'settings.flowTtlHint': '無新流量時，流量保持可見的時間',
    'settings.fieldMapping': '欄位對應',
    'settings.sourceIpField': '來源 IP 欄位',
    'settings.destIpField': '目的 IP 欄位',
    'settings.protoField': '協定欄位',
    'settings.srcPtrField': '來源 IP PTR 欄位',
    'settings.dstPtrField': '目的 IP PTR 欄位',
    'settings.srcCountryField': '來源 IP 國碼欄位',
    'settings.dstCountryField': '目的 IP 國碼欄位',
    'settings.fieldMappingHint': '左：GELF 訊息中要讀取的欄位名稱。右：顯示名稱（會用於桑基圖欄位標題等場合）。',
    'settings.fieldMappingTemplateReminder': '若這裡改了欄位名稱（例如 src_ip → suricata_srcip），下方「標籤範本」區也要一起改成對應的欄位名稱，不然節點與連線標籤會顯示空白。',
    'settings.displayNamePlaceholder': '顯示名稱',
    'settings.countryDisplayLabel': '國碼欄位顯示名稱',
    'settings.countryDisplayHint': '桑基圖會顯示對外端點的國碼。右側顯示名稱由來源與目的國碼欄位共用。',
    'settings.dstCountrySharesDisplay': '與上面共用顯示名稱',
    'settings.valueField': '數值欄位（位元組/計數）',
    'settings.valueDefault': '預設值',
    'settings.valueTransform': '數值轉換',
    'settings.transformNone': '無',
    'settings.transformLog': '對數',
    'settings.transformSqrt': '平方根',
    'settings.transformHint': '套用轉換以處理大數值範圍',
    'settings.labelTemplates': '標籤範本',
    'settings.templateHint': '使用 {field} 或 {field||default} 語法',
    'settings.nodeLabelTemplate': '節點標籤範本',
    'settings.edgeLabelTemplate': '連線標籤範本',
    'settings.preview': '預覽',
    'settings.noData': '（無資料）',
    'settings.discoveredFields': '已探索欄位',
    'settings.clearFields': '清除',
    'settings.clearFieldsTooltip': '清除已快取的欄位名稱',
    'settings.fieldName': '欄位',
    'settings.fieldType': '類型',
    'settings.fieldCount': '數量',

    // Zone settings
    'settings.zoneSettings': '區域 / 顯示設定',
    'settings.internalCidrs': '內部網段 CIDR',
    'settings.internalCidrsHint': '每行一個 CIDR（例如 192.168.0.0/16）',
    'settings.internalFilterIps': '內部篩選 IP',
    'settings.internalFilterIpsHint': '只顯示這些內部 IP（每行一個，空白 = 顯示全部）',
    'settings.internalFilterApplyTo': '套用篩選至',
    'settings.minTraffic': '最小流量門檻',
    'settings.minTrafficHint': '隱藏低於此數值的流量',
    'settings.topNInternal': '前 N 個內部',
    'settings.topNInternalHint': '只顯示流量最大的前 N 個內部 IP。0 = 顯示全部。',
    'settings.topNExternal': '前 N 個外部',
    'settings.topNExternalHint': '只顯示流量最大的前 N 個外部 IP。0 = 顯示全部。',
    'settings.showInternalTraffic': '顯示內部對內部流量',
    'settings.showInternalTrafficHint': '顯示內部網路節點之間的連線（可能較雜亂）。',
    'settings.showTrafficValue': '在節點上顯示流量數值',
    'settings.showTrafficValueHint': '在節點標籤底部顯示流量數值。',

    // GeoIP settings
    'settings.geoipSettings': '3D 地球 / GeoIP 設定',
    'settings.sourceGeoField': '來源 GeoIP 欄位',
    'settings.sourceGeoFieldHint': '包含來源座標的欄位（格式："lat,lng"）',
    'settings.destGeoField': '目的 GeoIP 欄位',
    'settings.destGeoFieldHint': '包含目的座標的欄位（格式："lat,lng"）',
    'settings.hideNoGeo': '隱藏無地理位置的外部節點',
    'settings.hideNoGeoHint': '若取消勾選，無地理資料的外部節點將顯示在原點 (0,0)',
    'settings.internalLocation': '內部網路位置（備用）',
    'settings.latitude': '緯度',
    'settings.longitude': '經度',
    'settings.internalLocationHint': '地球上內部 IP 使用的座標',
    'settings.mapBrightness': '地圖/地球亮度',
    'settings.mapBrightnessHint': '調整地圖和地球的亮度 (0-100)',
    'settings.showStarfield': '顯示星空背景',
    'settings.showStarfieldHint': '在 3D 地球後方顯示星空效果',
    'settings.statsTopN': '統計顯示數量',
    'settings.statsTopNHint': '統計面板中顯示的項目數量 (Flow、2D 地圖、3D 地球)',
    'settings.focusZoomLevel': '聚焦縮放等級',
    'settings.focusZoomLevelHint': '雙擊節點聚焦時的縮放等級 (2D 地圖/3D 地球)',

    // Zoom controls
    'zoom.out': '縮小 (按鍵 -)',
    'zoom.in': '放大 (按鍵 +)',
    'zoom.reset': '重設縮放 (按鍵 0)',
    'zoom.to': '縮放至',

    // Globe/Map
    'globe.loading': '載入世界地圖中...',
    'globe.nodes': '節點',
    'globe.arcs': '連線',
    'globe.dragRotate': '拖曳旋轉',
    'globe.dragPan': '拖曳平移',
    'globe.scrollZoom': '滾輪縮放',
    'globe.noGeoData': '目前流量中無地理位置資料',
    'globe.autoRotate': '自動旋轉',
    'globe.tooltip.location': '位置',
    'globe.tooltip.coords': '座標',
    'globe.tooltip.in': '流入',
    'globe.tooltip.out': '流出',
    'globe.stats': '統計',

    // Status popup
    'status.connectionInfo': '連線資訊',
    'status.status': '狀態',
    'status.wsUrl': 'WebSocket 網址',
    'status.httpUrl': 'HTTP 網址',
    'status.gelfUdp': 'GELF UDP 連接埠',
    'status.gelfTcp': 'GELF TCP 連接埠',

    // Language
    'lang.en': 'English',
    'lang.zh-TW': '繁體中文',

    // Clock
    'clock.lastLogTimestamp': '最後收到的 log 時間戳記',

    // Default View
    'settings.defaultView': '預設檢視模式',
    'settings.defaultViewHint': '頁面載入時顯示的檢視模式',
    'settings.transitionEffect': '過場特效',
    'settings.transitionEffect.warp': '光脈衝',
    'settings.transitionEffect.matrix': 'Matrix Rain (字元雨)',
    'settings.transitionEffectHint': '切換檢視模式時的動畫效果，套用於全部四種檢視。',
  },
};

// Language context
interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | null>(null);

// Storage key
const LANGUAGE_STORAGE_KEY = 'jt-gelflow-language';

// Provider component
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored === 'en' || stored === 'zh-TW') {
        return stored;
      }
    }
    return 'en'; // Default to English
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  }, []);

  const t = useCallback((key: string): string => {
    return translations[language][key] || key;
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

// Hook to use translations
export function useTranslation() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }
  return context;
}

// Hook for just the t function (convenience)
export function useT() {
  const { t } = useTranslation();
  return t;
}
