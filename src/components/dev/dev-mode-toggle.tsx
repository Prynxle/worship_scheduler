'use client';

import { useDevMode } from '@/contexts/dev-mode-context';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function DevModeToggle() {
  const { devMode, toggleDevMode } = useDevMode();

  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  return (
    <Button
      variant="ghost"
      onClick={toggleDevMode}
      className={cn(
        'w-full justify-start gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
        devMode
          ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/15'
          : 'text-muted-foreground hover-surface hover:text-foreground'
      )}
    >
      {devMode ? (
        <Check className="h-[18px] w-[18px] shrink-0 text-amber-400" />
      ) : (
        <AlertTriangle className="h-[18px] w-[18px] shrink-0" />
      )}
      <span>Dev Mode</span>
      {devMode && (
        <span className="ml-auto rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
          ON
        </span>
      )}
    </Button>
  );
}
