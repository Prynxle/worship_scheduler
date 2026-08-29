'use client';

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
} from 'motion/react';
import { cn } from '@/lib/utils';

interface TiltCardProps {
  children: React.ReactNode;
  className?: string;
  /** Max tilt angle in degrees (3-8, default 5) */
  tilt?: number;
  /** Show radial glare overlay on hover */
  glare?: boolean;
  /** Stagger delay in seconds for entrance animation */
  delay?: number;
}

/**
 * TiltCard wraps content in a 3D perspective container.
 *
 * Architecture:
 *   .entrance            → fade/rise on mount
 *     .perspective       → perspective + preserve-3d
 *       .glow-backdrop   → sibling at translateZ(-32px)
 *       .tilt-surface    → rotateX/rotateY + translateZ(+14px) lift
 *         {children}
 *         .glare-overlay → radial gradient following the pointer
 *
 * The glow backdrop is a sibling rendered outside the shadcn Card
 * (which has overflow-hidden) so 3D effects are never clipped.
 */
export function TiltCard({
  children,
  className,
  tilt = 5,
  glare = true,
  delay = 0,
}: TiltCardProps) {
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = prefersReducedMotion ?? false;

  const [isHovered, setIsHovered] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // SSR-safe "after hydration" gate. `mounted` is `false` during server
  // render AND during the client's first (hydration) render, so server and
  // client always render IDENTICAL markup (the full 3D tree). Only after
  // hydration completes does `mounted` flip to `true`, letting the reduced
  // simple branch swap in for reduced-motion clients — no HTML mismatch.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Mount entrance gate so `delay` can stagger cards
  useEffect(() => {
    const timer = setTimeout(() => setIsMounted(true), delay * 1000);
    return () => clearTimeout(timer);
  }, [delay]);

  // Tilt rotation motion values with spring physics
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const springRotateX = useSpring(rotateX, { stiffness: 150, damping: 15 });
  const springRotateY = useSpring(rotateY, { stiffness: 150, damping: 15 });

  // Lift layer (+14px) and glow backdrop (-32px)
  const liftValue = useMotionValue(0);
  const liftZ = useSpring(liftValue, { stiffness: 200, damping: 20 });

  // Glare position + opacity
  const glareX = useMotionValue(50);
  const glareY = useMotionValue(50);
  const glareOpacityValue = useMotionValue(0);
  const glareOpacity = useSpring(glareOpacityValue, { stiffness: 200, damping: 25 });

  // Radial gradient that follows the pointer
  const glareBackground = useTransform(
    [glareX, glareY],
    ([gx, gy]) =>
      `radial-gradient(circle at ${gx}% ${gy}%, oklch(1 0 0 / 0.12) 0%, transparent 60%)`,
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (reducedMotion || !isHovered) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Normalized to -1..1 and clamped by the tilt prop
      rotateX.set(-((y - rect.height / 2) / (rect.height / 2)) * tilt);
      rotateY.set(((x - rect.width / 2) / (rect.width / 2)) * tilt);

      glareX.set((x / rect.width) * 100);
      glareY.set((y / rect.height) * 100);
    },
    [reducedMotion, isHovered, tilt, rotateX, rotateY, glareX, glareY],
  );

  const handlePointerEnter = useCallback(() => {
    setIsHovered(true);
    if (!reducedMotion) {
      glareOpacityValue.set(0.15);
      liftValue.set(14);
    }
  }, [reducedMotion, glareOpacityValue, liftValue]);

  const handlePointerLeave = useCallback(() => {
    setIsHovered(false);
    rotateX.set(0);
    rotateY.set(0);
    glareOpacityValue.set(0);
    liftValue.set(0);
  }, [rotateX, rotateY, glareOpacityValue, liftValue]);

  // Reduced motion: fade only, no tilt, no glare, no lift. Swapped in only
  // AFTER hydration (mounted) so server and hydration markup always match.
  if (mounted && reducedMotion) {
    return (
      <motion.div
        className={cn('flex w-full', className)}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay }}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      className={cn('flex w-full', className)}
      initial={{ opacity: 0, y: 8 }}
      animate={isMounted ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Perspective container */}
      <div
        ref={containerRef}
        className="relative flex w-full"
        style={{ perspective: 1000, transformStyle: 'preserve-3d' }}
        onPointerMove={handlePointerMove}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        {/* Glow backdrop at -32px (sibling, outside Card overflow) */}
        <div
          className="pointer-events-none absolute inset-0 rounded-xl"
          style={{
            transform: 'translateZ(-32px)',
            boxShadow:
              '0 0 24px oklch(0.72 0.030 65 / 0.06), 0 0 48px oklch(0.72 0.030 65 / 0.03)',
            opacity: isHovered ? 1 : 0,
            transition: 'opacity 0.3s ease',
          }}
        />

        {/* Tilt surface: rotateX/Y + translateZ lift */}
        <motion.div
          className="relative flex w-full"
          style={{
            rotateX: springRotateX,
            rotateY: springRotateY,
            translateZ: liftZ,
            transformStyle: 'preserve-3d',
            willChange: 'transform',
          }}
        >
          {children}

          {/* Glare overlay (clipped by Card's overflow-hidden) */}
          {glare && (
            <motion.div
              className="pointer-events-none absolute inset-0 z-10 rounded-xl"
              style={{ background: glareBackground, opacity: glareOpacity }}
            />
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}