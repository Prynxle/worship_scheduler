'use client';

import { createContext, useContext, useState, useSyncExternalStore, ReactNode } from 'react';

interface DevModeContextType {
  devMode: boolean;
  toggleDevMode: () => void;
}

const DevModeContext = createContext<DevModeContextType>({
  devMode: false,
  toggleDevMode: () => {},
});

export function useDevMode() {
  return useContext(DevModeContext);
}

const emptySubscribe = () => () => {};

export function DevModeProvider({ children }: { children: ReactNode }) {
  const [devMode, setDevMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('devMode') === 'true';
  });

  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const toggleDevMode = () => {
    const next = !devMode;
    setDevMode(next);
    localStorage.setItem('devMode', String(next));
  };

  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <DevModeContext.Provider value={{ devMode, toggleDevMode }}>
      {children}
    </DevModeContext.Provider>
  );
}
