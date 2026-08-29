'use client';

import { motion, type MotionValue } from 'motion/react';
import type { CSSProperties } from 'react';

interface Cross3DProps {
  /** Spring-smoothed tilt values owned by the hero orchestrator */
  rotateX: MotionValue<number>;
  rotateY: MotionValue<number>;
}

/** Beam thickness (depth) in px — faces sit at z = +/- 10 */
const THICKNESS = 20;
const HALF = THICKNESS / 2;

const WOOD = 'var(--color-landing-wood)';
const WOOD_LIGHT = 'var(--color-landing-wood-light)';
const WOOD_DEEP = 'var(--color-landing-wood-deep)';

/**
 * Realistic wood surfaces. Every value is a constant so the component is
 * deterministic and hydration-safe: no Math.random, no Date, no client hooks.
 * Grain orientation follows the beam direction (long grain along the stipes
 * for the vertical beam, along the arms for the crossbar).
 */
const VERTICAL_FRONT_BG = `
  radial-gradient(circle at 34% 22%, oklch(0.20 0.045 45 / 0.85) 0 1.5px, oklch(0.24 0.05 48 / 0.6) 1.5px 4px, transparent 4.5px),
  radial-gradient(circle at 68% 64%, oklch(0.19 0.04 44 / 0.8) 0 1.2px, oklch(0.23 0.05 47 / 0.55) 1.2px 3px, transparent 3.5px),
  linear-gradient(115deg, transparent 42%, oklch(0.16 0.03 45 / 0.28) 42.2% 43.6%, transparent 43.8%),
  linear-gradient(120deg, oklch(1 0 0 / 0.08) 0%, transparent 38%),
  repeating-linear-gradient(90deg, oklch(0 0 0 / 0.11) 0 1px, transparent 1px 5px),
  repeating-linear-gradient(0deg, oklch(1 0 0 / 0.04) 0 1px, transparent 1px 3px),
  linear-gradient(180deg, oklch(0.46 0.06 60) 0%, ${WOOD_LIGHT} 18%, ${WOOD} 55%, ${WOOD_DEEP} 100%)
`;

const HORIZONTAL_FRONT_BG = `
  radial-gradient(circle at 34% 22%, oklch(0.20 0.045 45 / 0.85) 0 1.5px, oklch(0.24 0.05 48 / 0.6) 1.5px 4px, transparent 4.5px),
  radial-gradient(circle at 68% 64%, oklch(0.19 0.04 44 / 0.8) 0 1.2px, oklch(0.23 0.05 47 / 0.55) 1.2px 3px, transparent 3.5px),
  linear-gradient(115deg, transparent 42%, oklch(0.16 0.03 45 / 0.28) 42.2% 43.6%, transparent 43.8%),
  linear-gradient(120deg, oklch(1 0 0 / 0.08) 0%, transparent 38%),
  repeating-linear-gradient(0deg, oklch(0 0 0 / 0.11) 0 1px, transparent 1px 5px),
  repeating-linear-gradient(90deg, oklch(1 0 0 / 0.04) 0 1px, transparent 1px 3px),
  linear-gradient(180deg, oklch(0.46 0.06 60) 0%, ${WOOD_LIGHT} 18%, ${WOOD} 55%, ${WOOD_DEEP} 100%)
`;

const VERTICAL_BACK_BG = `
  repeating-linear-gradient(90deg, oklch(0 0 0 / 0.14) 0 1px, transparent 1px 5px),
  linear-gradient(180deg, oklch(0.18 0.03 48) 0%, ${WOOD_DEEP} 100%)
`;

const HORIZONTAL_BACK_BG = `
  repeating-linear-gradient(0deg, oklch(0 0 0 / 0.14) 0 1px, transparent 1px 5px),
  linear-gradient(180deg, oklch(0.18 0.03 48) 0%, ${WOOD_DEEP} 100%)
`;

/** Front-face bevel/lighting: top sheen, bottom falloff, faint side edges */
const FRONT_BEVEL =
  'inset 0 3px 4px oklch(1 1 0.6 / 0.10), inset 0 -10px 16px oklch(0 0 0 / 0.5), inset 1px 0 3px oklch(0 0 0 / 0.30), inset -1px 0 3px oklch(0 0 0 / 0.20)';

