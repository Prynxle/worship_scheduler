/**
 * Dependency-free fixed-window in-memory rate limiter.
 *
 * `checkRateLimit` uses the module-level defaults (5 attempts / 60 seconds).
 * `createRateLimiter` builds a limiter with an injectable window so callers
 * (and tests) can use smaller windows without waiting for the full default.
 */

export type RateLimitResult = {
  ok: boolean;
  retryAfterSeconds: number;
};

export type RateLimiterOptions = {
  maxAttempts?: number;
  windowMs?: number;
  maxKeys?: number;
};

export type RateLimiter = (key: string) => RateLimitResult;

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_KEYS = 10_000;

function pruneExpired(state: Map<string, RateLimitEntry>, now: number): void {
  if (state.size === 0) {
    return;
  }
  for (const [key, entry] of state) {
    if (now >= entry.resetAt) {
      state.delete(key);
    }
  }
}

function evictUntilUnderCap(state: Map<string, RateLimitEntry>, maxKeys: number): void {
  while (state.size >= maxKeys) {
    const oldestKey = state.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    state.delete(oldestKey);
  }
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const state = new Map<string, RateLimitEntry>();

  return (key: string): RateLimitResult => {
    const now = Date.now();
    pruneExpired(state, now);

    const entry = state.get(key);
    if (!entry) {
      evictUntilUnderCap(state, maxKeys);
      state.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true, retryAfterSeconds: 0 };
    }

    if (entry.count >= maxAttempts) {
      return {
        ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      };
    }

    entry.count += 1;
    return { ok: true, retryAfterSeconds: 0 };
  };
}

let moduleLimiter = createRateLimiter();

export function checkRateLimit(key: string): RateLimitResult {
  return moduleLimiter(key);
}

export function resetRateLimiters(): void {
  // Fresh limiter => fresh state Map; gives tests isolated module-level state.
  moduleLimiter = createRateLimiter();
}