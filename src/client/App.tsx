import React, { useState, useCallback, useEffect, useRef, useMemo, Suspense, lazy } from 'react';
import { FlowCanvas } from './FlowCanvas';
import { SettingsPanel } from './SettingsPanel';
import { SevenSegmentClock } from './SevenSegmentClock';
import { LoadingOverlay } from './LoadingOverlay';
import { MatrixRain } from './MatrixRain';
import { LanguageProvider, useTranslation, Language } from './i18n';

// Lazy load GlobeCanvas to prevent blocking if WebGL fails
const GlobeCanvas = lazy(() => import('./GlobeCanvas').then(m => ({ default: m.GlobeCanvas })));
const SankeyCanvas = lazy(() => import('./SankeyCanvas').then(m => ({ default: m.SankeyCanvas })));
import type { GlobeMode } from './GlobeCanvas';
import { SearchBar, createFlowFilter } from './SearchBar';
import { useWebSocket } from './useWebSocket';
import { getStats, clearData, getConfig, updateConfig } from './api';
import type { GraphData, ZoneGraphData, ZoneConfig, FlowData, NodeData, Config, ViewMode, GeoIPConfig, SankeyColumn } from './types';

const VERSION = '1.5.0';

// Iconoir SVG icons (https://iconoir.com/) - embedded inline
const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
    <path d="M19.622 10.395l-1.097-2.65L20 6l-2-2-1.735 1.483-2.707-1.113L12.935 2h-1.954l-.632 2.401-2.645 1.115L6 4 4 6l1.453 1.789-1.08 2.657L2 11v2l2.401.655 1.113 2.706L4 18l2 2 1.791-1.46 2.606 1.072L11 22h2l.604-2.387 2.651-1.098C16.697 18.831 18 20 18 20l2-2-1.484-1.737 1.115-2.708L22 13v-2l-2.378-.605Z" />
  </svg>
);

const ClearIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

const PauseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 18.4V5.6a.6.6 0 0 1 .6-.6h2.8a.6.6 0 0 1 .6.6v12.8a.6.6 0 0 1-.6.6H6.6a.6.6 0 0 1-.6-.6ZM14 18.4V5.6a.6.6 0 0 1 .6-.6h2.8a.6.6 0 0 1 .6.6v12.8a.6.6 0 0 1-.6.6h-2.8a.6.6 0 0 1-.6-.6Z" />
  </svg>
);

const PlayIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.906 4.537A.6.6 0 0 0 6 5.053v13.894a.6.6 0 0 0 .906.516l11.723-6.947a.6.6 0 0 0 0-1.032L6.906 4.537Z" />
  </svg>
);

// Auto-rotate icon
const RotateIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.168 8A10.003 10.003 0 0 0 12 2c-5.185 0-9.449 3.947-9.95 9" />
    <path d="M17 8h4.4a.6.6 0 0 0 .6-.6V3" />
    <path d="M2.881 16c1.544 3.532 5.068 6 9.168 6 5.186 0 9.45-3.947 9.951-9" />
    <path d="M7.05 16H2.6a.6.6 0 0 0-.6.6V21" />
  </svg>
);

// View mode icons
const FlowIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="6" r="3" />
    <circle cx="19" cy="6" r="3" />
    <circle cx="12" cy="18" r="3" />
    <path d="M5 9v1a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4V9" />
    <path d="M12 14v1" />
  </svg>
);

const Map2DIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 19l-6 2V5l6-2m0 16l6-2m-6 2V3m6 14l6 2V3l-6-2m0 16V1" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </svg>
);

const SankeyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3"  y="4"  width="2.4" height="16" rx="0.8" />
    <rect x="18.6" y="4"  width="2.4" height="16" rx="0.8" />
    <path d="M5.4 7c4 0 8.6 4 13.2 4" />
    <path d="M5.4 13c4 0 8.6 4 13.2 4" />
  </svg>
);

const LanguageIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 8l4 8" />
    <path d="M9 8l-4 8" />
    <path d="M6 12h2" />
    <path d="M14 4h6" />
    <path d="M17 4v5" />
    <path d="M14 9c0 2 1.5 3 3 3s3-1 3-3" />
    <path d="M12 19l3-6 3 6" />
    <path d="M13.5 17h3" />
  </svg>
);

const emptyZoneGraph: ZoneGraphData = { nodes: [], edges: [] };
const emptyGraph: GraphData = {
  nodes: [],
  edges: [],
  timestamp: 0,
  zones: {
    internal: emptyZoneGraph,
    external: emptyZoneGraph,
    inbound: emptyZoneGraph,
    outbound: emptyZoneGraph,
  }
};

function AppContent() {
  const { t, language, setLanguage } = useTranslation();
  const [graph, setGraph] = useState<GraphData>(emptyGraph);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stats, setStats] = useState({ messageCount: 0, flowCount: 0 });
  const [config, setConfig] = useState<Config | null>(null);
  const [paused, setPaused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('flow');
  const [viewModeInitialized, setViewModeInitialized] = useState(false);
  const [viewTransitioning, setViewTransitioning] = useState(false);
  const [viewWarpingIn, setViewWarpingIn] = useState(false);
  const [showMatrixRain, setShowMatrixRain] = useState(false);
  const [pendingViewMode, setPendingViewMode] = useState<ViewMode | null>(null);
  const [flashEffect, setFlashEffect] = useState(false);
  const [clearEffect, setClearEffect] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [statusPopupOpen, setStatusPopupOpen] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);  // 3D globe auto-rotate

  // Refs for zoom and pan handlers (set by canvas components)
  const zoomInRef = useRef<(() => void) | null>(null);
  const zoomOutRef = useRef<(() => void) | null>(null);
  const zoomResetRef = useRef<(() => void) | null>(null);
  const panUpRef = useRef<(() => void) | null>(null);
  const panDownRef = useRef<(() => void) | null>(null);
  const panLeftRef = useRef<(() => void) | null>(null);
  const panRightRef = useRef<(() => void) | null>(null);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('INITIALIZING');
  const [readyToRender, setReadyToRender] = useState(false);  // Wait for overlay to hide before rendering
  const hasReceivedFirstEvent = useRef(false);
  const pendingGraphRef = useRef<GraphData | null>(null);  // Store first graph data until ready
  const pausedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Filter graph based on search query
  const filteredGraph = useMemo(() => {
    if (!searchQuery.trim()) return graph;

    const flowFilter = createFlowFilter(searchQuery);
    const filteredEdges = graph.edges.filter(flowFilter);

    // Rebuild nodes based on filtered edges
    const nodeIds = new Set<string>();
    filteredEdges.forEach(edge => {
      nodeIds.add(edge.key.src);
      nodeIds.add(edge.key.dst);
    });

    const filteredNodes = graph.nodes.filter(node => nodeIds.has(node.id));

    // Rebuild zone data
    const filterZoneEdges = (edges: FlowData[]) => edges.filter(flowFilter);
    const filterZoneNodes = (nodes: NodeData[]) => nodes.filter(n => nodeIds.has(n.id));

    return {
      ...graph,
      nodes: filteredNodes,
      edges: filteredEdges,
      zones: {
        internal: {
          nodes: filterZoneNodes(graph.zones.internal.nodes),
          edges: filterZoneEdges(graph.zones.internal.edges),
        },
        external: {
          nodes: filterZoneNodes(graph.zones.external.nodes),
          edges: filterZoneEdges(graph.zones.external.edges),
        },
        inbound: {
          nodes: filterZoneNodes(graph.zones.inbound.nodes),
          edges: filterZoneEdges(graph.zones.inbound.edges),
        },
        outbound: {
          nodes: filterZoneNodes(graph.zones.outbound.nodes),
          edges: filterZoneEdges(graph.zones.outbound.edges),
        },
      },
    };
  }, [graph, searchQuery]);

  // Keep ref in sync with state
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Handle WebSocket graph updates
  const handleGraph = useCallback((data: GraphData) => {
    // Check if this is the first event with actual data
    if (!hasReceivedFirstEvent.current && data.lastMessageTimestamp !== null) {
      hasReceivedFirstEvent.current = true;
      // Store the first graph data, don't render yet
      pendingGraphRef.current = data;
      // Set progress to 100% and update status
      setLoadingProgress(100);
      setLoadingStatus('DATA RECEIVED');
      // Hide overlay after showing 100%
      setTimeout(() => {
        // Set graph data and readyToRender BEFORE hiding overlay
        // so content is ready when overlay fades out
        setReadyToRender(true);
        if (pendingGraphRef.current && !pausedRef.current) {
          setGraph(pendingGraphRef.current);
        }
        // Start overlay fade-out
        setShowLoadingOverlay(false);
      }, 800);  // Show 100% for a moment
      return;  // Don't update graph yet
    }

    // Normal updates after first event
    if (readyToRender && !pausedRef.current) {
      setGraph(data);
    }
  }, [readyToRender]);

  const { connected } = useWebSocket(handleGraph);

  // Update loading progress based on connection state
  useEffect(() => {
    if (connected) {
      setLoadingProgress(50);
      setLoadingStatus('CONNECTED - AWAITING DATA');
    } else {
      setLoadingProgress(20);
      setLoadingStatus('CONNECTING TO SYSTEM');
    }
  }, [connected]);

  // Load config
  const loadConfig = useCallback(() => {
    getConfig().then(cfg => {
      setConfig(cfg);
      // Set default view only on first load
      if (!viewModeInitialized) {
        setViewMode(cfg.default_view || 'flow');
        setViewModeInitialized(true);
      }
    });
  }, [viewModeInitialized]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Extract zones from config
  const zones = config?.zones || null;

  // Default GeoIP config
  const defaultGeoIPConfig: GeoIPConfig = {
    source_field: 'source_ip_geolocation',
    destination_field: 'destination_ip_geolocation',
    hide_no_geo: true,
    internal_fallback_lat: 0,
    internal_fallback_lng: 0,
    auto_detect_location: true,
    map_brightness: 75,
    show_starfield: true,
  };
  const geoipConfig = config?.geoip || defaultGeoIPConfig;

  // Update dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [settingsOpen]);

  // Poll stats
  useEffect(() => {
    const fetchStats = () => {
      getStats().then(setStats).catch(console.error);
    };
    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, []);

  const handlePauseToggle = useCallback(() => {
    setPaused(p => !p);
    // Trigger flash effect
    setFlashEffect(true);
    setTimeout(() => setFlashEffect(false), 300);
  }, []);

  // Handle view mode change with transition animation. The chosen effect
  // (warp / matrix) applies to ALL views uniformly per config.
  const handleViewModeChange = useCallback((newMode: ViewMode) => {
    if (newMode === viewMode || viewTransitioning || viewWarpingIn) return;

    const effect = config?.transition_effect || 'warp';
    setViewTransitioning(true);
    setPendingViewMode(newMode);

    setTimeout(() => {
      setViewMode(newMode);
      setViewTransitioning(false);
      if (effect === 'matrix') {
        setShowMatrixRain(true);
        // MatrixRain.onComplete clears showMatrixRain + pendingViewMode
      } else {
        setViewWarpingIn(true);
        setTimeout(() => {
          setViewWarpingIn(false);
          setPendingViewMode(null);
        }, 350);
      }
    }, 400);
  }, [viewMode, viewTransitioning, viewWarpingIn, config?.transition_effect]);

  // Keyboard shortcuts (when not in text input)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if settings panel is open or focus is in an input/textarea
      if (settingsOpen) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      // Spacebar to toggle pause
      if (e.code === 'Space') {
        e.preventDefault();
        handlePauseToggle();
      }
      // 1, 2, 3 to switch views
      if (e.code === 'Digit1' || e.code === 'Numpad1') {
        e.preventDefault();
        handleViewModeChange('flow');
      }
      if (e.code === 'Digit2' || e.code === 'Numpad2') {
        e.preventDefault();
        handleViewModeChange('2d-geo');
      }
      if (e.code === 'Digit3' || e.code === 'Numpad3') {
        e.preventDefault();
        handleViewModeChange('3d-globe');
      }
      if (e.code === 'Digit4' || e.code === 'Numpad4') {
        e.preventDefault();
        handleViewModeChange('sankey');
      }
      // + to zoom in, - to zoom out, 0 to reset
      if (e.code === 'Equal' || e.code === 'NumpadAdd') {
        e.preventDefault();
        zoomInRef.current?.();
      }
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        zoomOutRef.current?.();
      }
      if (e.code === 'Digit0' || e.code === 'Numpad0') {
        e.preventDefault();
        zoomResetRef.current?.();
      }
      // Arrow keys to pan
      if (e.code === 'ArrowUp') {
        e.preventDefault();
        panUpRef.current?.();
      }
      if (e.code === 'ArrowDown') {
        e.preventDefault();
        panDownRef.current?.();
      }
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        panLeftRef.current?.();
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        panRightRef.current?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settingsOpen, handlePauseToggle, handleViewModeChange]);

  const handleClear = async () => {
    // Trigger clear effect
    setClearEffect(true);
    await clearData();
    setGraph(emptyGraph);
    setTimeout(() => setClearEffect(false), 500);
  };

  const isEmpty = filteredGraph.nodes.length === 0;
  const isFiltering = searchQuery.trim().length > 0;

  // Calculate actual visible counts for Flow view (respecting internal_filter_ips)
  const flowFilteredCounts = useMemo(() => {
    const filterIps = (zones?.internal_filter_apply_to || ['flow']).includes('flow')
      ? (zones?.internal_filter_ips || [])
      : [];
    const cidrs = zones?.internal_cidrs || [];
    const topNInternal = (zones?.top_n_internal_apply_to || ['flow']).includes('flow')
      ? (zones?.top_n_internal || 0)
      : 0;
    const topNExternal = (zones?.top_n_external_apply_to || ['flow']).includes('flow')
      ? (zones?.top_n_external || 0)
      : 0;

    // Helper functions (same as FlowCanvas)
    const ipToNum = (ip: string): number => {
      const parts = ip.split('.').map(Number);
      if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return -1;
      return ((parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
    };

    const isIpInCidr = (ip: string, cidr: string): boolean => {
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
    };

    const isIpInPattern = (ip: string, pattern: string): boolean => {
      pattern = pattern.trim();
      if (pattern.includes('/')) {
        return isIpInCidr(ip, pattern);
      } else if (pattern.includes('-')) {
        return false; // Skip range check for simplicity
      } else {
        return ip === pattern;
      }
    };

    const isInternalIp = (ip: string): boolean => {
      if (filterIps.length > 0) {
        if (filterIps.some(p => !p.includes('/') && !p.includes('-') && p === ip)) {
          return true;
        }
      }
      return cidrs.some(c => isIpInPattern(ip, c));
    };

    // Calculate internal nodes (those matching filter)
    let internalNodes = filteredGraph.nodes.filter(node => {
      if (!isInternalIp(node.id)) return false;
      if (filterIps.length > 0 && !filterIps.some(p => isIpInPattern(node.id, p))) return false;
      return true;
    });

    // Always include filter IPs even if no traffic
    if (filterIps.length > 0) {
      const existingIds = new Set(internalNodes.map(n => n.id));
      filterIps.forEach(ip => {
        if (!ip.includes('/') && !ip.includes('-') && !existingIds.has(ip)) {
          internalNodes.push({ id: ip, label: ip, totalIn: 0, totalOut: 0, connections: 0 });
        }
      });
    }

    if (topNInternal > 0) {
      internalNodes = internalNodes
        .sort((a, b) => (b.totalIn + b.totalOut) - (a.totalIn + a.totalOut))
        .slice(0, topNInternal);
    }

    const visibleInternalIds = new Set(internalNodes.map(n => n.id));

    // Calculate external nodes that connect to visible internal nodes
    const externalTrafficMap = new Map<string, number>();
    const showInternalTraffic = zones?.show_internal_traffic ?? false;

    for (const edge of filteredGraph.edges) {
      const srcInternal = isInternalIp(edge.key.src);
      const dstInternal = isInternalIp(edge.key.dst);

      // Skip internal-to-internal if not showing internal traffic
      if (!showInternalTraffic && srcInternal && dstInternal) continue;

      if (srcInternal && !dstInternal && visibleInternalIds.has(edge.key.src)) {
        externalTrafficMap.set(edge.key.dst, (externalTrafficMap.get(edge.key.dst) || 0) + edge.value);
      } else if (!srcInternal && dstInternal && visibleInternalIds.has(edge.key.dst)) {
        externalTrafficMap.set(edge.key.src, (externalTrafficMap.get(edge.key.src) || 0) + edge.value);
      }
    }

    let externalNodes = filteredGraph.nodes.filter(node => {
      if (isInternalIp(node.id)) return false;
      return externalTrafficMap.has(node.id);
    });

    if (topNExternal > 0) {
      externalNodes = externalNodes
        .sort((a, b) => (externalTrafficMap.get(b.id) || 0) - (externalTrafficMap.get(a.id) || 0))
        .slice(0, topNExternal);
    }

    return {
      internal: internalNodes.length,
      external: externalNodes.length,
    };
  }, [filteredGraph, zones]);

  // Use flow-filtered counts for flow view, zone counts for other views
  const internalCount = viewMode === 'flow'
    ? flowFilteredCounts.internal
    : (filteredGraph.zones?.internal?.nodes?.length || 0);
  const externalCount = viewMode === 'flow'
    ? flowFilteredCounts.external
    : (filteredGraph.zones?.external?.nodes?.length || 0);

  return (
    <div className="app">
      <div className="main-content">
        <header className="header">
          <h1>
            <a href="https://github.com/jasoncheng7115/it-scripts" target="_blank" rel="noopener noreferrer" className="project-link">
              <img src="/logo.png" alt="JT-GELFLOW" className="header-logo" />
            </a>
          </h1>
          <div className="header-stats">
            <div className="status-wrapper">
              <button
                className={`status-indicator ${connected ? 'connected' : ''}`}
                onClick={() => setStatusPopupOpen(!statusPopupOpen)}
                style={{ background: connected ? '#00ff88' : '#ff4444' }}
              />
              {statusPopupOpen && (
                <div className="status-popup">
                  <div className="status-popup-header">
                    <span>{t('status.connectionInfo')}</span>
                    <button onClick={() => setStatusPopupOpen(false)}>&times;</button>
                  </div>
                  <div className="status-popup-content">
                    <div className="status-row">
                      <span className="status-label">{t('status.status')}</span>
                      <span className="status-value" style={{ color: connected ? '#00ff88' : '#ff4444' }}>
                        {connected ? t('header.connected') : t('header.disconnected')}
                      </span>
                    </div>
                    <div className="status-row">
                      <span className="status-label">{t('status.wsUrl')}</span>
                      <span className="status-value">{`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`}</span>
                    </div>
                    <div className="status-row">
                      <span className="status-label">{t('status.httpUrl')}</span>
                      <span className="status-value">{window.location.origin}</span>
                    </div>
                    {config && (
                      <>
                        <div className="status-row">
                          <span className="status-label">{t('status.gelfUdp')}</span>
                          <span className="status-value">{config.gelf_udp_port}</span>
                        </div>
                        <div className="status-row">
                          <span className="status-label">{t('status.gelfTcp')}</span>
                          <span className="status-value">{config.gelf_tcp_port}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
            <SevenSegmentClock timestamp={graph?.lastMessageTimestamp ?? null} connected={connected} />
            <div className="stats-panel">
              <div className="stat-item">
                <span className="stat-label">{t('stats.flw')}</span>
                <span className="stat-value">
                  {stats.flowCount}
                  {isFiltering && <span className="stat-filtered">/{filteredGraph.edges.length}</span>}
                </span>
              </div>
              <div className="stat-divider" />
              <div className="stat-item external">
                <span className="stat-label">{t('stats.ext')}</span>
                <span className="stat-value">{externalCount}</span>
              </div>
              <div className="stat-divider" />
              <div className="stat-item internal">
                <span className="stat-label">{t('stats.int')}</span>
                <span className="stat-value">{internalCount}</span>
              </div>
            </div>
          </div>
          <div className="header-center">
            <SearchBar
              onQueryChange={setSearchQuery}
              placeholder={t('filter.placeholder')}
            />
            <div className="view-toggle">
              <button
                className={`btn btn-toggle ${viewMode === 'flow' ? 'active' : ''}`}
                onClick={() => handleViewModeChange('flow')}
                title={t('view.flowWithHotkey')}
              >
                <FlowIcon /> <span className="btn-text">{t('view.flow')}</span>
              </button>
              <button
                className={`btn btn-toggle ${viewMode === '2d-geo' ? 'active' : ''}`}
                onClick={() => handleViewModeChange('2d-geo')}
                title={t('view.2dMapWithHotkey')}
              >
                <Map2DIcon /> <span className="btn-text">{t('view.2dMap')}</span>
              </button>
              <button
                className={`btn btn-toggle ${viewMode === '3d-globe' ? 'active' : ''}`}
                onClick={() => handleViewModeChange('3d-globe')}
                title={t('view.3dGlobeWithHotkey')}
              >
                <GlobeIcon /> <span className="btn-text">{t('view.3dGlobe')}</span>
              </button>
              <button
                className={`btn btn-toggle ${viewMode === 'sankey' ? 'active' : ''}`}
                onClick={() => handleViewModeChange('sankey')}
                title={t('view.sankeyWithHotkey')}
              >
                <SankeyIcon /> <span className="btn-text">{t('view.sankey')}</span>
              </button>
            </div>
          </div>
          <div className="header-actions">
            <button
              className={`btn btn-icon ${paused ? 'btn-warning' : 'btn-secondary'}`}
              onClick={handlePauseToggle}
              title={paused ? t('btn.resumeWithHotkey') : t('btn.pauseWithHotkey')}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button className="btn btn-icon btn-secondary" onClick={handleClear} title={t('btn.clearData')}>
              <ClearIcon />
            </button>
            <div className="lang-selector">
              <button
                className="btn btn-icon btn-secondary"
                onClick={() => setLangMenuOpen(!langMenuOpen)}
                title={language === 'en' ? 'English' : '繁體中文'}
              >
                <LanguageIcon />
              </button>
              {langMenuOpen && (
                <div className="lang-menu">
                  <button
                    className={language === 'en' ? 'active' : ''}
                    onClick={() => { setLanguage('en'); setLangMenuOpen(false); }}
                  >
                    English
                  </button>
                  <button
                    className={language === 'zh-TW' ? 'active' : ''}
                    onClick={() => { setLanguage('zh-TW'); setLangMenuOpen(false); }}
                  >
                    繁體中文
                  </button>
                </div>
              )}
            </div>
            <button className="btn btn-icon btn-primary" onClick={() => setSettingsOpen(true)} title={t('btn.settings')}>
              <SettingsIcon />
            </button>
          </div>
        </header>

        <div className="canvas-container" ref={containerRef}>
          {/* Loading overlay - only covers canvas area */}
          <LoadingOverlay
            visible={showLoadingOverlay}
            progress={loadingProgress}
            status={loadingStatus}
          />

          <div className={`view-container ${viewTransitioning ? 'transitioning' : ''} ${viewWarpingIn ? `warp-in warp-in-${viewMode}` : ''} ${flashEffect ? 'flash-effect' : ''} ${clearEffect ? 'clear-effect' : ''}`}>
            {viewMode === 'flow' && (
              <div className="flow-view-wrapper">
              <FlowCanvas
                graph={filteredGraph}
                width={dimensions.width}
                height={dimensions.height}
                internalCidrs={zones?.internal_cidrs || []}
                internalFilterIps={(zones?.internal_filter_apply_to || ['flow']).includes('flow') ? (zones?.internal_filter_ips || []) : []}
                minTrafficThreshold={zones?.min_traffic_threshold || 0}
                topNInternal={(zones?.top_n_internal_apply_to || ['flow']).includes('flow') ? (zones?.top_n_internal || 0) : 0}
                topNExternal={(zones?.top_n_external_apply_to || ['flow']).includes('flow') ? (zones?.top_n_external || 0) : 0}
                customZones={zones?.custom_zones || []}
                showInternalTraffic={zones?.show_internal_traffic ?? false}
                showTrafficValue={zones?.show_traffic_value ?? false}
                paused={paused || !connected}
                statsTopN={geoipConfig.stats_top_n || 15}
                zoomInRef={zoomInRef}
                zoomOutRef={zoomOutRef}
                zoomResetRef={zoomResetRef}
                panUpRef={panUpRef}
                panDownRef={panDownRef}
                panLeftRef={panLeftRef}
                panRightRef={panRightRef}
              />
              </div>
            )}
            {viewMode === '2d-geo' && (
              <Suspense fallback={<div className="globe-loading">Loading Map...</div>}>
                <GlobeCanvas
                  graph={filteredGraph}
                  width={dimensions.width}
                  height={dimensions.height}
                  internalCidrs={zones?.internal_cidrs || []}
                  geoipConfig={geoipConfig}
                  paused={paused || !connected}
                  mode="2d"
                  internalFilterIps={(zones?.internal_filter_apply_to || ['flow']).includes('2d-geo') ? (zones?.internal_filter_ips || []) : []}
                  topNInternal={(zones?.top_n_internal_apply_to || ['flow']).includes('2d-geo') ? (zones?.top_n_internal || 0) : 0}
                  topNExternal={(zones?.top_n_external_apply_to || ['flow']).includes('2d-geo') ? (zones?.top_n_external || 0) : 0}
                  zoomInRef={zoomInRef}
                  zoomOutRef={zoomOutRef}
                  zoomResetRef={zoomResetRef}
                  panUpRef={panUpRef}
                  panDownRef={panDownRef}
                  panLeftRef={panLeftRef}
                  panRightRef={panRightRef}
                />
              </Suspense>
            )}
            {viewMode === '3d-globe' && (
              <Suspense fallback={<div className="globe-loading">Loading Globe...</div>}>
                <GlobeCanvas
                  graph={filteredGraph}
                  width={dimensions.width}
                  height={dimensions.height}
                  internalCidrs={zones?.internal_cidrs || []}
                  geoipConfig={geoipConfig}
                  paused={paused || !connected}
                  mode="3d"
                  autoRotate={autoRotate}
                  onAutoRotateChange={setAutoRotate}
                  internalFilterIps={(zones?.internal_filter_apply_to || ['flow']).includes('3d-globe') ? (zones?.internal_filter_ips || []) : []}
                  topNInternal={(zones?.top_n_internal_apply_to || ['flow']).includes('3d-globe') ? (zones?.top_n_internal || 0) : 0}
                  topNExternal={(zones?.top_n_external_apply_to || ['flow']).includes('3d-globe') ? (zones?.top_n_external || 0) : 0}
                  zoomInRef={zoomInRef}
                  zoomOutRef={zoomOutRef}
                  zoomResetRef={zoomResetRef}
                  panUpRef={panUpRef}
                  panDownRef={panDownRef}
                  panLeftRef={panLeftRef}
                  panRightRef={panRightRef}
                />
              </Suspense>
            )}
            {viewMode === 'sankey' && (
              <Suspense fallback={<div className="globe-loading">Loading Sankey...</div>}>
                <SankeyCanvas
                  graph={filteredGraph}
                  width={dimensions.width}
                  height={dimensions.height}
                  internalCidrs={zones?.internal_cidrs || []}
                  internalFilterIps={(zones?.internal_filter_apply_to || ['flow']).includes('sankey') ? (zones?.internal_filter_ips || []) : []}
                  topNInternal={(zones?.top_n_internal_apply_to || ['flow']).includes('sankey') ? (zones?.top_n_internal || 0) : 0}
                  topNExternal={(zones?.top_n_external_apply_to || ['flow']).includes('sankey') ? (zones?.top_n_external || 0) : 0}
                  activeColumns={config?.sankey_active_columns || ['country', 'ext_ip', 'ext_ip_ptr', 'int_ip', 'int_ip_ptr']}
                  columnHeaders={{
                    country:    config?.mapping?.country_display       || '來源國碼',
                    ext_ip:     config?.mapping?.src_field_display     || '來源 IP',
                    ext_ip_ptr: config?.mapping?.src_ptr_field_display || '來源 IP 反解',
                    protocol:   config?.mapping?.proto_field_display   || '協定',
                    int_ip:     config?.mapping?.dst_field_display     || '目的 IP',
                    int_ip_ptr: config?.mapping?.dst_ptr_field_display || '目的 IP 反解',
                  }}
                  windowSeconds={config?.sankey_window_seconds ?? 5}
                  srcPtrField={config?.mapping?.src_ptr_field || 'source_ip_ptr'}
                  dstPtrField={config?.mapping?.dst_ptr_field || 'destination_ip_ptr'}
                  paused={paused || !connected}
                  onActiveColumnsChange={async (cols) => {
                    setConfig(prev => prev ? { ...prev, sankey_active_columns: cols } : prev);
                    try { await updateConfig({ sankey_active_columns: cols }); } catch (e) { console.error(e); }
                  }}
                  onTopNInternalChange={async (n) => {
                    if (!zones) return;
                    const apply = zones.top_n_internal_apply_to.includes('sankey')
                      ? zones.top_n_internal_apply_to
                      : [...zones.top_n_internal_apply_to, 'sankey'];
                    setConfig(prev => prev ? { ...prev, zones: { ...prev.zones, top_n_internal: n, top_n_internal_apply_to: apply } } : prev);
                    try { await updateConfig({ zones: { top_n_internal: n, top_n_internal_apply_to: apply } as Partial<ZoneConfig> }); } catch (e) { console.error(e); }
                  }}
                  onTopNExternalChange={async (n) => {
                    if (!zones) return;
                    const apply = zones.top_n_external_apply_to.includes('sankey')
                      ? zones.top_n_external_apply_to
                      : [...zones.top_n_external_apply_to, 'sankey'];
                    setConfig(prev => prev ? { ...prev, zones: { ...prev.zones, top_n_external: n, top_n_external_apply_to: apply } } : prev);
                    try { await updateConfig({ zones: { top_n_external: n, top_n_external_apply_to: apply } as Partial<ZoneConfig> }); } catch (e) { console.error(e); }
                  }}
                  onWindowSecondsChange={async (n) => {
                    const clamped = Math.max(1, Math.min(30, n));
                    setConfig(prev => prev ? { ...prev, sankey_window_seconds: clamped } : prev);
                    try { await updateConfig({ sankey_window_seconds: clamped }); } catch (e) { console.error(e); }
                  }}
                />
              </Suspense>
            )}
            {showMatrixRain && (
              <MatrixRain
                width={dimensions.width}
                height={dimensions.height}
                duration={2500}
                onComplete={() => {
                  setShowMatrixRain(false);
                  setPendingViewMode(null);
                }}
              />
            )}
          </div>

          {isEmpty && viewMode === 'flow' && !showLoadingOverlay && readyToRender && (
            <div className="empty-state">
              <h2>{t('empty.title')}</h2>
              <p>{t('empty.description')}</p>
              <code>
                {t('empty.udp')}: {config?.gelf_udp_port || '...'}<br />
                {t('empty.tcp')}: {config?.gelf_tcp_port || '...'}
              </code>
            </div>
          )}


        </div>
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onSave={loadConfig} />
    </div>
  );
}

// Wrap with LanguageProvider
function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}

export default App;
