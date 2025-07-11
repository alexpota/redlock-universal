import type { RedisAdapter, RedisAdapterOptions } from '../types/adapters.js';
import { DEFAULTS } from '../constants.js';

/**
 * Base adapter class providing common functionality for all Redis clients.
 * Implements validation and error handling that's shared across adapters.
 */
export abstract class BaseAdapter implements RedisAdapter {
  protected readonly options: Required<RedisAdapterOptions>;

  constructor(options: RedisAdapterOptions = {}) {
    this.options = {
      keyPrefix: options.keyPrefix ?? '',
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? DEFAULTS.RETRY_DELAY,
      timeout: options.timeout ?? DEFAULTS.REDIS_TIMEOUT,
      ...options,
    };
  }

  /**
   * Validates lock key format and requirements
   */
  protected validateKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw new TypeError('Lock key must be a non-empty string');
    }
    if (key.length > 512) {
      throw new TypeError('Lock key must be less than 512 characters');
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
    if (value.length > 1024) {
      throw new TypeError('Lock value must be less than 1024 characters');
    }
  }

  /**
   * Validates TTL (time-to-live) value
   */
  protected validateTTL(ttl: number): void {
    if (!Number.isInteger(ttl) || ttl <= 0) {
      throw new TypeError('TTL must be a positive integer');
    }
    if (ttl > 86400000) {
      // 24 hours in milliseconds
      throw new TypeError('TTL cannot exceed 24 hours (86400000ms)');
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

  // Abstract methods that must be implemented by concrete adapters
  abstract setNX(key: string, value: string, ttl: number): Promise<string | null>;
  abstract get(key: string): Promise<string | null>;
  abstract del(key: string): Promise<number>;
  abstract delIfMatch(key: string, value: string): Promise<boolean>;
  abstract extendIfMatch(key: string, value: string, ttl: number): Promise<boolean>;
  abstract ping(): Promise<string>;
  abstract isConnected(): boolean;
  abstract disconnect(): Promise<void>;
}
