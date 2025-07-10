import type { RedisAdapter } from './types/adapters.js';
import type { Lock, SimpleLockConfig } from './types/locks.js';
import { SimpleLock } from './locks/SimpleLock.js';
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
