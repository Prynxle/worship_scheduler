'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, MotionConfig } from 'motion/react';
import {
  BarChart3,
  CalendarDays,
  Church,
  Clock3,
  Download,
  LayoutDashboard,
  Music2,
  Settings2,
  UsersRound,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DevModeToggle } from '@/components/dev/dev-mode-toggle';

const navigationGroups = [
  {
    label: 'Workspace',
    items: [
      { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
      { name: 'Schedule', href: '/schedule', icon: CalendarDays },
      { name: 'Members', href: '/members', icon: UsersRound },
      { name: 'Availability', href: '/availability', icon: Clock3 },
      { name: 'Ministries', href: '/ministries', icon: Music2 },
    ],
  },
  {
    label: 'Insights',
    items: [
      { name: 'Analytics', href: '/analytics', icon: BarChart3 },
      { name: 'Exports', href: '/exports', icon: Download },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <MotionConfig reducedMotion="user">
      <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-5">
        <Link href="/dashboard" className="mb-8 flex items-center gap-3 px-2">
          <motion.span
            className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_8px_24px_-10px_var(--primary)]"
            initial={{ rotate: -8, scale: 0.9, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <Church className="size-5" />
          </motion.span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-tight text-sidebar-foreground">JOHIA Bankers</span>
            <span className="block text-xs text-muted-foreground">Ministry operations</span>
          </span>
        </Link>

        <nav className="flex flex-1 flex-col gap-7" aria-label="Main navigation">
          {navigationGroups.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/65">{group.label}</p>
              {group.items.map((item, index) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <motion.div key={item.name} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.04, duration: 0.3 }}>
                    <Link
                      href={item.href}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                        isActive ? 'bg-primary/[0.11] font-medium text-primary' : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                      )}
                    >
                      {isActive && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />}
                      <Icon className={cn('size-[18px]', isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-primary')} />
                      <span>{item.name}</span>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="flex flex-col gap-3 border-t border-sidebar-border pt-4">
          <Link
            href="/settings"
            className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground', pathname.startsWith('/settings') && 'bg-primary/[0.11] text-primary')}
          >
            <Settings2 className="size-[18px]" />
            Settings
          </Link>
          <DevModeToggle />
          <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent/60 p-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">JS</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-sidebar-foreground">John Smith</p>
              <p className="text-xs text-muted-foreground">Administrator</p>
            </div>
          </div>
        </div>
      </aside>
    </MotionConfig>
  );
}
