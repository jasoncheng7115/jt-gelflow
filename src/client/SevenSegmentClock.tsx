import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from './i18n';

interface Props {
  timestamp: number | null;  // Timestamp in milliseconds, null if no data yet
  connected?: boolean;  // WebSocket connection status
}

// Seven-segment display digit patterns (a-g segments)
const DIGITS: Record<string, boolean[]> = {
  '0': [true, true, true, true, true, true, false],
  '1': [false, true, true, false, false, false, false],
  '2': [true, true, false, true, true, false, true],
  '3': [true, true, true, true, false, false, true],
  '4': [false, true, true, false, false, true, true],
  '5': [true, false, true, true, false, true, true],
  '6': [true, false, true, true, true, true, true],
  '7': [true, true, true, false, false, false, false],
  '8': [true, true, true, true, true, true, true],
  '9': [true, true, true, true, false, true, true],
  '-': [false, false, false, false, false, false, true],
  ' ': [false, false, false, false, false, false, false],
};

function SevenSegmentDigit({ digit, size = 20, color = '#00ffcc', glow = false, dimColor = 'rgba(0, 255, 204, 0.08)' }: {
  digit: string;
  size?: number;
  color?: string;
  glow?: boolean;
  dimColor?: string;
}) {
  const segments = DIGITS[digit] || DIGITS[' '];
  const w = size;
  const h = size * 1.8;
  const thickness = size * 0.15;
  const gap = size * 0.05;
  const glowIntensity = glow ? size * 0.4 : size * 0.15;

  const segmentPaths = [
    `M ${gap + thickness} ${gap} L ${w - gap - thickness} ${gap} L ${w - gap - thickness * 0.3} ${thickness * 0.7 + gap} L ${gap + thickness * 0.3} ${thickness * 0.7 + gap} Z`,
    `M ${w - gap} ${gap + thickness} L ${w - gap} ${h / 2 - gap} L ${w - gap - thickness * 0.7} ${h / 2 - gap - thickness * 0.3} L ${w - gap - thickness * 0.7} ${gap + thickness + thickness * 0.3} Z`,
    `M ${w - gap} ${h / 2 + gap} L ${w - gap} ${h - gap - thickness} L ${w - gap - thickness * 0.7} ${h - gap - thickness - thickness * 0.3} L ${w - gap - thickness * 0.7} ${h / 2 + gap + thickness * 0.3} Z`,
    `M ${gap + thickness} ${h - gap} L ${w - gap - thickness} ${h - gap} L ${w - gap - thickness * 0.3} ${h - thickness * 0.7 - gap} L ${gap + thickness * 0.3} ${h - thickness * 0.7 - gap} Z`,
    `M ${gap} ${h / 2 + gap} L ${gap} ${h - gap - thickness} L ${gap + thickness * 0.7} ${h - gap - thickness - thickness * 0.3} L ${gap + thickness * 0.7} ${h / 2 + gap + thickness * 0.3} Z`,
    `M ${gap} ${gap + thickness} L ${gap} ${h / 2 - gap} L ${gap + thickness * 0.7} ${h / 2 - gap - thickness * 0.3} L ${gap + thickness * 0.7} ${gap + thickness + thickness * 0.3} Z`,
    `M ${gap + thickness * 0.5} ${h / 2} L ${gap + thickness} ${h / 2 - thickness * 0.4} L ${w - gap - thickness} ${h / 2 - thickness * 0.4} L ${w - gap - thickness * 0.5} ${h / 2} L ${w - gap - thickness} ${h / 2 + thickness * 0.4} L ${gap + thickness} ${h / 2 + thickness * 0.4} Z`,
  ];

  return (
    <svg width={w} height={h} style={{ display: 'inline-block' }}>
      {segmentPaths.map((path, i) => (
        <path
          key={i}
          d={path}
          fill={segments[i] ? color : dimColor}
          style={{
            filter: segments[i] ? `drop-shadow(0 0 ${glowIntensity}px ${color})` : 'none',
            transition: 'fill 0.03s ease-out',
          }}
        />
      ))}
    </svg>
  );
}

