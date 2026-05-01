import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { FlowData } from './types';
import { useTranslation } from './i18n';

interface Props {
  onQueryChange: (query: string) => void;
  placeholder?: string;
}

interface ParsedFilter {
  includeIps: string[];
  excludeIps: string[];
  includePorts: string[];
  excludePorts: string[];
}

// Parse simple filter: IPs and ports, prefix with - to exclude
// Example: "192.168.1.68 443" - include IP and port
// Example: "-192.168.1.68 !80" - exclude IP and port
function parseFilter(query: string): ParsedFilter {
  const result: ParsedFilter = {
    includeIps: [],
    excludeIps: [],
    includePorts: [],
    excludePorts: [],
  };

  if (!query.trim()) return result;

  // Split by whitespace or comma
  const tokens = query.split(/[\s,]+/).filter(t => t.length > 0);

  for (const token of tokens) {
    let value = token;
    let isExclude = false;

    // Check for exclude prefix
    if (value.startsWith('-') || value.startsWith('!')) {
      isExclude = true;
      value = value.slice(1);
    }

    if (!value) continue;

    // Determine if it's an IP or port
    const isPort = /^\d+$/.test(value) && parseInt(value) <= 65535;
    const isIp = /^[\d.]+$/.test(value) && value.includes('.');

    if (isPort) {
      if (isExclude) {
        result.excludePorts.push(value);
      } else {
        result.includePorts.push(value);
      }
    } else if (isIp || value.length > 0) {
      // Treat as IP or partial IP match
      if (isExclude) {
        result.excludeIps.push(value.toLowerCase());
      } else {
        result.includeIps.push(value.toLowerCase());
      }
    }
  }

  return result;
}

// Check if a flow matches the filter
function matchFlow(flow: FlowData, filter: ParsedFilter): boolean {
  const { includeIps, excludeIps, includePorts, excludePorts } = filter;

  // Get all IPs and ports from the flow
  const flowIps = [
    flow.key.src.toLowerCase(),
    flow.key.dst.toLowerCase(),
    String(flow.fields?.source_ip || '').toLowerCase(),
    String(flow.fields?.destination_ip || '').toLowerCase(),
  ];

  const flowPorts = [
    String(flow.fields?.source_port || ''),
    String(flow.fields?.destination_port || ''),
  ];

  // Also check labels for partial matches
  const flowLabels = [
    flow.srcLabel.toLowerCase(),
    flow.dstLabel.toLowerCase(),
  ];

  // Check excludes first - if any exclude matches, reject
  for (const ip of excludeIps) {
    if (flowIps.some(fip => fip.includes(ip)) || flowLabels.some(l => l.includes(ip))) {
      return false;
    }
  }

  for (const port of excludePorts) {
    if (flowPorts.some(fp => fp === port)) {
      return false;
    }
  }

  // Check includes - all must match (if specified)
  if (includeIps.length > 0) {
    const ipMatch = includeIps.some(ip =>
      flowIps.some(fip => fip.includes(ip)) || flowLabels.some(l => l.includes(ip))
    );
    if (!ipMatch) return false;
  }

  if (includePorts.length > 0) {
    const portMatch = includePorts.some(port => flowPorts.some(fp => fp === port));
    if (!portMatch) return false;
  }

  return true;
}

// Create a filter function from query string
export function createFlowFilter(queryString: string): (flow: FlowData) => boolean {
  const parsed = parseFilter(queryString);
  return (flow: FlowData) => matchFlow(flow, parsed);
}

export function SearchBar({ onQueryChange, placeholder = 'IP or Port, -exclude' }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout>();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    // Debounce the query change
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      onQueryChange(value);
    }, 150);
  }, [onQueryChange]);

  const handleClear = useCallback(() => {
    setQuery('');
    onQueryChange('');
  }, [onQueryChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClear();
      (e.target as HTMLInputElement).blur();
    }
  }, [handleClear]);

  // Close expanded filter when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    if (expanded) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [expanded]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <div className={`filter-bar-wrapper ${expanded ? 'expanded' : ''}`} ref={wrapperRef}>
      <button
        className={`filter-bar-toggle ${query ? 'has-filter' : ''}`}
        onClick={() => setExpanded(!expanded)}
        title={t('filter.usage')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
      </button>
      <div className={`filter-bar ${isFocused ? 'focused' : ''}`}>
      <svg className="filter-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
      </svg>
      <input
        type="text"
        value={query}
        onChange={handleChange}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        spellCheck={false}
      />
      {query && (
        <button className="filter-clear" onClick={handleClear} title="Clear (Esc)">
          &times;
        </button>
      )}
      <button
        className="filter-help-btn"
        onClick={() => setShowHelp(!showHelp)}
        title="Filter Help"
      >
        ?
      </button>
      {showHelp && (
        <div className="filter-help-popup">
          <div className="filter-help-header">
            <span>{t('filter.usage')}</span>
            <button onClick={() => setShowHelp(false)}>&times;</button>
          </div>
          <div className="filter-help-content">
            <table>
              <tbody>
                <tr><td><code>192.168.1.68</code></td><td>{t('filter.showIp')}</td></tr>
                <tr><td><code>443</code></td><td>{t('filter.showPort')}</td></tr>
                <tr><td><code>192.168.1.68 443</code></td><td>{t('filter.ipAndPort')}</td></tr>
                <tr><td><code>192.168.1.1, 10.0.0.1</code></td><td>{t('filter.multipleIps')}</td></tr>
                <tr><td><code>-192.168.1.68</code></td><td>{t('filter.excludeIp')}</td></tr>
                <tr><td><code>!80</code></td><td>{t('filter.excludePort')}</td></tr>
                <tr><td><code>mon5</code></td><td>{t('filter.matchLabel')}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
