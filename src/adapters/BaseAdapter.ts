import type {
  RedisAdapter,
  RedisAdapterOptions,
  AtomicExtensionResult,
  BatchAcquireResult,
  LockInspection,
} from '../types/adapters.js';
import type { Logger } from '../monitoring/Logger.js';
import { DEFAULTS } from '../constants.js';

// Validation limits
const MAX_KEY_LENGTH = 512;
const MAX_VALUE_LENGTH = 1024;
const MAX_TTL_MS = 86_400_000; // 24 hours

// Redis Lua script return codes
export const REDIS_SCRIPT_SUCCESS = 1;
export const REDIS_SCRIPT_PARTIAL_FAILURE = 0;
export const REDIS_SCRIPT_FAILURE = -1;
export const REDIS_KEY_MISSING = -2;

/**
 * Atomic extension Lua script with TTL feedback and race condition protection
 *
 * KEYS[1]: lock key
 * ARGV[1]: expected lock value
 * ARGV[2]: minimum TTL threshold (ms)
 * ARGV[3]: new TTL to set (ms)
 *
 * Returns: {result_code, current_ttl}
 *   result_code: 1=success, 0=too_late, -1=value_mismatch/key_missing
 *   current_ttl: actual TTL at time of check (-2 if key doesn't exist)
 */
const ATOMIC_EXTEND_SCRIPT = `
local current_ttl = redis.call("PTTL", KEYS[1])
local min_ttl = tonumber(ARGV[2])
local new_ttl = tonumber(ARGV[3])

-- Check if key exists
if current_ttl == -2 then
  return {-1, -2}  -- Key doesn't exist
end

-- Check if we have enough time remaining for safe extension
if current_ttl < min_ttl then
  return {0, current_ttl}  -- Too late, include actual TTL for logging
end

-- Check value and extend atomically
local current_value = redis.call("GET", KEYS[1])
if current_value == ARGV[1] then
  redis.call("PEXPIRE", KEYS[1], new_ttl)
  return {1, current_ttl}  -- Success with original TTL
else
  return {-1, current_ttl}  -- Value mismatch (lock stolen)
end
`.trim();

/**
 * Export atomic extend script for use by concrete adapters
 */
export { ATOMIC_EXTEND_SCRIPT };

export const DELETE_IF_MATCH_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`.trim();

export const EXTEND_IF_MATCH_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
  else
    return 0
  end
`.trim();

/**
 * Atomic batch lock acquisition script
 *
 * ATOMICITY GUARANTEE:
 * Redis Lua scripts execute atomically - either the entire script succeeds
 * or it fails with no side effects. From Redis documentation:
 * "Lua scripts are executed atomically, that is, once a script has been executed,
 * no other script or command will be executed until the script has finished."
 *
 * This provides all-or-nothing semantics for batch acquisition:
 * - If Phase 1 finds any locked key, returns immediately with no keys modified
 * - If Phase 2 completes, all keys are guaranteed to be set
 * - Script execution is atomic even if Redis crashes or client disconnects
 *
 * KEYS[1..N]: Lock keys to acquire
 * ARGV[1..N]: Lock values (one per key)
 * ARGV[N+1]: TTL in milliseconds
 *
 * Returns: {success, count_or_index, failed_key?}
 *   success=1: All locks acquired, count_or_index = number of locks
 *   success=0: Acquisition failed, count_or_index = index of conflicting key
 */
export const BATCH_ACQUIRE_SCRIPT = `
  -- Phase 1: Check all keys are available
  for i = 1, #KEYS do
    if redis.call("EXISTS", KEYS[i]) == 1 then
      return {0, i, KEYS[i]}
    end
  end

  -- Phase 2: All keys available, acquire atomically
  local ttl = tonumber(ARGV[#ARGV])
  for i = 1, #KEYS do
    redis.call("SET", KEYS[i], ARGV[i], "PX", ttl)
  end

  return {1, #KEYS}
`.trim();

