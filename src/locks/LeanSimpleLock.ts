/**
 * Memory-optimized SimpleLock implementation
 */

import type { RedisAdapter } from '../types/adapters.js';
import type { Lock, LockHandle, SimpleLockConfig } from '../types/locks.js';
import { LockAcquisitionError, LockReleaseError, LockExtensionError } from '../types/errors.js';
import { generateLockValue } from '../utils/crypto.js';
import { clockDriftFor, releaseQuietly, validityExceededError } from '../utils/validity.js';
import {
  executeWithSingleLockExtension,
  type ExtendedAbortSignal,
} from '../utils/auto-extension.js';
import { DEFAULTS } from '../constants.js';

// Redis response constants
const REDIS_OK_RESPONSE = 'OK';

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
 * - Pooled-buffer lock values from crypto
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
    const drift = clockDriftFor(this.t);
    let lastError: Error | null = null;
    let attempts = 0;

    for (let attempt = 0; attempt <= this.r; attempt++) {
      attempts++;
      const value = generateLockValue();
      try {
        // The server starts the TTL when it runs the SET, so the lock is valid from here
        const sentAt = Date.now();
        const startedAt = performance.now();
        const result = await this.a.setNX(this.k, value, this.t);
        const elapsed = performance.now() - startedAt;

        if (result === REDIS_OK_RESPONSE && elapsed + drift < this.t) {
          const acquisitionTime = Date.now() - startTime;

          return {
            id: value,
            key: this.k,
            value,
            acquiredAt: sentAt,
            ttl: this.t,
            metadata: {
              attempts,
              acquisitionTime,
              strategy: 'simple' as const,
            },
          };
        }

        if (result === REDIS_OK_RESPONSE) {
          // Granted too late to be safe: give the key back and try again
          releaseQuietly(this.a, this.k, value);
          lastError = validityExceededError(elapsed, drift, this.t);
        } else {
          lastError = LOCK_HELD_ERROR;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : LOCK_HELD_ERROR;
        // The SET may still have run: release this attempt's value without waiting
        releaseQuietly(this.a, this.k, value);
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

  /**
   * Get the underlying Redis adapter for atomic operations
   * @returns Redis adapter instance
   */
  getAdapter(): RedisAdapter {
    return this.a;
  }

  /**
   * Execute a routine with automatic lock management and extension
   * Auto-extends when remaining TTL < 20% (extends at ~80% consumed)
   * Provides AbortSignal when extension fails
   *
   * @param routine - Function to execute while holding the lock
   * @returns Result of the routine
   */
  async using<T>(routine: (signal: ExtendedAbortSignal) => Promise<T>): Promise<T> {
    const handle = await this.acquire();
    return executeWithSingleLockExtension(this, handle, this.t, routine);
  }
}
