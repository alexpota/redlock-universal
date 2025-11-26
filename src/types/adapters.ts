/**
 * Redis adapter types for universal client support
 */

import type { Logger } from '../monitoring/Logger.js';

/**
 * Result of atomic lock extension operation
 */
export interface AtomicExtensionResult {
  /** Result code: 1=success, 0=too_late, -1=value_mismatch/key_missing */
  readonly resultCode: 1 | 0 | -1;
  /** Actual TTL at time of check (ms, -2 if key doesn't exist) */
  readonly actualTTL: number;
  /** Human-readable result message */
  readonly message: string;
}

/**
 * Result of lock inspection operation
 * Returns the current lock owner and remaining TTL
 */
export interface LockInspection {
  /** Current lock value (owner token) */
  readonly value: string;
  /** Remaining TTL in milliseconds */
  readonly ttl: number;
}

/**
 * Result of successful batch lock acquisition
 */
export interface BatchAcquireSuccess {
  /** Acquisition succeeded */
  readonly success: true;
  /** Number of locks acquired (equals keys.length) */
  readonly acquiredCount: number;
}

/**
 * Result of failed batch lock acquisition
 */
export interface BatchAcquireFailure {
  /** Acquisition failed */
  readonly success: false;
  /** Number of locks acquired (always 0 due to all-or-nothing semantics) */
  readonly acquiredCount: 0;
  /** Key that was already locked */
  readonly failedKey: string;
  /** 1-based index of the failed key */
  readonly failedIndex: number;
}

/**
 * Result of batch lock acquisition operation (discriminated union)
 */
export type BatchAcquireResult = BatchAcquireSuccess | BatchAcquireFailure;

/**
 * Configuration options for Redis adapters
 */
export interface RedisAdapterOptions {
  /** Prefix to add to all keys */
  readonly keyPrefix?: string;
  /** Maximum number of retries for failed operations */
  readonly maxRetries?: number;
  /** Delay between retries in milliseconds */
  readonly retryDelay?: number;
  /** Timeout for Redis operations in milliseconds */
  readonly timeout?: number;
  /** Optional logger for structured logging (default: none) */
  readonly logger?: Logger;
}

/**
 * Universal Redis adapter interface
 * Abstracts differences between node-redis and ioredis
 */
export interface RedisAdapter {
  /**
   * Set key with value if not exists, with TTL in milliseconds
   * @param key - Redis key
   * @param value - Value to set
   * @param ttl - Time to live in milliseconds
   * @returns Promise resolving to 'OK' on success, null if key exists
   */
  setNX(key: string, value: string, ttl: number): Promise<string | null>;

  /**
   * Get value by key
   * @param key - Redis key
   * @returns Promise resolving to value or null if not found
   */
  get(key: string): Promise<string | null>;

  /**
   * Delete key
   * @param key - Key to delete
   * @returns Promise resolving to number of deleted keys
   */
  del(key: string): Promise<number>;

  /**
   * Delete key only if value matches (atomic operation)
   * @param key - Redis key
   * @param value - Expected value
   * @returns Promise resolving to true if deleted, false otherwise
   */
  delIfMatch(key: string, value: string): Promise<boolean>;

  /**
   * Extend TTL of a key only if value matches (atomic operation)
   * @param key - Redis key
   * @param value - Expected value
   * @param ttl - New TTL in milliseconds
   * @returns Promise resolving to true if extended, false otherwise
   */
  extendIfMatch(key: string, value: string, ttl: number): Promise<boolean>;

  /**
   * Atomic extension with TTL feedback and race condition protection
   * @param key - Redis key
   * @param value - Expected value
   * @param minTTL - Minimum TTL required for extension (race condition protection)
   * @param newTTL - New TTL to set in milliseconds
   * @returns Promise resolving to atomic extension result with TTL feedback
   */
  atomicExtend(
    key: string,
    value: string,
    minTTL: number,
    newTTL: number
  ): Promise<AtomicExtensionResult>;

  /**
   * Atomically acquire multiple locks in a single operation
   * All-or-nothing semantics: either all locks are acquired or none
   *
   * @param keys - Array of Redis keys to lock
   * @param values - Array of values (one per key, same length as keys)
   * @param ttl - Time to live in milliseconds for all locks
   * @returns Promise resolving to batch acquisition result
   * @throws Error if keys and values arrays have different lengths
   */
  batchSetNX(keys: string[], values: string[], ttl: number): Promise<BatchAcquireResult>;

  /**
   * Atomically inspect a lock's current state
   * Returns the lock value (owner) and remaining TTL in a single operation
   *
   * @param key - Redis key to inspect
   * @returns Promise resolving to LockInspection if key exists, null otherwise
   */
  inspect(key: string): Promise<LockInspection | null>;

  /**
   * Ping Redis server
   * @returns Promise resolving to 'PONG'
   */
  ping(): Promise<string>;

  /**
   * Check if adapter is connected
   * @returns Connection status
   */
  isConnected(): boolean;

  /**
   * Disconnect from Redis
   * @returns Promise that resolves when disconnected
   */
  disconnect(): Promise<void>;
}

/**
 * Factory function type for creating Redis adapters
 */
export type AdapterFactory = (client: unknown) => RedisAdapter;
