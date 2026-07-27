'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Calendar, 
  Users, 
  Music, 
  BarChart3, 
  Settings, 
  Download,
  LayoutDashboard,
  Clock,
  Church
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DevModeToggle } from '@/components/dev/dev-mode-toggle';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Schedule', href: '/schedule', icon: Calendar },
  { name: 'Members', href: '/members', icon: Users },
  { name: 'Availability', href: '/availability', icon: Clock },
  { name: 'Ministries', href: '/ministries', icon: Music },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  { name: 'Exports', href: '/exports', icon: Download },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-64 flex-col bg-sidebar border-r border-sidebar-border">
      <div className="flex h-16 items-center gap-2.5 px-6 border-b border-sidebar-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
          <Church className="h-5 w-5 text-primary" />
        </div>
        <div>
          <span className="text-base font-bold tracking-tight text-sidebar-foreground">JOHIA Bankers</span>
          <p className="text-[10px] text-muted-foreground leading-none mt-0.5">Ministry Scheduling</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href || 
            (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
                isActive
                  ? 'sidebar-active-glow text-primary'
                  : 'text-muted-foreground hover-surface hover:text-foreground'
              )}
            >
              <item.icon className={cn('h-[18px] w-[18px] shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-4 space-y-2">
        <DevModeToggle />
        <div className="flex items-center gap-3 rounded-lg p-2 hover-surface cursor-default">
          <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center">
            <span className="text-xs font-semibold text-primary">JS</span>
          </div>
          <div>
            <p className="text-sm font-medium text-sidebar-foreground">John Smith</p>
            <p className="text-xs text-muted-foreground">Admin</p>
          </div>
        </div>
      </div>
    </div>
  );
}
