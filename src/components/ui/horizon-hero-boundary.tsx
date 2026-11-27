'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type ReactNode } from 'react';

const HeroScene = dynamic(
  () => import('@/components/ui/horizon-hero-scene').then((module) => module.HeroScene),
  { ssr: false },
);

/**
 * Client boundary for the landing page. Only this wrapper hydrates on first
 * load; the Three.js/GSAP scene is a separate lazy chunk. Reduced-motion users
 * never request that chunk and keep the server-rendered CSS fallback.
 */
export function HeroSceneBoundary({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [sceneEnabled, setSceneEnabled] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => setSceneEnabled(!preference.matches);

    syncPreference();
    preference.addEventListener?.('change', syncPreference);
    return () => preference.removeEventListener?.('change', syncPreference);
  }, []);

  return (
    <div ref={containerRef} className="hero-container cosmos-style">
      {sceneEnabled ? <HeroScene containerRef={containerRef} /> : null}
      {children}
    </div>
  );
}
