import React, { useRef, useEffect } from 'react';

interface Props {
  width: number;
  height: number;
  duration?: number;
  onComplete?: () => void;
}

export function MatrixRain({ width, height, duration = 2500, onComplete }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const completedRef = useRef<boolean>(false);
  const onCompleteRef = useRef(onComplete);

  // Keep onComplete ref updated without triggering effect re-run
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) {
      // Invalid dimensions, complete immediately
      onCompleteRef.current?.();
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      onCompleteRef.current?.();
      return;
    }

    completedRef.current = false;

    // Matrix characters
    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF';
    const charArray = chars.split('');

    const fontSize = 18;
    const columns = Math.floor(width / fontSize);

    // Initialize drops - staggered across the full screen height for dense rain
    const drops: number[] = new Array(columns).fill(0).map(() => {
      // Some start above, some already on screen for immediate density
      const rand = Math.random();
      if (rand < 0.3) {
        return -Math.random() * height * 0.3; // Above screen
      } else if (rand < 0.6) {
        return Math.random() * height * 0.5; // Top half
      } else {
        return Math.random() * height; // Anywhere on screen
      }
    });

    const speeds: number[] = new Array(columns).fill(0).map(() =>
      6 + Math.random() * 10  // Speed: 6-16 pixels per frame
    );

    const startTime = performance.now();
    let lastTime = startTime;
    let backgroundAlpha = 1; // For fade-out transition

    // Fill initial black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const animate = (currentTime: number) => {
      if (completedRef.current) return;

      const elapsed = currentTime - startTime;
      const deltaTime = Math.min(currentTime - lastTime, 50); // Cap delta to avoid jumps
      lastTime = currentTime;

      const progress = elapsed / duration;

      // Smooth easing function for more natural fade
      const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
      const easeInOutQuad = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      // Rain alpha: full until 40%, then smoothly fade out
      let rainAlpha = 1;
      if (progress > 0.4) {
        const fadeProgress = (progress - 0.4) / 0.6; // 0 to 1 over remaining 60%
        rainAlpha = 1 - easeInOutQuad(fadeProgress);
      }

      // Background fade: start fading at 45% to reveal Flow underneath smoothly
      if (progress > 0.45) {
        const bgFadeProgress = (progress - 0.45) / 0.55; // 0 to 1 over remaining 55%
        backgroundAlpha = 1 - easeOutCubic(bgFadeProgress);
      }

      // Check if animation should end
      if (progress >= 1) {
        completedRef.current = true;
        ctx.clearRect(0, 0, width, height);
        onCompleteRef.current?.();
        return;
      }

      // Clear canvas with decreasing opacity black (reveals content underneath as it fades)
      ctx.clearRect(0, 0, width, height);
      if (backgroundAlpha > 0.01) {
        ctx.fillStyle = `rgba(0, 0, 0, ${backgroundAlpha})`;
        ctx.fillRect(0, 0, width, height);
      }

      ctx.font = `bold ${fontSize}px monospace`;

      // Draw each column
      for (let i = 0; i < columns; i++) {
        const x = i * fontSize;
        const y = drops[i];

        // Only draw if on screen
        if (y >= -fontSize && y < height + fontSize) {
          // Random character
          const char = charArray[Math.floor(Math.random() * charArray.length)];

          // Head character (brightest - white/light green)
          if (y >= 0 && y < height) {
            ctx.shadowColor = '#00ff00';
            ctx.shadowBlur = 12 * rainAlpha;
            ctx.fillStyle = `rgba(200, 255, 200, ${rainAlpha})`;
            ctx.fillText(char, x, y);
            ctx.shadowBlur = 0;
          }

          // Draw trail above the head
          const trailLength = 20;
          for (let j = 1; j <= trailLength; j++) {
            const trailY = y - j * fontSize;
            if (trailY < 0) break;
            if (trailY > height) continue;

            const trailChar = charArray[Math.floor(Math.random() * charArray.length)];
            const trailFade = (1 - j / trailLength) * 0.8 * rainAlpha;
            const green = Math.floor(255 - (j / trailLength) * 100);

            ctx.fillStyle = `rgba(0, ${green}, 50, ${trailFade})`;
            ctx.fillText(trailChar, x, trailY);
          }
        }

        // Move drop down
        drops[i] += speeds[i] * (deltaTime / 16); // Normalize to ~60fps

        // Reset more frequently for continuous rain waves
        if (drops[i] > height + fontSize * 10) {
          // Immediately respawn at top with some randomness
          drops[i] = -fontSize * (1 + Math.random() * 8);
          speeds[i] = 6 + Math.random() * 10;
        }
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      completedRef.current = true;
      cancelAnimationFrame(animationRef.current);
    };
  }, [width, height, duration]); // Note: onComplete is handled via ref to avoid re-triggering

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 1000,
        pointerEvents: 'none',
      }}
    />
  );
}
