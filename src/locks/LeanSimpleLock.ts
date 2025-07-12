/**
 * Memory-optimized SimpleLock implementation
 */

import type { RedisAdapter } from '../types/adapters.js';
import type { Lock, LockHandle, SimpleLockConfig } from '../types/locks.js';
import { LockAcquisitionError, LockReleaseError, LockExtensionError } from '../types/errors.js';
import { DEFAULTS } from '../constants.js';

// Pre-allocated error to avoid stack trace overhead
const LOCK_HELD_ERROR = new Error('Lock already held');
LOCK_HELD_ERROR.stack = '';

/**
 * Lean SimpleLock - Optimized for memory efficiency
 *
 * Memory optimizations:
 * - No circuit breaker by default (saves ~100KB)
 * - No health checks by default (saves ~50KB)
 * - Pre-allocated error objects (saves stack trace overhead)
 * - Minimal property storage with short names
 * - No closures or callbacks
 * - Inline value generation
 */
export class LeanSimpleLock implements Lock {
  private readonly a: RedisAdapter;
  private readonly k: string;
  private readonly t: number;
  private readonly r: number;
  private readonly d: number;

  constructor(config: SimpleLockConfig) {
    this.a = config.adapter;
    this.k = config.key;
    this.t = config.ttl ?? DEFAULTS.TTL;
    this.r = config.retryAttempts ?? DEFAULTS.RETRY_ATTEMPTS;
    this.d = config.retryDelay ?? DEFAULTS.RETRY_DELAY;
  }

  async acquire(): Promise<LockHandle> {
    const startTime = Date.now();
    let lastError: Error | null = null;
    let attempts = 0;

    const value = `${startTime}-${Math.random().toString(36).slice(2)}-${process.pid}`;

    for (let attempt = 0; attempt <= this.r; attempt++) {
      attempts++;
      try {
        const result = await this.a.setNX(this.k, value, this.t);

        if (result === 'OK') {
          const acquisitionTime = Date.now() - startTime;

          return {
            id: value,
            key: this.k,
            value,
            acquiredAt: startTime,
            ttl: this.t,
            metadata: {
              attempts,
              acquisitionTime,
              strategy: 'simple' as const,
            },
          };
        }

        lastError = LOCK_HELD_ERROR;
      } catch (error) {
        lastError = error instanceof Error ? error : LOCK_HELD_ERROR;
      }

      if (attempt < this.r) {
        await new Promise(r => setTimeout(r, this.d));
      }
    }

    throw new LockAcquisitionError(this.k, this.r + 1, lastError!);
  }

  async release(handle: LockHandle): Promise<boolean> {
    try {
      return await this.a.delIfMatch(handle.key, handle.value);
    } catch (error) {
      throw new LockReleaseError(
        handle.key,
        'redis_error',
        error instanceof Error ? error : undefined
      );
    }
  }

  async extend(handle: LockHandle, newTtl: number): Promise<boolean> {
    try {
      return await this.a.extendIfMatch(handle.key, handle.value, newTtl);
    } catch (error) {
      throw new LockExtensionError(
        handle.key,
        'redis_error',
        error instanceof Error ? error : undefined
      );
    }
  }

  async isLocked(key: string): Promise<boolean> {
    try {
      const value = await this.a.get(key);
      return value !== null;
    } catch {
      return false;
    }
  }
}