const WOOD_EDGE_BASE = `linear-gradient(90deg, ${WOOD_DEEP} 0%, ${WOOD} 50%, ${WOOD_LIGHT} 100%)`;

/** Gold rim-light so silhouette edges catch the divine glow */
const EDGE_RIM =
  'linear-gradient(90deg, oklch(0.70 0.14 65 / 0.45) 0%, transparent 24%, transparent 76%, oklch(0.78 0.10 70 / 0.40) 100%)';

/** Combined edge surface: rim painted over the base wood */
const WOOD_EDGE = `${EDGE_RIM}, ${WOOD_EDGE_BASE}`;

const TOP_FACE_BG = `linear-gradient(180deg, oklch(0.75 0.12 60 / 0.8), ${WOOD_LIGHT})`;
const BOTTOM_FACE_BG = `linear-gradient(180deg, ${WOOD_DEEP} 0%, oklch(0.16 0.03 50) 100%)`;

const GLOW_SPRITE_BG =
  'radial-gradient(circle, oklch(0.70 0.14 65 / 0.5) 0%, oklch(0.70 0.14 65 / 0.18) 40%, transparent 68%)';

type GrainOrientation = 'vertical' | 'horizontal';

interface WoodBeamProps {
  width: number;
  height: number;
  grain: GrainOrientation;
  style?: CSSProperties;
}

/**
 * A wooden beam rendered as a 6-face CSS cuboid: front/back faces, left/right
 * edge strips, and top/bottom faces, all inside a `preserve-3d` container.
 * Edge strips reuse the proven pattern (`translateZ(-HALF) rotateY(+/-90)`
 * with transformOrigin at the beam edge). Top/bottom faces use the mirrored
 * technique anchored at their edge. No SVG.
 */
function WoodBeam({ width, height, grain, style }: WoodBeamProps) {
  const frontBg = grain === 'vertical' ? VERTICAL_FRONT_BG : HORIZONTAL_FRONT_BG;
  const backBg = grain === 'vertical' ? VERTICAL_BACK_BG : HORIZONTAL_BACK_BG;

  return (
    <div
      style={{ position: 'relative', width, height, transformStyle: 'preserve-3d', ...style }}
    >
      {/* Front face: z +10 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translateZ(${HALF}px)`,
          background: frontBg,
          boxShadow: FRONT_BEVEL,
          borderRadius: 2,
        }}
      />
      {/* Back face: z -10 (rotateY 180) — darker silhouette, no sheen */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `rotateY(180deg) translateZ(${HALF}px)`,
          background: backBg,
          borderRadius: 2,
        }}
      />
      {/* Left edge: rotateY(-90) anchored at the left face line, z -10..10 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: THICKNESS,
          height: '100%',
          transformOrigin: 'left center',
          transform: `translateZ(-${HALF}px) rotateY(-90deg)`,
          background: WOOD_EDGE,
        }}
      />
      {/* Right edge: rotateY(+90) anchored at the right face line, z -10..10 */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: THICKNESS,
          height: '100%',
          transformOrigin: 'right center',
          transform: `translateZ(-${HALF}px) rotateY(90deg)`,
          background: WOOD_EDGE,
        }}
      />
      {/* Top face: rotateX(+90) anchored at the top edge, brighter top-light */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width,
          height: THICKNESS,
          transformOrigin: 'top center',
          transform: `translateZ(-${HALF}px) rotateX(90deg)`,
          background: TOP_FACE_BG,
        }}
      />
      {/* Bottom face: rotateX(-90) anchored at the bottom edge, darker */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width,
          height: THICKNESS,
          transformOrigin: 'bottom center',
          transform: `translateZ(-${HALF}px) rotateX(-90deg)`,
          background: BOTTOM_FACE_BG,
        }}
      />
    </div>
  );
}

/**
 * Ambient occlusion + seam shading where the crossbar meets the stipes.
 * Sits just in front of the front faces (z 10.5) so the junction reads as
 * one carved piece. Decorative, pointer-transparent.
 */
