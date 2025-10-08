/**
 * Lock-related types and interfaces
 */

import type { RedisAdapter } from './adapters.js';
import type { Logger } from '../monitoring/Logger.js';
import type { ExtendedAbortSignal } from '../utils/auto-extension.js';

/**
 * Lock handle returned when a lock is successfully acquired
 * Contains information needed to release the lock
 */
export interface LockHandle {
  /** Unique identifier for this lock instance */
  readonly id: string;

  /** Lock key */
  readonly key: string;

  /** Lock value (for safe release) */
  readonly value: string;

  /** Timestamp when lock was acquired */
  readonly acquiredAt: number;

  /** Lock TTL in milliseconds */
  readonly ttl: number;

  /** Extended metadata for debugging */
  readonly metadata?: LockMetadata;
}

/**
 * Additional metadata for lock debugging and monitoring
 */
export interface LockMetadata {
  /** How many attempts it took to acquire */
  readonly attempts: number;

  /** Time spent acquiring the lock (ms) */
  readonly acquisitionTime: number;

  /** Which Redis instances participated (for distributed locks) */
  readonly nodes?: string[];

  /** Acquisition strategy used */
  readonly strategy: 'simple' | 'redlock';
}

/**
 * Configuration for simple (single-instance) locks
 */
export interface SimpleLockConfig {
  /** Redis adapter instance */
  readonly adapter: RedisAdapter;

  /** Lock key */
  readonly key: string;

  /** Time-to-live in milliseconds (default: 30000) */
  readonly ttl?: number;

  /** Maximum retry attempts (default: 3) */
  readonly retryAttempts?: number;

  /** Delay between retries in milliseconds (default: 100) */
  readonly retryDelay?: number;

  /** Optional logger for structured logging (default: none) */
  readonly logger?: Logger;
}

/**
 * Configuration for distributed (Redlock) locks
 */
export interface RedLockConfig {
  /** Array of Redis adapter instances */
  readonly adapters: readonly RedisAdapter[];

  /** Lock key */
  readonly key: string;

  /** Time-to-live in milliseconds (default: 30000) */
  readonly ttl?: number;

  /** Minimum number of nodes for quorum (default: majority) */
  readonly quorum?: number;

  /** Maximum retry attempts (default: 3) */
  readonly retryAttempts?: number;

  /** Delay between retries in milliseconds (default: 200) */
  readonly retryDelay?: number;

  /** Clock drift factor (default: 0.01) */
  readonly clockDriftFactor?: number;

  /** Optional logger for structured logging (default: none) */
  readonly logger?: Logger;
}

/**
 * Abstract base class for all lock implementations
 */
export interface Lock {
  /**
   * Attempt to acquire the lock
   * @returns Promise resolving to lock handle on success
   * @throws LockAcquisitionError on failure
   */
  acquire(): Promise<LockHandle>;

  /**
   * Release a previously acquired lock
   * @param handle - Lock handle from acquire()
   * @returns Promise resolving to true if released, false if already expired
   */
  release(handle: LockHandle): Promise<boolean>;

  /**
   * Extend the TTL of an existing lock
   * @param handle - Lock handle from acquire()
   * @param ttl - New TTL in milliseconds
   * @returns Promise resolving to true if extended, false if lock expired
   */
  extend(handle: LockHandle, ttl: number): Promise<boolean>;

  /**
   * Check if a lock is currently held
   * @param key - Lock key to check
   * @returns Promise resolving to true if locked, false otherwise
   */
  isLocked(key: string): Promise<boolean>;

  /**
   * Get the underlying Redis adapter for atomic operations
   * @returns Redis adapter instance or null if not applicable (e.g., for RedLock with multiple adapters)
   */
  getAdapter(): RedisAdapter | null;

  /**
   * Execute a routine with automatic lock management and extension
   * Auto-extends when remaining TTL < 20% (extends at ~80% consumed)
   * Provides ExtendedAbortSignal when extension fails
   *
   * @param routine - Function to execute while holding the lock
   * @returns Promise resolving to the routine result
   */
  using<T>(routine: (signal: ExtendedAbortSignal) => Promise<T>): Promise<T>;
}