/**
 * Lock inspection Lua script
 * Atomically retrieves lock value and remaining TTL
 *
 * KEYS[1]: lock key
 *
 * Returns: [value, ttl] as array, or nil if key doesn't exist
 *   value: current lock value (owner token)
 *   ttl: remaining TTL in milliseconds (-2 if key doesn't exist, -1 if no TTL)
 */
export const INSPECT_SCRIPT = `
local value = redis.call("GET", KEYS[1])
-- If key doesn't exist, return nil (becomes null in JS)
if not value then
  return nil
end
local ttl = redis.call("PTTL", KEYS[1])
-- Returns [value, ttl] as array
return {value, ttl}
`.trim();

/**
 * Script cache keys for internal use by adapters
 * @internal
 */
export const SCRIPT_CACHE_KEYS = {
  ATOMIC_EXTEND: 'ATOMIC_EXTEND',
  BATCH_ACQUIRE: 'BATCH_ACQUIRE',
  INSPECT: 'INSPECT',
  DELETE_IF_MATCH: 'DELETE_IF_MATCH',
  EXTEND_IF_MATCH: 'EXTEND_IF_MATCH',
} as const;

/**
 * Base adapter class providing common functionality for all Redis clients.
 * Implements validation and error handling that's shared across adapters.
 */
export abstract class BaseAdapter implements RedisAdapter {
  protected readonly options: Required<Omit<RedisAdapterOptions, 'logger'>> & { logger?: Logger };
  protected readonly scriptSHAs = new Map<string, string>();

  constructor(options: RedisAdapterOptions = {}) {
    const baseOptions = {
      keyPrefix: options.keyPrefix ?? '',
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? DEFAULTS.RETRY_DELAY,
      timeout: options.timeout ?? DEFAULTS.REDIS_TIMEOUT,
    };

    this.options = options.logger ? { ...baseOptions, logger: options.logger } : baseOptions;
  }

