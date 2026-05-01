export interface FlowKey {
  src: string;
  dst: string;
  proto: string;
}

export type ZoneType = "internal" | "external" | "inbound" | "outbound";

export interface FlowData {
  key: FlowKey;
  srcLabel: string;
  dstLabel: string;
  edgeLabel: string;
  value: number;
  count: number;
  lastUpdate: number;
  zone: ZoneType;
  fields: Record<string, string | number>;  // Original message fields for filtering
}

export interface NodeData {
  id: string;
  label: string;
  totalIn: number;
  totalOut: number;
  connections: number;
}

export interface ZoneGraphData {
  nodes: NodeData[];
  edges: FlowData[];
}

export interface GraphData {
  nodes: NodeData[];
  edges: FlowData[];
  timestamp: number;
  lastMessageTimestamp: number | null;  // Timestamp from the last GELF message (in ms)
  zones: {
    internal: ZoneGraphData;
    external: ZoneGraphData;
    inbound: ZoneGraphData;
    outbound: ZoneGraphData;
  };
}

export interface MappingConfig {
  src_field: string;
  src_field_display?: string;       // Sankey column header for src_field
  dst_field: string;
  dst_field_display?: string;
  proto_field: string;
  proto_field_display?: string;
  value_field: string;
  value_default: number;
  value_transform: 'none' | 'log' | 'sqrt';
  node_label_template: string;
  edge_label_template: string;
  src_ptr_field?: string;
  src_ptr_field_display?: string;
  dst_ptr_field?: string;
  dst_ptr_field_display?: string;
  country_display?: string;         // Sankey country column header (no GELF field)
}

export interface CustomZone {
  name: string;           // e.g., "Server Zone"
  color: string;          // e.g., "#00d4ff"
  patterns: string[];     // e.g., ["192.168.1.0/24", "192.168.2.10-20"]
  position: 'left' | 'right';  // Which side to display
  top_n: number;          // Show only top N (0 = all)
}

export interface ZoneConfig {
  internal_cidrs: string[];
  external_cidrs: string[];
  internal_filter_ips: string[];
  internal_filter_apply_to: string[];  // Which views to apply filter: flow, 2d-geo, 3d-globe
  min_traffic_threshold: number;
  top_n_internal: number;  // Show only top N internal IPs (0 = all)
  top_n_internal_apply_to: string[];  // Which views to apply top N internal
  top_n_external: number;  // Show only top N external IPs (0 = all)
  top_n_external_apply_to: string[];  // Which views to apply top N external
  custom_zones: CustomZone[];  // Custom zone definitions
  show_internal_traffic: boolean;  // Show internal-to-internal connections (default: false)
  show_traffic_value: boolean;  // Show traffic value on node labels (default: false)
}

export interface Config {
  gelf_udp_port: number;
  gelf_tcp_port: number;
  http_port: number;
  field_cache_ttl_seconds: number;
  field_cache_max_messages: number;
  flow_ttl_seconds: number;
  default_view: ViewMode;
  sankey_active_columns?: SankeyColumn[];
  sankey_window_seconds?: number;
  transition_effect?: 'warp' | 'matrix';
  mapping: MappingConfig;
  zones: ZoneConfig;
  geoip?: GeoIPConfig;
}

export interface FieldInfo {
  name: string;
  count: number;
  lastSeen: number;
  inferredType: string;
  samples: unknown[];
}

export interface FieldsResponse {
  fields: FieldInfo[];
  messageCount: number;
}

// Visualization types
export interface VisNode {
  id: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  totalIn: number;
  totalOut: number;
  radius: number;
  pinned?: boolean;
}

export interface VisEdge {
  source: VisNode;
  target: VisNode;
  value: number;
  label: string;
  particles: Particle[];
  fading?: boolean;       // Edge is fading out
  fadeProgress?: number;  // 0-1 fade progress (1 = fully visible, 0 = gone)
}

export interface Particle {
  progress: number; // 0-1 along the edge
  speed: number;
  size: number;
  color: string;
  reverse?: boolean; // If true, particle moves from target to source
}

// View mode toggle: Flow (2D graph), 2D Geo (flat map), 3D Globe, Sankey
export type ViewMode = 'flow' | '2d-geo' | '3d-globe' | 'sankey';

// Sankey column identifiers. Mandatory: ext_ip + int_ip. Order is fixed
// left-to-right; the active set just toggles which optional ones appear.
export type SankeyColumn =
  | 'country'
  | 'ext_ip'      // mandatory
  | 'ext_ip_ptr'
  | 'protocol'
  | 'int_ip'      // mandatory
  | 'int_ip_ptr';

// Maps each Sankey column to its display header string. Built at runtime
// from MappingConfig.*_display + country_display, not stored standalone.
export type SankeyColumns = Partial<Record<SankeyColumn, string>>;

// GeoIP types for globe visualization
export interface GeoCoordinate {
  lat: number;
  lng: number;
}

export type CountryStatsMode = 'events' | 'nodes' | 'value';

export interface GeoIPConfig {
  source_field: string;       // default: 'source_ip_geolocation'
  destination_field: string;  // default: 'destination_ip_geolocation'
  hide_no_geo: boolean;       // hide nodes without geo data
  internal_fallback_lat: number;  // fallback latitude for internal IPs
  internal_fallback_lng: number;  // fallback longitude for internal IPs
  auto_detect_location: boolean;  // auto-detect location from external service
  map_brightness: number;     // map/globe brightness 0-100, default 30
  show_starfield: boolean;    // show starfield background in 3D globe
  stats_top_n: number;        // top N to show in stats panel, default 15
  focus_zoom_level: number;   // zoom level when focusing on a node, default 14
}

export interface GlobeNode {
  id: string;
  label: string;
  lat: number;
  lng: number;
  isInternal: boolean;
  totalIn: number;
  totalOut: number;
  color: string;
  isFallback?: boolean;  // true if using fallback coordinates
  // Additional location info from logs
  countryCode?: string;
  cityName?: string;
}

export interface GlobeArc {
  id: string;
  sourceId: string;  // Source node ID (for expiring arc tracking)
  targetId: string;  // Target node ID (for expiring arc tracking)
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
  value: number;
  label: string;
}
