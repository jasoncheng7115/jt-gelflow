import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { VisNode, VisEdge, Particle, NodeData, FlowData, GraphData, CustomZone } from './types';
import { ZoomControls } from './ZoomControls';
import { useTranslation } from './i18n';

interface Props {
  graph: GraphData;
  width: number;
  height: number;
  internalCidrs: string[];
  internalFilterIps: string[];
  minTrafficThreshold?: number;
  topNInternal?: number;
  topNExternal?: number;
  customZones?: CustomZone[];
  showInternalTraffic?: boolean;
  showTrafficValue?: boolean;
  paused?: boolean;
  statsTopN?: number;
  zoomInRef?: React.MutableRefObject<(() => void) | null>;
  zoomOutRef?: React.MutableRefObject<(() => void) | null>;
  zoomResetRef?: React.MutableRefObject<(() => void) | null>;
  panUpRef?: React.MutableRefObject<(() => void) | null>;
  panDownRef?: React.MutableRefObject<(() => void) | null>;
  panLeftRef?: React.MutableRefObject<(() => void) | null>;
  panRightRef?: React.MutableRefObject<(() => void) | null>;
}

// Extended VisNode with zone info
interface ZonedVisNode extends VisNode {
  zoneName: string;
  zoneColor: string;
  zonePosition: 'left' | 'right';
}

// Color palette for internal network (blue/green tones)
const INTERNAL_COLORS = [
  '#00d4ff', // cyan
  '#00ff88', // green
  '#6bcb77', // mint
  '#54a0ff', // blue
  '#00b894', // teal
  '#74b9ff', // light blue
  '#55efc4', // aqua
  '#81ecec', // light cyan
];

// Color palette for external network (red/orange/purple tones)
const EXTERNAL_COLORS = [
  '#ff6b6b', // red
  '#ff9f43', // orange
  '#ffd93d', // yellow
  '#c56cf0', // purple
  '#fd79a8', // pink
  '#e17055', // coral
  '#fdcb6e', // gold
  '#a29bfe', // lavender
];

