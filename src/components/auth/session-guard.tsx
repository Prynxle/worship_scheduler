'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { SessionProvider, type SessionUser } from '@/contexts/session-context';
import { DashboardLoadingSkeleton } from '@/components/ui/loading-skeleton';

type SessionGuardProps = {
  children: React.ReactNode;
};

export function SessionGuard({ children }: SessionGuardProps) {
  const router = useRouter();
  // Lazy initial state keeps the first client render null, matching the server
  // render so no protected content flashes before the session check finishes.
  const [isChecking, setIsChecking] = useState(true);
  // The resolved account is published to context so the dashboard shell can read
  // the role without repeating this request. Previously it was fetched only to
  // pick the member redirect and then thrown away.
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function verifySession() {
      try {
        const { data } = await getSupabaseClient().auth.getSession();
        if (cancelled) return;
        if (!data.session) {
          router.replace('/login');
          return;
        }
        const response = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        });
        if (!response.ok) {
          router.replace('/login');
          return;
        }
        const result = await response.json() as { user?: SessionUser };
        if (result.user?.role === 'member' && window.location.pathname !== '/member') {
          router.replace('/member');
          return;
        }
        setUser(result.user ?? null);
        setIsChecking(false);
      } catch {
        if (cancelled) return;
        router.replace('/login');
      }
    }

    void verifySession();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (isChecking) {
    return <DashboardLoadingSkeleton />;
  }

  return <SessionProvider user={user}>{children}</SessionProvider>;
}