function Colon({ size = 20, color = '#00ffcc', dim = false }: { size?: number; color?: string; dim?: boolean }) {
  const w = size * 0.4;
  const h = size * 1.8;
  const dotSize = size * 0.15;
  const opacity = dim ? 0.15 : 1;

  return (
    <svg width={w} height={h} style={{ display: 'inline-block' }}>
      <circle cx={w / 2} cy={h * 0.3} r={dotSize} fill={color} opacity={opacity}
        style={{ filter: dim ? 'none' : `drop-shadow(0 0 ${size * 0.1}px ${color})` }} />
      <circle cx={w / 2} cy={h * 0.7} r={dotSize} fill={color} opacity={opacity}
        style={{ filter: dim ? 'none' : `drop-shadow(0 0 ${size * 0.1}px ${color})` }} />
    </svg>
  );
}

function Dot({ size = 20, color = '#00ffcc', dim = false }: { size?: number; color?: string; dim?: boolean }) {
  const w = size * 0.3;
  const h = size * 1.8;
  const dotSize = size * 0.12;
  const opacity = dim ? 0.15 : 1;

  return (
    <svg width={w} height={h} style={{ display: 'inline-block' }}>
      <circle cx={w / 2} cy={h - size * 0.2} r={dotSize} fill={color} opacity={opacity}
        style={{ filter: dim ? 'none' : `drop-shadow(0 0 ${size * 0.1}px ${color})` }} />
    </svg>
  );
}

// Helper to format timestamp to time parts
function formatTimestamp(ts: number): { hours: string; minutes: string; seconds: string; centiseconds: string } {
  const date = new Date(ts);
  return {
    hours: date.getHours().toString().padStart(2, '0'),
    minutes: date.getMinutes().toString().padStart(2, '0'),
    seconds: date.getSeconds().toString().padStart(2, '0'),
    centiseconds: Math.floor(date.getMilliseconds() / 10).toString().padStart(2, '0'),
  };
}

// Generate random time display
function randomTime(): { hours: string; minutes: string; seconds: string; centiseconds: string } {
  return {
    hours: Math.floor(Math.random() * 24).toString().padStart(2, '0'),
    minutes: Math.floor(Math.random() * 60).toString().padStart(2, '0'),
    seconds: Math.floor(Math.random() * 60).toString().padStart(2, '0'),
    centiseconds: Math.floor(Math.random() * 100).toString().padStart(2, '0'),
  };
}

