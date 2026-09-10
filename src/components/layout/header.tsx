'use client';

import { Bell, ChevronRight, Menu, Search } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onMenuClick?: () => void;
}

export function Header({ title, subtitle, onMenuClick }: HeaderProps) {
  const pathname = usePathname();
  const section = pathname.split('/').filter(Boolean).at(-1) ?? 'dashboard';

  return (
    <header className="flex min-h-20 items-center justify-between gap-4 border-b border-border/70 bg-background/80 px-5 backdrop-blur-xl sm:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <Button variant="ghost" size="icon" className="shrink-0 lg:hidden" onClick={onMenuClick} aria-label="Open navigation">
          <Menu className="size-5" />
        </Button>
        <div className="min-w-0">
          <div className="mb-1 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <span>Workspace</span>
            <ChevronRight className="size-3" />
            <span className="capitalize text-foreground/70">{section}</span>
          </div>
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="hidden truncate text-sm text-muted-foreground sm:block">{subtitle}</p>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div className="relative hidden w-56 lg:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search workspace" className="h-9 border-border/70 bg-secondary/40 pl-9 text-sm" />
          <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground xl:block">⌘ K</kbd>
        </div>
        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground" aria-label="Notifications">
          <Bell className="size-[18px]" />
          <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary" />
        </Button>
        <div className="hidden h-8 w-px bg-border sm:block" />
        <div className="hidden text-right sm:block">
          <p className="text-xs font-medium text-foreground">Sunday, August 2</p>
          <p className="text-[11px] text-muted-foreground">Planning season</p>
        </div>
      </div>
    </header>
  );
}
