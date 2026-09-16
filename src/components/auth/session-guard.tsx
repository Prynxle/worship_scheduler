'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

type SessionGuardProps = {
  children: React.ReactNode;
};

export function SessionGuard({ children }: SessionGuardProps) {
  const router = useRouter();
  // Lazy initial state keeps the first client render null, matching the server
  // render so no protected content flashes before the session check finishes.
  const [isChecking, setIsChecking] = useState(true);

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
        const result = await response.json() as { user?: { role?: string } };
        if (result.user?.role === 'member' && window.location.pathname !== '/member') {
          router.replace('/member');
          return;
        }
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
    return null;
  }

  return children;
}