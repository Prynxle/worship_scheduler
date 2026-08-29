'use client';

import type { CSSProperties } from 'react';

interface RayPreset {
  width: number; // px
  offset: number; // px from scene center
  angle: number; // skew angle in degrees
  dur: number; // animation seconds
  delay: number; // animation delay seconds
  opacity: number; // base opacity
}

const RAYS: RayPreset[] = [
  { width: 60, offset: -132, angle: -12, dur: 6.5, delay: 0.2, opacity: 0.5 },
  { width: 82, offset: -72, angle: -6, dur: 8.2, delay: 1.4, opacity: 0.55 },
  { width: 96, offset: 0, angle: 0, dur: 7.4, delay: 0.8, opacity: 0.6 },
  { width: 80, offset: 62, angle: 6, dur: 9.1, delay: 2.1, opacity: 0.5 },
  { width: 58, offset: 124, angle: 12, dur: 6.9, delay: 1.1, opacity: 0.45 },
];

/**
 * Divine light rays: skewed trapezoid strips falling from above the cross.
 * Each strip translates only opacity via `landing-ray-flicker`, with a
 * per-ray `--dur`/`--delay`. Rays are always rendered (server + client) so
 * markup is identical during hydration; reduced motion freezes them via the
 * CSS guard, so the DOM structure never depends on `useReducedMotion`.
 */
export function LightRays() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {RAYS.map((ray, i) => (
        <div
          key={i}
          className="animate-landing-ray-flicker"
          style={
            {
              position: 'absolute',
              top: '-6%',
              left: '50%',
              width: ray.width,
              height: '118%',
              marginLeft: ray.offset,
              transform: `skewX(${ray.angle}deg)`,
              transformOrigin: '50% 0%',
              clipPath: 'polygon(38% 0, 62% 0, 100% 100%, 0% 100%)',
              background:
                'linear-gradient(to top, oklch(0.70 0.14 65 / 0.32), transparent 82%)',
              opacity: ray.opacity,
              '--dur': `${ray.dur}s`,
              '--delay': `${ray.delay}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}