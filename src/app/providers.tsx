'use client';

import { DevModeProvider } from '@/contexts/dev-mode-context';

export function Providers({ children }: { children: React.ReactNode }) {
  return <DevModeProvider>{children}</DevModeProvider>;
}