  /**
   * Validates lock key format and requirements
   */
  protected validateKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw new TypeError('Lock key must be a non-empty string');
    }
    if (key.length > MAX_KEY_LENGTH) {
      throw new TypeError(`Lock key must be less than ${MAX_KEY_LENGTH} characters`);
    }
    if (key.includes('\n') || key.includes('\r')) {
      throw new TypeError('Lock key cannot contain newline characters');
    }
  }

  /**
   * Validates lock value format and requirements
   */
  protected validateValue(value: string): void {
    if (!value || typeof value !== 'string') {
      throw new TypeError('Lock value must be a non-empty string');
    }
    if (value.length > MAX_VALUE_LENGTH) {
      throw new TypeError(`Lock value must be less than ${MAX_VALUE_LENGTH} characters`);
    }
  }

  /**
   * Validates TTL (time-to-live) value
   */
  protected validateTTL(ttl: number): void {
    if (!Number.isInteger(ttl) || ttl <= 0) {
      throw new TypeError('TTL must be a positive integer');
    }
    if (ttl > MAX_TTL_MS) {
      throw new TypeError(`TTL cannot exceed 24 hours (${MAX_TTL_MS}ms)`);
    }
  }

  /**
   * Adds prefix to key if configured
   */
  protected prefixKey(key: string): string {
    return this.options.keyPrefix ? `${this.options.keyPrefix}${key}` : key;
  }

  protected stripPrefix(prefixedKey: string): string {
    if (this.options.keyPrefix && prefixedKey.startsWith(this.options.keyPrefix)) {
      return prefixedKey.slice(this.options.keyPrefix.length);
    }
    return prefixedKey;
  }

  /**
   * Handles timeout for Redis operations
   * Properly cleans up timeout handles to prevent memory leaks
   * Uses .unref() to allow Node.js to exit even if timeout is pending
   */
  protected async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number = this.options.timeout
  ): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
      // Prevent timeout from keeping process alive
      timeoutHandle.unref();
    });

    try {
      return await Promise.race([operation, timeoutPromise]);
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * Validate batch acquisition parameters
   * Ensures consistent validation across all adapters
   */
  protected validateBatchAcquisition(keys: string[], values: string[], ttl: number): void {
    if (keys.length !== values.length) {
      throw new TypeError('Keys and values arrays must have the same length');
    }

    if (keys.length === 0) {
      throw new TypeError('At least one key is required for batch acquisition');
    }

    for (let i = 0; i < keys.length; i++) {
      this.validateKey(keys[i]!);
    }
    for (let i = 0; i < values.length; i++) {
      this.validateValue(values[i]!);
    }
    this.validateTTL(ttl);
  }

  /**
   * Parse batch acquisition script result into BatchAcquireResult
   * Ensures consistent handling across all adapters
   *
   * @param result - Lua script result [resultCode, countOrIndex, failedKey?]
   * @param keys - Original keys array for fallback lookup
   * @returns BatchAcquireResult object
   */
  protected parseBatchAcquireResult(
    result: [number, number, string?],
    keys: string[]
  ): BatchAcquireResult {
    const [resultCode, countOrIndex, failedKey] = result;

    if (resultCode === REDIS_SCRIPT_SUCCESS) {
      return {
        success: true,
        acquiredCount: countOrIndex,
      };
    } else {
      const keyThatFailed = failedKey
        ? this.stripPrefix(failedKey)
        : (keys[countOrIndex - 1] ?? 'unknown');

      return {
        success: false,
        acquiredCount: 0,
        failedIndex: countOrIndex,
        failedKey: keyThatFailed,
      };
    }
  }

  /**
   * Parse inspection script result into LockInspection object
   * Ensures consistent handling of Lua array return value across all adapters
   *
   * @param result - Lua script result [value, ttl] or null
   * @returns LockInspection object or null if key doesn't exist
   */
  protected parseInspectionResult(result: [string, number] | null): LockInspection | null {
    if (!result) {
      return null;
    }
    const [value, ttl] = result;
    return { value, ttl };
  }

  /**
   * Interpret atomic extension script result into structured response
   */
  protected interpretAtomicExtensionResult(
    key: string,
    minTTL: number,
    scriptResult: [number, number]
  ): AtomicExtensionResult {
    const [resultCode, actualTTL] = scriptResult;

    switch (resultCode) {
      case REDIS_SCRIPT_SUCCESS:
        return {
          resultCode: REDIS_SCRIPT_SUCCESS,
          actualTTL,
          message: `Extension successful (${actualTTL}ms remaining before extension)`,
        };
      case REDIS_SCRIPT_PARTIAL_FAILURE:
        return {
          resultCode: REDIS_SCRIPT_PARTIAL_FAILURE,
          actualTTL,
          message: `Extension too late (only ${actualTTL}ms left, needed ${minTTL}ms minimum)`,
        };
      case REDIS_SCRIPT_FAILURE:
        return {
          resultCode: REDIS_SCRIPT_FAILURE,
          actualTTL,
          message:
            actualTTL === REDIS_KEY_MISSING
              ? `Lock key "${key}" no longer exists`
              : `Lock value changed - lock stolen (${actualTTL}ms remaining)`,
        };
      default:
        return {
          resultCode: REDIS_SCRIPT_FAILURE,
          actualTTL,
          message: `Unexpected result code: ${resultCode}`,
        };
    }
  }

  abstract setNX(key: string, value: string, ttl: number): Promise<string | null>;
  abstract get(key: string): Promise<string | null>;
  abstract del(key: string): Promise<number>;
  abstract delIfMatch(key: string, value: string): Promise<boolean>;
  abstract extendIfMatch(key: string, value: string, ttl: number): Promise<boolean>;
  abstract atomicExtend(
    key: string,
    value: string,
    minTTL: number,
    newTTL: number
  ): Promise<AtomicExtensionResult>;
  abstract batchSetNX(keys: string[], values: string[], ttl: number): Promise<BatchAcquireResult>;
  abstract inspect(key: string): Promise<LockInspection | null>;
  abstract ping(): Promise<string>;
  abstract isConnected(): boolean;
  abstract disconnect(): Promise<void>;
}