// Convert IP string to number
function ipToNum(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return -1;
  return ((parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

// Check if IP is in CIDR range
function isIpInCidr(ip: string, cidr: string): boolean {
  try {
    const [network, bits] = cidr.split('/');
    const mask = (~(2 ** (32 - parseInt(bits)) - 1)) >>> 0;
    const ipNum = ipToNum(ip);
    const networkNum = ipToNum(network);
    if (ipNum < 0 || networkNum < 0) return false;
    return (ipNum & mask) === (networkNum & mask);
  } catch {
    return false;
  }
}

// Check if IP is in range (supports: 192.168.1.10-20 or 192.168.1.10-192.168.1.20)
function isIpInRange(ip: string, range: string): boolean {
  try {
    const ipNum = ipToNum(ip);
    if (ipNum < 0) return false;

    if (range.includes('-')) {
      const [start, end] = range.split('-');
      let startNum: number, endNum: number;

      if (end.includes('.')) {
        // Full range: 192.168.1.10-192.168.1.20
        startNum = ipToNum(start);
        endNum = ipToNum(end);
      } else {
        // Short range: 192.168.1.10-20
        startNum = ipToNum(start);
        const startParts = start.split('.');
        startParts[3] = end;
        endNum = ipToNum(startParts.join('.'));
      }

      if (startNum < 0 || endNum < 0) return false;
      return ipNum >= startNum && ipNum <= endNum;
    }
    return false;
  } catch {
    return false;
  }
}

// Check if IP matches a pattern (CIDR, range, or exact IP)
function isIpInPattern(ip: string, pattern: string): boolean {
  pattern = pattern.trim();
  if (pattern.includes('/')) {
    return isIpInCidr(ip, pattern);
  } else if (pattern.includes('-')) {
    return isIpInRange(ip, pattern);
  } else {
    // Exact IP match
    return ip === pattern;
  }
}

function isInternalIp(ip: string, internalPatterns: string[], filterIps?: string[]): boolean {
  // First check if IP is in the filter list (exact match takes priority)
  if (filterIps && filterIps.length > 0) {
    if (filterIps.some(pattern => {
      if (!pattern.includes('/') && !pattern.includes('-')) {
        return pattern === ip;
      }
      return isIpInPattern(ip, pattern);
    })) {
      return true;
    }
  }
  // Then check CIDR patterns
  return internalPatterns.some(pattern => isIpInPattern(ip, pattern));
}

// Check if a node should be classified as internal
// This handles cases where node.id might be a hostname instead of IP
function isNodeInternal(
  node: NodeData,
  cidrs: string[],
  filterIps: string[],
  edges: FlowData[]
): boolean {
  // First check the standard way (node.id is an IP)
  if (isInternalIp(node.id, cidrs, filterIps)) {
    return true;
  }

  // Check if filterIps contains this node.id or if label contains a filter IP
  if (filterIps.length > 0) {
    // Check if node ID matches a filter pattern
    for (const pattern of filterIps) {
      if (!pattern.includes('/') && !pattern.includes('-')) {
        if (pattern === node.id) return true;
        // Check if the label contains this IP (e.g., "192.168.1.68" in label)
        if (node.label && node.label.includes(pattern)) return true;
      }
    }
  }

  // Check edges - if this node appears in an edge with a known internal IP, check fields
  const nodeEdges = edges.filter(e => e.key.src === node.id || e.key.dst === node.id);
  for (const edge of nodeEdges) {
    if (edge.fields) {
      // Check if source_ip or destination_ip in fields matches internal patterns
      const srcIp = edge.fields.source_ip || edge.fields.src;
      const dstIp = edge.fields.destination_ip || edge.fields.dst;

      // If node.id matches the flow position, check the corresponding IP
      if (edge.key.src === node.id && srcIp) {
        if (isInternalIp(String(srcIp), cidrs, filterIps)) return true;
      }
      if (edge.key.dst === node.id && dstIp) {
        if (isInternalIp(String(dstIp), cidrs, filterIps)) return true;
      }
    }
  }

  return false;
}

function getNodeColor(index: number, isInternal: boolean): string {
  const colors = isInternal ? INTERNAL_COLORS : EXTERNAL_COLORS;
  return colors[index % colors.length];
}

// Extended node with fields info
interface NodeWithFields extends ZonedVisNode {
  fields?: Record<string, string | number>;
}

export function FlowCanvas({ graph, width, height, internalCidrs, internalFilterIps, minTrafficThreshold = 0, topNInternal = 0, topNExternal = 0, customZones = [], showInternalTraffic = false, showTrafficValue = false, paused = false, statsTopN = 15, zoomInRef, zoomOutRef, zoomResetRef, panUpRef, panDownRef, panLeftRef, panRightRef }: Props) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const nodesRef = useRef<Map<string, NodeWithFields>>(new Map());
  const edgesRef = useRef<VisEdge[]>([]);
  const fadingEdgesRef = useRef<VisEdge[]>([]);  // Edges being faded out
  const internalCidrsRef = useRef(internalCidrs);
  const internalFilterIpsRef = useRef(internalFilterIps);
  const customZonesRef = useRef(customZones);
  const pausedRef = useRef(paused);
  const selectedNodeRef = useRef<string | null>(null);
  // Stable slot assignments for nodes (by side: 'left' or 'right')
  const slotAssignmentsRef = useRef<{
    left: Map<string, number>;  // nodeId -> slot index
    right: Map<string, number>;
  }>({ left: new Map(), right: new Map() });
  // Track slots occupied by fading nodes (to prevent new nodes from using them)
  const fadingNodeSlotsRef = useRef<{
    left: Map<string, number>;  // nodeId -> slot index for fading nodes
    right: Map<string, number>;
  }>({ left: new Map(), right: new Map() });
  // Cache for last known labels (persist labels even when node has no traffic)
  const lastKnownLabelsRef = useRef<Map<string, string>>(new Map());
  // Cache for node fields (for tooltip display)
  const nodeFieldsRef = useRef<Map<string, Record<string, string | number>>>(new Map());
  // Tooltip state
  const [tooltip, setTooltip] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const tooltipRef = useRef<{ nodeId: string; x: number; y: number } | null>(null);
  // Highlight mode state (focus on single internal node)
  const [highlightMode, setHighlightMode] = useState<{
    enabled: boolean;
    nodeId: string | null;
    connectedNodeIds: Set<string>;
  }>({ enabled: false, nodeId: null, connectedNodeIds: new Set() });
  const highlightModeRef = useRef(highlightMode);
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
  } | null>(null);
  // Cancel button position for highlight mode
  const cancelButtonRef = useRef<{ x: number; y: number; radius: number } | null>(null);
  // Zoom and pan state
  const [zoomLevel, setZoomLevel] = useState(1);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const hasDraggedRef = useRef(false);  // Track if actual dragging occurred
  const panStartRef = useRef({ x: 0, y: 0 });
  // Internal IP stats panel state
  const [showStatsPanel, setShowStatsPanel] = useState(false);
  const [statsMode, setStatsMode] = useState<'events' | 'traffic'>('events');
  const statsPanelWidth = 280;
  const effectiveWidth = showStatsPanel ? width - statsPanelWidth : width;
  const effectiveWidthRef = useRef(effectiveWidth);
  effectiveWidthRef.current = effectiveWidth;

  // Update refs when props change
  useEffect(() => {
    internalCidrsRef.current = internalCidrs;
  }, [internalCidrs]);

  // Track previous filter IPs to detect changes
  const prevFilterIpsRef = useRef<string[]>(internalFilterIps);

  useEffect(() => {
    // Check if filter IPs actually changed (not just reference)
    const prevSet = new Set(prevFilterIpsRef.current);
    const newSet = new Set(internalFilterIps);
    const changed = prevSet.size !== newSet.size ||
      [...prevSet].some(ip => !newSet.has(ip)) ||
      [...newSet].some(ip => !prevSet.has(ip));

    if (changed && prevFilterIpsRef.current.length > 0) {
      // Filter IPs changed - clear all cached data
      nodesRef.current.clear();
      edgesRef.current = [];
      fadingEdgesRef.current = [];
      slotAssignmentsRef.current = { left: new Map(), right: new Map() };
      fadingNodeSlotsRef.current = { left: new Map(), right: new Map() };
      lastKnownLabelsRef.current.clear();
      nodeFieldsRef.current.clear();
      // Exit highlight mode if active
      setHighlightMode({ enabled: false, nodeId: null, connectedNodeIds: new Set() });
      setContextMenu(null);
      console.log('Internal filter IPs changed, canvas cleared');
    }

    prevFilterIpsRef.current = internalFilterIps;
    internalFilterIpsRef.current = internalFilterIps;
  }, [internalFilterIps]);

  useEffect(() => {
    customZonesRef.current = customZones;
  }, [customZones]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    highlightModeRef.current = highlightMode;
  }, [highlightMode]);

  const showTrafficValueRef = useRef(showTrafficValue);
  useEffect(() => {
    showTrafficValueRef.current = showTrafficValue;
  }, [showTrafficValue]);

  // Helper to transform screen coordinates to canvas coordinates (accounting for zoom/pan)
  const screenToCanvas = useCallback((screenX: number, screenY: number): { x: number, y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: screenX, y: screenY };

    const rect = canvas.getBoundingClientRect();
    const canvasX = screenX - rect.left;
    const canvasY = screenY - rect.top;

    // Reverse the transform: ctx.translate(centerX, centerY) -> scale(zoom) -> translate(-centerX + pan.x, -centerY + pan.y)
    const centerX = width / 2;
    const centerY = height / 2;
    const zoom = zoomRef.current;
    const pan = panRef.current;

    // Reverse order: subtract center, divide by zoom, add center, subtract pan
    const x = (canvasX - centerX) / zoom + centerX - pan.x;
    const y = (canvasY - centerY) / zoom + centerY - pan.y;

    return { x, y };
  }, [width, height]);

  // Helper to find node at position
  const findNodeAtPosition = useCallback((x: number, y: number): VisNode | null => {
    for (const node of nodesRef.current.values()) {
      const labelLines = node.label.split('\n');
      const maxLineLen = Math.max(...labelLines.map(l => l.length));
      const boxWidth = Math.max(100, maxLineLen * 7 + 16);
      const boxHeight = Math.max(36, labelLines.length * 14 + 20);

      if (x >= node.x - boxWidth / 2 && x <= node.x + boxWidth / 2 &&
          y >= node.y - boxHeight / 2 && y <= node.y + boxHeight / 2) {
        return node;
      }
    }
    return null;
  }, []);

  // Handle click to pin/unpin nodes or cancel highlight mode
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Close context menu if open
    if (contextMenu) {
      setContextMenu(null);
      return;
    }

    // Skip if we just finished dragging
    if (hasDraggedRef.current) {
      return;
    }

    const { x, y } = screenToCanvas(e.clientX, e.clientY);

    // Check if clicked on cancel button (in highlight mode)
    if (highlightModeRef.current.enabled && cancelButtonRef.current) {
      const btn = cancelButtonRef.current;
      const dist = Math.hypot(x - btn.x, y - btn.y);
      if (dist <= btn.radius + 5) {
        setHighlightMode({ enabled: false, nodeId: null, connectedNodeIds: new Set() });
        cancelButtonRef.current = null;
        return;
      }
    }

    const node = findNodeAtPosition(x, y);

    if (node) {
      // Toggle pin state
      node.pinned = !node.pinned;
      selectedNodeRef.current = node.pinned ? node.id : null;
    } else {
      // Clicked empty space - deselect
      selectedNodeRef.current = null;
    }
  }, [screenToCanvas, findNodeAtPosition, contextMenu]);

  // Handle right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    const node = findNodeAtPosition(x, y);

    if (node) {
      // Check if it's an internal node (right side)
      const zonedNode = node as ZonedVisNode;
      const isInternal = zonedNode.zonePosition === 'right' ||
        isInternalIp(node.id, internalCidrsRef.current, internalFilterIpsRef.current);

      if (isInternal) {
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          nodeId: node.id
        });
      }
    } else {
      setContextMenu(null);
    }
  }, [screenToCanvas, findNodeAtPosition]);

  // Enter highlight mode for a specific node
  const enterHighlightMode = useCallback((nodeId: string) => {
    // Find all connected node IDs (from both active and fading edges)
    const connectedNodeIds = new Set<string>();
    for (const edge of edgesRef.current) {
      if (edge.source.id === nodeId) {
        connectedNodeIds.add(edge.target.id);
      }
      if (edge.target.id === nodeId) {
        connectedNodeIds.add(edge.source.id);
      }
    }
    for (const edge of fadingEdgesRef.current) {
      if (edge.source.id === nodeId) {
        connectedNodeIds.add(edge.target.id);
      }
      if (edge.target.id === nodeId) {
        connectedNodeIds.add(edge.source.id);
      }
    }

    setHighlightMode({
      enabled: true,
      nodeId,
      connectedNodeIds
    });
    setContextMenu(null);
  }, []);

  // Zoom handlers - use native event to support passive: false
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.3, Math.min(5, zoomRef.current * delta));
    zoomRef.current = newZoom;
    setZoomLevel(newZoom);
  }, []);

  // Attach wheel event with passive: false to allow preventDefault
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Smooth zoom animation helper
  const animateZoom = useCallback((targetZoom: number, targetPan?: { x: number; y: number }) => {
    const startZoom = zoomRef.current;
    const startPan = { ...panRef.current };
    const endPan = targetPan || startPan;
    const duration = 300;
    const startTime = performance.now();

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3); // Cubic ease-out

      const currentZoom = startZoom + (targetZoom - startZoom) * eased;
      zoomRef.current = currentZoom;
      setZoomLevel(currentZoom);

      if (targetPan) {
        panRef.current = {
          x: startPan.x + (endPan.x - startPan.x) * eased,
          y: startPan.y + (endPan.y - startPan.y) * eased,
        };
      }

      if (t < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, []);

  const handleZoomIn = useCallback(() => {
    const newZoom = Math.min(5, zoomRef.current * 1.3);
    animateZoom(newZoom);
  }, [animateZoom]);

  const handleZoomOut = useCallback(() => {
    const newZoom = Math.max(0.3, zoomRef.current / 1.3);
    animateZoom(newZoom);
  }, [animateZoom]);

  const handleZoomReset = useCallback(() => {
    animateZoom(1, { x: 0, y: 0 });
  }, [animateZoom]);

  const handleZoomTo = useCallback((level: number) => {
    animateZoom(level);
  }, [animateZoom]);

  // Pan handlers for keyboard navigation
  const panAmount = 50;
  const handlePanUp = useCallback(() => {
    panRef.current = { x: panRef.current.x, y: panRef.current.y + panAmount };
  }, []);
  const handlePanDown = useCallback(() => {
    panRef.current = { x: panRef.current.x, y: panRef.current.y - panAmount };
  }, []);
  const handlePanLeft = useCallback(() => {
    panRef.current = { x: panRef.current.x + panAmount, y: panRef.current.y };
  }, []);
  const handlePanRight = useCallback(() => {
    panRef.current = { x: panRef.current.x - panAmount, y: panRef.current.y };
  }, []);

  // Register zoom and pan handlers for keyboard shortcuts
  useEffect(() => {
    if (zoomInRef) zoomInRef.current = handleZoomIn;
    if (zoomOutRef) zoomOutRef.current = handleZoomOut;
    if (zoomResetRef) zoomResetRef.current = handleZoomReset;
    if (panUpRef) panUpRef.current = handlePanUp;
    if (panDownRef) panDownRef.current = handlePanDown;
    if (panLeftRef) panLeftRef.current = handlePanLeft;
    if (panRightRef) panRightRef.current = handlePanRight;
    return () => {
      if (zoomInRef) zoomInRef.current = null;
      if (zoomOutRef) zoomOutRef.current = null;
      if (zoomResetRef) zoomResetRef.current = null;
      if (panUpRef) panUpRef.current = null;
      if (panDownRef) panDownRef.current = null;
      if (panLeftRef) panLeftRef.current = null;
      if (panRightRef) panRightRef.current = null;
    };
  }, [handleZoomIn, handleZoomOut, handleZoomReset, handlePanUp, handlePanDown, handlePanLeft, handlePanRight, zoomInRef, zoomOutRef, zoomResetRef, panUpRef, panDownRef, panLeftRef, panRightRef]);

  // Drag/pan handlers - use left mouse button for panning (only on empty space)
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 0) { // Left mouse button
      // Check if clicking on a node - if so, don't start drag
      const { x, y } = screenToCanvas(e.clientX, e.clientY);
      const node = findNodeAtPosition(x, y);

      if (!node) {
        // Only start drag if not on a node
        isDraggingRef.current = true;
        hasDraggedRef.current = false;  // Reset drag tracking
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        panStartRef.current = { ...panRef.current };
      }
    }
  }, [screenToCanvas, findNodeAtPosition]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      // Mark as dragged if moved more than 5 pixels
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        hasDraggedRef.current = true;
      }
      panRef.current = {
        x: panStartRef.current.x + dx / zoomRef.current,
        y: panStartRef.current.y + dy / zoomRef.current,
      };
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  // Calculate top internal IPs for stats panel
  const topInternalIPs = React.useMemo(() => {
    const nodeMap = nodesRef.current;
    const edgeList = edgesRef.current;
    const internalNodes: Array<{ id: string; label: string; value: number }> = [];

    // Count events (edges) per node if in events mode
    const eventCounts = new Map<string, number>();
    if (statsMode === 'events') {
      edgeList.forEach((edge) => {
        // edge.source and edge.target are VisNode objects with .id property
        const sourceId = edge.source.id;
        const targetId = edge.target.id;
        eventCounts.set(sourceId, (eventCounts.get(sourceId) || 0) + 1);
        eventCounts.set(targetId, (eventCounts.get(targetId) || 0) + 1);
      });
    }

    nodeMap.forEach((node) => {
      const zonedNode = node as ZonedVisNode;
      if (zonedNode.zonePosition === 'right') { // Internal nodes are on the right
        const value = statsMode === 'events'
          ? (eventCounts.get(node.id) || 0)
          : (node.totalIn || 0) + (node.totalOut || 0);
        internalNodes.push({
          id: node.id,
          label: node.label.split('\n')[0], // First line of label
          value,
        });
      }
    });

    // Sort by value descending and take top N
    return internalNodes
      .sort((a, b) => b.value - a.value)
      .slice(0, statsTopN);
  }, [graph, statsMode, statsTopN]); // Recalculate when graph, statsMode, or statsTopN changes

  // Determine which zone an IP belongs to
  const getZoneForIp = useCallback((ip: string, zones: CustomZone[], cidrs: string[], filterIps: string[]): { name: string, color: string, position: 'left' | 'right' } | null => {
    // Check custom zones first
    for (const zone of zones) {
      if (zone.patterns.some(pattern => isIpInPattern(ip, pattern))) {
        return { name: zone.name, color: zone.color, position: zone.position };
      }
    }
    // Fall back to internal/external
    if (isInternalIp(ip, cidrs, filterIps)) {
      return { name: 'Internal', color: '#00d4ff', position: 'right' };
    }
    return { name: 'External', color: '#ff6b6b', position: 'left' };
  }, []);

  // Convert graph data to visualization nodes/edges
  const updateGraph = useCallback(() => {
    const nodeMap = nodesRef.current;
    const cidrs = internalCidrsRef.current;
    const filterIps = internalFilterIpsRef.current;
    const zones = customZonesRef.current;
    const useCustomZones = zones.length > 0;

    // Filter edges by minimum traffic threshold and internal traffic setting
    let filteredEdges = minTrafficThreshold > 0
      ? graph.edges.filter(e => e.value >= minTrafficThreshold)
      : graph.edges;

    // Filter out internal-to-internal traffic if showInternalTraffic is false
    if (!showInternalTraffic) {
      filteredEdges = filteredEdges.filter(e => {
        const srcInternal = isInternalIp(e.key.src, cidrs, filterIps);
        const dstInternal = isInternalIp(e.key.dst, cidrs, filterIps);
        // Keep edge if at least one endpoint is external
        return !(srcInternal && dstInternal);
      });
    }

    // Group nodes by zone
    const nodesByZone = new Map<string, { zone: CustomZone | { name: string, color: string, position: 'left' | 'right', top_n: number }, nodes: NodeData[] }>();

    // Always include filtered internal IPs even if no traffic
    const alwaysShowInternalIps = filterIps.length > 0 ? filterIps : [];

    if (useCustomZones) {
      // Use custom zones
      zones.forEach(zone => {
        nodesByZone.set(zone.name, { zone, nodes: [] });
      });
      // Add "Other" zone for unmatched IPs
      nodesByZone.set('Other', { zone: { name: 'Other', color: '#888888', position: 'left' as const, top_n: 0, patterns: [] }, nodes: [] });

      graph.nodes.forEach(node => {
        let matched = false;
        for (const zone of zones) {
          if (zone.patterns.some(pattern => isIpInPattern(node.id, pattern))) {
            const entry = nodesByZone.get(zone.name);
            if (entry) {
              entry.nodes.push(node);
              matched = true;
              break;
            }
          }
        }
        if (!matched) {
          const other = nodesByZone.get('Other');
          if (other) other.nodes.push(node);
        }
      });

      // Apply top_n filter per zone
      nodesByZone.forEach((entry, zoneName) => {
        if (entry.zone.top_n > 0) {
          entry.nodes = entry.nodes
            .sort((a, b) => (b.totalIn + b.totalOut) - (a.totalIn + a.totalOut))
            .slice(0, entry.zone.top_n);
        }
      });
    } else {
      // Use legacy internal/external logic
      const labelCache = lastKnownLabelsRef.current;

      let candidateInternalNodes = graph.nodes.filter(node => {
        if (!isInternalIp(node.id, cidrs, filterIps)) return false;
        if (filterIps.length > 0 && !filterIps.some(pattern => isIpInPattern(node.id, pattern))) return false;
        return true;
      });

      // Update label cache for nodes with actual data
      candidateInternalNodes.forEach(node => {
        if (node.label && node.label !== node.id) {
          labelCache.set(node.id, node.label);
        }
      });

      // Always include filtered IPs even if no traffic
      if (filterIps.length > 0) {
        const existingIds = new Set(candidateInternalNodes.map(n => n.id));
        filterIps.forEach(pattern => {
          // For exact IPs (not ranges/CIDRs), add placeholder node if not exists
          if (!pattern.includes('/') && !pattern.includes('-')) {
            if (!existingIds.has(pattern)) {
              // Use cached label if available, otherwise use the IP
              const cachedLabel = labelCache.get(pattern) || pattern;
              candidateInternalNodes.push({
                id: pattern,
                label: cachedLabel,
                totalIn: 0,
                totalOut: 0,
                connections: 0,
              });
            }
          }
        });
      }

      if (topNInternal > 0) {
        candidateInternalNodes = candidateInternalNodes
          .sort((a, b) => (b.totalIn + b.totalOut) - (a.totalIn + a.totalOut))
          .slice(0, topNInternal);
      }
      const visibleInternalIds = new Set(candidateInternalNodes.map(n => n.id));

      const externalTrafficMap = new Map<string, number>();
      // Track external IPs that connect to explicitly filtered internal IPs (these bypass Top N limit)
      const filteredInternalIps = new Set(
        filterIps.filter(ip => !ip.includes('/') && !ip.includes('-'))
      );
      const mustShowExternalIps = new Set<string>();

      filteredEdges.forEach(edge => {
        const srcInternal = isInternalIp(edge.key.src, cidrs, filterIps);
        const dstInternal = isInternalIp(edge.key.dst, cidrs, filterIps);

        if (srcInternal && !dstInternal && visibleInternalIds.has(edge.key.src)) {
          externalTrafficMap.set(edge.key.dst, (externalTrafficMap.get(edge.key.dst) || 0) + edge.value);
          // If source is an explicitly filtered IP, mark this external as must-show
          if (filteredInternalIps.has(edge.key.src)) {
            mustShowExternalIps.add(edge.key.dst);
          }
        } else if (!srcInternal && dstInternal && visibleInternalIds.has(edge.key.dst)) {
          externalTrafficMap.set(edge.key.src, (externalTrafficMap.get(edge.key.src) || 0) + edge.value);
          // If destination is an explicitly filtered IP, mark this external as must-show
          if (filteredInternalIps.has(edge.key.dst)) {
            mustShowExternalIps.add(edge.key.src);
          }
        }
      });

      let candidateExternalNodes = graph.nodes.filter(node => {
        // Use enhanced check that also looks at node labels and edge fields
        const isInternal = isNodeInternal(node, cidrs, filterIps, filteredEdges);

        // Additional check: if node.id doesn't look like an IP but could be internal
        // Check if any filter IP appears in the label
        let blockedByLabel = false;
        for (const filterIp of filterIps) {
          if (!filterIp.includes('/') && !filterIp.includes('-')) {
            if (node.label && node.label.includes(filterIp)) {
              blockedByLabel = true;
              break;
            }
          }
        }

        if (isInternal || blockedByLabel) {
          return false;
        }
        return externalTrafficMap.has(node.id);
      });

      // Update label cache for external nodes too
      candidateExternalNodes.forEach(node => {
        if (node.label && node.label !== node.id) {
          labelCache.set(node.id, node.label);
        }
      });

      if (topNExternal > 0) {
        // Separate must-show nodes (connected to filtered internal IPs) from others
        const mustShowNodes = candidateExternalNodes.filter(n => mustShowExternalIps.has(n.id));
        const otherNodes = candidateExternalNodes.filter(n => !mustShowExternalIps.has(n.id));

        // Apply Top N only to other nodes
        const topNOthers = otherNodes
          .sort((a, b) => (externalTrafficMap.get(b.id) || 0) - (externalTrafficMap.get(a.id) || 0))
          .slice(0, topNExternal);

        // Combine: must-show nodes always included + top N from others
        candidateExternalNodes = [...mustShowNodes, ...topNOthers];
      }

      nodesByZone.set('Internal', { zone: { name: 'Internal', color: '#00d4ff', position: 'right' as const, top_n: 0, patterns: [] }, nodes: candidateInternalNodes });
      nodesByZone.set('External', { zone: { name: 'External', color: '#ff6b6b', position: 'left' as const, top_n: 0, patterns: [] }, nodes: candidateExternalNodes });
    }

    // Get all visible node IDs
    const visibleNodeIds = new Set<string>();
    nodesByZone.forEach(entry => {
      entry.nodes.forEach(n => visibleNodeIds.add(n.id));
    });

    // Always keep filtered internal IPs visible (never remove them)
    filterIps.forEach(pattern => {
      if (!pattern.includes('/') && !pattern.includes('-')) {
        visibleNodeIds.add(pattern);
      }
    });

    // Layout parameters - spread nodes further apart on wide screens
    // Use effectiveWidthRef to account for stats panel
    const layoutWidth = effectiveWidthRef.current;
    const basePadding = 60;
    const centerGap = Math.min(200, layoutWidth * 0.15);  // Gap from center line (15% of width, max 200px)
    const edgePadding = Math.max(80, layoutWidth * 0.05);  // Distance from edge (5% of width, min 80px)
    const nodeHeight = 70;  // Increased for multi-line labels
    const nodeWidth = 130;

    // Calculate effective visible area based on zoom level
    // When zoomed out (zoom < 1), more space is visible, so more nodes can fit
    // When zoomed in (zoom > 1), less space is visible, so fewer nodes should be placed
    const currentZoom = zoomRef.current;
    const zoomAdjustedHeight = height / currentZoom;
    const zoomAdjustedWidth = layoutWidth / currentZoom;
    const availableHeight = zoomAdjustedHeight - basePadding * 2;
    const padding = basePadding;

    // Collect zones by position
    const leftZones: Array<{ zone: any, nodes: NodeData[] }> = [];
    const rightZones: Array<{ zone: any, nodes: NodeData[] }> = [];

    nodesByZone.forEach((entry) => {
      if (entry.nodes.length === 0) return;
      if (entry.zone.position === 'left') {
        leftZones.push(entry);
      } else {
        rightZones.push(entry);
      }
    });

    // Position nodes for each side
    const positionZoneNodes = (
      zonesData: Array<{ zone: any, nodes: NodeData[] }>,
      side: 'left' | 'right'
    ) => {
      const sideWidth = layoutWidth / 2 - padding;
      const slotMap = slotAssignmentsRef.current[side];
      const currentNodeIds = new Set<string>();

      zonesData.forEach(({ zone, nodes }) => {
        const nodesPerColumn = Math.max(1, Math.floor(availableHeight / nodeHeight));
        const columnWidth = Math.min(nodeWidth, sideWidth / Math.max(1, 1));

        // Collect all current node IDs for this side
        nodes.forEach(node => currentNodeIds.add(node.id));

        // Get fading slots map for this side
        const fadingSlotsMap = fadingNodeSlotsRef.current[side];

        // Clean up slots for nodes that no longer exist
        // Move them to fading slots instead of deleting (so new nodes won't use them)
        const usedSlots = new Set<number>();
        for (const [nodeId, slot] of slotMap.entries()) {
          if (currentNodeIds.has(nodeId)) {
            usedSlots.add(slot);
          } else {
            // Node disappeared - move slot to fading slots
            fadingSlotsMap.set(nodeId, slot);
            slotMap.delete(nodeId);
          }
        }

        // Also mark fading node slots as used (so new nodes won't overlap)
        for (const slot of fadingSlotsMap.values()) {
          usedSlots.add(slot);
        }

        nodes.forEach((node) => {
          // Check if this is a filtered internal IP (should be fixed position)
          const isFilteredIp = filterIps.length > 0 && filterIps.some(pattern =>
            !pattern.includes('/') && !pattern.includes('-') && pattern === node.id
          );

          let slotIndex: number;

          if (isFilteredIp && side === 'right') {
            // Use stable index from filterIps array for filtered IPs
            slotIndex = filterIps.findIndex(pattern =>
              !pattern.includes('/') && !pattern.includes('-') && pattern === node.id
            );
          } else {
            // Use stable slot assignment for other nodes
            if (slotMap.has(node.id)) {
              slotIndex = slotMap.get(node.id)!;
            } else if (fadingSlotsMap.has(node.id)) {
              // Node was fading but reappeared - restore its old slot
              slotIndex = fadingSlotsMap.get(node.id)!;
              fadingSlotsMap.delete(node.id);  // Remove from fading
              slotMap.set(node.id, slotIndex);  // Add back to active slots
              // Note: slot is already in usedSlots from fading slots
            } else {
              // Find the first available slot (fill gaps first)
              slotIndex = 0;
              while (usedSlots.has(slotIndex)) {
                slotIndex++;
              }
              slotMap.set(node.id, slotIndex);
              usedSlots.add(slotIndex);
            }
          }

          const col = Math.floor(slotIndex / nodesPerColumn);
          const row = slotIndex % nodesPerColumn;

          // Calculate label width to ensure it stays within bounds
          const labelLines = node.label.split('\n');
          const maxLineLength = Math.max(...labelLines.map(l => l.length));
          const labelWidth = Math.max(100, maxLineLength * 7 + 16);
          const halfLabelWidth = labelWidth / 2;

          let targetX: number;
          if (side === 'left') {
            // Left side: start from left edge, move right with each column
            targetX = edgePadding + col * columnWidth + columnWidth / 2;
            // Ensure label doesn't go beyond left edge
            targetX = Math.max(halfLabelWidth + 5, targetX);
          } else {
            // Right side: start from right edge, move left with each column
            targetX = layoutWidth - edgePadding - col * columnWidth - columnWidth / 2;
            // Ensure label doesn't go beyond right edge
            targetX = Math.min(layoutWidth - halfLabelWidth - 5, targetX);
          }
          const targetY = padding + row * nodeHeight + nodeHeight / 2;

          let visNode = nodeMap.get(node.id) as ZonedVisNode | undefined;
          if (!visNode) {
            visNode = {
              id: node.id,
              label: node.label,
              // Filtered IPs get exact position, others get slight random offset
              x: isFilteredIp ? targetX : targetX + (Math.random() - 0.5) * 20,
              y: isFilteredIp ? targetY : targetY + (Math.random() - 0.5) * 20,
              vx: 0,
              vy: 0,
              totalIn: node.totalIn,
              totalOut: node.totalOut,
              radius: 20,
              zoneName: zone.name,
              zoneColor: zone.color,
              zonePosition: zone.position,
              pinned: isFilteredIp,  // Auto-pin filtered IPs
            };
            nodeMap.set(node.id, visNode);
          }

          // Clamp node position to keep label within screen bounds
          const currentHalfWidth = Math.max(100, visNode.label.split('\n').reduce((max, l) => Math.max(max, l.length), 0) * 7 + 16) / 2;
          visNode.x = Math.max(currentHalfWidth + 5, Math.min(layoutWidth - currentHalfWidth - 5, visNode.x));

          // Filtered IPs stay fixed, others move toward target
          if (!isFilteredIp && !visNode.pinned) {
            visNode.vx = (targetX - visNode.x) * 0.05;
            visNode.vy = (targetY - visNode.y) * 0.05;
          } else if (isFilteredIp) {
            // Keep filtered IPs at their target position
            visNode.x = targetX;
            visNode.y = targetY;
            visNode.vx = 0;
            visNode.vy = 0;
          }
          visNode.label = node.label;
          visNode.totalIn = node.totalIn;
          visNode.totalOut = node.totalOut;
          visNode.zoneName = zone.name;
          visNode.zoneColor = zone.color;
          visNode.zonePosition = zone.position;

          const totalTraffic = node.totalIn + node.totalOut;
          visNode.radius = Math.max(15, Math.min(40, 15 + Math.log10(totalTraffic + 1) * 8));
        });
      });
    };

    positionZoneNodes(leftZones, 'left');
    positionZoneNodes(rightZones, 'right');

    // Update edges (use filtered edges)
    const newEdges: VisEdge[] = [];
    // Track which current edges are still active
    const activeEdgeKeys = new Set<string>();

    for (const edge of filteredEdges) {
      const source = nodeMap.get(edge.key.src);
      const target = nodeMap.get(edge.key.dst);
      if (!source || !target) continue;

      const edgeKey = `${source.id}->${target.id}`;
      activeEdgeKeys.add(edgeKey);

      // Find existing edge or create new
      const existingEdge = edgesRef.current.find(
        e => e.source.id === source.id && e.target.id === target.id
      );

      if (existingEdge) {
        existingEdge.value = edge.value;
        existingEdge.label = edge.edgeLabel;
        existingEdge.source = source;
        existingEdge.target = target;
        existingEdge.fading = false;
        existingEdge.fadeProgress = 1;
        newEdges.push(existingEdge);
      } else {
        // Also check if this edge is currently fading - revive it
        const fadingEdge = fadingEdgesRef.current.find(
          e => e.source.id === source.id && e.target.id === target.id
        );
        if (fadingEdge) {
          fadingEdge.value = edge.value;
          fadingEdge.label = edge.edgeLabel;
          fadingEdge.source = source;
          fadingEdge.target = target;
          fadingEdge.fading = false;
          fadingEdge.fadeProgress = 1;
          newEdges.push(fadingEdge);
          // Remove from fading list
          fadingEdgesRef.current = fadingEdgesRef.current.filter(e => e !== fadingEdge);
        } else {
          newEdges.push({
            source,
            target,
            value: edge.value,
            label: edge.edgeLabel,
            particles: [],
            fading: false,
            fadeProgress: 1,
          });
        }
      }
    }

    // Move removed edges to fading list (if they have particles or just started)
    for (const edge of edgesRef.current) {
      const edgeKey = `${edge.source.id}->${edge.target.id}`;
      if (!activeEdgeKeys.has(edgeKey) && !edge.fading) {
        edge.fading = true;
        edge.fadeProgress = 1;
        fadingEdgesRef.current.push(edge);
      }
    }

    edgesRef.current = newEdges;

    // NOW remove nodes that are no longer needed (after edges are processed)
    // Collect node IDs that are still needed by fading edges
    const fadingNodeIds = new Set<string>();
    for (const edge of fadingEdgesRef.current) {
      fadingNodeIds.add(edge.source.id);
      fadingNodeIds.add(edge.target.id);
    }

    // Remove nodes that are no longer visible (except filtered IPs, fading edge nodes, and pinned nodes)
    for (const id of nodeMap.keys()) {
      const node = nodeMap.get(id);
      if (!visibleNodeIds.has(id) && !fadingNodeIds.has(id) && !node?.pinned) {
        nodeMap.delete(id);
      }
    }
  }, [graph, width, height, internalFilterIps, minTrafficThreshold, topNInternal, topNExternal, customZones, showInternalTraffic, getZoneForIp]);

  // Animation loop
  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, width, height);

    // Apply zoom transform
    ctx.save();
    const zoom = zoomRef.current;
    const centerX = width / 2;
    const centerY = height / 2;
    ctx.translate(centerX, centerY);
    ctx.scale(zoom, zoom);
    ctx.translate(-centerX + panRef.current.x, -centerY + panRef.current.y);

    // Draw center divider and zone labels
    const dividerX = width / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(dividerX, 0);
    ctx.lineTo(dividerX, height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Zone labels
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 107, 107, 0.5)';
    ctx.fillText('External', width * 0.25, 30);
    ctx.fillStyle = 'rgba(0, 212, 255, 0.5)';
    ctx.fillText('Internal', width * 0.75, 30);

    // Update node positions (skip pinned nodes and when paused)
    if (!pausedRef.current) {
      for (const node of nodesRef.current.values()) {
        if (!node.pinned) {
          node.x += node.vx;
          node.y += node.vy;
          node.vx *= 0.95;
          node.vy *= 0.95;
        }
      }
    }

    // Calculate max edge value for proportional particle spawning
    const maxEdgeValue = Math.max(1, ...edgesRef.current.map(e => e.value));

    // Draw edges and particles
    // Capture primitive values to ensure consistent comparison
    const hlModeEdgeEnabled = highlightModeRef.current.enabled;
    const hlModeEdgeNodeId = highlightModeRef.current.nodeId;
    for (const edge of edgesRef.current) {
      const { source, target } = edge;

      // In highlight mode, skip drawing edges not connected to highlighted node
      if (hlModeEdgeEnabled && hlModeEdgeNodeId) {
        const isConnectedToHighlighted =
          source.id === hlModeEdgeNodeId || target.id === hlModeEdgeNodeId;
        if (!isConnectedToHighlighted) {
          continue; // Don't draw this edge at all
        }
      }

      // Calculate edge line
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist === 0) continue;
      const nx = dx / dist;
      const ny = dy / dist;

      // Box dimensions for connection points - calculate based on actual label
      const srcLabelLines = source.label.split('\n');
      const srcMaxLineLen = Math.max(...srcLabelLines.map(l => l.length));
      const srcBoxW = Math.max(100, srcMaxLineLen * 7 + 16) / 2;
      const srcBoxH = Math.max(36, srcLabelLines.length * 14 + 20) / 2;

      const tgtLabelLines = target.label.split('\n');
      const tgtMaxLineLen = Math.max(...tgtLabelLines.map(l => l.length));
      const tgtBoxW = Math.max(100, tgtMaxLineLen * 7 + 16) / 2;
      const tgtBoxH = Math.max(36, tgtLabelLines.length * 14 + 20) / 2;

      // Start and end points (edge of rectangles)
      const startX = source.x + nx * srcBoxW;
      const startY = source.y + ny * srcBoxH;
      const endX = target.x - nx * tgtBoxW;
      const endY = target.y - ny * tgtBoxH;

      // Draw edge line - width proportional to traffic
      const edgeRatio = edge.value / maxEdgeValue;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.05 + edgeRatio * 0.15})`;
      ctx.lineWidth = 1 + Math.sqrt(edgeRatio) * 4;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      // Draw arrow
      const arrowSize = 8;
      const arrowX = endX - nx * 5;
      const arrowY = endY - ny * 5;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(arrowX - nx * arrowSize - ny * arrowSize * 0.5, arrowY - ny * arrowSize + nx * arrowSize * 0.5);
      ctx.lineTo(arrowX - nx * arrowSize + ny * arrowSize * 0.5, arrowY - ny * arrowSize - nx * arrowSize * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // Spawn new particles based on value (skip when paused)
      // Direction is determined by edge.key.src -> edge.key.dst from GELF data
      if (!pausedRef.current) {
        const sourceNode = source as ZonedVisNode;
        const particleColor = sourceNode.zoneColor || (isInternalIp(source.id, internalCidrsRef.current, internalFilterIpsRef.current) ? '#00d4ff' : '#ff6b6b');

        // Use logarithmic scaling to handle extreme traffic differences
        // This ensures even small traffic gets some particles while large traffic gets more
        const logValue = Math.log10(edge.value + 1);
        const logMax = Math.log10(maxEdgeValue + 1);
        const normalizedValue = logMax > 0 ? logValue / logMax : 0;

        // Min 0.08 (small traffic still visible), max 1.5 (large traffic many particles)
        const spawnRate = 0.08 + normalizedValue * normalizedValue * 1.2;

        if (Math.random() < spawnRate) {
          // Particle size also uses log scale
          const baseSize = 0.8 + normalizedValue * 1.2;
          edge.particles.push({
            progress: 0,
            speed: 0.005 + Math.random() * 0.01,
            size: baseSize + Math.random() * 0.8,
            color: particleColor,
          });
        }

        // Update particles
        edge.particles = edge.particles.filter(p => p.progress < 1);
        for (const particle of edge.particles) {
          particle.progress += particle.speed;
        }
      }

      // Draw particles
      for (const particle of edge.particles) {
        const px = startX + (endX - startX) * particle.progress;
        const py = startY + (endY - startY) * particle.progress;

        // Glow effect
        const gradient = ctx.createRadialGradient(px, py, 0, px, py, particle.size * 3);
        gradient.addColorStop(0, particle.color);
        gradient.addColorStop(0.5, particle.color + '80');
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(px, py, particle.size * 3, 0, Math.PI * 2);
        ctx.fill();

        // Core particle
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(px, py, particle.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Draw edge label at midpoint, rotated to match line direction
      if (edge.label) {
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;

        // Calculate angle of the line
        let angle = Math.atan2(endY - startY, endX - startX);

        // Keep text readable (not upside down)
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
          angle += Math.PI;
        }

        ctx.save();
        ctx.translate(midX, midY);
        ctx.rotate(angle);
        ctx.font = '10px sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(edge.label, 0, -10);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }

    // Process and draw fading edges
    const fadeSpeed = 0.05;  // How fast edges fade out (after particles done)
    fadingEdgesRef.current = fadingEdgesRef.current.filter(edge => {
      const { source, target } = edge;

      // In highlight mode, skip drawing edges not connected to highlighted node
      // (but keep in list so they can properly fade when highlight mode ends)
      if (hlModeEdgeEnabled && hlModeEdgeNodeId) {
        const isConnectedToHighlighted =
          source.id === hlModeEdgeNodeId || target.id === hlModeEdgeNodeId;
        if (!isConnectedToHighlighted) {
          // Still update fade progress so it's ready when highlight mode ends
          if (!pausedRef.current) {
            edge.particles = edge.particles.filter(p => p.progress < 1);
            for (const particle of edge.particles) {
              particle.progress += particle.speed;
            }
            if (edge.particles.length === 0) {
              edge.fadeProgress = Math.max(0, (edge.fadeProgress || 1) - fadeSpeed);
            }
          }
          // Remove if fully faded
          if ((edge.fadeProgress || 1) <= 0 && edge.particles.length === 0) {
            return false;
          }
          return true; // Keep in list but don't draw
        }
      }

      // Update particles (let them complete their journey)
      if (!pausedRef.current) {
        edge.particles = edge.particles.filter(p => p.progress < 1);
        for (const particle of edge.particles) {
          particle.progress += particle.speed;
        }
      }

      // Only start fading AFTER all particles are done
      const particlesDone = edge.particles.length === 0;
      if (!pausedRef.current && particlesDone) {
        edge.fadeProgress = Math.max(0, (edge.fadeProgress || 1) - fadeSpeed);
      }
      const opacity = particlesDone ? (edge.fadeProgress || 0) : 1;  // Full opacity while particles exist

      // Remove edge if fully faded and no particles left
      if (opacity <= 0 && particlesDone) {
        return false;  // Remove from fading list
      }

      // Draw fading edge
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist === 0) return opacity > 0 || edge.particles.length > 0;

      const nx = dx / dist;
      const ny = dy / dist;

      const srcLabelLines = source.label.split('\n');
      const srcMaxLineLen = Math.max(...srcLabelLines.map(l => l.length));
      const srcBoxW = Math.max(100, srcMaxLineLen * 7 + 16) / 2;
      const srcBoxH = Math.max(36, srcLabelLines.length * 14 + 20) / 2;

      const tgtLabelLines = target.label.split('\n');
      const tgtMaxLineLen = Math.max(...tgtLabelLines.map(l => l.length));
      const tgtBoxW = Math.max(100, tgtMaxLineLen * 7 + 16) / 2;
      const tgtBoxH = Math.max(36, tgtLabelLines.length * 14 + 20) / 2;

      const startX = source.x + nx * srcBoxW;
      const startY = source.y + ny * srcBoxH;
      const endX = target.x - nx * tgtBoxW;
      const endY = target.y - ny * tgtBoxH;

      // Draw edge line with fading opacity
      if (opacity > 0) {
        ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.15})`;
        ctx.lineWidth = 1 + Math.sqrt(0.3) * 4;  // Fixed width for fading
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }

      // Draw particles with fading
      for (const particle of edge.particles) {
        const px = startX + (endX - startX) * particle.progress;
        const py = startY + (endY - startY) * particle.progress;
        const particleOpacity = Math.max(opacity, 0.3);  // Keep particles visible longer

        const gradient = ctx.createRadialGradient(px, py, 0, px, py, particle.size * 3);
        gradient.addColorStop(0, particle.color);
        gradient.addColorStop(0.5, particle.color + Math.floor(128 * particleOpacity).toString(16).padStart(2, '0'));
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(px, py, particle.size * 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = particleOpacity;
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(px, py, particle.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      return true;  // Keep in fading list
    });

    // Clean up fading node slots for nodes no longer in fading edges
    const stillFadingNodeIds = new Set<string>();
    for (const edge of fadingEdgesRef.current) {
      stillFadingNodeIds.add(edge.source.id);
      stillFadingNodeIds.add(edge.target.id);
    }
    // Remove from fading slots map if no longer fading
    for (const side of ['left', 'right'] as const) {
      const fadingSlotsMap = fadingNodeSlotsRef.current[side];
      for (const nodeId of fadingSlotsMap.keys()) {
        if (!stillFadingNodeIds.has(nodeId)) {
          fadingSlotsMap.delete(nodeId);
        }
      }
    }

    // Collect node IDs that have active edges
    const activeNodeIds = new Set<string>();
    for (const edge of edgesRef.current) {
      activeNodeIds.add(edge.source.id);
      activeNodeIds.add(edge.target.id);
    }

    // Calculate fade progress for nodes only referenced by fading edges
    const nodeFadeProgress = new Map<string, number>();
    for (const edge of fadingEdgesRef.current) {
      const progress = edge.fadeProgress || 0;
      // Only track nodes not in active edges
      if (!activeNodeIds.has(edge.source.id)) {
        const current = nodeFadeProgress.get(edge.source.id) || 0;
        nodeFadeProgress.set(edge.source.id, Math.max(current, progress));
      }
      if (!activeNodeIds.has(edge.target.id)) {
        const current = nodeFadeProgress.get(edge.target.id) || 0;
        nodeFadeProgress.set(edge.target.id, Math.max(current, progress));
      }
    }

    // Draw nodes as rectangles (pinned nodes drawn last to be on top)
    const nodeArray = Array.from(nodesRef.current.values());
    const unpinnedNodes = nodeArray.filter(n => !n.pinned);
    const pinnedNodes = nodeArray.filter(n => n.pinned);

    // Dynamically calculate connected nodes for highlight mode (includes new connections)
    const hlModeEnabled = highlightModeRef.current.enabled;
    const hlNodeId = highlightModeRef.current.nodeId;
    let currentConnectedIds = new Set<string>();
    if (hlModeEnabled && hlNodeId) {
      for (const edge of edgesRef.current) {
        if (edge.source.id === hlNodeId) {
          currentConnectedIds.add(edge.target.id);
        }
        if (edge.target.id === hlNodeId) {
          currentConnectedIds.add(edge.source.id);
        }
      }
      for (const edge of fadingEdgesRef.current) {
        if (edge.source.id === hlNodeId) {
          currentConnectedIds.add(edge.target.id);
        }
        if (edge.target.id === hlNodeId) {
          currentConnectedIds.add(edge.source.id);
        }
      }
    }

    const drawNode = (node: VisNode, i: number) => {
      const zonedNode = node as ZonedVisNode;
      const color = zonedNode.zoneColor || (isInternalIp(node.id, internalCidrsRef.current, internalFilterIpsRef.current) ? '#00d4ff' : '#ff6b6b');

      // Check if node is fading (only referenced by fading edges)
      const fadeProgress = nodeFadeProgress.get(node.id);
      const isFadingNode = fadeProgress !== undefined;
      let opacity = isFadingNode ? fadeProgress : 1;

      // In highlight mode, skip drawing nodes that are not highlighted or connected
      if (hlModeEnabled) {
        const isHighlighted = node.id === hlNodeId;
        const isConnected = currentConnectedIds.has(node.id);
        if (!isHighlighted && !isConnected) {
          return; // Don't draw this node at all
        }
      }

      // Skip drawing fully faded nodes
      if (opacity <= 0) return;

      // Split label into lines
      const labelLines = node.label.split('\n');
      const lineHeight = 14;

      // Calculate box dimensions
      const totalTraffic = node.totalIn + node.totalOut;
      const trafficText = showTrafficValueRef.current && totalTraffic > 0 ? formatValue(totalTraffic) : null;
      const maxLineLength = Math.max(...labelLines.map(l => l.length));
      const boxWidth = Math.max(100, maxLineLength * 7 + 20);
      const boxHeight = Math.max(40, labelLines.length * lineHeight + (trafficText ? 24 : 14));

      // Dim internal nodes with no traffic
      const isInternal = zonedNode.zonePosition === 'right';
      if (isInternal && totalTraffic === 0) {
        opacity *= 0.3; // Dim to 30%
      }

      ctx.globalAlpha = opacity;

      const x = node.x - boxWidth / 2;
      const y = node.y - boxHeight / 2;
      const cornerCut = 8; // Size of the cut corners

      // Sci-fi hexagonal/cut-corner shape path
      const drawSciFiBox = () => {
        ctx.beginPath();
        ctx.moveTo(x + cornerCut, y);
        ctx.lineTo(x + boxWidth - cornerCut, y);
        ctx.lineTo(x + boxWidth, y + cornerCut);
        ctx.lineTo(x + boxWidth, y + boxHeight - cornerCut);
        ctx.lineTo(x + boxWidth - cornerCut, y + boxHeight);
        ctx.lineTo(x + cornerCut, y + boxHeight);
        ctx.lineTo(x, y + boxHeight - cornerCut);
        ctx.lineTo(x, y + cornerCut);
        ctx.closePath();
      };

      // Outer glow
      ctx.shadowColor = color;
      ctx.shadowBlur = (node.pinned ? 25 : 15) * opacity;

      // Background fill
      ctx.fillStyle = node.pinned ? 'rgba(26, 26, 42, 0.95)' : 'rgba(12, 12, 20, 0.92)';
      drawSciFiBox();
      ctx.fill();

      // Reset shadow for crisp lines
      ctx.shadowBlur = 0;

      // Main border
      ctx.strokeStyle = color;
      ctx.lineWidth = node.pinned ? 2 : 1.5;
      drawSciFiBox();
      ctx.stroke();

      // Inner glow line (slightly inset)
      ctx.strokeStyle = `${color}40`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + cornerCut + 3, y + 3);
      ctx.lineTo(x + boxWidth - cornerCut - 3, y + 3);
      ctx.lineTo(x + boxWidth - 3, y + cornerCut + 3);
      ctx.lineTo(x + boxWidth - 3, y + boxHeight - cornerCut - 3);
      ctx.lineTo(x + boxWidth - cornerCut - 3, y + boxHeight - 3);
      ctx.lineTo(x + cornerCut + 3, y + boxHeight - 3);
      ctx.lineTo(x + 3, y + boxHeight - cornerCut - 3);
      ctx.lineTo(x + 3, y + cornerCut + 3);
      ctx.closePath();
      ctx.stroke();

      // Corner accent lines
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      // Top-left corner accent
      ctx.beginPath();
      ctx.moveTo(x, y + cornerCut + 8);
      ctx.lineTo(x, y + cornerCut);
      ctx.lineTo(x + cornerCut, y);
      ctx.lineTo(x + cornerCut + 8, y);
      ctx.stroke();
      // Top-right corner accent
      ctx.beginPath();
      ctx.moveTo(x + boxWidth - cornerCut - 8, y);
      ctx.lineTo(x + boxWidth - cornerCut, y);
      ctx.lineTo(x + boxWidth, y + cornerCut);
      ctx.lineTo(x + boxWidth, y + cornerCut + 8);
      ctx.stroke();
      // Bottom-left corner accent
      ctx.beginPath();
      ctx.moveTo(x, y + boxHeight - cornerCut - 8);
      ctx.lineTo(x, y + boxHeight - cornerCut);
      ctx.lineTo(x + cornerCut, y + boxHeight);
      ctx.lineTo(x + cornerCut + 8, y + boxHeight);
      ctx.stroke();
      // Bottom-right corner accent
      ctx.beginPath();
      ctx.moveTo(x + boxWidth - cornerCut - 8, y + boxHeight);
      ctx.lineTo(x + boxWidth - cornerCut, y + boxHeight);
      ctx.lineTo(x + boxWidth, y + boxHeight - cornerCut);
      ctx.lineTo(x + boxWidth, y + boxHeight - cornerCut - 8);
      ctx.stroke();

      // Top header bar
      ctx.fillStyle = `${color}30`;
      ctx.beginPath();
      ctx.moveTo(x + cornerCut, y);
      ctx.lineTo(x + boxWidth - cornerCut, y);
      ctx.lineTo(x + boxWidth, y + cornerCut);
      ctx.lineTo(x + boxWidth, y + 6);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x, y + cornerCut);
      ctx.closePath();
      ctx.fill();

      // Small decorative dots on header
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + cornerCut + 6, y + 3, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + cornerCut + 12, y + 3, 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Pin indicator (glowing dot)
      if (node.pinned) {
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x + boxWidth - cornerCut - 6, y + 3, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Draw label lines
      ctx.font = '11px "SF Mono", Consolas, monospace';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const labelStartY = node.y - (labelLines.length - 1) * lineHeight / 2 - (trafficText ? 4 : 0) + 2;
      labelLines.forEach((line, idx) => {
        ctx.fillText(line, node.x, labelStartY + idx * lineHeight);
      });

      // Traffic value (bottom line with glow)
      if (trafficText) {
        ctx.font = '10px "SF Mono", Consolas, monospace';
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 4;
        const trafficY = labelStartY + labelLines.length * lineHeight + 2;
        ctx.fillText(trafficText, node.x, trafficY);
        ctx.shadowBlur = 0;
      }

      // Draw cancel button for highlighted node
      if (hlModeEnabled && node.id === hlNodeId) {
        ctx.globalAlpha = 1;
        const btnX = node.x + boxWidth / 2 + 15;
        const btnY = node.y;
        const btnRadius = 12;

        // Button background (red circle with glow)
        ctx.shadowColor = '#ff4444';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#ff4444';
        ctx.beginPath();
        ctx.arc(btnX, btnY, btnRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // X icon
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(btnX - 5, btnY - 5);
        ctx.lineTo(btnX + 5, btnY + 5);
        ctx.moveTo(btnX + 5, btnY - 5);
        ctx.lineTo(btnX - 5, btnY + 5);
        ctx.stroke();
        ctx.lineCap = 'butt';

        // Store button position for click detection
        cancelButtonRef.current = { x: btnX, y: btnY, radius: btnRadius };
      }

      ctx.globalAlpha = 1;
    };

    // In highlight mode, only highlighted/connected nodes are drawn (others skipped in drawNode)
    // Draw connected nodes first, then highlighted node on top
    if (hlModeEnabled) {
      const connectedNodes: VisNode[] = [];
      let highlightedNode: VisNode | null = null;

      for (const node of nodeArray) {
        if (node.id === hlNodeId) {
          highlightedNode = node;
        } else if (currentConnectedIds.has(node.id)) {
          connectedNodes.push(node);
        }
        // Non-connected nodes will be skipped by drawNode anyway
      }

      // Draw connected nodes first, then highlighted node on top
      connectedNodes.forEach((node, i) => drawNode(node, nodeArray.indexOf(node)));
      if (highlightedNode) {
        drawNode(highlightedNode, nodeArray.indexOf(highlightedNode));
      }
    } else {
      // Normal mode: unpinned first, then pinned on top
      unpinnedNodes.forEach((node, i) => drawNode(node, nodeArray.indexOf(node)));
      pinnedNodes.forEach((node, i) => drawNode(node, nodeArray.indexOf(node)));
    }

    // Restore transform
    ctx.restore();

    animationRef.current = requestAnimationFrame(animate);
  }, [width, height]);

  // Update graph when data changes
  useEffect(() => {
    updateGraph();
  }, [updateGraph]);

  // Start animation
  useEffect(() => {
    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [animate]);

  return (
    <div style={{ position: 'relative', width, height, display: 'flex' }}>
      <div style={{ position: 'relative', width: effectiveWidth, height, transition: 'width 0.3s ease' }}>
        <canvas
          ref={canvasRef}
          width={effectiveWidth}
          height={height}
          style={{ display: 'block', cursor: 'grab' }}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={handleContextMenu}
        />
        <ZoomControls
        zoomLevel={zoomLevel}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        onZoomTo={handleZoomTo}
        presets={[0.5, 1, 1.5, 2, 3]}
        minZoom={0.3}
        maxZoom={5}
      />

        {/* Internal IP Stats Toggle Button */}
        <button
          className={`flow-stats-toggle ${showStatsPanel ? 'active' : ''}`}
          onClick={() => setShowStatsPanel(!showStatsPanel)}
          title="Internal IP Rankings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="14" width="4" height="6" rx="1" fill="currentColor" opacity="0.3" />
            <rect x="10" y="10" width="4" height="10" rx="1" fill="currentColor" opacity="0.5" />
            <rect x="16" y="6" width="4" height="14" rx="1" fill="currentColor" opacity="0.7" />
            <path d="M4 20h16" strokeLinecap="round" />
          </svg>
        </button>

        {/* Flow Legend */}
        <div className="legend flow-legend">
          <h4>{t('legend.networkZones')}</h4>
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#ff6b6b' }} />
            <span>{t('legend.external')}</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#00d4ff' }} />
            <span>{t('legend.internal')}</span>
          </div>
        </div>

        {/* Context menu for right-click on internal nodes */}
        {contextMenu && (
          <div
            className="flow-context-menu"
            style={{
              position: 'fixed',
              left: contextMenu.x,
              top: contextMenu.y,
              background: 'linear-gradient(180deg, #252532 0%, #1a1a25 100%)',
              border: '1px solid #3a3a4a',
              borderRadius: '8px',
              padding: '6px',
              zIndex: 1000,
              boxShadow: '0 4px 20px rgba(0,0,0,0.6), 0 0 1px rgba(255,255,255,0.1)',
              minWidth: '180px',
            }}
          >
            <button
              onClick={() => enterHighlightMode(contextMenu.nodeId)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                padding: '10px 14px',
                background: 'transparent',
                border: 'none',
                borderRadius: '6px',
                color: '#e0e0e0',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: '13px',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0, 212, 255, 0.15)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00d4ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
              </svg>
              {t('flow.focusOnLabel')}
            </button>
          </div>
        )}
      </div>

      {/* Internal IP Stats Panel - Side Panel */}
      {showStatsPanel && (
        <div className="flow-stats-panel sci-fi">
          <div className="panel-header">
            <span>INTERNAL TOP {statsTopN}</span>
            <span
              className="panel-subtitle clickable"
              onClick={() => setStatsMode(statsMode === 'events' ? 'traffic' : 'events')}
              title="Click to toggle"
            >
              BY {statsMode === 'events' ? 'EVENTS' : 'TRAFFIC'}
            </span>
          </div>
          <div className="flow-stats-list">
            {topInternalIPs.length === 0 ? (
              <div className="no-data">{t('empty.title')}</div>
            ) : (
              topInternalIPs.map((item, index) => (
                <div key={item.id} className="flow-stat-row">
                  <span className="flow-rank">{index + 1}</span>
                  <span className="flow-ip">{item.id}</span>
                  <span className="flow-traffic">{formatValue(item.value)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatValue(value: number): string {
  if (value >= 1_000_000_000) return (value / 1_000_000_000).toFixed(1) + 'G';
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'K';
  return value.toFixed(0);
}
