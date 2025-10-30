import type { RedisAdapter } from './types/adapters.js';
import type { Lock, SimpleLockConfig, RedLockConfig } from './types/locks.js';
import { SimpleLock } from './locks/SimpleLock.js';
import { LeanSimpleLock } from './locks/LeanSimpleLock.js';
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
  /** Performance mode: 'standard' (default) | 'lean' | 'enterprise' */
  readonly performance?: 'standard' | 'lean' | 'enterprise';
}

/**
 * Create a simple lock instance
 *
 * @param config - Lock configuration
 * @returns Lock instance
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

  const simpleLockConfig: SimpleLockConfig = {
    adapter: config.adapter,
    key: config.key,
    ...(config.ttl !== undefined && { ttl: config.ttl }),
    ...(config.retryAttempts !== undefined && { retryAttempts: config.retryAttempts }),
    ...(config.retryDelay !== undefined && { retryDelay: config.retryDelay }),
  };

  const performance = config.performance ?? 'standard';

  switch (performance) {
    case 'lean':
      return new LeanSimpleLock(simpleLockConfig);
    case 'enterprise':
    case 'standard':
    default:
      return new SimpleLock(simpleLockConfig);
  }
}

/**
 * Create multiple locks with shared configuration
 *
 * @param adapter - Redis adapter to use for all locks
 * @param keys - Array of lock keys
 * @param options - Shared configuration options
 * @returns Array of lock instances
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
