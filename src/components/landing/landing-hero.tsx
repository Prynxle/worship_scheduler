'use client';

import {
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  type Variants,
} from 'motion/react';
import { Cross3D } from './cross-3d';
import { LightRays } from './light-rays';
import { Particles } from './particles';

/**
 * Entrance choreography for the scene layers. Children reveal in order
 * (glow -> rays -> floor -> cross -> particles) at ~0.12s stagger,
 * mirroring the page copy's eyebrow -> heading -> sub -> desc -> CTA flow.
 */
const sceneContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.15 } },
};

const sceneFade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.8, ease: 'easeOut' } },
};

const FLOOR_STYLE = {
  position: 'absolute' as const,
  left: '50%',
  bottom: 0,
  width: 560,
  height: 210,
  marginLeft: -280,
  transform: 'perspective(600px) rotateX(60deg)',
  transformOrigin: '50% 0%',
  background:
    'radial-gradient(ellipse 62% 55% at 50% 45%, oklch(0.70 0.14 65 / 0.22) 0%, oklch(0.33 0.05 55 / 0.32) 52%, transparent 74%)',
};

/**
 * "Light of the Cross" hero scene. Owns pointer tilt (spring physics,
 * mirroring TiltCard) and feeds smoothed rotations to <Cross3D/>. Renders
 * the divine glow core, reflective floor plane, light rays, 3D cross, and
 * rising particles. `useReducedMotion` only disables the pointer-tilt
 * handler logic — it never changes the rendered JSX, so server and client
 * markup stay identical during hydration. Decorative motion (glow, rays,
 * particles) is frozen by the CSS `@media (prefers-reduced-motion: reduce)`
 * guard in globals.css.
 */
export function LandingHero() {
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = prefersReducedMotion ?? false;

  const containerRef = useRef<HTMLDivElement>(null);

  // Tilt springs: stiffness 150 / damping 16 (TiltCard range 120-180 / 14-20)
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const springRotateX = useSpring(rotateX, { stiffness: 150, damping: 16 });
  const springRotateY = useSpring(rotateY, { stiffness: 150, damping: 16 });

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (reducedMotion) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const px = x / rect.width - 0.5; // -0.5..0.5
      const py = y / rect.height - 0.5;

      // Max tilt ~6deg (matches TiltCard's 3-8 range)
      rotateY.set(px * 12);
      rotateX.set(-py * 12);
    },
    [reducedMotion, rotateX, rotateY],
  );

  const resetTilt = useCallback(() => {
    rotateX.set(0);
    rotateY.set(0);
  }, [rotateX, rotateY]);

  return (
    <motion.div
      ref={containerRef}
      className="relative mx-auto h-[440px] w-full max-w-[560px] select-none overflow-hidden sm:h-[500px]"
      initial="hidden"
      animate="show"
      variants={sceneContainer}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetTilt}
    >
      {/* Divine glow core: radial gold blur behind everything */}
      <motion.div variants={sceneFade} className="absolute inset-0" aria-hidden>
        <div
          className="animate-landing-glow-pulse"
          style={{
            position: 'absolute',
            left: '50%',
            top: '46%',
            width: 340,
            height: 340,
            transform: 'translate(-50%, -50%)',
            background:
              'radial-gradient(circle, oklch(0.70 0.14 65 / 0.55) 0%, oklch(0.70 0.14 65 / 0.16) 46%, transparent 68%)',
          }}
        />
      </motion.div>

      {/* Light rays */}
      <motion.div variants={sceneFade} className="absolute inset-0">
        <LightRays />
      </motion.div>

      {/* Reflective floor plane (gold/wood radial, receding) */}
      <motion.div variants={sceneFade} className="absolute inset-x-0 bottom-0" aria-hidden>
        <div style={FLOOR_STYLE} />
      </motion.div>

      {/* 3D cross, tilting with the pointer */}
      <motion.div variants={sceneFade} className="absolute inset-0 z-20">
        <Cross3D rotateX={springRotateX} rotateY={springRotateY} />
      </motion.div>

      {/* Rising embers in front of the cross */}
      <motion.div variants={sceneFade} className="absolute inset-0 z-30">
        <Particles />
      </motion.div>
    </motion.div>
  );
}