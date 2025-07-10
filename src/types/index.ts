/**
 * Type definitions for redlock-universal
 */

// Core types
export type { RedisAdapter, SetOptions, SetResult, AdapterFactory } from './adapters.js';
export type { 
  Lock, 
  LockHandle, 
  LockMetadata, 
  SimpleLockConfig, 
  RedLockConfig 
} from './locks.js';
export type { 
  LockConfig, 
  SimpleLockFactoryConfig, 
  RedLockFactoryConfig, 
  UniversalLockConfig 
} from './config.js';
export { isRedLockConfig, isSimpleLockConfig } from './config.js';

// Error types
export {
  RedlockError,
  LockAcquisitionError,
  LockReleaseError,
  LockExtensionError,
  AdapterError,
  ConfigurationError,
} from './errors.js';

// Monitoring types
export type {
  LockMetrics,
  HealthStatus,
  AdapterHealth,
  LockEvent,
  MonitoringConfig,
} from './monitoring.js';