export function SevenSegmentClock({ timestamp, connected = true }: Props) {
  const { t } = useTranslation();
  const [displayTime, setDisplayTime] = useState({ hours: '  ', minutes: '  ', seconds: '  ', centiseconds: '  ' });
  const [isAnimating, setIsAnimating] = useState(false);
  const [isFirstSpin, setIsFirstSpin] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  // Refs for tracking state across renders
  const hasReceivedFirstEventRef = useRef(false);
  const spinAnimationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastDisplayedTimestampRef = useRef<number | null>(null);

  // Color based on connection status
  const color = connected ? '#00ffcc' : '#ff4444';
  const dimColor = connected ? 'rgba(0, 255, 204, 0.08)' : 'rgba(255, 68, 68, 0.08)';
  const isBlank = displayTime.hours === '  ';

  // Update display with a specific timestamp
  const updateDisplay = useCallback((ts: number, animate: boolean = true) => {
    const time = formatTimestamp(ts);

    if (animate) {
      // Quick animation for centiseconds
      setIsAnimating(true);
      setDisplayTime(prev => ({ ...prev, hours: time.hours, minutes: time.minutes, seconds: time.seconds }));

      let frame = 0;
      const animateCs = () => {
        frame++;
        if (frame < 8) {
          setDisplayTime(prev => ({ ...prev, centiseconds: Math.floor(Math.random() * 100).toString().padStart(2, '0') }));
          requestAnimationFrame(animateCs);
        } else {
          const finalCs = time.centiseconds === '00' ? Math.floor(Math.random() * 100).toString().padStart(2, '0') : time.centiseconds;
          setDisplayTime(prev => ({ ...prev, centiseconds: finalCs }));
          setIsAnimating(false);
        }
      };
      requestAnimationFrame(animateCs);
    } else {
      const finalCs = time.centiseconds === '00' ? Math.floor(Math.random() * 100).toString().padStart(2, '0') : time.centiseconds;
      setDisplayTime({ ...time, centiseconds: finalCs });
    }

    lastDisplayedTimestampRef.current = ts;
  }, []);

  // Handle first event - do the rapid spin animation
  const startFirstSpinAnimation = useCallback((targetTimestamp: number) => {
    if (spinAnimationRef.current) {
      clearInterval(spinAnimationRef.current);
    }

    setIsFirstSpin(true);
    setIsAnimating(true);

    let spinCount = 0;
    const totalSpins = 25;  // 25 * 40ms = 1 second
    const spinSpeed = 40;

    // Store the target timestamp in a ref so we can access it when animation ends
    const targetRef = { current: targetTimestamp };

    spinAnimationRef.current = setInterval(() => {
      spinCount++;

      if (spinCount < totalSpins) {
        setDisplayTime(randomTime());
      } else {
        // Animation complete
        if (spinAnimationRef.current) {
          clearInterval(spinAnimationRef.current);
          spinAnimationRef.current = null;
        }

        // Use the latest timestamp we've seen
        const finalTime = formatTimestamp(targetRef.current);
        const finalCs = finalTime.centiseconds === '00' ? Math.floor(Math.random() * 100).toString().padStart(2, '0') : finalTime.centiseconds;
        setDisplayTime({ ...finalTime, centiseconds: finalCs });
        lastDisplayedTimestampRef.current = targetRef.current;

        setIsFirstSpin(false);
        setIsAnimating(false);
      }
    }, spinSpeed);

    // Return a function to update the target timestamp
    return (newTs: number) => {
      targetRef.current = newTs;
    };
  }, []);

  // Track the update function for the current spin animation
  const spinUpdateRef = useRef<((ts: number) => void) | null>(null);

  // Main effect to handle timestamp changes
  useEffect(() => {
    // No timestamp yet
    if (timestamp === null) {
      if (!hasReceivedFirstEventRef.current) {
        setDisplayTime({ hours: '  ', minutes: '  ', seconds: '  ', centiseconds: '  ' });
      }
      return;
    }

    // First event ever - start the spin animation
    if (!hasReceivedFirstEventRef.current) {
      hasReceivedFirstEventRef.current = true;
      spinUpdateRef.current = startFirstSpinAnimation(timestamp);
      return;
    }

    // If spin animation is in progress, just update the target timestamp
    if (spinAnimationRef.current && spinUpdateRef.current) {
      spinUpdateRef.current(timestamp);
      return;
    }

    // Normal update - only if timestamp changed
    if (lastDisplayedTimestampRef.current !== timestamp) {
      updateDisplay(timestamp);
    }
  }, [timestamp, startFirstSpinAnimation, updateDisplay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (spinAnimationRef.current) {
        clearInterval(spinAnimationRef.current);
      }
    };
  }, []);

  const size = 16;

  return (
    <div
      className={`seven-segment-clock ${isAnimating ? 'pulse' : ''} ${isFirstSpin ? 'first-spin' : ''}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {showTooltip && (
        <div className="clock-tooltip">
          {t('clock.lastLogTimestamp')}
        </div>
      )}
      <div className="clock-label">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span style={{ color }}>LAST</span>
      </div>
      <div className="clock-display">
        {(displayTime.hours || '  ').split('').map((d, i) => (
          <SevenSegmentDigit key={`h${i}`} digit={d || ' '} size={size} color={color} dimColor={dimColor} glow={isFirstSpin} />
        ))}
        <Colon size={size} color={color} dim={isBlank} />
        {(displayTime.minutes || '  ').split('').map((d, i) => (
          <SevenSegmentDigit key={`m${i}`} digit={d || ' '} size={size} color={color} dimColor={dimColor} glow={isFirstSpin} />
        ))}
        <Colon size={size} color={color} dim={isBlank} />
        {(displayTime.seconds || '  ').split('').map((d, i) => (
          <SevenSegmentDigit key={`s${i}`} digit={d || ' '} size={size} color={color} dimColor={dimColor} glow={isFirstSpin} />
        ))}
        <Dot size={size} color={color} dim={isBlank} />
        {(displayTime.centiseconds || '  ').split('').map((d, i) => (
          <SevenSegmentDigit key={`cs${i}`} digit={d || ' '} size={size * 0.85} color={color} dimColor={dimColor} glow={isAnimating} />
        ))}
      </div>
    </div>
  );
}
