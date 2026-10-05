'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { AppRole } from '@/lib/auth/server';

/**
 * The authenticated account as returned by `GET /api/auth/me`.
 *
 * `SessionGuard` is the only place that resolves it, so the rest of the
 * dashboard reads the role from context instead of issuing its own
 * `/api/auth/me` request on every page. The shape mirrors the route payload.
 */
export interface SessionUser {
  id: string;
  member_id: string | null;
  church_id: string;
  full_name: string;
  member_name: string | null;
  phone: string | null;
  role: AppRole;
}

interface SessionContextValue {
  user: SessionUser | null;
}

const SessionContext = createContext<SessionContextValue>({ user: null });

export function SessionProvider({ user, children }: { user: SessionUser | null; children: ReactNode }) {
  return <SessionContext.Provider value={{ user }}>{children}</SessionContext.Provider>;
}

/** Null until the session check resolves. Consumers sit behind `SessionGuard`. */
export function useSessionUser(): SessionUser | null {
  return useContext(SessionContext).user;
}
