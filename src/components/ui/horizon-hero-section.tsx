import Link from 'next/link';

import { HeroSceneBoundary } from '@/components/ui/horizon-hero-boundary';

const sectionContent = [
  {
    title: 'GRACE',
    subtitle: ['Where faith meets purpose,', 'we discover the life God has called us to live.'],
  },
  {
    title: 'HOPE',
    subtitle: ['Beyond the boundaries of what we can see,', 'lies a future held in God\'s promises.'],
  },
  {
    title: 'PURPOSE',
    subtitle: ['In the space between prayer and action,', 'we find the calling God has placed within us.'],
  },
] as const;

const splitTitle = (text: string) =>
  text.split('').map((char, index) => (
    <span key={index} className="title-char">
      {char}
    </span>
  ));

/**
 * Server-rendered hero shell. The WebGL/GSAP scene is a client-only lazy chunk;
 * this static content and its CSS fallback are present in the HTML before that
 * chunk is fetched or hydrated.
 */
export const Component = () => (
  <HeroSceneBoundary>
    <div className="hero-canvas-fallback" aria-hidden="true" />

    <Link className="sign-in-link" href="/login">Sign In</Link>

    <div className="scroll-sections">
      {sectionContent.map((section) => (
        <section className="content-section" key={section.title}>
          <div className="hero-copy">
            <h1 className="hero-title">
              {splitTitle(section.title)}
            </h1>
            <div className="hero-subtitle cosmos-subtitle">
              {section.subtitle.map((line) => (
                <p className="subtitle-line" key={line}>{line}</p>
              ))}
            </div>
            <Link className="scripture-link" href="/dashboard">Romans 8:28</Link>
          </div>
        </section>
      ))}
    </div>

    <div className="scroll-progress" data-hero-progress style={{ visibility: 'hidden' }}>
      <div className="scroll-text">SCROLL</div>
      <div className="progress-track">
        <div className="progress-fill" data-hero-progress-fill style={{ width: 0 }} />
      </div>
      <div className="section-counter" data-hero-section-counter>00 / 02</div>
    </div>
  </HeroSceneBoundary>
);
