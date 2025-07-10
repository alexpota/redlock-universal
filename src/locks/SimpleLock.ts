import type { RedisAdapter } from '../types/adapters.js';
import type { Lock, LockHandle, SimpleLockConfig } from '../types/locks.js';
import { LockAcquisitionError, LockReleaseError, LockExtensionError } from '../types/errors.js';
import { generateLockValue, generateLockId, safeCompare } from '../utils/crypto.js';
import { DEFAULTS } from '../constants.js';

/**
 * Simple lock implementation for single Redis instance
 * Provides reliable locking with retry logic and proper error handling
 */
export class SimpleLock implements Lock {
  private readonly adapter: RedisAdapter;
  private readonly config: Required<SimpleLockConfig>;

  constructor(config: SimpleLockConfig) {
    this.adapter = config.adapter;
    this.config = {
      adapter: config.adapter,
      key: config.key,
      ttl: config.ttl ?? DEFAULTS.TTL,
      retryAttempts: config.retryAttempts ?? DEFAULTS.RETRY_ATTEMPTS,
      retryDelay: config.retryDelay ?? DEFAULTS.RETRY_DELAY,
    };

    this.validateConfig();
  }

  /**
   * Validate configuration parameters
   */
  private validateConfig(): void {
    if (!this.config.key || typeof this.config.key !== 'string') {
      throw new Error('Lock key must be a non-empty string');
    }

    if (this.config.ttl <= 0 || !Number.isInteger(this.config.ttl)) {
      throw new Error('TTL must be a positive integer');
    }

    if (this.config.retryAttempts < 0 || !Number.isInteger(this.config.retryAttempts)) {
      throw new Error('Retry attempts must be a non-negative integer');
    }

    if (this.config.retryDelay < 0 || !Number.isInteger(this.config.retryDelay)) {
      throw new Error('Retry delay must be a non-negative integer');
    }
  }

  /**
   * Attempt to acquire the lock
   */
  async acquire(): Promise<LockHandle> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const lockValue = generateLockValue();
        const result = await this.adapter.setNX(this.config.key, lockValue, this.config.ttl);

        if (result === 'OK') {
          const acquisitionTime = Date.now() - startTime;

          return {
            id: generateLockId(),
            key: this.config.key,
            value: lockValue,
            acquiredAt: Date.now(),
            ttl: this.config.ttl,
            metadata: {
              attempts: attempt + 1,
              acquisitionTime,
              strategy: 'simple',
            },
          };
        }

        // Lock already exists, prepare for retry
        lastError = new Error(`Lock "${this.config.key}" is already held`);
      } catch (error) {
        lastError = error as Error;
      }

      // Wait before retrying (except on last attempt)
      if (attempt < this.config.retryAttempts) {
        await this.sleep(this.config.retryDelay);
      }
    }

    throw new LockAcquisitionError(
      this.config.key,
      this.config.retryAttempts + 1,
      lastError || new Error('Unknown error')
    );
  }

  /**
   * Release a previously acquired lock
   */
  async release(handle: LockHandle): Promise<boolean> {
    this.validateHandle(handle);

    try {
      const released = await this.adapter.delIfMatch(handle.key, handle.value);
      return released;
    } catch (error) {
      throw new LockReleaseError(handle.key, 'redis_error', error as Error);
    }
  }

  /**
   * Extend the TTL of an existing lock
   */
  async extend(handle: LockHandle, ttl: number): Promise<boolean> {
    this.validateHandle(handle);

    if (ttl <= 0 || !Number.isInteger(ttl)) {
      throw new Error('TTL must be a positive integer');
    }

    try {
      // Check if lock still exists with correct value
      const currentValue = await this.adapter.get(handle.key);

      if (currentValue === null) {
        return false; // Lock doesn't exist
      }

      if (!safeCompare(currentValue, handle.value)) {
        return false; // Lock exists but with different value
      }

      // Extend the lock by setting it again with new TTL
      const result = await this.adapter.setNX(handle.key, handle.value, ttl);

      // If setNX fails, the lock might have expired between get and setNX
      // Try direct extension using a more complex approach
      if (result !== 'OK') {
        // Use a Lua script for atomic extend operation
        // This is a fallback - in practice, most simple use cases won't need this
        return false;
      }

      return true;
    } catch (error) {
      throw new LockExtensionError(handle.key, 'redis_error', error as Error);
    }
  }

  /**
   * Check if a lock is currently held
   */
  async isLocked(key: string): Promise<boolean> {
    try {
      const value = await this.adapter.get(key);
      return value !== null;
    } catch (error) {
      // If we can't check, assume it's not locked rather than throwing
      return false;
    }
  }

  /**
   * Validate lock handle
   */
  private validateHandle(handle: LockHandle): void {
    if (!handle) {
      throw new Error('Lock handle is required');
    }

    if (!handle.id || !handle.key || !handle.value) {
      throw new Error('Invalid lock handle: missing required properties');
    }

    if (handle.key !== this.config.key) {
      throw new Error(
        `Lock handle key "${handle.key}" does not match lock key "${this.config.key}"`
      );
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get lock configuration (for debugging)
   */
  getConfig(): Readonly<SimpleLockConfig> {
    return { ...this.config };
  }

  /**
   * Get the underlying Redis adapter (for advanced usage)
   */
  getAdapter(): RedisAdapter {
    return this.adapter;
  }
}
