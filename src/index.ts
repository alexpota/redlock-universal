/**
 * RedLock Universal - Enterprise-grade distributed Redis locks for Node.js
 *
 * @packageDocumentation
 */

// Factory functions
export {
  createLock,
  createLocks,
  createPrefixedLock,
  createRedlock,
  createRedlocks,
} from './factory.js';
export type { CreateLockConfig, CreateRedlockConfig } from './factory.js';

// Lock implementations
export { SimpleLock, RedLock } from './locks/index.js';
export type { Lock, LockHandle, SimpleLockConfig, RedLockConfig } from './locks/index.js';

// Redis adapters
export { BaseAdapter, NodeRedisAdapter, IoredisAdapter } from './adapters/index.js';
export type { RedisAdapter, RedisAdapterOptions } from './adapters/index.js';

// Lock manager
export { LockManager } from './manager/index.js';
export type { LockManagerConfig, LockStats } from './manager/index.js';

// Utilities
export {
  generateLockValue,
  generateLockId,
  safeCompare,
  createLockValueWithMetadata,
  parseLockValue,
  isValidLockValue,
} from './utils/index.js';

// Error types
export {
  RedlockError,
  LockAcquisitionError,
  LockReleaseError,
  LockExtensionError,
  AdapterError,
  ConfigurationError,
} from './types/errors.js';

// Constants
export { DEFAULTS, LUA_SCRIPTS, LIBRARY_INFO } from './constants.js';
