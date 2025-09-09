/**
 * Library constants
 */

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
} as const;

/**
 * Lua scripts for atomic operations
 */
export const LUA_SCRIPTS = {
  /** Script to safely release a lock (check value before delete) */
  RELEASE: `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `.trim(),

  /** Script to safely extend a lock (check value before extend) */
  EXTEND: `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("PEXPIRE", KEYS[1], ARGV[2])
    else
      return 0
    end
  `.trim(),
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
