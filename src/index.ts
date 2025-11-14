/**
 * redlock-universal - Production-ready distributed Redis locks for Node.js
 *
 * @packageDocumentation
 */

export {
  createLock,
  createLocks,
  createPrefixedLock,
  createRedlock,
  createRedlocks,
} from './factory.js';
export type { CreateLockConfig, CreateRedlockConfig } from './factory.js';

export { SimpleLock, LeanSimpleLock, RedLock } from './locks/index.js';
export type { Lock, LockHandle, SimpleLockConfig, RedLockConfig } from './locks/index.js';

export { BaseAdapter, NodeRedisAdapter, IoredisAdapter } from './adapters/index.js';
export type { RedisAdapter, RedisAdapterOptions } from './adapters/index.js';

export { LockManager } from './manager/index.js';
export type { LockManagerConfig, LockStats } from './manager/index.js';

export {
  MetricsCollector,
  HealthChecker,
  Logger,
  LogLevel,
  logger,
  createPinoAdapter,
  createBunyanAdapter,
} from './monitoring/index.js';
export type {
  ILogger,
  LockMetrics,
  RedLockMetrics,
  MetricsSummary,
  HealthStatus,
  AdapterHealth,
  SystemHealth,
  LogEntry,
  LoggerConfig,
  PinoLogger,
  BunyanLogger,
} from './monitoring/index.js';

export {
  generateLockValue,
  generateLockId,
  safeCompare,
  createLockValueWithMetadata,
  parseLockValue,
  isValidLockValue,
  executeWithAutoExtension,
  executeWithSingleLockExtension,
} from './utils/index.js';
export type { AutoExtensionConfig, ExtendedAbortSignal } from './utils/index.js';

export {
  RedlockError,
  LockAcquisitionError,
  LockReleaseError,
  LockExtensionError,
  AdapterError,
  ConfigurationError,
} from './types/errors.js';

export { DEFAULTS, LUA_SCRIPTS, LIBRARY_INFO } from './constants.js';