function JointShade() {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: '50%',
        top: 104,
        width: 232,
        height: 58,
        marginLeft: -116,
        transform: 'translateZ(10.5px)',
        borderRadius: 6,
        background:
          'radial-gradient(ellipse at 50% 50%, oklch(0 0 0 / 0.5), oklch(0 0 0 / 0.28) 45%, transparent 75%)',
        boxShadow: '0 0 14px oklch(0.70 0.14 65 / 0.25)',
        pointerEvents: 'none',
      }}
    >
      {/* Thin dark seam lines along the top/bottom junction of the crossbar */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: 3,
          borderRadius: 2,
          background: 'oklch(0 0 0 / 0.55)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: '100%',
          height: 3,
          borderRadius: 2,
          background: 'oklch(0 0 0 / 0.55)',
        }}
      />
    </div>
  );
}

/**
 * Presentational, realistic 3D cross: pure CSS wood cuboids, gold back-bloom,
 * joint AO, titulus plaque, and divine glow sprite. Receives the spring tilt
 * values from the hero so the whole cross leans with the pointer. Entrance is
 * always rendered the same on server and client so hydration stays consistent.
 * All geometry values are constants — deterministic and
 * hydration-safe.
 */
export function Cross3D({ rotateX, rotateY }: Cross3DProps) {
  return (
    <motion.div
      className="relative h-full w-full pointer-events-none"
      initial={{ opacity: 0, y: 80 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Contact shadow: grounded on the floor, does not tilt with the cross */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 56,
          width: 140,
          height: 24,
           transform: 'translateX(-50%)',
           background: 'radial-gradient(ellipse at 50% 50%, oklch(0 0 0 / 0.60), transparent 70%)',
           filter: 'blur(2px)',
           pointerEvents: 'none',
         }}
      />

      <div
        className="absolute inset-0"
        style={{ perspective: 1200, perspectiveOrigin: '50% 25%' }}
      >
        <motion.div
          className="absolute inset-0"
          style={{
            rotateX,
            rotateY,
            transformStyle: 'preserve-3d',
            transformOrigin: '50% 55%',
          }}
        >
          {/* Divine glow sprite behind the cross */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: '50%',
              top: '46%',
              width: 280,
              height: 280,
               transform: 'translate(-50%, -50%) translateZ(-60px)',
               background: GLOW_SPRITE_BG,
               pointerEvents: 'none',
            }}
          />

          {/* Golden back-bloom silhouettes: flat blurred leaves at z -20 */}
          <div
            aria-hidden
            style={{ position: 'absolute', inset: 0, transform: 'translateZ(-20px)', pointerEvents: 'none' }}
          >
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: 28,
                width: 74,
                height: 350,
                marginLeft: -37,
                 background: 'oklch(0.70 0.14 65 / 0.22)',
                 filter: 'blur(10px)',
                 pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: 104,
                width: 250,
                height: 78,
                marginLeft: -125,
                 background: 'oklch(0.70 0.14 65 / 0.22)',
                 filter: 'blur(10px)',
                 pointerEvents: 'none',
              }}
            />
          </div>

          {/* Vertical beam (stipes) */}
          <WoodBeam
            grain="vertical"
            width={64}
            height={340}
            style={{ position: 'absolute', left: '50%', top: 28, marginLeft: -32 }}
          />

          {/* Horizontal beam (Latin cross arms, crossbar center ~22-23% down) */}
          <WoodBeam
            grain="horizontal"
            width={232}
            height={58}
            style={{ position: 'absolute', left: '50%', top: 104, marginLeft: -116 }}
          />

          {/* Joint ambient occlusion at the crossbar junction */}
          <JointShade />

          {/* Titulus plaque above the crossbar (engraved, no glyphs) */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: '50%',
              top: 46,
              width: 100,
              height: 28,
              marginLeft: -50,
              transform: 'translateZ(11px)',
              borderRadius: 3,
              background:
                'linear-gradient(180deg, oklch(0.85 0.08 80 / 0.92), oklch(0.70 0.14 65 / 0.85))',
               boxShadow:
                 'inset 0 1px 0 oklch(1 1 0.8 / 0.35), inset 0 -1px 2px oklch(0 0 0 / 0.35), inset 0 0 0 1px oklch(0 0 0 / 0.15)',
               pointerEvents: 'none',
            }}
          />
        </motion.div>
      </div>
    </motion.div>
  );
}
