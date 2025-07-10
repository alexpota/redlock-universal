/**
 * RedLock Universal - Enterprise-grade distributed Redis locks for Node.js
 *
 * @packageDocumentation
 */

// Factory functions
export { createLock, createLocks, createPrefixedLock } from './factory.js';
export type { CreateLockConfig } from './factory.js';

// Lock implementations
export { SimpleLock } from './locks/index.js';
export type { Lock, LockHandle, SimpleLockConfig } from './locks/index.js';

// Redis adapters
export { BaseAdapter, NodeRedisAdapter, IoredisAdapter } from './adapters/index.js';
export type { RedisAdapter, RedisAdapterOptions } from './adapters/index.js';

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
