import React from 'react';
import { useTranslation } from './i18n';

// Iconoir SVG icons (https://iconoir.com/) - embedded inline
const MinusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 12h12" />
  </svg>
);

const PlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 12h12M12 6v12" />
  </svg>
);

// Reset/Fit to view icon - arrows pointing inward to center
const ResetZoomIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {/* Top-left corner arrow pointing to center */}
    <path d="M4 4h5v5" />
    <path d="M4 4l6 6" />
    {/* Top-right corner arrow pointing to center */}
    <path d="M20 4h-5v5" />
    <path d="M20 4l-6 6" />
    {/* Bottom-left corner arrow pointing to center */}
    <path d="M4 20h5v-5" />
    <path d="M4 20l6-6" />
    {/* Bottom-right corner arrow pointing to center */}
    <path d="M20 20h-5v-5" />
    <path d="M20 20l-6-6" />
  </svg>
);

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 17l4 4M3 11a8 8 0 1 0 16 0 8 8 0 0 0-16 0Z" />
  </svg>
);

interface ZoomControlsProps {
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onZoomTo: (level: number) => void;
  presets?: number[];
  minZoom?: number;
  maxZoom?: number;
}

const defaultPresets = [0.5, 1, 2, 5, 10, 20];

export function ZoomControls({
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onZoomTo,
  presets = defaultPresets,
  minZoom = 0.3,
  maxZoom = 50,
}: ZoomControlsProps) {
  const { t } = useTranslation();
  return (
    <div className="zoom-controls">
      <button
        className="zoom-btn"
        onClick={onZoomOut}
        title={t('zoom.out')}
        disabled={zoomLevel <= minZoom}
      >
        <MinusIcon />
      </button>

      <span className="zoom-level">{zoomLevel.toFixed(1)}x</span>

      <button
        className="zoom-btn"
        onClick={onZoomIn}
        title={t('zoom.in')}
        disabled={zoomLevel >= maxZoom}
      >
        <PlusIcon />
      </button>

      <div className="zoom-divider" />

      <button
        className="zoom-btn"
        onClick={onZoomReset}
        title={t('zoom.reset')}
      >
        <ResetZoomIcon />
      </button>

      <div className="zoom-divider" />

      {presets.map(level => (
        <button
          key={level}
          className={`zoom-preset ${Math.abs(zoomLevel - level) < 0.1 ? 'active' : ''}`}
          onClick={() => onZoomTo(level)}
          title={`${t('zoom.to')} ${level}x`}
        >
          {level}x
        </button>
      ))}
    </div>
  );
}
