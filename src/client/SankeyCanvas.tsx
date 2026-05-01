import React, { useRef, useEffect, useCallback, useState } from 'react';
import * as d3 from 'd3';
import { sankey as d3Sankey, sankeyLinkHorizontal, SankeyGraph } from 'd3-sankey';
import type { GraphData, FlowData, SankeyColumn, SankeyColumns } from './types';
import { useTranslation } from './i18n';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  graph: GraphData;
  width: number;
  height: number;
  internalCidrs: string[];
  internalFilterIps: string[];
  topNInternal?: number;
  topNExternal?: number;
  activeColumns: SankeyColumn[];   // User-toggled active columns
  columnHeaders?: SankeyColumns;   // User-configured header labels
  windowSeconds?: number;
  // GELF field names for PTR lookup.
  srcPtrField?: string;
  dstPtrField?: string;
  paused?: boolean;
  onActiveColumnsChange?: (cols: SankeyColumn[]) => void;
  onTopNInternalChange?: (n: number) => void;
  onTopNExternalChange?: (n: number) => void;
  onWindowSecondsChange?: (n: number) => void;
}

// Use SankeyColumn from types.ts (snake_case to match server config keys).
type StageColumn = SankeyColumn;

// Fixed left-to-right order. Active set is intersected with this array.
const COLUMN_ORDER: SankeyColumn[] = [
  'country', 'ext_ip', 'ext_ip_ptr', 'protocol', 'int_ip', 'int_ip_ptr',
];
const MANDATORY_COLUMNS: SankeyColumn[] = ['ext_ip', 'int_ip'];

const DEFAULT_HEADERS: Record<SankeyColumn, string> = {
  country:    '來源國碼',
  ext_ip:     '來源 IP',
  ext_ip_ptr: '來源 IP 反解',
  protocol:   '協定',
  int_ip:     '目的 IP',
  int_ip_ptr: '目的 IP 反解',
};

function resolveActiveColumns(active?: SankeyColumn[]): SankeyColumn[] {
  const set = new Set<SankeyColumn>(active || []);
  for (const m of MANDATORY_COLUMNS) set.add(m);
  return COLUMN_ORDER.filter(c => set.has(c));
}

interface SNode extends d3.SimulationNodeDatum {
  id: string;                    // unique within graph (column-prefixed)
  column: StageColumn;
  label: string;                 // display label
  rawValue: string;              // raw IP / protocol / country code
  // d3-sankey will inject x0,x1,y0,y1,index,sourceLinks,targetLinks at runtime
  x0?: number; x1?: number; y0?: number; y1?: number;
  index?: number;
  value?: number;
}

interface SLink {
  source: number | SNode;
  target: number | SNode;
  value: number;                // bytes
  events: number;               // GELF event count (sum of FlowData.count contributions)
  colorKey: string;             // dominant ancestor key (country or ext IP)
  // d3-sankey injects width, y0, y1
  width?: number;
  y0?: number;
  y1?: number;
}

// ─── IP / CIDR helpers (same logic as FlowCanvas, kept self-contained) ────────

