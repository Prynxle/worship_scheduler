import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkRateLimit,
  createRateLimiter,
  resetRateLimiters,
  DEFAULT_MAX_ATTEMPTS,
} from './rate-limit';

describe('checkRateLimit (module-level defaults)', () => {
  beforeEach(() => {
    resetRateLimiters();
  });

  it('allows the first five attempts, then blocks the sixth with a retry window', () => {
    for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i += 1) {
      const result = checkRateLimit('login-key');
      expect(result.ok).toBe(true);
      expect(result.retryAfterSeconds).toBe(0);
    }

    const sixth = checkRateLimit('login-key');
    expect(sixth.ok).toBe(false);
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('tracks different keys independently', () => {
    for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i += 1) {
      checkRateLimit('key-a');
    }

    expect(checkRateLimit('key-b').ok).toBe(true);
    expect(checkRateLimit('key-a').ok).toBe(false);
  });

  it('resetRateLimiters clears the module-level state', () => {
    for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i += 1) {
      checkRateLimit('login-key');
    }
    expect(checkRateLimit('login-key').ok).toBe(false);

    resetRateLimiters();
    expect(checkRateLimit('login-key').ok).toBe(true);
  });
});

describe('createRateLimiter (injectable window)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows retries after the window expires', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 100 });

    expect(limiter('window-key').ok).toBe(true);
    expect(limiter('window-key').ok).toBe(true);
    expect(limiter('window-key').ok).toBe(false);

    vi.advanceTimersByTime(150);
    expect(limiter('window-key').ok).toBe(true);
  });
});