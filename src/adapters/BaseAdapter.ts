import type {
  RedisAdapter,
  RedisAdapterOptions,
  AtomicExtensionResult,
} from '../types/adapters.js';
import type { Logger } from '../monitoring/Logger.js';
import { DEFAULTS } from '../constants.js';

// Validation limits
const MAX_KEY_LENGTH = 512;
const MAX_VALUE_LENGTH = 1024;
const MAX_TTL_MS = 86_400_000; // 24 hours

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

  /**
   * Handles timeout for Redis operations
   */
  protected async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number = this.options.timeout
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    return Promise.race([operation, timeoutPromise]);
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
      case 1:
        return {
          resultCode: 1,
          actualTTL,
          message: `Extension successful (${actualTTL}ms remaining before extension)`,
        };
      case 0:
        return {
          resultCode: 0,
          actualTTL,
          message: `Extension too late (only ${actualTTL}ms left, needed ${minTTL}ms minimum)`,
        };
      case -1:
        return {
          resultCode: -1,
          actualTTL,
          message:
            actualTTL === -2
              ? `Lock key "${key}" no longer exists`
              : `Lock value changed - lock stolen (${actualTTL}ms remaining)`,
        };
      default:
        return {
          resultCode: -1,
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
  abstract ping(): Promise<string>;
  abstract isConnected(): boolean;
  abstract disconnect(): Promise<void>;
}
