/**
 * Configuration types for the library
 */

import type { RedisAdapter } from './adapters.js';

/**
 * Universal lock configuration that can create either simple or distributed locks
 */
export interface LockConfig {
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
 * Configuration for simple locks (single Redis instance)
 */
export interface SimpleLockFactoryConfig extends LockConfig {
  /** Single Redis adapter */
  readonly adapter: RedisAdapter;
}

/**
 * Configuration for distributed locks (multiple Redis instances)
 */
export interface RedLockFactoryConfig extends LockConfig {
  /** Array of Redis adapters */
  readonly adapters: readonly RedisAdapter[];

  /** Minimum number of nodes for quorum (default: majority) */
  readonly quorum?: number;

  /** Clock drift factor for Redlock algorithm (default: 0.01) */
  readonly clockDriftFactor?: number;
}

/**
 * Factory configuration that can create either type of lock
 */
export type UniversalLockConfig = SimpleLockFactoryConfig | RedLockFactoryConfig;

/**
 * Type guard to check if config is for distributed locks
 */
export function isRedLockConfig(config: UniversalLockConfig): config is RedLockFactoryConfig {
  return 'adapters' in config;
}

/**
 * Type guard to check if config is for simple locks
 */
export function isSimpleLockConfig(config: UniversalLockConfig): config is SimpleLockFactoryConfig {
  return 'adapter' in config;
}
