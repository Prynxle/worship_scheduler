'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { Sheet, SheetContent } from '@/components/ui/sheet';

interface DashboardLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

export function DashboardLayout({ children, title, subtitle }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  // The member workspace is a single self-contained page: the sidebar only ever
  // offered "My workspace" there, so it is dropped along with its mobile sheet,
  // and the header's sign-out button replaces the sidebar's. Staff shells keep
  // the full navigation.
  const standalone = pathname === '/member';

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {!standalone && (
        <>
          <div className="hidden lg:flex">
            <Sidebar />
          </div>
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent side="left" className="w-[280px] border-sidebar-border bg-sidebar p-0">
              <Sidebar />
            </SheetContent>
          </Sheet>
        </>
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header
          title={title}
          subtitle={subtitle}
          onMenuClick={standalone ? undefined : () => setSidebarOpen(true)}
        />
        <main className="flex-1 overflow-y-auto bg-background px-5 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
