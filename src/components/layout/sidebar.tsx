'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, MotionConfig } from 'motion/react';
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
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
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
    <MotionConfig reducedMotion="user">
    <div className="flex h-full w-64 flex-col bg-sidebar border-r border-sidebar-border">
      {/* Logo: rotateY flip-on-mount */}
      <div className="flex h-16 items-center gap-2.5 px-6 border-b border-sidebar-border">
        <motion.div
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15"
          initial={{ rotateY: 90, opacity: 0 }}
          animate={{ rotateY: 0, opacity: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          style={{ transformPerspective: 400 }}
        >
          <Church className="h-5 w-5 text-primary" />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
        >
          <span className="text-base font-bold tracking-tight text-sidebar-foreground">JOHIA Bankers</span>
          <p className="text-[10px] text-muted-foreground leading-none mt-0.5">Ministry Scheduling</p>
        </motion.div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {navigation.map((item, index) => {
          const isActive = pathname === item.href || 
            pathname.startsWith(item.href + '/');
          return (
            <motion.div
              key={item.name}
              className="relative"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, delay: 0.08 * index, ease: [0.16, 1, 0.3, 1] }}
            >
              <Link
                href={item.href}
                className={cn(
                  'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover-surface hover:text-foreground hover:-translate-y-px'
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="sidebar-active-pill"
                    className="absolute inset-0 rounded-lg bg-primary/10 shadow-[inset_3px_0_0_oklch(0.72_0.030_65)]"
                    transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                  />
                )}
                <item.icon className={cn('h-[18px] w-[18px] shrink-0 relative', isActive ? 'text-primary' : 'text-muted-foreground')} />
                <span className="relative">{item.name}</span>
              </Link>
            </motion.div>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-4 space-y-2">
        <DevModeToggle />
        <motion.div
          whileHover={{ scale: 1.02 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="origin-left"
        >
          <div className="flex items-center gap-3 rounded-lg p-2 hover-surface cursor-default">
            <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center">
              <span className="text-xs font-semibold text-primary">JS</span>
            </div>
            <div>
              <p className="text-sm font-medium text-sidebar-foreground">John Smith</p>
              <p className="text-xs text-muted-foreground">Admin</p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
    </MotionConfig>
  );
}