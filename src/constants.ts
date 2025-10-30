/**
 * Library constants
 */

import { DELETE_IF_MATCH_SCRIPT, EXTEND_IF_MATCH_SCRIPT } from './adapters/BaseAdapter.js';

/**
 * Default configuration values
 */
export const DEFAULTS = {
  /** Default lock TTL in milliseconds (30 seconds) */
  TTL: 30_000,

  /** Default retry attempts */
  RETRY_ATTEMPTS: 3,

  /** Default retry delay in milliseconds */
  RETRY_DELAY: 100,

  /** Default Redis command timeout in milliseconds */
  REDIS_TIMEOUT: 5_000,

  /** Default clock drift factor for Redlock */
  CLOCK_DRIFT_FACTOR: 0.01,

  /** Default monitoring interval in milliseconds (1 minute) */
  MONITORING_INTERVAL: 60_000,

  /** Default health check interval in milliseconds (30 seconds) */
  HEALTH_CHECK_INTERVAL: 30_000,

  /** Circuit breaker failure threshold */
  CIRCUIT_BREAKER_THRESHOLD: 5,

  /** Circuit breaker timeout in milliseconds (1 minute) */
  CIRCUIT_BREAKER_TIMEOUT: 60_000,

  /** Auto-extension threshold ratio (extend when 80% of TTL consumed) */
  AUTO_EXTENSION_THRESHOLD_RATIO: 0.2,

  /** Minimum extension interval in milliseconds */
  MIN_EXTENSION_INTERVAL: 1_000,

  /** Safety buffer for atomic extension (minimum TTL required) */
  ATOMIC_EXTENSION_SAFETY_BUFFER: 2000,

  /**
   * Extension buffer ratio for single-node locks (10%)
   *
   * This ratio determines how much TTL must remain before atomic extension.
   * For single-node locks, we use a larger buffer (10%) because:
   * - Lower coordination overhead allows larger safety margin
   * - Single point of failure means we can be more conservative
   * - Network latency to one node is more predictable
   *
   * Example: For a 30-second TTL, extension triggers with 3 seconds remaining
   */
  SINGLE_NODE_EXTENSION_BUFFER_RATIO: 0.1,

  /**
   * Extension buffer ratio for distributed locks (5%)
   *
   * This ratio determines how much TTL must remain before atomic extension.
   * For distributed locks (RedLock), we use a smaller buffer (5%) because:
   * - Multiple nodes require more coordination time
   * - Smaller ratio ensures we extend before ANY node expires
   * - Clock drift across nodes necessitates earlier extension
   * - Quorum-based approach means we need tighter timing
   *
   * Example: For a 30-second TTL, extension triggers with 1.5 seconds remaining
   */
  DISTRIBUTED_EXTENSION_BUFFER_RATIO: 0.05,
} as const;

/**
 * Lua scripts for atomic operations
 * These scripts are re-exported from BaseAdapter for public API access
 */
export const LUA_SCRIPTS = {
  /** Script to safely release a lock (check value before delete) */
  RELEASE: DELETE_IF_MATCH_SCRIPT,

  /** Script to safely extend a lock (check value before extend) */
  EXTEND: EXTEND_IF_MATCH_SCRIPT,
} as const;

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
  UNKNOWN_ERROR: 'Unknown error',
} as const;

/**
 * Library metadata
 */
export const LIBRARY_INFO = {
  NAME: 'redlock-universal',
  VERSION: '0.1.0',
  DESCRIPTION: 'Production-ready distributed Redis locks for Node.js',
} as const;
