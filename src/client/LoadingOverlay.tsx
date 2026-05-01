import React, { useEffect, useState } from 'react';

interface Props {
  visible: boolean;
  progress?: number;  // 0-100, optional progress indicator
  status?: string;    // Status text to display
}

export function LoadingOverlay({ visible, progress, status }: Props) {
  const [mounted, setMounted] = useState(visible);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setFadeOut(false);
    } else {
      // Start fade out animation
      setFadeOut(true);
      // Remove from DOM after animation
      const timer = setTimeout(() => setMounted(false), 600);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!mounted) return null;

  return (
    <div className={`loading-overlay ${fadeOut ? 'fade-out' : ''}`}>
      {/* Animated background grid */}
      <div className="loading-grid">
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={`h${i}`} className="grid-line horizontal" style={{ top: `${i * 5}%` }} />
        ))}
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={`v${i}`} className="grid-line vertical" style={{ left: `${i * 5}%` }} />
        ))}
      </div>

      {/* Scanning line effect */}
      <div className="scanning-line" />

      {/* Center content */}
      <div className="loading-content">
        {/* Rotating rings */}
        <div className="loading-rings">
          <div className="ring ring-1" />
          <div className="ring ring-2" />
          <div className="ring ring-3" />

          {/* Center pulse */}
          <div className="center-pulse">
            <div className="pulse-core" />
            <div className="pulse-wave pulse-wave-1" />
            <div className="pulse-wave pulse-wave-2" />
            <div className="pulse-wave pulse-wave-3" />
          </div>
        </div>

        {/* Progress bar */}
        <div className="loading-progress-container">
          <div className="loading-progress-bar">
            <div
              className="loading-progress-fill"
              style={{ width: progress !== undefined ? `${progress}%` : '0%' }}
            />
            <div className="loading-progress-glow" />
          </div>
          <div className="loading-progress-text">
            {progress !== undefined ? `${Math.round(progress)}%` : 'INITIALIZING'}
          </div>
        </div>

        {/* Status text */}
        <div className="loading-status">
          <span className="loading-status-text">{status || 'CONNECTING TO SYSTEM'}</span>
          <span className="loading-dots">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </div>

        {/* Corner decorations */}
        <div className="loading-corner top-left">
          <svg viewBox="0 0 40 40">
            <path d="M0 20 L0 0 L20 0" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </div>
        <div className="loading-corner top-right">
          <svg viewBox="0 0 40 40">
            <path d="M20 0 L40 0 L40 20" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </div>
        <div className="loading-corner bottom-left">
          <svg viewBox="0 0 40 40">
            <path d="M0 20 L0 40 L20 40" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </div>
        <div className="loading-corner bottom-right">
          <svg viewBox="0 0 40 40">
            <path d="M20 40 L40 40 L40 20" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </div>
      </div>

      {/* Floating particles */}
      <div className="loading-particles">
        {Array.from({ length: 30 }).map((_, i) => (
          <div
            key={i}
            className="particle"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${3 + Math.random() * 4}s`,
            }}
          />
        ))}
      </div>

      {/* Data stream effect on sides */}
      <div className="data-stream left">
        {Array.from({ length: 15 }).map((_, i) => (
          <div
            key={i}
            className="data-line"
            style={{
              animationDelay: `${i * 0.2}s`,
              width: `${20 + Math.random() * 80}px`,
            }}
          />
        ))}
      </div>
      <div className="data-stream right">
        {Array.from({ length: 15 }).map((_, i) => (
          <div
            key={i}
            className="data-line"
            style={{
              animationDelay: `${i * 0.2}s`,
              width: `${20 + Math.random() * 80}px`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
