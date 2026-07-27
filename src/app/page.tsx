import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Church } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <nav className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
                <Church className="h-5 w-5 text-primary" />
              </div>
              <div>
                <span className="text-base font-bold tracking-tight text-foreground">JOHIA Bankers</span>
                <p className="text-[10px] text-muted-foreground leading-none mt-0.5">Ministry Scheduling</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Sign In
              </Link>
              <Button>
                <Link href="/register">Register</Link>
              </Button>
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-1 flex items-center justify-center">
        <div className="relative mx-auto max-w-7xl px-4 py-28 sm:px-6 lg:px-8 overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[800px] rounded-full bg-primary/5 blur-3xl" />
          </div>
          <div className="text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 mb-8">
              <Church className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium text-primary">JOHIA Bankers</span>
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              Worship Ministry
              <br />
              <span className="text-primary">Simplified</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              Manage schedules, track availability, and coordinate your worship team
              with an intelligent scheduling platform.
            </p>
            <div className="mt-10 flex items-center justify-center gap-4">
              <Button size="lg" className="px-6">
                <Link href="/login" className="flex items-center gap-2">
                  Sign In to Continue
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-border py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
                <Church className="h-4 w-4 text-primary" />
              </div>
              <span className="text-sm font-bold text-foreground">JOHIA Bankers</span>
            </div>
            <p className="text-sm text-muted-foreground">
              &copy; 2026 JOHIA Bankers. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
