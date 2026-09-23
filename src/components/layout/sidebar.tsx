'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
import {
  BarChart3,
  CalendarDays,
  CalendarPlus2,
  Church,
  Clock3,
  Download,
  LayoutDashboard,
  LogOut,
  Music2,
  Settings2,
  UsersRound,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DevModeToggle } from '@/components/dev/dev-mode-toggle';
import { Button } from '@/components/ui/button';
import { getSupabaseClient } from '@/lib/supabase/client';

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
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [isStaff, setIsStaff] = useState(true);
  const [profile, setProfile] = useState({ name: 'Loadingâ€¦', role: 'Loading' });

  useEffect(() => {
    void getSupabaseClient().auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        setProfile({ name: 'Your account', role: 'Member' });
        return;
      }
      const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${data.session.access_token}` } });
      if (response.ok) {
        const result = await response.json() as { user?: { full_name?: string; member_name?: string | null; role?: string } };
        const role = result.user?.role ?? 'member';
        const roleLabel = role === 'admin' ? 'Administrator' : role === 'coordinator' ? 'Coordinator' : 'Member';
        setIsStaff(role !== 'member');
        setProfile({
          name: result.user?.member_name || result.user?.full_name || 'Your account',
          role: roleLabel,
        });
      }
    });
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await getSupabaseClient().auth.signOut({ scope: 'local' });
    } catch {
      // Local-only sign out: ignore network errors and clear the session anyway.
    } finally {
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sb-')) {
          localStorage.removeItem(key);
        }
      }
      router.push('/login');
      router.refresh();
      setSigningOut(false);
    }
  }

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
          {!isStaff ? (
  <>
    <Link href="/member" className="rounded-xl bg-primary/[0.11] px-3 py-2.5 text-sm font-medium text-primary">My workspace</Link>
    <Link
      href="/events"
      className={cn(
        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
        pathname === '/events' || pathname.startsWith('/events/')
          ? 'bg-primary/[0.11] font-medium text-primary'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
      )}
    >
      {(pathname === '/events' || pathname.startsWith('/events/')) && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />}
      <CalendarPlus2 className="size-[18px] text-muted-foreground group-hover:text-primary" />
      <span>Events</span>
    </Link>
  </>
) : null}
          {isStaff ? (
            <Link
              href="/events"
              className={cn(
                'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                pathname === '/events' || pathname.startsWith('/events/')
                  ? 'bg-primary/[0.11] font-medium text-primary'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
              )}
            >
              {(pathname === '/events' || pathname.startsWith('/events/')) && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />}
              <CalendarPlus2 className="size-[18px] text-muted-foreground group-hover:text-primary" />
              <span>Events</span>
            </Link>
          ) : null}
          {isStaff ? navigationGroups.map((group) => (
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
          )) : null}
        </nav>

        <div className="flex flex-col gap-3 border-t border-sidebar-border pt-4">
          {isStaff ? <Link
            href="/settings"
            className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground', pathname.startsWith('/settings') && 'bg-primary/[0.11] text-primary')}
          >
            <Settings2 className="size-[18px]" />
            Settings
          </Link> : null}
          <DevModeToggle />
          <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent/60 p-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              {profile.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U'}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-sidebar-foreground">{profile.name}</p>
              <p className="text-xs text-muted-foreground">{profile.role}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            <LogOut className="size-[18px]" />
            {signingOut ? 'Signing outâ€¦' : 'Sign out'}
          </Button>
        </div>
      </aside>
    </MotionConfig>
  );
}
