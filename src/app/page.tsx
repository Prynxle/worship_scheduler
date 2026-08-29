import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { LandingHero } from '@/components/landing/landing-hero';

/**
 * Landing page (server component) for Jesus Our Hope International Assemblies.
 * Brand mark is served from /public/icon-removebg-preview.png via next/image.
 * Copy left, 3D cross scene right. No dev-mode button, no client hooks.
 * Copy entrance choreography uses the existing `.animate-fade-up` helper
 * with a 0.12s stagger matching eyebrow -> heading -> sub -> desc -> CTA.
 */
export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-landing-bg text-landing-ivory">
      {/* Top bar */}
      <header className="border-b border-landing-gold/10">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-landing-gold/15 ring-1 ring-landing-gold/25">
              <Image
                src="/icon-removebg-preview.png"
                alt="Jesus Our Hope International Assemblies logo"
                width={500}
                height={500}
                className="h-6 w-6 object-contain"
                priority
              />
            </div>
            <div className="min-w-0">
              <span className="block min-w-0 text-[10px] font-bold leading-[1.1] tracking-tight text-landing-ivory sm:text-base">
                Jesus Our Hope International Assemblies
              </span>
              <p className="mt-0.5 hidden text-[10px] leading-none text-landing-ivory/45 sm:block">
                Ministry Scheduling
              </p>
            </div>
          </Link>

          <nav className="flex shrink-0 items-center gap-2 sm:gap-7">
            <Link
              href="/"
              className="text-[10px] font-semibold uppercase tracking-[0.12em] text-landing-gold sm:text-xs sm:tracking-[0.22em]"
            >
              Home
            </Link>
            <Link
              href="/login"
              className="text-[10px] font-semibold uppercase tracking-[0.12em] text-landing-ivory/70 transition-colors hover:text-landing-ivory sm:text-xs sm:tracking-[0.22em]"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'border-landing-gold/30 text-landing-gold hover:bg-landing-gold/10 hover:text-landing-gold'
              )}
            >
              Register
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex flex-1 items-center">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:gap-6 lg:px-8 lg:py-20">
          {/* Left: copy block */}
          <div className="space-y-7">
            <div
              className="animate-fade-up inline-flex max-w-full items-center gap-2 rounded-full border border-landing-gold/25 bg-landing-gold/10 px-4 py-1.5"
              style={{ animationDelay: '0s' }}
            >
              <Image
                src="/icon-removebg-preview.png"
                alt=""
                width={500}
                height={500}
                className="h-3.5 w-3.5 shrink-0 object-contain"
              />
              <span className="min-w-0 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-landing-gold sm:text-xs">
                Jesus Our Hope International Assemblies
              </span>
            </div>

            <h1
              className="animate-fade-up font-display text-5xl font-semibold uppercase leading-[1.02] tracking-tight text-landing-ivory sm:text-6xl lg:text-7xl"
              style={{ animationDelay: '0.12s' }}
            >
              The Cross
              <br />
              <span className="text-landing-gold">of Christ</span>
            </h1>

            <p
              className="animate-fade-up font-display text-xl italic text-landing-gold-soft sm:text-2xl"
              style={{ animationDelay: '0.24s' }}
            >
              Where grace meets us.
            </p>

            <p
              className="animate-fade-up max-w-md text-base leading-7 text-landing-ivory/65"
              style={{ animationDelay: '0.36s' }}
            >
              A community gathered in faith, worship, and the hope of Christ.
            </p>

            <div className="animate-fade-up pt-2" style={{ animationDelay: '0.48s' }}>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-full bg-landing-gold px-7 py-3 text-sm font-semibold text-landing-bg transition-transform hover:-translate-y-0.5"
                style={{ boxShadow: '0 0 44px oklch(0.70 0.14 65 / 0.32)' }}
              >
                Watch Service
                <span aria-hidden="true">&rarr;</span>
              </Link>
            </div>
          </div>

          {/* Right: 3D scene (fixed dimensions to avoid CLS) */}
          <div className="relative">
            <LandingHero />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-landing-gold/10">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-5 px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex max-w-full flex-wrap items-center justify-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-landing-gold/15">
              <Image
                src="/icon-removebg-preview.png"
                alt="Jesus Our Hope International Assemblies logo"
                width={500}
                height={500}
                className="h-5 w-5 object-contain"
              />
            </div>
            <span className="min-w-0 text-center text-sm font-bold text-landing-ivory">
              Jesus Our Hope International Assemblies
            </span>
          </div>
          <p className="max-w-full text-center text-xs text-landing-ivory/35">
            &copy; 2026 Jesus Our Hope International Assemblies. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