function ipToNum(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return -1;
  return ((parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}
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
function isIpInRange(ip: string, range: string): boolean {
  try {
    const ipNum = ipToNum(ip);
    if (ipNum < 0) return false;
    const [start, end] = range.split('-');
    let startNum: number, endNum: number;
    if (end.includes('.')) {
      startNum = ipToNum(start);
      endNum = ipToNum(end);
    } else {
      startNum = ipToNum(start);
      const startParts = start.split('.');
      startParts[3] = end;
      endNum = ipToNum(startParts.join('.'));
    }
    return ipNum >= startNum && ipNum <= endNum;
  } catch {
    return false;
  }
}
function isIpInPattern(ip: string, pattern: string): boolean {
  pattern = pattern.trim();
  if (!pattern) return false;
  if (pattern.includes('/')) return isIpInCidr(ip, pattern);
  if (pattern.includes('-')) return isIpInRange(ip, pattern);
  return ip === pattern;
}
function isInternalIp(ip: string, cidrs: string[], filterIps: string[]): boolean {
  if (filterIps.length > 0) {
    if (filterIps.some(p => (!p.includes('/') && !p.includes('-')) ? p === ip : isIpInPattern(ip, p))) {
      return true;
    }
  }
  return cidrs.some(c => isIpInPattern(ip, c));
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

interface AggregatedFlow {
  extIp: string;
  intIp: string;
  proto: string;
  country: string;       // country code or '__unknown__'
  countryName: string;   // pretty label
  extPtr: string;        // PTR for external IP, falls back to ip if missing
  intPtr: string;        // PTR for internal IP, falls back to ip if missing
  value: number;         // bytes
  events: number;        // GELF event count from the underlying FlowData
}

function aggregate(
  edges: FlowData[],
  cidrs: string[],
  filterIps: string[],
  unknownCountryLabel: string,
  srcPtrField: string,
  dstPtrField: string,
): AggregatedFlow[] {
  const out: AggregatedFlow[] = [];

  for (const e of edges) {
    const srcInternal = isInternalIp(e.key.src, cidrs, filterIps);
    const dstInternal = isInternalIp(e.key.dst, cidrs, filterIps);

    if (srcInternal === dstInternal) continue;

    const extIp = srcInternal ? e.key.dst : e.key.src;
    const intIp = srcInternal ? e.key.src : e.key.dst;

    // GELF source side's PTR is in srcPtrField; destination side's is in dstPtrField.
    // The "ext" side maps to whichever GELF endpoint is external.
    const fields = e.fields || {};
    const srcPtr = String(fields[srcPtrField] ?? '').trim();
    const dstPtr = String(fields[dstPtrField] ?? '').trim();
    const extPtr = (srcInternal ? dstPtr : srcPtr) || extIp;
    const intPtr = (srcInternal ? srcPtr : dstPtr) || intIp;

    const countryRaw = srcInternal
      ? (fields['destination_ip_country_code'] ?? '')
      : (fields['source_ip_country_code'] ?? '');
    const country = String(countryRaw || '').trim() || '__unknown__';
    const countryName = country === '__unknown__' ? unknownCountryLabel : country;

    out.push({
      extIp,
      intIp,
      proto: e.key.proto || '?',
      country,
      countryName,
      extPtr,
      intPtr,
      value: e.value,
      events: e.count ?? 0,
    });
  }

  return out;
}

// Apply top-N to internal and external sides, return filtered set of allowed extIp/intIp.
function applyTopN(
  agg: AggregatedFlow[],
  topNInternal: number,
  topNExternal: number,
  filterIps: string[],
): { allowedExt: Set<string>; allowedInt: Set<string> } {
  // Sum traffic per side IP
  const extTotals = new Map<string, number>();
  const intTotals = new Map<string, number>();
  for (const a of agg) {
    extTotals.set(a.extIp, (extTotals.get(a.extIp) || 0) + a.value);
    intTotals.set(a.intIp, (intTotals.get(a.intIp) || 0) + a.value);
  }

  // Internal: optionally restricted by filterIps whitelist (exact-IP entries)
  const exactFilterIps = new Set(filterIps.filter(p => !p.includes('/') && !p.includes('-')));

  let intCandidates = Array.from(intTotals.entries());
  if (exactFilterIps.size > 0) {
    intCandidates = intCandidates.filter(([ip]) => exactFilterIps.has(ip));
  }
  intCandidates.sort((a, b) => b[1] - a[1]);
  const allowedInt = new Set(
    topNInternal > 0
      ? intCandidates.slice(0, topNInternal).map(([ip]) => ip)
      : intCandidates.map(([ip]) => ip),
  );

  // External: top-N by traffic
  const extCandidates = Array.from(extTotals.entries()).sort((a, b) => b[1] - a[1]);
  const allowedExt = new Set(
    topNExternal > 0
      ? extCandidates.slice(0, topNExternal).map(([ip]) => ip)
      : extCandidates.map(([ip]) => ip),
  );

  return { allowedExt, allowedInt };
}

// Extract the (raw, label) pair for a column from an aggregated flow.
function colValue(col: StageColumn, f: AggregatedFlow): { raw: string; label: string } {
  switch (col) {
    case 'country':    return { raw: f.country, label: f.countryName };
    case 'ext_ip':     return { raw: f.extIp,   label: f.extIp };
    case 'ext_ip_ptr': return { raw: f.extPtr,  label: f.extPtr };
    case 'protocol':   return { raw: f.proto,   label: f.proto };
    case 'int_ip':     return { raw: f.intIp,   label: f.intIp };
    case 'int_ip_ptr': return { raw: f.intPtr,  label: f.intPtr };
  }
}

// Pick a flow's "ancestor key" for path-colouring. If country column is
// active, group paths from the same country; otherwise group by external IP.
function flowColorKey(f: AggregatedFlow, columns: StageColumn[]): string {
  return columns.includes('country') ? f.country : f.extIp;
}

// Build d3-sankey nodes + links by chaining links between consecutive columns
// in the active set. ext_ip + int_ip are guaranteed by resolveActiveColumns.
function buildSankeyData(
  flows: AggregatedFlow[],
  columns: StageColumn[],
): { nodes: SNode[]; links: SLink[] } {
  const nodeMap = new Map<string, number>();
  const nodes: SNode[] = [];

  const addNode = (column: StageColumn, raw: string, label: string): number => {
    const k = `${column}::${raw}`;
    let i = nodeMap.get(k);
    if (i === undefined) {
      i = nodes.length;
      nodeMap.set(k, i);
      nodes.push({ id: k, column, label, rawValue: raw });
    }
    return i;
  };

  const linkAcc = new Map<string, number>();         // bytes per link
  const linkEventsAcc = new Map<string, number>();   // event count per link
  const linkColorAcc = new Map<string, Map<string, number>>();

  const addLink = (s: number, t: number, v: number, ev: number, colorKey: string) => {
    const k = `${s}>${t}`;
    linkAcc.set(k, (linkAcc.get(k) || 0) + v);
    linkEventsAcc.set(k, (linkEventsAcc.get(k) || 0) + ev);
    let m = linkColorAcc.get(k);
    if (!m) { m = new Map(); linkColorAcc.set(k, m); }
    m.set(colorKey, (m.get(colorKey) || 0) + v);
  };

  for (const f of flows) {
    const ck = flowColorKey(f, columns);
    const indices = columns.map(col => {
      const { raw, label } = colValue(col, f);
      return addNode(col, raw, label);
    });
    for (let i = 0; i < indices.length - 1; i++) {
      addLink(indices[i], indices[i + 1], f.value, f.events, ck);
    }
  }

  const links: SLink[] = [];
  linkAcc.forEach((value, key) => {
    const [a, b] = key.split('>');
    const m = linkColorAcc.get(key);
    let dominantKey = '';
    let dominantV = -1;
    if (m) {
      m.forEach((v, k) => { if (v > dominantV) { dominantV = v; dominantKey = k; } });
    }
    links.push({
      source: parseInt(a, 10),
      target: parseInt(b, 10),
      value,
      events: linkEventsAcc.get(key) || 0,
      colorKey: dominantKey,
    });
  });

  return { nodes, links };
}

// ─── Color scales ─────────────────────────────────────────────────────────────

// Uniform node colour — all column nodes share the same mint-green so the eye
// is drawn to the band colours instead.
const NODE_COLOR = '#7dd87d';

// Categorical palette for distinct paths. Each unique colorKey (country code
// or external IP, depending on the stage layout) gets one entry; we cycle if
// we run out.
const PATH_PALETTE: string[] = [
  '#3b82c4', // blue
  '#a259d9', // purple
  '#d04a4a', // red
  '#e8932e', // orange
  '#3da25c', // green
  '#d99c2b', // amber
  '#0098a8', // teal
  '#c4548b', // pink
  '#7a8aa8', // slate
  '#7c5cc7', // violet
];
const FALLBACK_BAND_COLOR = '#5a6878';

function colorForKey(key: string, palette: Map<string, string>): string {
  return palette.get(key) ?? FALLBACK_BAND_COLOR;
}

// ─── Component ────────────────────────────────────────────────────────────────

const TRANSITION_MS = 600;         // fade-in duration on each snapshot
const WINDOW_MIN_S = 1;
const WINDOW_MAX_S = 30;

// Stable identifiers for d3 enter/update/exit keyed joins.
function linkKey(l: SLink): string {
  const s = typeof l.source === 'object' ? (l.source as SNode).id : `idx${l.source}`;
  const t = typeof l.target === 'object' ? (l.target as SNode).id : `idx${l.target}`;
  return `${s}>${t}`;
}
function cssId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function SankeyCanvas({
  graph,
  width,
  height,
  internalCidrs,
  internalFilterIps,
  topNInternal = 0,
  topNExternal = 0,
  activeColumns,
  columnHeaders,
  windowSeconds = 5,
  srcPtrField = 'source_ip_ptr',
  dstPtrField = 'destination_ip_ptr',
  paused = false,
  onActiveColumnsChange,
  onTopNInternalChange,
  onTopNExternalChange,
  onWindowSecondsChange,
}: Props) {
  const resolvedColumns = resolveActiveColumns(activeColumns);
  const headers: Record<SankeyColumn, string> = { ...DEFAULT_HEADERS, ...(columnHeaders || {}) };
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; html: string } | null>(null);

  // Imperative pattern: graph (which mutates every 100ms) lives in a ref so it
  // does NOT trigger re-renders. The 5s interval reads the latest graph and
  // re-runs the layout. This avoids cancelling d3 transitions every WS tick.
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const internalCidrsRef = useRef(internalCidrs);
  internalCidrsRef.current = internalCidrs;
  const internalFilterIpsRef = useRef(internalFilterIps);
  internalFilterIpsRef.current = internalFilterIps;

  // Render with persistent SVG structure + keyed enter/update/exit.
  // Same-key bands smooth-transition stroke-width on value change; old bands
  // fade out, new bands fade in. No full canvas wipe.
  const render = useCallback(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const T = TRANSITION_MS;

    // ── Persistent skeleton (created once) ──
    if (svg.select('g.root').empty()) {
      svg.append('defs').attr('class', 'sankey-defs');
      const root = svg.append('g').attr('class', 'root');
      root.append('g').attr('class', 'headers');
      root.append('g').attr('class', 'links').attr('fill', 'none');
      root.append('g').attr('class', 'nodes');
      svg.append('text')
        .attr('class', 'empty-message')
        .attr('text-anchor', 'middle')
        .attr('fill', '#9ba8b8')
        .attr('font-size', 16)
        .attr('opacity', 0);
    }

    const root = svg.select<SVGGElement>('g.root');
    const headersG = root.select<SVGGElement>('g.headers');
    const linksG = root.select<SVGGElement>('g.links');
    const nodesG = root.select<SVGGElement>('g.nodes');
    const defs = svg.select<SVGDefsElement>('defs.sankey-defs');
    const emptyText = svg.select<SVGTextElement>('text.empty-message');

    const showEmpty = (msg: string) => {
      // Fade out anything currently drawn, fade in message
      linksG.selectAll<SVGPathElement, SLink>('path')
        .transition().duration(T).attr('stroke-opacity', 0).remove();
      nodesG.selectAll<SVGGElement, SNode>('g.node')
        .transition().duration(T).attr('opacity', 0).remove();
      headersG.selectAll('text.col-header')
        .transition().duration(T).attr('opacity', 0).remove();
      defs.selectAll('linearGradient').remove();
      emptyText
        .attr('x', width / 2)
        .attr('y', height / 2)
        .text(msg)
        .transition().duration(T).attr('opacity', 1);
    };

    // ── Aggregate cross-boundary flows ──
    const agg = aggregate(
      graphRef.current.edges,
      internalCidrsRef.current,
      internalFilterIpsRef.current,
      t('sankey.unknownCountry'),
      srcPtrField,
      dstPtrField,
    );
    if (agg.length === 0) { showEmpty(t('sankey.empty')); return; }

    const { allowedExt, allowedInt } = applyTopN(
      agg, topNInternal, topNExternal, internalFilterIpsRef.current,
    );
    const filtered = agg.filter(a => allowedExt.has(a.extIp) && allowedInt.has(a.intIp));
    if (filtered.length === 0) { showEmpty(t('sankey.empty')); return; }

    const built = buildSankeyData(filtered, resolvedColumns);
    if (built.nodes.length === 0 || built.links.length === 0) {
      showEmpty(t('sankey.empty')); return;
    }

    // hide empty message if previously shown
    emptyText.transition().duration(T / 2).attr('opacity', 0);

    // Bottom margin reserves space for the inline controls bar (height + 10px
    // safe area) so bands don't draw under it.
    // Top margin reserves room for column headers; bottom for the inline
    // controls bar.
    const margin = { top: 36, right: 140, bottom: 64, left: 140 };
    const innerW = Math.max(200, width - margin.left - margin.right);
    const innerH = Math.max(200, height - margin.top - margin.bottom);

    root.attr('transform', `translate(${margin.left},${margin.top})`);

    // Layout — pin x positions deterministically by the column's index in
    // the resolved active set.
    const colIndex = new Map<StageColumn, number>();
    resolvedColumns.forEach((c, i) => colIndex.set(c, i));

    const layout = d3Sankey<SNode, SLink>()
      .nodeAlign((d: any) => {
        const col = (d as SNode).column;
        return colIndex.get(col) ?? 0;
      })
      .nodeWidth(14)
      .nodePadding(12)
      .extent([[0, 0], [innerW, innerH]]);

    const cloneNodes: SNode[] = built.nodes.map(n => ({ ...n }));
    const cloneLinks: SLink[] = built.links.map(l => ({ ...l }));
    const laidOut: SankeyGraph<SNode, SLink> = layout(
      { nodes: cloneNodes, links: cloneLinks } as any,
    );
    const { nodes, links } = laidOut as unknown as { nodes: SNode[]; links: SLink[] };

    // Assign palette colours to each colorKey deterministically (sorted by
    // total value descending so dominant flows get the first / most distinct
    // palette slots).
    const keyTotals = new Map<string, number>();
    for (const l of links) {
      keyTotals.set(l.colorKey, (keyTotals.get(l.colorKey) || 0) + l.value);
    }
    const sortedKeys = Array.from(keyTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
    const palette = new Map<string, string>();
    sortedKeys.forEach((k, i) => palette.set(k, PATH_PALETTE[i % PATH_PALETTE.length]));

    const linkPath = sankeyLinkHorizontal();

    // No gradients needed — each band is solid colour. Clear leftover defs.
    defs.selectAll('linearGradient').remove();

    // ── Column headers ──
    // Header label comes from user-configurable sankey_columns config. Falls
    // back to DEFAULT_HEADERS when not set. Headers are NOT translated — they
    // reflect whatever GELF field the user has mapped this column to.
    const colXMap = new Map<StageColumn, [number, number]>();
    for (const n of nodes) {
      if (!colXMap.has(n.column)) {
        colXMap.set(n.column, [n.x0 ?? 0, n.x1 ?? 0]);
      }
    }
    interface HeaderDatum { column: StageColumn; cx: number; label: string; }
    const headerData: HeaderDatum[] = [];
    colXMap.forEach(([x0, x1], col) => {
      headerData.push({ column: col, cx: (x0 + x1) / 2, label: headers[col] || col });
    });

    const headerSel = headersG.selectAll<SVGTextElement, HeaderDatum>('text.col-header')
      .data(headerData, d => d.column);
    headerSel.exit().transition().duration(T).attr('opacity', 0).remove();
    const headerEnter = headerSel.enter().append('text')
      .attr('class', 'col-header')
      .attr('text-anchor', 'middle')
      .attr('y', -10)
      .attr('fill', '#9ba8b8')
      .attr('font-size', 12)
      .attr('font-weight', 600)
      .attr('letter-spacing', '0.5px')
      .attr('opacity', 0)
      .text(d => d.label)
      .attr('x', d => d.cx);
    headerEnter.transition().duration(T).attr('opacity', 1);
    headerSel.transition().duration(T)
      .attr('x', d => d.cx)
      .attr('opacity', 1)
      .text(d => d.label);

    // ── Links: enter / update / exit ──
    const linkSel = linksG.selectAll<SVGPathElement, SLink>('path').data(links, linkKey);

    linkSel.exit()
      .transition().duration(T)
      .attr('stroke-opacity', 0)
      .remove();

    // ── Hover highlight helpers ──
    const DEFAULT_OPACITY = 0.55;
    const DIM_OPACITY = 0.08;
    const HIGHLIGHT_OPACITY = 0.95;

    const dimAllLinksExcept = (predicate: (d: SLink) => boolean) => {
      linksG.selectAll<SVGPathElement, SLink>('path')
        .interrupt('hover')
        .transition('hover').duration(120)
        .attr('stroke-opacity', d => predicate(d) ? HIGHLIGHT_OPACITY : DIM_OPACITY);
    };
    const restoreAllLinks = () => {
      linksG.selectAll<SVGPathElement, SLink>('path')
        .interrupt('hover')
        .transition('hover').duration(120)
        .attr('stroke-opacity', DEFAULT_OPACITY);
    };

    // Collect every link reachable from the hovered link via the d3-sankey
    // graph (BFS forward through sourceLinks, backward through targetLinks).
    // This lights up the whole flow chain end-to-end, not just one segment.
    const connectedChain = (start: SLink): Set<SLink> => {
      const visited = new Set<SLink>([start]);
      const fwd: SNode[] = [start.target as SNode];
      while (fwd.length) {
        const node = fwd.shift()!;
        for (const l of (((node as any).sourceLinks ?? []) as SLink[])) {
          if (!visited.has(l)) { visited.add(l); fwd.push(l.target as SNode); }
        }
      }
      const bwd: SNode[] = [start.source as SNode];
      while (bwd.length) {
        const node = bwd.shift()!;
        for (const l of (((node as any).targetLinks ?? []) as SLink[])) {
          if (!visited.has(l)) { visited.add(l); bwd.push(l.source as SNode); }
        }
      }
      return visited;
    };

    const linkTooltipHTML = (d: SLink) => {
      const sN = d.source as SNode;
      const tN = d.target as SNode;
      return `${sN.label} → ${tN.label}<br/><b>${formatBytes(d.value)}</b> &nbsp; · &nbsp; ${d.events.toLocaleString()} ${d.events === 1 ? 'event' : 'events'}`;
    };
    const onLinkEnter = (event: any, d: SLink) => {
      const chain = connectedChain(d);
      dimAllLinksExcept(l => chain.has(l));
      setTooltip({ x: event.offsetX, y: event.offsetY, html: linkTooltipHTML(d) });
    };
    const onLinkMove = (event: any, d: SLink) => {
      setTooltip({ x: event.offsetX, y: event.offsetY, html: linkTooltipHTML(d) });
    };
    const onLinkLeave = () => {
      restoreAllLinks();
      setTooltip(null);
    };

    const linkEnter = linkSel.enter().append('path')
      .attr('d', linkPath)
      .attr('stroke', d => colorForKey(d.colorKey, palette))
      .attr('stroke-width', d => Math.max(1, d.width ?? 1))
      .attr('stroke-opacity', 0)
      .style('cursor', 'pointer')
      .on('mouseenter', onLinkEnter)
      .on('mousemove', onLinkMove)
      .on('mouseleave', onLinkLeave);
    linkEnter.transition().duration(T)
      .attr('stroke-opacity', DEFAULT_OPACITY);

    linkSel
      .on('mouseenter', onLinkEnter)
      .on('mousemove', onLinkMove)
      .on('mouseleave', onLinkLeave);
    linkSel.transition().duration(T)
      .attr('d', linkPath)
      .attr('stroke', d => colorForKey(d.colorKey, palette))
      .attr('stroke-width', d => Math.max(1, d.width ?? 1))
      .attr('stroke-opacity', DEFAULT_OPACITY);

    // ── Nodes: enter / update / exit ──
    const nodeSel = nodesG.selectAll<SVGGElement, SNode>('g.node').data(nodes, n => n.id);

    nodeSel.exit()
      .transition().duration(T)
      .attr('opacity', 0)
      .remove();

    const nodeEnter = nodeSel.enter().append('g')
      .attr('class', 'node')
      .attr('transform', n => `translate(${n.x0 ?? 0},${n.y0 ?? 0})`)
      .attr('opacity', 0);

    const onNodeEnter = (event: any, n: SNode) => {
      // Build a chain rooted at this node — every link reachable upstream and
      // downstream from any link touching the node.
      const seedLinks: SLink[] = [
        ...(((n as any).sourceLinks ?? []) as SLink[]),
        ...(((n as any).targetLinks ?? []) as SLink[]),
      ];
      if (seedLinks.length === 0) {
        restoreAllLinks();
      } else {
        const chain = new Set<SLink>();
        for (const seed of seedLinks) {
          for (const l of connectedChain(seed)) chain.add(l);
        }
        dimAllLinksExcept(l => chain.has(l));
      }
      setTooltip({ x: event.offsetX, y: event.offsetY, html: nodeTooltipHTML(n) });
    };
    const nodeEventTotal = (n: SNode): number => {
      const inLinks  = ((n as any).targetLinks ?? []) as SLink[];
      const outLinks = ((n as any).sourceLinks ?? []) as SLink[];
      const evIn  = inLinks.reduce((s, l) => s + (l.events || 0), 0);
      const evOut = outLinks.reduce((s, l) => s + (l.events || 0), 0);
      return Math.max(evIn, evOut);
    };
    const nodeTooltipHTML = (n: SNode) => {
      const ev = nodeEventTotal(n);
      return `${n.label}<br/><b>${formatBytes(n.value ?? 0)}</b> &nbsp; · &nbsp; ${ev.toLocaleString()} ${ev === 1 ? 'event' : 'events'}`;
    };
    const onNodeMove = (event: any, n: SNode) => {
      setTooltip({ x: event.offsetX, y: event.offsetY, html: nodeTooltipHTML(n) });
    };
    const onNodeLeave = () => {
      restoreAllLinks();
      setTooltip(null);
    };

    nodeEnter.append('rect')
      .attr('width', n => Math.max(0, (n.x1 ?? 0) - (n.x0 ?? 0)))
      .attr('height', n => Math.max(0, (n.y1 ?? 0) - (n.y0 ?? 0)))
      .attr('fill', NODE_COLOR)
      .style('cursor', 'pointer')
      .on('mouseenter', onNodeEnter)
      .on('mousemove', onNodeMove)
      .on('mouseleave', onNodeLeave);

    nodeEnter.append('text')
      .attr('x', n => ((n.x0 ?? 0) < innerW / 2 ? -8 : ((n.x1 ?? 0) - (n.x0 ?? 0)) + 8))
      .attr('y', n => ((n.y1 ?? 0) - (n.y0 ?? 0)) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', n => ((n.x0 ?? 0) < innerW / 2 ? 'end' : 'start'))
      .attr('fill', '#cbd5e1')
      .attr('font-size', 12)
      .style('cursor', 'pointer')
      .style('pointer-events', 'visiblePainted')
      .on('mouseenter', onNodeEnter)
      .on('mousemove', onNodeMove)
      .on('mouseleave', onNodeLeave)
      .text(n => n.label);

    nodeEnter.transition().duration(T).attr('opacity', 0.95);

    // Update existing nodes — animate position and rect dimensions
    nodeSel.transition().duration(T)
      .attr('transform', n => `translate(${n.x0 ?? 0},${n.y0 ?? 0})`)
      .attr('opacity', 0.95);
    // Re-attach hover handlers each render so their closures (dim/restore
    // helpers) reference the current frame's links, not stale ones.
    nodeSel.select<SVGRectElement>('rect')
      .on('mouseenter', onNodeEnter)
      .on('mousemove', onNodeMove)
      .on('mouseleave', onNodeLeave);
    nodeSel.select('rect').transition().duration(T)
      .attr('width', n => Math.max(0, (n.x1 ?? 0) - (n.x0 ?? 0)))
      .attr('height', n => Math.max(0, (n.y1 ?? 0) - (n.y0 ?? 0)));
    nodeSel.select<SVGTextElement>('text')
      .attr('x', n => ((n.x0 ?? 0) < innerW / 2 ? -8 : ((n.x1 ?? 0) - (n.x0 ?? 0)) + 8))
      .attr('y', n => ((n.y1 ?? 0) - (n.y0 ?? 0)) / 2)
      .attr('text-anchor', n => ((n.x0 ?? 0) < innerW / 2 ? 'end' : 'start'))
      .text(n => n.label)
      .on('mouseenter', onNodeEnter)
      .on('mousemove', onNodeMove)
      .on('mouseleave', onNodeLeave);
  }, [width, height, resolvedColumns.join(','), JSON.stringify(headers), topNInternal, topNExternal, srcPtrField, dstPtrField, t]);

  // Snapshot loop: render immediately on mount/setting-change, then every
  // `windowSeconds` seconds. Clamp to safe bounds.
  useEffect(() => {
    render();
    if (paused) return;
    const ms = Math.max(1, Math.min(30, windowSeconds)) * 1000;
    const id = window.setInterval(render, ms);
    return () => window.clearInterval(id);
  }, [render, paused, windowSeconds]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ display: 'block', background: 'transparent' }}
      />

      {/* Left bar — stages + Top-N */}
      <div className="sankey-controls sankey-controls-left">
        <div className="sankey-control-group">
          <span className="sankey-control-label">{t('sankey.columns')}</span>
          <div className="sankey-stage-buttons">
            {COLUMN_ORDER.map(col => {
              const mandatory = MANDATORY_COLUMNS.includes(col);
              const active = mandatory || (activeColumns || []).includes(col);
              return (
                <button
                  key={col}
                  type="button"
                  disabled={mandatory}
                  className={`sankey-stage-btn ${active ? 'active' : ''} ${mandatory ? 'is-mandatory' : ''}`}
                  onClick={() => {
                    if (mandatory) return;
                    const cur = new Set<SankeyColumn>(activeColumns || []);
                    cur.has(col) ? cur.delete(col) : cur.add(col);
                    onActiveColumnsChange?.(COLUMN_ORDER.filter(c => cur.has(c)));
                  }}
                  title={mandatory ? `${headers[col]} (always shown)` : headers[col]}
                >{headers[col]}</button>
              );
            })}
          </div>
        </div>
        {onTopNExternalChange && (
          <div className="sankey-control-group">
            <span className="sankey-control-label">{t('sankey.topNExt')}</span>
            <input
              type="number"
              className="sankey-topn-input"
              value={topNExternal}
              min={0}
              onChange={e => onTopNExternalChange(parseInt(e.target.value) || 0)}
            />
          </div>
        )}
        {onTopNInternalChange && (
          <div className="sankey-control-group">
            <span className="sankey-control-label">{t('sankey.topNInt')}</span>
            <input
              type="number"
              className="sankey-topn-input"
              value={topNInternal}
              min={0}
              onChange={e => onTopNInternalChange(parseInt(e.target.value) || 0)}
            />
          </div>
        )}
      </div>

      {/* Right bar — snapshot frequency */}
      {onWindowSecondsChange && (
        <div className="sankey-controls sankey-controls-right">
          <div className="sankey-control-group">
            <span className="sankey-control-label">{t('sankey.window')}</span>
            <input
              type="range"
              className="sankey-window-slider"
              min={WINDOW_MIN_S}
              max={WINDOW_MAX_S}
              step={1}
              value={Math.max(WINDOW_MIN_S, Math.min(WINDOW_MAX_S, windowSeconds))}
              onChange={e => onWindowSecondsChange(parseInt(e.target.value))}
            />
            <input
              type="number"
              className="sankey-topn-input"
              value={windowSeconds}
              min={WINDOW_MIN_S}
              max={WINDOW_MAX_S}
              onChange={e => {
                const v = parseInt(e.target.value);
                if (!isNaN(v)) onWindowSecondsChange(Math.max(WINDOW_MIN_S, Math.min(WINDOW_MAX_S, v)));
              }}
            />
            <span className="sankey-control-label">s</span>
          </div>
        </div>
      )}

      {tooltip && (
        <div
          className="sankey-tooltip"
          style={{
            position: 'absolute',
            left: tooltip.x + 12,
            top: tooltip.y + 12,
            background: 'rgba(10, 14, 20, 0.92)',
            border: '1px solid #1f2937',
            color: '#e6edf3',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 12,
            pointerEvents: 'none',
            boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
            whiteSpace: 'nowrap',
          }}
          dangerouslySetInnerHTML={{ __html: tooltip.html }}
        />
      )}
    </div>
  );
}

function formatBytes(v: number): string {
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + ' GB';
  if (v >= 1_000_000)     return (v / 1_000_000).toFixed(2)     + ' MB';
  if (v >= 1_000)         return (v / 1_000).toFixed(1)         + ' KB';
  return v.toFixed(0) + ' B';
}
