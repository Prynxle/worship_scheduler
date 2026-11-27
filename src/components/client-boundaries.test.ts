import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('issue #127 client boundaries', () => {
  it('keeps the hero shell server-rendered and defers WebGL/GSAP', () => {
    const page = source('../app/page.tsx');
    const shell = source('./ui/horizon-hero-section.tsx');
    const boundary = source('./ui/horizon-hero-boundary.tsx');
    const scene = source('./ui/horizon-hero-scene.tsx');

    expect(page).not.toMatch(/^\s*['"]use client['"]/m);
    expect(shell).not.toMatch(/from ['"](three|gsap)/);
    expect(shell).toContain('HeroSceneBoundary');
    expect(shell).toContain('hero-canvas-fallback');
    expect(boundary).toContain('ssr: false');
    expect(boundary).toContain('prefers-reduced-motion: reduce');
    expect(scene).toContain("from 'three'");
    expect(scene).toContain("from 'gsap'");
    expect(scene.match(/\.dispose\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('defers FullCalendar behind an accessible fixed-size skeleton without losing guards', () => {
    const calendar = source('./events/event-calendar.tsx');
    const grid = source('./events/event-calendar-grid.tsx');
    const skeleton = source('./events/event-calendar-grid-skeleton.tsx');

    expect(calendar).not.toContain('@fullcalendar/react');
    expect(calendar).toContain('dynamic(');
    expect(calendar).toContain('EventCalendarGridSkeleton');
    expect(calendar).toContain('eventsRequest');
    expect(calendar).toContain('removeChannel');
    expect(skeleton).toContain('role="status"');
    expect(skeleton).toContain('aria-busy="true"');
    expect(skeleton).toContain('h-[39rem]');
    expect(grid).toContain('@fullcalendar/react');
    expect(grid).toContain('dayCellDidMount');
    expect(grid).toContain("'keydown'");
    expect(grid).toContain('removeEventListener');
    expect(grid).toContain('gotoDate');
  });

  it('defers Recharts and keeps the analytics shell server-rendered', () => {
    const chart = source('./analytics/workload-chart.tsx');
    const canvas = source('./analytics/workload-chart-canvas.tsx');
    const page = source('../app/(dashboard)/analytics/page.tsx');

    expect(chart).not.toContain("from 'recharts'");
    expect(chart).toContain('ssr: false');
    expect(canvas).toContain("from 'recharts'");
    expect(page).not.toMatch(/^\s*['"]use client['"]/m);
    expect(page.match(/<WorkloadChart\s/g) ?? []).toHaveLength(2);
  });

  it('replaces sidebar motion with CSS animations guarded by reduced motion', () => {
    const sidebar = source('./layout/sidebar.tsx');
    const css = source('../app/globals.css');

    expect(sidebar).not.toContain('motion/react');
    expect(sidebar).not.toContain('motion.');
    expect(sidebar).toContain('sidebar-brand-mark');
    expect(sidebar).toContain('sidebar-nav-item');
    expect(css).toContain('@keyframes sidebar-brand-in');
    expect(css).toContain('@keyframes sidebar-nav-in');
    expect(css).toContain('prefers-reduced-motion: no-preference');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });
});
