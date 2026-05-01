import React, { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import type { GraphData, GeoIPConfig, GlobeNode, GlobeArc } from './types';
import { convertToGlobeData, formatValue } from './utils/geoip';
import { ZoomControls } from './ZoomControls';
import { useTranslation } from './i18n';

// World map GeoJSON URL
const WORLD_MAP_URL = 'https://unpkg.com/world-atlas@2/countries-110m.json';

export type GlobeMode = '2d' | '3d';

interface Props {
  graph: GraphData;
  width: number;
  height: number;
  internalCidrs: string[];
  geoipConfig: GeoIPConfig;
  paused?: boolean;
  mode?: GlobeMode;  // Controlled mode from parent
  autoRotate?: boolean;  // Controlled from parent (3D globe only)
  onAutoRotateChange?: (value: boolean) => void;  // Callback when auto-rotate is toggled
  // Filtering options
  internalFilterIps?: string[];
  topNInternal?: number;
  topNExternal?: number;
  // Zoom and pan handlers for keyboard shortcuts
  zoomInRef?: React.MutableRefObject<(() => void) | null>;
  zoomOutRef?: React.MutableRefObject<(() => void) | null>;
  zoomResetRef?: React.MutableRefObject<(() => void) | null>;
  panUpRef?: React.MutableRefObject<(() => void) | null>;
  panDownRef?: React.MutableRefObject<(() => void) | null>;
  panLeftRef?: React.MutableRefObject<(() => void) | null>;
  panRightRef?: React.MutableRefObject<(() => void) | null>;
}

// Custom interpolation that goes east-west (not over poles)
function geoInterpolateEastWest(start: [number, number], end: [number, number]) {
  const [lng1, lat1] = start;
  const [lng2, lat2] = end;

  // Calculate the shorter longitude path
  let dLng = lng2 - lng1;
  if (dLng > 180) dLng -= 360;
  if (dLng < -180) dLng += 360;

  return (t: number): [number, number] => {
    // Linear interpolation for latitude
    const lat = lat1 + (lat2 - lat1) * t;
    // Interpolate longitude the short way
    let lng = lng1 + dLng * t;
    // Normalize longitude to -180 to 180
    if (lng > 180) lng -= 360;
    if (lng < -180) lng += 360;
    return [lng, lat];
  };
}

// Helper to adjust color brightness based on percentage (0-100)
function adjustBrightness(hexColor: string, brightness: number): string {
  // Parse hex color
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Brightness factor: 0% = dark, 100% = full brightness
  const factor = brightness / 100;

  const newR = Math.min(255, Math.round(r * factor * 2));
  const newG = Math.min(255, Math.round(g * factor * 2));
  const newB = Math.min(255, Math.round(b * factor * 2));

  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  node: GlobeNode | null;
  // Fixed card position (set when tooltip first appears)
  cardX?: number;
  cardY?: number;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  node: GlobeNode | null;
}

export function GlobeCanvas({
  graph,
  width,
  height,
  internalCidrs,
  geoipConfig,
  paused = false,
  mode = '3d',
  autoRotate = true,
  onAutoRotateChange,
  internalFilterIps = [],
  topNInternal = 0,
  topNExternal = 0,
  zoomInRef,
  zoomOutRef,
  zoomResetRef,
  panUpRef,
  panDownRef,
  panLeftRef,
  panRightRef,
}: Props) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const [worldData, setWorldData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const globeMode = mode;  // Use controlled mode from parent
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, node: null });
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, node: null });
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);  // Track focused node for toggle
  const [zoomLevel, setZoomLevel] = useState(1);  // For display (2D)
  const [globeZoomLevel, setGlobeZoomLevel] = useState(1);  // For display (3D)
  const autoRotateRef = useRef(autoRotate);  // Ref for animation loop
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const globeZoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const animationRef = useRef<number>(0);
  const particlesRef = useRef<Array<{ arc: GlobeArc; progress: number; speed: number }>>([]);
  const prevNodesMapRef = useRef<Map<string, GlobeNode>>(new Map());
  const expiringNodesRef = useRef<Map<string, { node: GlobeNode; fadeProgress: number }>>(new Map());
  // Initialize rotation to center on internal fallback location
  // D3 geoOrthographic rotation format: [-longitude, -latitude, tilt]
  const initialRotation: [number, number, number] = [
    -(geoipConfig.internal_fallback_lng || 0),
    -(geoipConfig.internal_fallback_lat || 0),
    0
  ];
  const rotationRef = useRef<[number, number, number]>(initialRotation);
  const scaleRef = useRef<number>(1);
  const initializedRef = useRef<boolean>(false);
  const projectionRef = useRef<d3.GeoProjection | null>(null);

  // Update rotation when geoipConfig fallback location changes
  useEffect(() => {
    // Only update if we have valid coordinates and haven't initialized yet
    // or if the coordinates have changed significantly
    const lng = geoipConfig.internal_fallback_lng || 0;
    const lat = geoipConfig.internal_fallback_lat || 0;

    if (!initializedRef.current && (lng !== 0 || lat !== 0)) {
      rotationRef.current = [-lng, -lat, 0];
      initializedRef.current = true;
    }
  }, [geoipConfig.internal_fallback_lng, geoipConfig.internal_fallback_lat]);

  // Keep autoRotateRef in sync with prop
  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  // Track tooltip position during 3D rotation
  const [tooltipTick, setTooltipTick] = useState(0);
  useEffect(() => {
    if (globeMode !== '3d' || !tooltip.visible || !autoRotate) return;
    const interval = setInterval(() => {
      setTooltipTick(t => t + 1);
    }, 50); // Update 20 times per second
    return () => clearInterval(interval);
  }, [globeMode, tooltip.visible, autoRotate]);

  // Country stats panel state
  const [showCountryStats, setShowCountryStats] = useState(false);
  const [statsMode, setStatsMode] = useState<'events' | 'traffic'>('events');
  const statsPanelWidth = 280;
  const effectiveWidth = showCountryStats ? width - statsPanelWidth : width;
  const effectiveWidthRef = useRef(effectiveWidth);
  effectiveWidthRef.current = effectiveWidth;

  // Calculate map colors based on brightness setting
  const mapColors = useMemo(() => {
    const brightness = geoipConfig.map_brightness ?? 30;
    return {
      background: adjustBrightness('#0a0a12', brightness),
      mapFill: adjustBrightness('#0d0d18', brightness),
      landFill: adjustBrightness('#151520', brightness),
      stroke: adjustBrightness('#1a1a2e', brightness),
      landStroke: adjustBrightness('#2a2a3e', brightness),
      graticule: adjustBrightness('#1a1a2e', brightness),
    };
  }, [geoipConfig.map_brightness]);

  // Convert graph data to globe format with filtering
  const { nodes, arcs } = useMemo(() => {
    try {
      const data = convertToGlobeData(graph, geoipConfig, internalCidrs);
      let filteredNodes = data.nodes;
      let filteredArcs = data.arcs;

      // Apply internal filter IPs (only show these internal IPs if specified)
      if (internalFilterIps.length > 0) {
        const filterSet = new Set(internalFilterIps);
        filteredNodes = filteredNodes.filter(n => !n.isInternal || filterSet.has(n.id));
        // Filter arcs to only include those connected to visible nodes
        const visibleNodeIds = new Set(filteredNodes.map(n => n.id));
        filteredArcs = filteredArcs.filter(a => visibleNodeIds.has(a.srcId) && visibleNodeIds.has(a.dstId));
      }

      // Apply top N internal filter
      if (topNInternal > 0) {
        const internalNodes = filteredNodes.filter(n => n.isInternal);
        const externalNodes = filteredNodes.filter(n => !n.isInternal);
        // Sort by traffic and take top N
        const topInternalNodes = internalNodes
          .sort((a, b) => b.value - a.value)
          .slice(0, topNInternal);
        filteredNodes = [...topInternalNodes, ...externalNodes];
        // Filter arcs
        const visibleNodeIds = new Set(filteredNodes.map(n => n.id));
        filteredArcs = filteredArcs.filter(a => visibleNodeIds.has(a.srcId) && visibleNodeIds.has(a.dstId));
      }

      // Apply top N external filter
      if (topNExternal > 0) {
        const internalNodes = filteredNodes.filter(n => n.isInternal);
        const externalNodes = filteredNodes.filter(n => !n.isInternal);
        // Sort by traffic and take top N
        const topExternalNodes = externalNodes
          .sort((a, b) => b.value - a.value)
          .slice(0, topNExternal);
        filteredNodes = [...internalNodes, ...topExternalNodes];
        // Filter arcs
        const visibleNodeIds = new Set(filteredNodes.map(n => n.id));
        filteredArcs = filteredArcs.filter(a => visibleNodeIds.has(a.srcId) && visibleNodeIds.has(a.dstId));
      }

      return { nodes: filteredNodes, arcs: filteredArcs };
    } catch (e) {
      console.error('Error converting data:', e);
      return { nodes: [], arcs: [] };
    }
  }, [graph, geoipConfig, internalCidrs, internalFilterIps, topNInternal, topNExternal]);

  // Compute country code statistics (top 10)
  const countryStats = useMemo(() => {
    const stats = new Map<string, { traffic: number; events: number }>();

    // First pass: count nodes and traffic per country
    nodes.forEach(node => {
      if (node.countryCode && !node.isInternal) {
        const existing = stats.get(node.countryCode) || { traffic: 0, events: 0 };
        const nodeTraffic = (node.totalIn || 0) + (node.totalOut || 0);
        stats.set(node.countryCode, {
          traffic: existing.traffic + nodeTraffic,
          events: existing.events,
        });
      }
    });

    // Second pass: count events (arcs) per country
    arcs.forEach(arc => {
      // Find the external node in this arc to get its country
      const srcNode = nodes.find(n => n.id === arc.sourceId);
      const dstNode = nodes.find(n => n.id === arc.targetId);
      const externalNode = srcNode?.isInternal === false ? srcNode : dstNode?.isInternal === false ? dstNode : null;
      if (externalNode?.countryCode) {
        const existing = stats.get(externalNode.countryCode);
        if (existing) {
          existing.events += 1;
        }
      }
    });

    // Sort by the selected mode and take top N
    const topN = geoipConfig.stats_top_n || 10;
    return Array.from(stats.entries())
      .map(([code, data]) => ({
        code,
        value: statsMode === 'events' ? data.events : data.traffic,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, topN);
  }, [nodes, arcs, statsMode, geoipConfig.stats_top_n]);

  // Track expiring nodes for fade-out effect
  useEffect(() => {
    const currentNodeIds = new Set(nodes.map(n => n.id));
    const prevNodesMap = prevNodesMapRef.current;

    // Find nodes that were in previous render but not in current
    prevNodesMap.forEach((prevNode, id) => {
      if (!currentNodeIds.has(id) && !expiringNodesRef.current.has(id)) {
        // Node is expiring - add it to expiring list with full opacity
        expiringNodesRef.current.set(id, { node: prevNode, fadeProgress: 1 });
      }
    });

    // Update previous nodes map with current nodes
    prevNodesMapRef.current = new Map(nodes.map(n => [n.id, n]));
  }, [nodes]);

  // Hide tooltip and context menu if the node they're showing no longer exists in the data
  useEffect(() => {
    if (tooltip.visible && tooltip.node) {
      const nodeStillExists = nodes.some(n => n.id === tooltip.node!.id);
      if (!nodeStillExists) {
        setTooltip({ visible: false, x: 0, y: 0, node: null });
      }
    }
    if (contextMenu.visible && contextMenu.node) {
      const nodeStillExists = nodes.some(n => n.id === contextMenu.node!.id);
      if (!nodeStillExists) {
        setContextMenu({ visible: false, x: 0, y: 0, node: null });
      }
    }
  }, [nodes, tooltip.visible, tooltip.node, contextMenu.visible, contextMenu.node]);

  // Combined nodes: current nodes + expiring nodes with fade progress
  const allNodes = useMemo(() => {
    const result: Array<GlobeNode & { fadeProgress?: number }> = nodes.map(n => ({ ...n, fadeProgress: 1 }));
    expiringNodesRef.current.forEach(({ node, fadeProgress }) => {
      if (fadeProgress > 0) {
        result.push({ ...node, fadeProgress });
      }
    });
    return result;
  }, [nodes, graph.timestamp]); // Re-compute when graph updates

  // Load world map data
  useEffect(() => {
    fetch(WORLD_MAP_URL)
      .then(res => res.json())
      .then(data => {
        setWorldData(data);
        setLoading(false);
      })
      .catch(e => {
        setError(`Failed to load map: ${e.message}`);
        setLoading(false);
      });
  }, []);

  // Initialize particles for arcs
  useEffect(() => {
    // Preserve existing particle progress for arcs that still exist
    const existingParticles = new Map<string, { progress: number; speed: number }>();
    particlesRef.current.forEach(p => {
      const key = `${p.arc.startLat},${p.arc.startLng}-${p.arc.endLat},${p.arc.endLng}`;
      existingParticles.set(key, { progress: p.progress, speed: p.speed });
    });

    // Create particles for current arcs, preserving progress where possible
    particlesRef.current = arcs.map(arc => {
      const key = `${arc.startLat},${arc.startLng}-${arc.endLat},${arc.endLng}`;
      const existing = existingParticles.get(key);
      return {
        arc,
        progress: existing?.progress ?? Math.random(),
        speed: existing?.speed ?? (0.002 + Math.random() * 0.003),
      };
    });
  }, [arcs]);

  // 2D flat map state
  const flatTransformRef = useRef<{ x: number; y: number; k: number }>({ x: 0, y: 0, k: 1 });

  // Focus on a specific node with smooth animation
  const focusOnNode = useCallback((node: GlobeNode) => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const targetZoom = geoipConfig.focus_zoom_level || 14;

    setContextMenu({ visible: false, x: 0, y: 0, node: null });
    setTooltip({ visible: false, x: 0, y: 0, node: null });

    if (globeMode === '2d' && zoomBehaviorRef.current) {
      // For 2D map: calculate translation to center node and zoom
      const currentWidth = effectiveWidthRef.current;
      const baseScale = Math.min(currentWidth / 5.65, height / 2.8);

      // Calculate where the node would be at target zoom with current offset
      const targetProjection = d3.geoNaturalEarth1()
        .scale(baseScale * targetZoom)
        .translate([currentWidth / 2, height / 2]);

      const nodePos = targetProjection([node.lng, node.lat]);
      if (!nodePos) return;

      // Calculate translation needed to center the node
      const targetX = currentWidth / 2 - nodePos[0];
      const targetY = height / 2 - nodePos[1];

      // Get start values
      const startX = flatTransformRef.current.x;
      const startY = flatTransformRef.current.y;
      const startK = flatTransformRef.current.k;

      // Animate using requestAnimationFrame
      const duration = 750;
      const startTime = performance.now();

      const animate2DFocus = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - t, 3);

        // Interpolate all values
        const currentX = startX + (targetX - startX) * eased;
        const currentY = startY + (targetY - startY) * eased;
        const currentK = startK + (targetZoom - startK) * eased;

        // Update ref
        flatTransformRef.current = { x: currentX, y: currentY, k: currentK };
        setZoomLevel(currentK);

        // Trigger zoom event to update the map
        svg.call(
          zoomBehaviorRef.current!.transform as any,
          d3.zoomIdentity.scale(currentK)
        );

        if (t < 1) {
          requestAnimationFrame(animate2DFocus);
        } else {
          setFocusedNodeId(node.id);
        }
      };

      requestAnimationFrame(animate2DFocus);
    } else if (globeMode === '3d' && globeZoomBehaviorRef.current && projectionRef.current) {
      // For 3D globe: rotate to center on node and zoom
      // Stop auto-rotate when focusing
      if (onAutoRotateChange) {
        onAutoRotateChange(false);
      }

      // Target rotation: negative of node coordinates to center it
      const targetRotation: [number, number, number] = [-node.lng, -node.lat, 0];
      const startRotation = [...rotationRef.current] as [number, number, number];
      const startScale = scaleRef.current;

      // Animate rotation and zoom
      const duration = 750;
      const startTime = performance.now();

      const animateToNode = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - t, 3);

        // Interpolate rotation
        rotationRef.current = [
          startRotation[0] + (targetRotation[0] - startRotation[0]) * eased,
          startRotation[1] + (targetRotation[1] - startRotation[1]) * eased,
          0
        ];

        // Update projection rotation so zoom handler uses new rotation
        if (projectionRef.current) {
          projectionRef.current.rotate(rotationRef.current);
        }

        // Interpolate scale
        const newScale = startScale + (targetZoom - startScale) * eased;
        scaleRef.current = newScale;
        setGlobeZoomLevel(newScale);

        // Apply changes through zoom behavior (this triggers redraw of all elements)
        svg.call(globeZoomBehaviorRef.current!.transform as any, d3.zoomIdentity.scale(newScale));

        if (t < 1) {
          requestAnimationFrame(animateToNode);
        } else {
          setFocusedNodeId(node.id);
        }
      };

      requestAnimationFrame(animateToNode);
    }
  }, [globeMode, height, geoipConfig.focus_zoom_level, onAutoRotateChange]);

  // Reset view to default position and zoom
  const resetView = useCallback(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);

    setContextMenu({ visible: false, x: 0, y: 0, node: null });
    setTooltip({ visible: false, x: 0, y: 0, node: null });

    if (globeMode === '2d' && zoomBehaviorRef.current) {
      // Animate back to default position
      const startX = flatTransformRef.current.x;
      const startY = flatTransformRef.current.y;
      const startK = flatTransformRef.current.k;

      const duration = 750;
      const startTime = performance.now();

      const animate2DReset = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - t, 3);

        const currentX = startX + (0 - startX) * eased;
        const currentY = startY + (0 - startY) * eased;
        const currentK = startK + (1 - startK) * eased;

        flatTransformRef.current = { x: currentX, y: currentY, k: currentK };
        setZoomLevel(currentK);

        svg.call(
          zoomBehaviorRef.current!.transform as any,
          d3.zoomIdentity.scale(currentK)
        );

        if (t < 1) {
          requestAnimationFrame(animate2DReset);
        } else {
          setFocusedNodeId(null);
        }
      };

      requestAnimationFrame(animate2DReset);
    } else if (globeMode === '3d' && globeZoomBehaviorRef.current && projectionRef.current) {
      // Animate back to default rotation (internal fallback location) and zoom
      const targetRotation: [number, number, number] = [
        -(geoipConfig.internal_fallback_lng || 0),
        -(geoipConfig.internal_fallback_lat || 0),
        0
      ];
      const startRotation = [...rotationRef.current] as [number, number, number];
      const startScale = scaleRef.current;

      const duration = 750;
      const startTime = performance.now();

      const animate3DReset = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - t, 3);

        rotationRef.current = [
          startRotation[0] + (targetRotation[0] - startRotation[0]) * eased,
          startRotation[1] + (targetRotation[1] - startRotation[1]) * eased,
          0
        ];

        // Update projection rotation so zoom handler uses new rotation
        if (projectionRef.current) {
          projectionRef.current.rotate(rotationRef.current);
        }

        const newScale = startScale + (1 - startScale) * eased;
        scaleRef.current = newScale;
        setGlobeZoomLevel(newScale);

        svg.call(globeZoomBehaviorRef.current!.transform as any, d3.zoomIdentity.scale(newScale));

        if (t < 1) {
          requestAnimationFrame(animate3DReset);
        } else {
          setFocusedNodeId(null);
        }
      };

      requestAnimationFrame(animate3DReset);
    }
  }, [globeMode, geoipConfig.internal_fallback_lat, geoipConfig.internal_fallback_lng]);

  // Handle double-click on node - toggle between focus and reset
  const handleNodeDoubleClick = useCallback((node: GlobeNode) => {
    if (focusedNodeId === node.id) {
      // Already focused on this node, reset view
      resetView();
    } else {
      // Focus on the node
      focusOnNode(node);
    }
  }, [focusedNodeId, focusOnNode, resetView]);

  // Render 2D flat map
  useEffect(() => {
    if (!svgRef.current || !worldData || loading || globeMode !== '2d') {
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Natural Earth projection aspect ratio is ~5.65:2.8 (≈2:1)
    // Calculate scale to fit the entire world map in the viewport
    const currentWidth = effectiveWidthRef.current;
    const baseScale = Math.min(currentWidth / 5.65, height / 2.8);

    // Natural Earth projection for flat map
    const projection = d3.geoNaturalEarth1()
      .scale(baseScale * flatTransformRef.current.k)
      .translate([
        currentWidth / 2 + flatTransformRef.current.x,
        height / 2 + flatTransformRef.current.y
      ]);

    const pathGenerator = d3.geoPath().projection(projection);

    // Background
    svg.append('rect')
      .attr('width', currentWidth)
      .attr('height', height)
      .attr('fill', mapColors.background);

    // Main map group for transform
    const mapGroup = svg.append('g').attr('class', 'map-content');

    // Globe outline
    mapGroup.append('path')
      .datum({ type: 'Sphere' } as any)
      .attr('d', pathGenerator as any)
      .attr('fill', mapColors.mapFill)
      .attr('stroke', mapColors.stroke)
      .attr('stroke-width', 1);

    // Graticule
    const graticule = d3.geoGraticule();
    mapGroup.append('path')
      .datum(graticule())
      .attr('d', pathGenerator as any)
      .attr('fill', 'none')
      .attr('stroke', mapColors.graticule)
      .attr('stroke-width', 0.3);

    // Countries
    const countries = topojson.feature(worldData, worldData.objects.countries);
    mapGroup.append('g')
      .attr('class', 'countries')
      .selectAll('path')
      .data(countries.features)
      .enter()
      .append('path')
      .attr('d', pathGenerator as any)
      .attr('fill', mapColors.landFill)
      .attr('stroke', mapColors.landStroke)
      .attr('stroke-width', 0.5);

    // Arc group
    const arcGroup = mapGroup.append('g').attr('class', 'arcs');

    // Helper to draw arc path
    const drawArcPath = (arc: GlobeArc) => {
      const source = projection([arc.startLng, arc.startLat]);
      const target = projection([arc.endLng, arc.endLat]);

      if (!source || !target) return '';

      const midX = (source[0] + target[0]) / 2;
      const midY = (source[1] + target[1]) / 2;
      const dx = target[0] - source[0];
      const dy = target[1] - source[1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist === 0) return '';
      const curvature = Math.min(dist * 0.3, 100);

      const nx = -dy / dist;
      const ny = dx / dist;
      const ctrlX = midX + nx * curvature;
      const ctrlY = midY - Math.abs(ny * curvature);

      return `M ${source[0]} ${source[1]} Q ${ctrlX} ${ctrlY} ${target[0]} ${target[1]}`;
    };

    // Draw arcs (including expiring ones)
    arcs.forEach(arc => {
      arcGroup.append('path')
        .datum(arc)
        .attr('d', drawArcPath(arc))
        .attr('fill', 'none')
        .attr('stroke', arc.color)
        .attr('stroke-width', Math.max(1, Math.log10(arc.value + 1) * 0.8))
        .attr('stroke-opacity', 0.4);

      // Draw arc label at midpoint
      if (arc.label) {
        const source = projection([arc.startLng, arc.startLat]);
        const target = projection([arc.endLng, arc.endLat]);
        if (source && target) {
          const midX = (source[0] + target[0]) / 2;
          const midY = (source[1] + target[1]) / 2;
          const dx = target[0] - source[0];
          const dy = target[1] - source[1];
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 50) {  // Only show label if arc is long enough
            const curvature = Math.min(dist * 0.3, 100);
            const nx = -dy / dist;
            const ny = dx / dist;
            const labelX = midX + nx * curvature * 0.5;
            const labelY = midY - Math.abs(ny * curvature) * 0.5;

            // Calculate angle to follow arc direction
            let angle = Math.atan2(dy, dx) * (180 / Math.PI);
            // Flip text if upside down
            if (angle > 90 || angle < -90) {
              angle += 180;
            }

            arcGroup.append('text')
              .datum(arc)
              .attr('class', 'arc-label')
              .attr('x', labelX)
              .attr('y', labelY)
              .attr('text-anchor', 'middle')
              .attr('dominant-baseline', 'middle')
              .attr('fill', '#ffffff')
              .attr('font-size', '10px')
              .attr('opacity', 0.8)
              .attr('transform', `rotate(${angle}, ${labelX}, ${labelY})`)
              .text(arc.label);
          }
        }
      }
    });

    // Particle group
    const particleGroup = mapGroup.append('g').attr('class', 'particles');

    // Node group
    const nodeGroup = mapGroup.append('g').attr('class', 'nodes');

    // Draw nodes (including expiring ones with fade effect)
    allNodes.forEach(node => {
      const pos = projection([node.lng, node.lat]);
      if (!pos) return;

      const fadeProgress = node.fadeProgress ?? 1;
      const radius = 4 + Math.log10((node.totalIn + node.totalOut) + 1) * 2;

      nodeGroup.append('circle')
        .datum(node)
        .attr('cx', pos[0])
        .attr('cy', pos[1])
        .attr('r', radius + 4)
        .attr('fill', node.color)
        .attr('opacity', 0.2 * fadeProgress);

      nodeGroup.append('circle')
        .datum(node)
        .attr('cx', pos[0])
        .attr('cy', pos[1])
        .attr('r', radius)
        .attr('fill', node.color)
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .attr('stroke-opacity', 0.5 * fadeProgress)
        .attr('opacity', fadeProgress)
        .style('cursor', 'pointer')
        .on('mouseenter', function(event) {
          const rect = svgRef.current?.getBoundingClientRect();
          if (rect) {
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            // Calculate fixed card position
            const tooltipWidth = 260;
            const tooltipHeight = 180;
            const margin = 20;
            const lineOffset = 40;
            const centerX = currentWidth / 2;
            const centerY = height / 2;
            const placeRight = x < centerX;
            const placeBottom = y < centerY;
            const cardX = placeRight
              ? Math.min(x + lineOffset + 60, currentWidth - tooltipWidth - margin)
              : Math.max(x - lineOffset - 60 - tooltipWidth, margin);
            const cardY = placeBottom
              ? Math.min(y + lineOffset + 20, height - tooltipHeight - margin)
              : Math.max(y - lineOffset - 20 - tooltipHeight, margin);
            setTooltip({ visible: true, x, y, node, cardX, cardY });
          }
        })
        .on('mousemove', function(event) {
          const rect = svgRef.current?.getBoundingClientRect();
          if (rect) {
            setTooltip(prev => ({
              ...prev,
              x: event.clientX - rect.left,
              y: event.clientY - rect.top
            }));
          }
        })
        .on('mouseleave', function() {
          setTooltip({ visible: false, x: 0, y: 0, node: null });
        })
        .on('dblclick', function(event) {
          event.preventDefault();
          event.stopPropagation();
          handleNodeDoubleClick(node);
        })
        .on('contextmenu', function(event) {
          event.preventDefault();
          const rect = svgRef.current?.getBoundingClientRect();
          if (rect) {
            setContextMenu({
              visible: true,
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
              node
            });
          }
        });
    });

    // Helper to update arc labels
    const updateArcLabels = () => {
      arcGroup.selectAll('text.arc-label').each(function() {
        const el = d3.select(this);
        const arc = el.datum() as GlobeArc;
        if (!arc) return;

        const source = projection([arc.startLng, arc.startLat]);
        const target = projection([arc.endLng, arc.endLat]);
        if (!source || !target) {
          el.attr('opacity', 0);
          return;
        }

        const midX = (source[0] + target[0]) / 2;
        const midY = (source[1] + target[1]) / 2;
        const dx = target[0] - source[0];
        const dy = target[1] - source[1];
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= 50) {
          el.attr('opacity', 0);
          return;
        }

        const curvature = Math.min(dist * 0.3, 100);
        const nx = -dy / dist;
        const ny = dx / dist;
        const labelX = midX + nx * curvature * 0.5;
        const labelY = midY - Math.abs(ny * curvature) * 0.5;

        let angle = Math.atan2(dy, dx) * (180 / Math.PI);
        if (angle > 90 || angle < -90) angle += 180;

        el.attr('x', labelX)
          .attr('y', labelY)
          .attr('transform', `rotate(${angle}, ${labelX}, ${labelY})`)
          .attr('opacity', 0.8);
      });
    };

    // Drag behavior for panning
    const drag = d3.drag<SVGSVGElement, unknown>()
      .on('drag', (event) => {
        flatTransformRef.current.x += event.dx;
        flatTransformRef.current.y += event.dy;

        projection.translate([
          currentWidth / 2 + flatTransformRef.current.x,
          height / 2 + flatTransformRef.current.y
        ]);

        // Update map
        mapGroup.selectAll('.countries path, .map-content > path').attr('d', pathGenerator as any);

        // Update arcs
        arcGroup.selectAll('path').attr('d', (d: any) => d ? drawArcPath(d) : '');

        // Update arc labels
        updateArcLabels();

        // Update nodes
        nodeGroup.selectAll('circle').each(function() {
          const el = d3.select(this);
          const node = el.datum() as GlobeNode;
          if (!node) return;
          const pos = projection([node.lng, node.lat]);
          if (pos) {
            el.attr('cx', pos[0]).attr('cy', pos[1]);
          }
        });
      });

    // Zoom behavior - center on mouse cursor
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 16])  // Max zoom 16x
      .on('zoom', (event) => {
        const newK = event.transform.k;
        const oldK = flatTransformRef.current.k;

        // Get mouse position relative to SVG (only for user-initiated zoom, not programmatic)
        // Check if sourceEvent exists to determine if this is a user interaction
        if (event.sourceEvent && oldK !== newK) {
          const [mouseX, mouseY] = d3.pointer(event, svg.node());
          // Only adjust if we have valid mouse coordinates
          if (isFinite(mouseX) && isFinite(mouseY)) {
            const scaleFactor = newK / oldK;
            // Calculate new translation to keep mouse point fixed
            flatTransformRef.current.x = mouseX - (mouseX - flatTransformRef.current.x - currentWidth / 2) * scaleFactor - currentWidth / 2;
            flatTransformRef.current.y = mouseY - (mouseY - flatTransformRef.current.y - height / 2) * scaleFactor - height / 2;
          }
        }

        flatTransformRef.current.k = newK;
        setZoomLevel(newK);  // Update display
        projection
          .scale(baseScale * flatTransformRef.current.k)
          .translate([
            currentWidth / 2 + flatTransformRef.current.x,
            height / 2 + flatTransformRef.current.y
          ]);

        // Update map
        mapGroup.selectAll('.countries path, .map-content > path').attr('d', pathGenerator as any);

        // Update arcs
        arcGroup.selectAll('path').attr('d', (d: any) => d ? drawArcPath(d) : '');

        // Update arc labels
        updateArcLabels();

        // Update nodes
        nodeGroup.selectAll('circle').each(function() {
          const el = d3.select(this);
          const node = el.datum() as GlobeNode;
          if (!node) return;
          const pos = projection([node.lng, node.lat]);
          if (pos) {
            el.attr('cx', pos[0]).attr('cy', pos[1]);
          }
        });
      });

    // Store zoom behavior for programmatic control
    zoomBehaviorRef.current = zoom;
    svg.call(drag as any).call(zoom as any);

    // Initialize zoom transform with current scale to enable programmatic control immediately
    svg.call(zoom.transform as any, d3.zoomIdentity.scale(flatTransformRef.current.k));

    // Pre-create particle elements for smooth animation
    const particleElements: { main: any; trails: any[] }[] = [];
    particlesRef.current.forEach((p) => {
      const main = particleGroup.append('circle')
        .attr('r', 3)
        .attr('fill', p.arc.color)
        .attr('opacity', 0);

      const trails: any[] = [];
      for (let i = 0; i < 3; i++) {
        trails.push(
          particleGroup.append('circle')
            .attr('r', 2 - i * 0.4)
            .attr('fill', p.arc.color)
            .attr('opacity', 0)
        );
      }
      particleElements.push({ main, trails });
    });

    // Animation loop
    const animate = () => {
      if (paused) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      // Update expiring nodes fade progress (2D)
      const fadeSpeed = 0.03;
      expiringNodesRef.current.forEach((data, id) => {
        data.fadeProgress -= fadeSpeed;
        if (data.fadeProgress <= 0) {
          expiringNodesRef.current.delete(id);
        } else {
          // Update node opacity in the DOM
          nodeGroup.selectAll('circle').each(function() {
            const el = d3.select(this);
            const node = el.datum() as any;
            if (node && node.id === id) {
              const currentOpacity = parseFloat(el.attr('opacity') || '1');
              if (currentOpacity > 0.2) {
                el.attr('opacity', data.fadeProgress);
              } else {
                el.attr('opacity', 0.2 * data.fadeProgress);
              }
            }
          });
        }
      });

      particlesRef.current.forEach((p, idx) => {
        p.progress += p.speed;
        if (p.progress > 1) {
          p.progress = 0;
          p.speed = 0.003 + Math.random() * 0.004;
        }

        const arc = p.arc;
        const source = projection([arc.startLng, arc.startLat]);
        const target = projection([arc.endLng, arc.endLat]);
        const elements = particleElements[idx];

        if (!source || !target || !elements) {
          if (elements) {
            elements.main.attr('opacity', 0);
            elements.trails.forEach(t => t.attr('opacity', 0));
          }
          return;
        }

        const midX = (source[0] + target[0]) / 2;
        const midY = (source[1] + target[1]) / 2;
        const dx = target[0] - source[0];
        const dy = target[1] - source[1];
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return;
        const curvature = Math.min(dist * 0.3, 100);
        const nx = -dy / dist;
        const ny = dx / dist;
        const ctrlX = midX + nx * curvature;
        const ctrlY = midY - Math.abs(ny * curvature);

        const t = p.progress;
        const x = (1-t)*(1-t)*source[0] + 2*(1-t)*t*ctrlX + t*t*target[0];
        const y = (1-t)*(1-t)*source[1] + 2*(1-t)*t*ctrlY + t*t*target[1];

        elements.main.attr('cx', x).attr('cy', y).attr('opacity', 0.8);

        for (let i = 0; i < elements.trails.length; i++) {
          const tt = Math.max(0, t - (i + 1) * 0.02);
          const tx = (1-tt)*(1-tt)*source[0] + 2*(1-tt)*tt*ctrlX + tt*tt*target[0];
          const ty = (1-tt)*(1-tt)*source[1] + 2*(1-tt)*tt*ctrlY + tt*tt*target[1];
          elements.trails[i].attr('cx', tx).attr('cy', ty).attr('opacity', 0.4 - i * 0.1);
        }
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [worldData, effectiveWidth, height, nodes, arcs, loading, paused, globeMode, graph.timestamp, mapColors, handleNodeDoubleClick, focusOnNode]);

  // Render 3D globe
  useEffect(() => {
    if (!svgRef.current || !worldData || loading || globeMode !== '3d') {
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const currentWidth = effectiveWidthRef.current;
    const minDim = Math.min(currentWidth, height);
    const baseScale = minDim / 2.2;

    // Orthographic projection for 3D globe
    const projection = d3.geoOrthographic()
      .scale(baseScale * scaleRef.current)
      .translate([currentWidth / 2, height / 2])
      .rotate(rotationRef.current)
      .clipAngle(90);
    projectionRef.current = projection;

    const pathGenerator = d3.geoPath().projection(projection);

    // Defs for gradients
    const defs = svg.append('defs');

    const globeGradient = defs.append('radialGradient')
      .attr('id', 'globe-gradient')
      .attr('cx', '30%')
      .attr('cy', '30%');
    globeGradient.append('stop').attr('offset', '0%').attr('stop-color', mapColors.stroke);
    globeGradient.append('stop').attr('offset', '100%').attr('stop-color', mapColors.background);

    // Inner atmosphere glow (close to globe surface)
    const atmosphereGradient = defs.append('radialGradient')
      .attr('id', 'atmosphere-gradient')
      .attr('cx', '50%')
      .attr('cy', '50%');
    atmosphereGradient.append('stop').attr('offset', '0%').attr('stop-color', '#00d4ff').attr('stop-opacity', '0');
    atmosphereGradient.append('stop').attr('offset', '75%').attr('stop-color', '#00d4ff').attr('stop-opacity', '0');
    atmosphereGradient.append('stop').attr('offset', '85%').attr('stop-color', '#00d4ff').attr('stop-opacity', '0.08');
    atmosphereGradient.append('stop').attr('offset', '92%').attr('stop-color', '#00aaff').attr('stop-opacity', '0.15');
    atmosphereGradient.append('stop').attr('offset', '97%').attr('stop-color', '#0066cc').attr('stop-opacity', '0.08');
    atmosphereGradient.append('stop').attr('offset', '100%').attr('stop-color', '#003366').attr('stop-opacity', '0');

    // Outer atmosphere haze (wider glow)
    const outerAtmosphereGradient = defs.append('radialGradient')
      .attr('id', 'outer-atmosphere-gradient')
      .attr('cx', '50%')
      .attr('cy', '50%');
    outerAtmosphereGradient.append('stop').attr('offset', '0%').attr('stop-color', '#00d4ff').attr('stop-opacity', '0');
    outerAtmosphereGradient.append('stop').attr('offset', '60%').attr('stop-color', '#00d4ff').attr('stop-opacity', '0');
    outerAtmosphereGradient.append('stop').attr('offset', '75%').attr('stop-color', '#00aaff').attr('stop-opacity', '0.03');
    outerAtmosphereGradient.append('stop').attr('offset', '90%').attr('stop-color', '#0088cc').attr('stop-opacity', '0.05');
    outerAtmosphereGradient.append('stop').attr('offset', '100%').attr('stop-color', '#004466').attr('stop-opacity', '0');

    // Background
    svg.append('rect')
      .attr('width', currentWidth)
      .attr('height', height)
      .attr('fill', mapColors.background);

    // Starfield background (if enabled)
    if (geoipConfig.show_starfield !== false) {
      const starGroup = svg.append('g').attr('class', 'starfield');
      // Use seeded random for consistent star positions
      const seededRandom = (seed: number) => {
        const x = Math.sin(seed) * 10000;
        return x - Math.floor(x);
      };
      const numStars = 200;
      for (let i = 0; i < numStars; i++) {
        const x = seededRandom(i * 1.1) * currentWidth;
        const y = seededRandom(i * 2.3) * height;
        const size = seededRandom(i * 3.7) * 1.5 + 0.5;
        const opacity = seededRandom(i * 4.9) * 0.6 + 0.2;
        const isBlue = seededRandom(i * 5.1) > 0.8;
        starGroup.append('circle')
          .attr('cx', x)
          .attr('cy', y)
          .attr('r', size)
          .attr('fill', isBlue ? '#aaccff' : '#ffffff')
          .attr('opacity', opacity);
      }
      // Add a few brighter "twinkling" stars
      for (let i = 0; i < 15; i++) {
        const x = seededRandom(i * 7.3 + 100) * currentWidth;
        const y = seededRandom(i * 8.9 + 100) * height;
        starGroup.append('circle')
          .attr('cx', x)
          .attr('cy', y)
          .attr('r', 1.5)
          .attr('fill', '#ffffff')
          .attr('opacity', 0.9)
          .style('filter', 'blur(0.5px)');
      }
    }

    // Outer atmosphere haze (wider, softer glow)
    svg.append('circle')
      .attr('class', 'globe-outer-atmosphere')
      .attr('cx', currentWidth / 2)
      .attr('cy', height / 2)
      .attr('r', baseScale * scaleRef.current + 55)
      .attr('fill', 'url(#outer-atmosphere-gradient)')
      .style('filter', 'blur(10px)');

    // Inner atmosphere (close to surface)
    svg.append('circle')
      .attr('class', 'globe-atmosphere')
      .attr('cx', currentWidth / 2)
      .attr('cy', height / 2)
      .attr('r', baseScale * scaleRef.current + 25)
      .attr('fill', 'url(#atmosphere-gradient)')
      .style('filter', 'blur(3px)');

    // Globe base
    svg.append('circle')
      .attr('class', 'globe-base')
      .attr('cx', currentWidth / 2)
      .attr('cy', height / 2)
      .attr('r', baseScale * scaleRef.current)
      .attr('fill', 'url(#globe-gradient)')
      .attr('stroke', mapColors.stroke)
      .attr('stroke-width', 1);

    const globeGroup = svg.append('g').attr('class', 'globe-content');

    // Graticule
    const graticule = d3.geoGraticule().step([15, 15]);
    globeGroup.append('path')
      .datum(graticule())
      .attr('d', pathGenerator as any)
      .attr('fill', 'none')
      .attr('stroke', mapColors.graticule)
      .attr('stroke-width', 0.3)
      .attr('stroke-opacity', 0.5);

    // Countries
    const countries = topojson.feature(worldData, worldData.objects.countries);
    globeGroup.append('g')
      .attr('class', 'countries')
      .selectAll('path')
      .data(countries.features)
      .enter()
      .append('path')
      .attr('d', pathGenerator as any)
      .attr('fill', mapColors.landFill)
      .attr('stroke', mapColors.landStroke)
      .attr('stroke-width', 0.5);

    const arcGroup = globeGroup.append('g').attr('class', 'arcs');

    // Helper to check if a point is on the visible side of the globe
    const isPointVisible = (coord: [number, number]): boolean => {
      const rotated = d3.geoRotation(rotationRef.current)(coord);
      return rotated[0] >= -90 && rotated[0] <= 90;
    };

    // Draw arcs using east-west interpolation with visibility culling (including expiring ones)
    arcs.forEach(arc => {
      const interpolate = geoInterpolateEastWest(
        [arc.startLng, arc.startLat],
        [arc.endLng, arc.endLat]
      );

      const arcPoints: [number, number][] = [];
      const numPoints = 50;
      for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        arcPoints.push(interpolate(t));
      }

      // Line generator that only draws visible segments
      const lineGenerator = d3.line<[number, number]>()
        .x(d => { const p = projection(d); return p ? p[0] : 0; })
        .y(d => { const p = projection(d); return p ? p[1] : 0; })
        .defined(d => {
          const p = projection(d);
          return p !== null && isPointVisible(d);
        })
        .curve(d3.curveCatmullRom);

      arcGroup.append('path')
        .datum(arcPoints)
        .attr('d', lineGenerator)
        .attr('fill', 'none')
        .attr('stroke', arc.color)
        .attr('stroke-width', Math.max(1.5, Math.log10(arc.value + 1) * 0.8))
        .attr('stroke-opacity', 0.5)
        .attr('stroke-linecap', 'round');

      // Draw arc label at midpoint (3D globe)
      if (arc.label) {
        const midPoint = interpolate(0.5);
        const beforePoint = interpolate(0.45);
        const afterPoint = interpolate(0.55);
        const midPos = projection(midPoint);
        const midVisible = isPointVisible(midPoint);
        if (midPos && midVisible) {
          const beforePos = projection(beforePoint);
          const afterPos = projection(afterPoint);

          let angle = 0;
          if (beforePos && afterPos) {
            const dx = afterPos[0] - beforePos[0];
            const dy = afterPos[1] - beforePos[1];
            angle = Math.atan2(dy, dx) * (180 / Math.PI);
            // Flip text if upside down
            if (angle > 90 || angle < -90) {
              angle += 180;
            }
          }

          arcGroup.append('text')
            .datum({ midPoint, beforePoint, afterPoint })
            .attr('class', 'arc-label')
            .attr('x', midPos[0])
            .attr('y', midPos[1])
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('fill', '#ffffff')
            .attr('font-size', '10px')
            .attr('opacity', 0.8)
            .attr('transform', `rotate(${angle}, ${midPos[0]}, ${midPos[1]})`)
            .text(arc.label);
        }
      }
    });

    const particleGroup = globeGroup.append('g').attr('class', 'particles');
    const nodeGroup = globeGroup.append('g').attr('class', 'nodes');

    // Draw nodes (including expiring ones with fade effect)
    allNodes.forEach(node => {
      // Skip nodes with invalid coordinates
      if (node.lng === undefined || node.lat === undefined ||
          !isFinite(node.lng) || !isFinite(node.lat)) return;

      const pos = projection([node.lng, node.lat]);
      if (!pos || !isFinite(pos[0]) || !isFinite(pos[1])) return;

      const rotated = d3.geoRotation(rotationRef.current)([node.lng, node.lat]);
      const isVisible = rotated[0] >= -90 && rotated[0] <= 90;
      const fadeProgress = node.fadeProgress ?? 1;

      // Clamp radius to reasonable bounds to prevent rendering issues
      const total = (node.totalIn || 0) + (node.totalOut || 0);
      const rawRadius = 5 + Math.log10(total + 1) * 2.5;
      const radius = Math.min(Math.max(rawRadius, 3), 25);

      // Glow circle - attach node data for zoom updates
      nodeGroup.append('circle')
        .datum(node)
        .attr('class', 'node-glow')
        .attr('cx', pos[0])
        .attr('cy', pos[1])
        .attr('r', radius + 6)
        .attr('fill', node.color)
        .attr('opacity', isVisible ? 0.25 * fadeProgress : 0);

      // Main circle - attach node data for zoom updates
      nodeGroup.append('circle')
        .datum(node)
        .attr('class', 'node-main')
        .attr('cx', pos[0])
        .attr('cy', pos[1])
        .attr('r', radius)
        .attr('fill', node.color)
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.6 * fadeProgress)
        .attr('opacity', isVisible ? fadeProgress : 0)
        .style('cursor', 'pointer')
        .style('filter', isVisible && fadeProgress > 0.5 ? 'drop-shadow(0 0 3px ' + node.color + ')' : 'none')
        .on('mouseenter', function(event) {
          const rect = svgRef.current?.getBoundingClientRect();
          if (rect) {
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            // Calculate fixed card position for 3D mode
            const tooltipWidth = 260;
            const tooltipHeight = 180;
            const margin = 20;
            const lineOffset = 40;
            const centerX = currentWidth / 2;
            const centerY = height / 2;
            const placeRight = x < centerX;
            const placeBottom = y < centerY;
            const cardX = placeRight
              ? Math.min(x + lineOffset + 60, currentWidth - tooltipWidth - margin)
              : Math.max(x - lineOffset - 60 - tooltipWidth, margin);
            const cardY = placeBottom
              ? Math.min(y + lineOffset + 20, height - tooltipHeight - margin)
              : Math.max(y - lineOffset - 20 - tooltipHeight, margin);
            setTooltip({ visible: true, x, y, node, cardX, cardY });
          }
        })
        .on('mousemove', function(event) {
          // In 3D mode, position will be tracked via projection, only update on explicit mouse move
          const rect = svgRef.current?.getBoundingClientRect();
          if (rect) {
            setTooltip(prev => ({
              ...prev,
              x: event.clientX - rect.left,
              y: event.clientY - rect.top
            }));
          }
        })
        .on('mouseleave', function() {
          setTooltip({ visible: false, x: 0, y: 0, node: null });
        })
        .on('dblclick', function(event) {
          event.preventDefault();
          event.stopPropagation();
          handleNodeDoubleClick(node);
        })
        .on('contextmenu', function(event) {
          event.preventDefault();
          const rect = svgRef.current?.getBoundingClientRect();
          if (rect) {
            setContextMenu({
              visible: true,
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
              node
            });
          }
        });
    });

    // Helper to update 3D arc labels
    const update3DArcLabels = () => {
      arcGroup.selectAll('text.arc-label').each(function() {
        const el = d3.select(this);
        const data = el.datum() as { midPoint: [number, number]; beforePoint: [number, number]; afterPoint: [number, number] };
        if (!data || !data.midPoint) return;

        const pos = projection(data.midPoint);
        const visible = isPointVisible(data.midPoint);

        if (!pos || !visible) {
          el.attr('opacity', 0);
          return;
        }

        // Recalculate angle based on before/after points
        const beforePos = projection(data.beforePoint);
        const afterPos = projection(data.afterPoint);
        let angle = 0;
        if (beforePos && afterPos) {
          const dx = afterPos[0] - beforePos[0];
          const dy = afterPos[1] - beforePos[1];
          angle = Math.atan2(dy, dx) * (180 / Math.PI);
          // Flip text if upside down
          if (angle > 90 || angle < -90) {
            angle += 180;
          }
        }

        el.attr('x', pos[0])
          .attr('y', pos[1])
          .attr('transform', `rotate(${angle}, ${pos[0]}, ${pos[1]})`)
          .attr('opacity', 0.8);
      });
    };

    // Drag behavior
    let dragStartRotation: [number, number, number] = [...rotationRef.current];
    const drag = d3.drag<SVGSVGElement, unknown>()
      .on('start', () => {
        dragStartRotation = [...rotationRef.current];
      })
      .on('drag', (event) => {
        const sensitivity = 0.5 / scaleRef.current;
        rotationRef.current = [
          dragStartRotation[0] + event.dx * sensitivity,
          Math.max(-90, Math.min(90, dragStartRotation[1] - event.dy * sensitivity)),
          0
        ];
        dragStartRotation = [...rotationRef.current];
        projection.rotate(rotationRef.current);

        globeGroup.selectAll('.countries path, .globe-content > path').attr('d', pathGenerator as any);

        arcGroup.selectAll('path').attr('d', (d: any) => {
          if (!Array.isArray(d)) return null;
          const lineGenerator = d3.line<[number, number]>()
            .x(p => { const pt = projection(p); return pt ? pt[0] : 0; })
            .y(p => { const pt = projection(p); return pt ? pt[1] : 0; })
            .defined(p => {
              const pt = projection(p);
              return pt !== null && isPointVisible(p);
            })
            .curve(d3.curveCatmullRom);
          return lineGenerator(d);
        });

        // Update arc labels
        update3DArcLabels();

        // Update node positions using attached datum
        nodeGroup.selectAll('circle').each(function() {
          const el = d3.select(this);
          const node = el.datum() as GlobeNode;
          if (!node || !node.lng || !node.lat) return;

          const pos = projection([node.lng, node.lat]);
          if (!pos) return;

          const visible = isPointVisible([node.lng, node.lat]);
          const isGlow = el.attr('class') === 'node-glow';

          el.attr('cx', pos[0])
            .attr('cy', pos[1])
            .attr('opacity', visible ? (isGlow ? 0.25 : 1) : 0);
        });
      });

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 16])
      .on('zoom', (event) => {
        scaleRef.current = event.transform.k;
        setGlobeZoomLevel(event.transform.k);
        projection.scale(baseScale * scaleRef.current);

        svg.select('.globe-outer-atmosphere').attr('r', baseScale * scaleRef.current + 55);
        svg.select('.globe-atmosphere').attr('r', baseScale * scaleRef.current + 25);
        svg.select('.globe-base').attr('r', baseScale * scaleRef.current);

        globeGroup.selectAll('.countries path, .globe-content > path').attr('d', pathGenerator as any);

        arcGroup.selectAll('path').attr('d', (d: any) => {
          if (!Array.isArray(d)) return null;
          const lineGenerator = d3.line<[number, number]>()
            .x(p => { const pt = projection(p); return pt ? pt[0] : 0; })
            .y(p => { const pt = projection(p); return pt ? pt[1] : 0; })
            .defined(p => {
              const pt = projection(p);
              return pt !== null && isPointVisible(p);
            })
            .curve(d3.curveCatmullRom);
          return lineGenerator(d);
        });

        // Update arc labels
        update3DArcLabels();

        // Update node positions using attached datum
        nodeGroup.selectAll('circle').each(function() {
          const el = d3.select(this);
          const node = el.datum() as GlobeNode;
          if (!node || node.lng === undefined || node.lat === undefined) {
            el.attr('opacity', 0);
            return;
          }

          const pos = projection([node.lng, node.lat]);
          if (!pos || !isFinite(pos[0]) || !isFinite(pos[1])) {
            el.attr('opacity', 0);
            return;
          }

          const rotated = d3.geoRotation(rotationRef.current)([node.lng, node.lat]);
          const isVisible = rotated[0] >= -90 && rotated[0] <= 90;
          const isGlow = el.attr('class') === 'node-glow';

          el.attr('cx', pos[0])
            .attr('cy', pos[1])
            .attr('opacity', isVisible ? (isGlow ? 0.25 : 1) : 0);
        });
      });

    globeZoomBehaviorRef.current = zoom;
    svg.call(drag as any).call(zoom as any);

    // Initialize zoom transform with current scale to enable programmatic control immediately
    svg.call(zoom.transform as any, d3.zoomIdentity.scale(scaleRef.current));

    // Pre-create particle elements for smooth animation
    const particleElements: { main: any; trails: any[] }[] = [];
    particlesRef.current.forEach((p, idx) => {
      const main = particleGroup.append('circle')
        .attr('r', 4)
        .attr('fill', p.arc.color)
        .attr('opacity', 0)
        .style('will-change', 'transform');

      const trails: any[] = [];
      for (let i = 0; i < 3; i++) {
        trails.push(
          particleGroup.append('circle')
            .attr('r', 3 - i * 0.7)
            .attr('fill', p.arc.color)
            .attr('opacity', 0)
            .style('will-change', 'transform')
        );
      }
      particleElements[idx] = { main, trails };
    });

    // Animation loop with frame counter for throttling
    let frameCount = 0;
    const animate = () => {
      if (paused) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      frameCount++;

      // Auto-rotate globe (throttle to every 3rd frame = ~20fps)
      if (autoRotateRef.current && frameCount % 3 === 0) {
        const rotateSpeed = 0.15;  // degrees per update (slower updates, larger steps)
        rotationRef.current = [
          rotationRef.current[0] - rotateSpeed,
          rotationRef.current[1],
          rotationRef.current[2]
        ];
        projection.rotate(rotationRef.current);

        // Update map paths
        globeGroup.selectAll('.countries path, .globe-content > path').attr('d', pathGenerator as any);

        // Update arcs
        arcGroup.selectAll('path').attr('d', (d: any) => {
          if (!Array.isArray(d)) return null;
          const lineGen = d3.line<[number, number]>()
            .x(p => { const pt = projection(p); return pt ? pt[0] : 0; })
            .y(p => { const pt = projection(p); return pt ? pt[1] : 0; })
            .defined(p => {
              const pt = projection(p);
              return pt !== null && isPointVisible(p);
            })
            .curve(d3.curveCatmullRom);
          return lineGen(d);
        });

        // Update arc labels
        update3DArcLabels();

        // Update nodes
        nodeGroup.selectAll('circle').each(function() {
          const el = d3.select(this);
          const node = el.datum() as GlobeNode;
          if (!node || node.lng === undefined || node.lat === undefined) return;

          const pos = projection([node.lng, node.lat]);
          if (!pos || !isFinite(pos[0]) || !isFinite(pos[1])) {
            el.attr('opacity', 0);
            return;
          }

          const visible = isPointVisible([node.lng, node.lat]);
          const isGlow = el.attr('class') === 'node-glow';

          el.attr('cx', pos[0])
            .attr('cy', pos[1])
            .attr('opacity', visible ? (isGlow ? 0.25 : 1) : 0);
        });
      }

      // Update expiring nodes fade progress (3D)
      const fadeSpeed = 0.03;
      expiringNodesRef.current.forEach((data, id) => {
        const node = data.node;
        // Check if node is on the back side of the globe (not visible)
        if (node.lng !== undefined && node.lat !== undefined) {
          const rotated = d3.geoRotation(rotationRef.current)([node.lng, node.lat]);
          const isVisible = rotated[0] >= -90 && rotated[0] <= 90;
          // If node is not visible, skip fade effect and remove immediately
          if (!isVisible) {
            expiringNodesRef.current.delete(id);
            return;
          }
        }

        data.fadeProgress -= fadeSpeed;
        if (data.fadeProgress <= 0) {
          expiringNodesRef.current.delete(id);
        } else {
          // Update node opacity in the DOM
          nodeGroup.selectAll('circle').each(function() {
            const el = d3.select(this);
            const nodeData = el.datum() as any;
            if (nodeData && nodeData.id === id) {
              const isGlow = el.attr('class') === 'node-glow';
              el.attr('opacity', isGlow ? 0.25 * data.fadeProgress : data.fadeProgress);
            }
          });
        }
      });

      particlesRef.current.forEach((p, idx) => {
        p.progress += p.speed;
        if (p.progress > 1) {
          p.progress = 0;
          p.speed = 0.003 + Math.random() * 0.004;
        }

        const arc = p.arc;
        const interpolate = geoInterpolateEastWest(
          [arc.startLng, arc.startLat],
          [arc.endLng, arc.endLat]
        );

        const [lng, lat] = interpolate(p.progress);
        const pos = projection([lng, lat]);
        const elements = particleElements[idx];
        if (!elements) return;

        const rotated = d3.geoRotation(rotationRef.current)([lng, lat]);
        const visible = pos && rotated[0] >= -90 && rotated[0] <= 90;

        if (visible && pos) {
          elements.main
            .attr('cx', pos[0])
            .attr('cy', pos[1])
            .attr('opacity', 0.9);

          for (let i = 0; i < elements.trails.length; i++) {
            const tt = Math.max(0, p.progress - (i + 1) * 0.02);
            const [tlng, tlat] = interpolate(tt);
            const tpos = projection([tlng, tlat]);
            const trotated = d3.geoRotation(rotationRef.current)([tlng, tlat]);
            const tvisible = tpos && trotated[0] >= -90 && trotated[0] <= 90;

            if (tvisible && tpos) {
              elements.trails[i]
                .attr('cx', tpos[0])
                .attr('cy', tpos[1])
                .attr('opacity', 0.4 - i * 0.1);
            } else {
              elements.trails[i].attr('opacity', 0);
            }
          }
        } else {
          elements.main.attr('opacity', 0);
          elements.trails.forEach(t => t.attr('opacity', 0));
        }
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [worldData, effectiveWidth, height, nodes, arcs, loading, paused, globeMode, graph.timestamp, mapColors, geoipConfig.show_starfield, handleNodeDoubleClick, focusOnNode]);

  // Smooth 2D zoom animation helper
  const animate2DZoom = useCallback((targetK: number, targetX?: number, targetY?: number) => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    const svg = d3.select(svgRef.current);

    const startK = flatTransformRef.current.k;
    const startX = flatTransformRef.current.x;
    const startY = flatTransformRef.current.y;
    const endX = targetX ?? startX;
    const endY = targetY ?? startY;

    const duration = 300;
    const startTime = performance.now();

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease out cubic

      const currentK = startK + (targetK - startK) * eased;
      const currentX = startX + (endX - startX) * eased;
      const currentY = startY + (endY - startY) * eased;

      flatTransformRef.current = { x: currentX, y: currentY, k: currentK };
      setZoomLevel(currentK);

      svg.call(
        zoomBehaviorRef.current!.transform as any,
        d3.zoomIdentity.translate(currentX, currentY).scale(currentK)
      );

      if (t < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, []);

  // Zoom control handlers for 2D map - with smooth animation
  const handle2DZoomTo = useCallback((level: number) => {
    animate2DZoom(level);
  }, [animate2DZoom]);

  const handle2DZoomIn = useCallback(() => {
    const newK = Math.min(16, flatTransformRef.current.k * 1.5);
    animate2DZoom(newK);
  }, [animate2DZoom]);

  const handle2DZoomOut = useCallback(() => {
    const newK = Math.max(0.3, flatTransformRef.current.k / 1.5);
    animate2DZoom(newK);
  }, [animate2DZoom]);

  const handle2DZoomReset = useCallback(() => {
    animate2DZoom(1, 0, 0);
    setFocusedNodeId(null);
  }, [animate2DZoom]);

  // Smooth 3D zoom animation helper
  const animate3DZoom = useCallback((targetK: number) => {
    if (!svgRef.current || !globeZoomBehaviorRef.current) return;
    const svg = d3.select(svgRef.current);

    const startK = scaleRef.current;
    const duration = 300;
    const startTime = performance.now();

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease out cubic

      const currentK = startK + (targetK - startK) * eased;
      scaleRef.current = currentK;
      setGlobeZoomLevel(currentK);

      svg.call(globeZoomBehaviorRef.current!.transform as any, d3.zoomIdentity.scale(currentK));

      if (t < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, []);

  // Zoom control handlers for 3D globe - with smooth animation
  const handle3DZoomTo = useCallback((level: number) => {
    animate3DZoom(level);
  }, [animate3DZoom]);

  const handle3DZoomIn = useCallback(() => {
    const newK = Math.min(8, scaleRef.current * 1.3);
    animate3DZoom(newK);
  }, [animate3DZoom]);

  const handle3DZoomOut = useCallback(() => {
    const newK = Math.max(0.5, scaleRef.current / 1.3);
    animate3DZoom(newK);
  }, [animate3DZoom]);

  // Pan handlers for 2D map - using existing animation helper
  const panAmount2D = 50;
  const handle2DPanUp = useCallback(() => {
    const newY = flatTransformRef.current.y + panAmount2D;
    animate2DZoom(flatTransformRef.current.k, flatTransformRef.current.x, newY);
  }, [animate2DZoom]);

  const handle2DPanDown = useCallback(() => {
    const newY = flatTransformRef.current.y - panAmount2D;
    animate2DZoom(flatTransformRef.current.k, flatTransformRef.current.x, newY);
  }, [animate2DZoom]);

  const handle2DPanLeft = useCallback(() => {
    const newX = flatTransformRef.current.x + panAmount2D;
    animate2DZoom(flatTransformRef.current.k, newX, flatTransformRef.current.y);
  }, [animate2DZoom]);

  const handle2DPanRight = useCallback(() => {
    const newX = flatTransformRef.current.x - panAmount2D;
    animate2DZoom(flatTransformRef.current.k, newX, flatTransformRef.current.y);
  }, [animate2DZoom]);

  // Pan handlers for 3D globe - rotate the globe
  const panAmount3D = 10; // degrees
  const animate3DRotation = useCallback((targetRotation: [number, number, number]) => {
    if (!projectionRef.current) return;

    const startRotation = [...rotationRef.current] as [number, number, number];
    const duration = 200;
    const startTime = performance.now();

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease out cubic

      rotationRef.current = [
        startRotation[0] + (targetRotation[0] - startRotation[0]) * eased,
        startRotation[1] + (targetRotation[1] - startRotation[1]) * eased,
        startRotation[2] + (targetRotation[2] - startRotation[2]) * eased
      ];

      if (projectionRef.current) {
        projectionRef.current.rotate(rotationRef.current);
      }

      if (t < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, []);

  const handle3DPanUp = useCallback(() => {
    // Pan up = rotate latitude (second element) negative (look up)
    const newLat = Math.max(-90, rotationRef.current[1] - panAmount3D);
    animate3DRotation([rotationRef.current[0], newLat, rotationRef.current[2]]);
  }, [animate3DRotation]);

  const handle3DPanDown = useCallback(() => {
    // Pan down = rotate latitude (second element) positive (look down)
    const newLat = Math.min(90, rotationRef.current[1] + panAmount3D);
    animate3DRotation([rotationRef.current[0], newLat, rotationRef.current[2]]);
  }, [animate3DRotation]);

  const handle3DPanLeft = useCallback(() => {
    // Pan left = rotate longitude (first element) negative
    animate3DRotation([rotationRef.current[0] - panAmount3D, rotationRef.current[1], rotationRef.current[2]]);
  }, [animate3DRotation]);

  const handle3DPanRight = useCallback(() => {
    // Pan right = rotate longitude (first element) positive
    animate3DRotation([rotationRef.current[0] + panAmount3D, rotationRef.current[1], rotationRef.current[2]]);
  }, [animate3DRotation]);

  const handle3DZoomReset = useCallback(() => {
    if (!svgRef.current || !globeZoomBehaviorRef.current || !projectionRef.current) return;
    const svg = d3.select(svgRef.current);

    // Smooth animation to default rotation and zoom
    const targetRotation: [number, number, number] = [
      -(geoipConfig.internal_fallback_lng || 0),
      -(geoipConfig.internal_fallback_lat || 0),
      0
    ];
    const startRotation = [...rotationRef.current] as [number, number, number];
    const startScale = scaleRef.current;

    const duration = 500;
    const startTime = performance.now();

    const animateReset = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease out cubic

      rotationRef.current = [
        startRotation[0] + (targetRotation[0] - startRotation[0]) * eased,
        startRotation[1] + (targetRotation[1] - startRotation[1]) * eased,
        0
      ];

      if (projectionRef.current) {
        projectionRef.current.rotate(rotationRef.current);
      }

      const newScale = startScale + (1 - startScale) * eased;
      scaleRef.current = newScale;
      setGlobeZoomLevel(newScale);

      svg.call(globeZoomBehaviorRef.current!.transform as any, d3.zoomIdentity.scale(newScale));

      if (t < 1) {
        requestAnimationFrame(animateReset);
      } else {
        setFocusedNodeId(null);
      }
    };

    requestAnimationFrame(animateReset);
  }, [geoipConfig.internal_fallback_lat, geoipConfig.internal_fallback_lng]);

  // Register zoom and pan handlers for keyboard shortcuts (based on current mode)
  useEffect(() => {
    if (globeMode === '2d') {
      if (zoomInRef) zoomInRef.current = handle2DZoomIn;
      if (zoomOutRef) zoomOutRef.current = handle2DZoomOut;
      if (zoomResetRef) zoomResetRef.current = handle2DZoomReset;
      if (panUpRef) panUpRef.current = handle2DPanUp;
      if (panDownRef) panDownRef.current = handle2DPanDown;
      if (panLeftRef) panLeftRef.current = handle2DPanLeft;
      if (panRightRef) panRightRef.current = handle2DPanRight;
    } else {
      if (zoomInRef) zoomInRef.current = handle3DZoomIn;
      if (zoomOutRef) zoomOutRef.current = handle3DZoomOut;
      if (zoomResetRef) zoomResetRef.current = handle3DZoomReset;
      if (panUpRef) panUpRef.current = handle3DPanUp;
      if (panDownRef) panDownRef.current = handle3DPanDown;
      if (panLeftRef) panLeftRef.current = handle3DPanLeft;
      if (panRightRef) panRightRef.current = handle3DPanRight;
    }
    return () => {
      if (zoomInRef) zoomInRef.current = null;
      if (zoomOutRef) zoomOutRef.current = null;
      if (zoomResetRef) zoomResetRef.current = null;
      if (panUpRef) panUpRef.current = null;
      if (panDownRef) panDownRef.current = null;
      if (panLeftRef) panLeftRef.current = null;
      if (panRightRef) panRightRef.current = null;
    };
  }, [globeMode, handle2DZoomIn, handle2DZoomOut, handle2DZoomReset, handle2DPanUp, handle2DPanDown, handle2DPanLeft, handle2DPanRight, handle3DZoomIn, handle3DZoomOut, handle3DZoomReset, handle3DPanUp, handle3DPanDown, handle3DPanLeft, handle3DPanRight, zoomInRef, zoomOutRef, zoomResetRef, panUpRef, panDownRef, panLeftRef, panRightRef]);

  if (loading) {
    return (
      <div className="globe-empty-state">
        <h3>{t('globe.loading')}</h3>
      </div>
    );
  }

  if (error) {
    return (
      <div className="globe-empty-state">
        <h3>Map Error</h3>
        <p style={{ color: '#ff6b6b' }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="globe-container" style={{ width, height, background: mapColors.background, display: 'flex' }}>
      <div style={{ position: 'relative', width: effectiveWidth, height, transition: 'width 0.3s ease' }}>
        <svg
          ref={svgRef}
          width={effectiveWidth}
          height={height}
          style={{ cursor: 'grab' }}
          onMouseDown={() => {
            // Dismiss tooltip/context menu on any mouse down (more reliable than click alone)
            setTooltip({ visible: false, x: 0, y: 0, node: null });
            setContextMenu({ visible: false, x: 0, y: 0, node: null });
          }}
          onDoubleClick={() => {
            // Double-click on empty area resets view (node double-clicks stop propagation)
            if (focusedNodeId) {
              resetView();
            }
          }}
        />

      {/* Zoom controls for 2D map mode */}
      {globeMode === '2d' && (
        <ZoomControls
          zoomLevel={zoomLevel}
          onZoomIn={handle2DZoomIn}
          onZoomOut={handle2DZoomOut}
          onZoomReset={handle2DZoomReset}
          onZoomTo={handle2DZoomTo}
          presets={[0.5, 1, 2, 5, 10, 20]}
          minZoom={0.3}
          maxZoom={50}
        />
      )}

      {/* Zoom controls for 3D globe mode */}
      {globeMode === '3d' && (
        <ZoomControls
          zoomLevel={globeZoomLevel}
          onZoomIn={handle3DZoomIn}
          onZoomOut={handle3DZoomOut}
          onZoomReset={handle3DZoomReset}
          onZoomTo={handle3DZoomTo}
          presets={[0.5, 1, 2, 4, 8]}
          minZoom={0.5}
          maxZoom={8}
        />
      )}

        {/* Stats Toggle Button */}
        <button
          className={`flow-stats-toggle ${showCountryStats ? 'active' : ''}`}
          onClick={() => setShowCountryStats(!showCountryStats)}
          title={t('globe.stats')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="14" width="4" height="6" rx="1" fill="currentColor" opacity="0.3" />
            <rect x="10" y="10" width="4" height="10" rx="1" fill="currentColor" opacity="0.5" />
            <rect x="16" y="6" width="4" height="14" rx="1" fill="currentColor" opacity="0.7" />
            <path d="M4 20h16" strokeLinecap="round" />
          </svg>
        </button>

        <div className="globe-stats">
          <div>{t('globe.nodes')}: {nodes.length}</div>
          <div>{t('globe.arcs')}: {arcs.length}</div>
          {nodes.length === 0 && (
            <div style={{ color: '#ffaa00', marginTop: 8 }}>
              {t('globe.noGeoData')}<br/>
              Fields: {geoipConfig.source_field}
            </div>
          )}
        </div>

        {/* Legend - inside wrapper so it moves with effectiveWidth */}
        <div className="legend globe-legend">
          {globeMode === '3d' && onAutoRotateChange && (
            <button
              className={`globe-auto-rotate-btn ${autoRotate ? 'active' : ''}`}
              onClick={() => onAutoRotateChange(!autoRotate)}
              title={t('globe.autoRotate')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            </button>
          )}
          <h4>{globeMode === '3d' ? t('view.3dGlobe') : t('view.2dMap')}</h4>
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#ff6b6b' }} />
            <span>{t('header.external')}</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#00d4ff' }} />
            <span>{t('header.internal')}</span>
          </div>
        </div>

      {tooltip.visible && tooltip.node && (() => {
        const tooltipWidth = 260;
        const tooltipHeight = 180;

        // In 3D mode, calculate current node position from projection
        let nodeX = tooltip.x;
        let nodeY = tooltip.y;
        let isNodeVisible = true;

        if (globeMode === '3d' && projectionRef.current && tooltip.node) {
          // Check if node is on visible side of globe
          const rotated = d3.geoRotation(rotationRef.current)([tooltip.node.lng, tooltip.node.lat]);
          isNodeVisible = rotated[0] >= -90 && rotated[0] <= 90;

          if (isNodeVisible) {
            // Get current screen position from projection
            const pos = projectionRef.current([tooltip.node.lng, tooltip.node.lat]);
            if (pos) {
              nodeX = pos[0];
              nodeY = pos[1];
            }
          }
        }

        // Hide tooltip if node is not visible (rotated to back side)
        if (!isNodeVisible) {
          return null;
        }

        // Use fixed card position if available, otherwise calculate
        const tooltipX = tooltip.cardX ?? nodeX + 100;
        const tooltipY = tooltip.cardY ?? nodeY - 90;

        // Calculate polyline points - line follows node, card stays fixed
        const startX = nodeX;
        const startY = nodeY;
        const cardCenterY = tooltipY + tooltipHeight / 2;

        // Determine line direction based on relative positions
        const lineGoesRight = tooltipX > startX;
        const midX = lineGoesRight ? tooltipX - 8 : tooltipX + tooltipWidth + 8;
        const midY = startY;
        const endX = midX;
        const endY = cardCenterY;

        const lineColor = tooltip.node.color || '#00d4ff';

        return (
          <>
            {/* SVG overlay for connecting line */}
            <svg
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 999,
              }}
            >
              <defs>
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>
              {/* Glow effect line */}
              <polyline
                points={`${startX},${startY} ${midX},${midY} ${endX},${endY}`}
                fill="none"
                stroke={lineColor}
                strokeWidth="2"
                strokeOpacity="0.3"
                filter="url(#glow)"
              />
              {/* Main line */}
              <polyline
                points={`${startX},${startY} ${midX},${midY} ${endX},${endY}`}
                fill="none"
                stroke={lineColor}
                strokeWidth="1"
                strokeOpacity="0.8"
              />
              {/* Start point indicator */}
              <circle cx={startX} cy={startY} r="4" fill={lineColor} fillOpacity="0.8" />
              <circle cx={startX} cy={startY} r="6" fill="none" stroke={lineColor} strokeWidth="1" strokeOpacity="0.4" />
              {/* Corner accent */}
              <circle cx={midX} cy={midY} r="2" fill={lineColor} fillOpacity="0.6" />
            </svg>

            {/* Tooltip card */}
            <div
              className="globe-node-tooltip sci-fi"
              style={{
                position: 'absolute',
                left: tooltipX,
                top: tooltipY,
                width: tooltipWidth,
                pointerEvents: 'none',
                '--accent-color': lineColor,
              } as React.CSSProperties}
            >
              {/* Corner accents */}
              <div className="corner-accent top-left" />
              <div className="corner-accent top-right" />
              <div className="corner-accent bottom-left" />
              <div className="corner-accent bottom-right" />

              {/* Header line decoration */}
              <div className="header-decoration">
                <div className="header-line" style={{ background: lineColor }} />
                <div className="header-dot" style={{ background: lineColor }} />
              </div>

              <div className="tooltip-header" style={{ color: lineColor }}>
                {tooltip.node.isInternal ? t('header.internal') : t('header.external')}
              </div>
              <div className="tooltip-row">
                <span className="tooltip-label">IP:</span>
                <span className="tooltip-value">{tooltip.node.id}</span>
              </div>
              {tooltip.node.label && tooltip.node.label !== tooltip.node.id && (
                <div className="tooltip-row">
                  <span className="tooltip-label">PTR:</span>
                  <span className="tooltip-value wrap">{tooltip.node.label.split('\n')[0]}</span>
                </div>
              )}
              {(tooltip.node.countryCode || tooltip.node.cityName) && (
                <div className="tooltip-row">
                  <span className="tooltip-label">{t('globe.tooltip.location')}:</span>
                  <span className="tooltip-value">
                    {[tooltip.node.cityName, tooltip.node.countryCode].filter(Boolean).join(', ')}
                  </span>
                </div>
              )}
              <div className="tooltip-row">
                <span className="tooltip-label">{t('globe.tooltip.coords')}:</span>
                <span className="tooltip-value">
                  {tooltip.node.lat.toFixed(2)}, {tooltip.node.lng.toFixed(2)}
                </span>
              </div>
              <div className="tooltip-row">
                <span className="tooltip-label">{t('globe.tooltip.in')}:</span>
                <span className="tooltip-value">{formatValue(tooltip.node.totalIn)}</span>
              </div>
              <div className="tooltip-row">
                <span className="tooltip-label">{t('globe.tooltip.out')}:</span>
                <span className="tooltip-value">{formatValue(tooltip.node.totalOut)}</span>
              </div>
            </div>
          </>
        );
      })()}

      {/* Context Menu */}
      {contextMenu.visible && contextMenu.node && (
        <div
          className="context-menu"
          style={{
            position: 'absolute',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000,
          }}
        >
          <button
            onClick={() => {
              if (contextMenu.node) {
                focusOnNode(contextMenu.node);
              }
            }}
          >
            {t('globe.focusOnNode')}
          </button>
        </div>
      )}
      </div>

      {/* Country Stats Panel - Side Panel */}
      {showCountryStats && (
        <div className="flow-stats-panel sci-fi">
          <div className="panel-header">
            <span>COUNTRY TOP {geoipConfig.stats_top_n || 10}</span>
            <span
              className="panel-subtitle clickable"
              onClick={() => setStatsMode(statsMode === 'events' ? 'traffic' : 'events')}
              title="Click to toggle"
            >
              BY {statsMode === 'events' ? 'EVENTS' : 'TRAFFIC'}
            </span>
          </div>
          <div className="flow-stats-list">
            {countryStats.length === 0 ? (
              <div className="no-data">{t('globe.noGeoData')}</div>
            ) : (
              (() => {
                const maxValue = Math.max(...countryStats.map(s => s.value), 1);
                return countryStats.map((stat, index) => (
                  <div key={stat.code} className="flow-stat-row">
                    <span className="flow-rank">{index + 1}</span>
                    <div className="flow-ip-bar">
                      <span className="flow-ip">{stat.code}</span>
                      <div className="flow-bar-wrapper">
                        <div className="flow-bar-inline" style={{ width: `${(stat.value / maxValue) * 100}%` }} />
                      </div>
                    </div>
                    <span className="flow-traffic">{stat.value.toLocaleString()}</span>
                  </div>
                ));
              })()
            )}
          </div>
        </div>
      )}
    </div>
  );
}
