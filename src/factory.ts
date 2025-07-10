import type { RedisAdapter } from './types/adapters.js';
import type { Lock, SimpleLockConfig, RedLockConfig } from './types/locks.js';
import { SimpleLock } from './locks/SimpleLock.js';
import { RedLock } from './locks/RedLock.js';
import { ConfigurationError } from './types/errors.js';

/**
 * Configuration for creating a simple lock
 */
export interface CreateLockConfig {
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
}

/**
 * Create a simple lock instance
 *
 * @param config - Lock configuration
 * @returns Lock instance
 *
 * @example
 * ```typescript
 * import { createLock, NodeRedisAdapter } from 'redlock-universal';
 *
 * const lock = createLock({
 *   adapter: new NodeRedisAdapter(redisClient),
 *   key: 'my-resource',
 *   ttl: 30000
 * });
 *
 * const handle = await lock.acquire();
 * try {
 *   // Critical section
 * } finally {
 *   await lock.release(handle);
 * }
 * ```
 */
export function createLock(config: CreateLockConfig): Lock {
  if (!config) {
    throw new ConfigurationError('Lock configuration is required');
  }

  if (!config.adapter) {
    throw new ConfigurationError('Redis adapter is required');
  }

  if (!config.key) {
    throw new ConfigurationError('Lock key is required');
  }

  // Convert to SimpleLockConfig format
  const simpleLockConfig: SimpleLockConfig = {
    adapter: config.adapter,
    key: config.key,
    ...(config.ttl !== undefined && { ttl: config.ttl }),
    ...(config.retryAttempts !== undefined && { retryAttempts: config.retryAttempts }),
    ...(config.retryDelay !== undefined && { retryDelay: config.retryDelay }),
  };

  return new SimpleLock(simpleLockConfig);
}

/**
 * Create multiple locks with shared configuration
 *
 * @param adapter - Redis adapter to use for all locks
 * @param keys - Array of lock keys
 * @param options - Shared configuration options
 * @returns Array of lock instances
 *
 * @example
 * ```typescript
 * const locks = createLocks(adapter, ['user:123', 'account:456'], {
 *   ttl: 15000,
 *   retryAttempts: 5
 * });
 * ```
 */
export function createLocks(
  adapter: RedisAdapter,
  keys: readonly string[],
  options: Omit<CreateLockConfig, 'adapter' | 'key'> = {}
): Lock[] {
  if (!adapter) {
    throw new ConfigurationError('Redis adapter is required');
  }

  if (!keys || keys.length === 0) {
    throw new ConfigurationError('At least one lock key is required');
  }

  return keys.map(key =>
    createLock({
      adapter,
      key,
      ...options,
    })
  );
}

/**
 * Create a lock with automatic key prefixing
 *
 * @param adapter - Redis adapter instance
 * @param prefix - Key prefix to add
 * @param key - Base key name
 * @param options - Additional lock options
 * @returns Lock instance with prefixed key
 *
 * @example
 * ```typescript
 * const lock = createPrefixedLock(adapter, 'locks:', 'user-update', {
 *   ttl: 10000
 * });
 * // Creates lock with key "locks:user-update"
 * ```
 */
export function createPrefixedLock(
  adapter: RedisAdapter,
  prefix: string,
  key: string,
  options: Omit<CreateLockConfig, 'adapter' | 'key'> = {}
): Lock {
  if (!prefix || !key) {
    throw new ConfigurationError('Both prefix and key are required');
  }

  return createLock({
    adapter,
    key: `${prefix}${key}`,
    ...options,
  });
}

/**
 * Configuration for creating a distributed RedLock
 */
export interface CreateRedlockConfig {
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
}

/**
 * Create a distributed RedLock instance
 *
 * @param config - RedLock configuration
 * @returns RedLock instance
 *
 * @example
 * ```typescript
 * import { createRedlock, NodeRedisAdapter } from 'redlock-universal';
 *
 * const redlock = createRedlock({
 *   adapters: [
 *     new NodeRedisAdapter(redis1),
 *     new NodeRedisAdapter(redis2),
 *     new NodeRedisAdapter(redis3)
 *   ],
 *   key: 'critical-resource',
 *   ttl: 30000,
 *   quorum: 2
 * });
 *
 * const handle = await redlock.acquire();
 * try {
 *   // Critical section with distributed guarantee
 * } finally {
 *   await redlock.release(handle);
 * }
 * ```
 */
export function createRedlock(config: CreateRedlockConfig): Lock {
  if (!config) {
    throw new ConfigurationError('RedLock configuration is required');
  }

  if (!config.adapters || config.adapters.length === 0) {
    throw new ConfigurationError('At least one Redis adapter is required for RedLock');
  }

  if (!config.key) {
    throw new ConfigurationError('Lock key is required');
  }

  // Convert to RedLockConfig format
  const redlockConfig: RedLockConfig = {
    adapters: config.adapters,
    key: config.key,
    ...(config.ttl !== undefined && { ttl: config.ttl }),
    ...(config.quorum !== undefined && { quorum: config.quorum }),
    ...(config.retryAttempts !== undefined && { retryAttempts: config.retryAttempts }),
    ...(config.retryDelay !== undefined && { retryDelay: config.retryDelay }),
    ...(config.clockDriftFactor !== undefined && { clockDriftFactor: config.clockDriftFactor }),
  };

  return new RedLock(redlockConfig);
}

/**
 * Create multiple RedLocks with shared configuration
 *
 * @param adapters - Array of Redis adapters to use for all locks
 * @param keys - Array of lock keys
 * @param options - Shared configuration options
 * @returns Array of RedLock instances
 *
 * @example
 * ```typescript
 * const redlocks = createRedlocks(
 *   [adapter1, adapter2, adapter3],
 *   ['resource1', 'resource2'],
 *   {
 *     ttl: 15000,
 *     quorum: 2,
 *     retryAttempts: 5
 *   }
 * );
 * ```
 */
export function createRedlocks(
  adapters: readonly RedisAdapter[],
  keys: readonly string[],
  options: Omit<CreateRedlockConfig, 'adapters' | 'key'> = {}
): Lock[] {
  if (!adapters || adapters.length === 0) {
    throw new ConfigurationError('At least one Redis adapter is required');
  }

  if (!keys || keys.length === 0) {
    throw new ConfigurationError('At least one lock key is required');
  }

  return keys.map(key =>
    createRedlock({
      adapters,
      key,
      ...options,
    })
  );
}
