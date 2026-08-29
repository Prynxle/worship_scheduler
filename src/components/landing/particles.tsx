'use client';

import type { CSSProperties } from 'react';

interface ParticlePreset {
  left: number; // % from scene left
  bottom: number; // % from scene bottom
  size: number; // px
  opacity: number;
  driftX: number; // px horizontal drift while rising
  dur: number; // animation seconds (6-14)
  delay: number; // animation delay seconds (0-9)
}

/**
 * Deterministic particle layout (seeded by index) so server and client
 * renders match during hydration — no Math.random() during render.
 */
const PARTICLES: ParticlePreset[] = Array.from({ length: 22 }, (_, i) => {
  const seed = (n: number) => ((i * 7919 + n * 104729) % 1000) / 1000;
  return {
    left: 4 + seed(1) * 92,
    bottom: 2 + seed(2) * 42,
    size: 3 + seed(3) * 3,
    opacity: 0.35 + seed(4) * 0.45,
    driftX: (seed(5) - 0.5) * 160,
    dur: 6 + seed(6) * 8,
    delay: seed(7) * 9,
  };
});

/**
 * Rising embers behind the cross. Uses `landing-particle-rise` keyframes
 * with per-particle `--drift-x`, `--dur`, `--delay`, `--particle-opacity`.
 * Particles are always rendered (server + client) so markup is identical
 * during hydration; reduced motion freezes them via the CSS guard, so the
 * DOM structure never depends on `useReducedMotion`.
 */
export function Particles() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {PARTICLES.map((p, i) => (
        <div
          key={i}
          className="animate-landing-particle-rise absolute rounded-full bg-landing-gold-soft"
          style={
            {
              left: `${p.left}%`,
              bottom: `${p.bottom}%`,
              width: p.size,
              height: p.size,
              opacity: p.opacity,
              filter: 'blur(0.5px)',
              '--drift-x': `${p.driftX}px`,
              '--dur': `${p.dur}s`,
              '--delay': `${p.delay}s`,
              '--particle-opacity': `${p.opacity}`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}