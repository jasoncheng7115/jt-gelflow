import type { GeoCoordinate, FlowData, GraphData, GeoIPConfig, GlobeNode, GlobeArc } from '../types';

/**
 * Parse GeoIP string format "lat,lng" to coordinate object
 * @param geoString - Comma-separated lat,lng string (e.g., "24.9889,121.3176")
 * @returns GeoCoordinate or null if invalid
 */
export function parseGeoIP(geoString: string | undefined | null): GeoCoordinate | null {
  if (!geoString || typeof geoString !== 'string') return null;

  const parts = geoString.split(',').map(s => s.trim());
  if (parts.length !== 2) return null;

  const lat = parseFloat(parts[0]);
  const lng = parseFloat(parts[1]);

  if (isNaN(lat) || isNaN(lng)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;

  return { lat, lng };
}

/**
 * Check if an IP is internal based on CIDR ranges
 */
function isInternalIp(ip: string, internalCidrs: string[]): boolean {
  // Simple check - match common private ranges
  if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.16.') ||
      ip.startsWith('172.17.') || ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
      ip.startsWith('172.20.') || ip.startsWith('172.21.') || ip.startsWith('172.22.') ||
      ip.startsWith('172.23.') || ip.startsWith('172.24.') || ip.startsWith('172.25.') ||
      ip.startsWith('172.26.') || ip.startsWith('172.27.') || ip.startsWith('172.28.') ||
      ip.startsWith('172.29.') || ip.startsWith('172.30.') || ip.startsWith('172.31.')) {
    return true;
  }

  // Check against configured CIDRs (simplified - just check prefix)
  for (const cidr of internalCidrs) {
    const [network] = cidr.split('/');
    const prefix = network.split('.').slice(0, 2).join('.') + '.';
    if (ip.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

/**
 * Convert graph data to globe visualization data
 */
// Additional location info for nodes
interface NodeLocationInfo {
  geo: GeoCoordinate | null;
  countryCode?: string;
  cityName?: string;
}

export function convertToGlobeData(
  graph: GraphData,
  config: GeoIPConfig,
  internalCidrs: string[]
): { nodes: GlobeNode[]; arcs: GlobeArc[] } {
  const nodes: GlobeNode[] = [];
  const arcs: GlobeArc[] = [];
  const nodeInfoCache = new Map<string, NodeLocationInfo>();
  const nodeSet = new Set<string>();

  // Fallback location for internal IPs
  const internalFallback: GeoCoordinate | null =
    (config.internal_fallback_lat !== 0 || config.internal_fallback_lng !== 0)
      ? { lat: config.internal_fallback_lat, lng: config.internal_fallback_lng }
      : null;

  // First pass: collect all geo coordinates and location info from edges
  for (const edge of graph.edges) {
    // Get source geo and location info
    const srcGeoStr = edge.fields?.[config.source_field] as string;
    const srcGeo = parseGeoIP(srcGeoStr);
    if (!nodeInfoCache.has(edge.key.src)) {
      nodeInfoCache.set(edge.key.src, {
        geo: srcGeo,
        countryCode: edge.fields?.['source_ip_country_code'] as string | undefined,
        cityName: edge.fields?.['source_ip_city_name'] as string | undefined,
      });
    }

    // Get destination geo and location info
    const dstGeoStr = edge.fields?.[config.destination_field] as string;
    const dstGeo = parseGeoIP(dstGeoStr);
    if (!nodeInfoCache.has(edge.key.dst)) {
      nodeInfoCache.set(edge.key.dst, {
        geo: dstGeo,
        countryCode: edge.fields?.['destination_ip_country_code'] as string | undefined,
        cityName: edge.fields?.['destination_ip_city_name'] as string | undefined,
      });
    }
  }

  // Build nodes from graph.nodes that have geo data
  for (const node of graph.nodes) {
    const nodeInfo = nodeInfoCache.get(node.id) || { geo: null };
    let geo = nodeInfo.geo;
    const isInternal = isInternalIp(node.id, internalCidrs);
    let isFallback = false;

    // If no geo data, use fallback for internal IPs
    if (!geo && isInternal && internalFallback) {
      geo = internalFallback;
      nodeInfoCache.set(node.id, { ...nodeInfo, geo });
      isFallback = true;
    }

    // Only draw nodes that have valid geo coordinates
    if (geo) {
      nodes.push({
        id: node.id,
        label: node.label,
        lat: geo.lat,
        lng: geo.lng,
        isInternal,
        totalIn: node.totalIn,
        totalOut: node.totalOut,
        color: isInternal ? '#00d4ff' : '#ff6b6b',
        isFallback,
        countryCode: nodeInfo.countryCode,
        cityName: nodeInfo.cityName,
      });
      nodeSet.add(node.id);
    }
    // Skip nodes without geo data - don't draw them at all
  }

  // Build arcs from edges where both endpoints have geo
  for (const edge of graph.edges) {
    const srcInfo = nodeInfoCache.get(edge.key.src);
    const dstInfo = nodeInfoCache.get(edge.key.dst);
    const srcGeo = srcInfo?.geo;
    const dstGeo = dstInfo?.geo;

    if (srcGeo && dstGeo) {
      // Skip if same location (would be invisible arc)
      if (srcGeo.lat === dstGeo.lat && srcGeo.lng === dstGeo.lng) continue;

      const srcIsInternal = isInternalIp(edge.key.src, internalCidrs);

      arcs.push({
        id: `${edge.key.src}-${edge.key.dst}-${edge.key.proto}`,
        sourceId: edge.key.src,
        targetId: edge.key.dst,
        startLat: srcGeo.lat,
        startLng: srcGeo.lng,
        endLat: dstGeo.lat,
        endLng: dstGeo.lng,
        color: srcIsInternal ? '#00d4ff' : '#ff6b6b',
        value: edge.value,
        label: edge.edgeLabel,
      });
    }
  }

  return { nodes, arcs };
}

/**
 * Format traffic value for display
 */
export function formatValue(value: number): string {
  if (value >= 1_000_000_000) return (value / 1_000_000_000).toFixed(1) + 'G';
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'K';
  return value.toFixed(0);
}
