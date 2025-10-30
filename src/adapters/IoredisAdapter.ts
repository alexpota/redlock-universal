import type { Redis } from 'ioredis';
import type {
  RedisAdapterOptions,
  AtomicExtensionResult,
  BatchAcquireResult,
} from '../types/adapters.js';
import {
  BaseAdapter,
  ATOMIC_EXTEND_SCRIPT,
  DELETE_IF_MATCH_SCRIPT,
  EXTEND_IF_MATCH_SCRIPT,
  BATCH_ACQUIRE_SCRIPT,
} from './BaseAdapter.js';

// Redis command constants
const REDIS_STATUS_READY = 'ready';
const REDIS_ERROR_NOSCRIPT = 'NOSCRIPT';

const MAX_SCRIPT_RETRY_ATTEMPTS = 1;
const SCRIPT_CACHE_KEY_ATOMIC_EXTEND = 'ATOMIC_EXTEND';
const SCRIPT_CACHE_KEY_BATCH_ACQUIRE = 'BATCH_ACQUIRE';

/**
 * Redis adapter for ioredis v5+ clients.
 * Provides unified interface for ioredis specific operations.
 */
export class IoredisAdapter extends BaseAdapter {
  private readonly client: Redis;

  constructor(client: Redis, options: RedisAdapterOptions = {}) {
    super(options);
    this.client = client;
  }

  /**
   * Factory method to create adapter from client
   */
  static from(client: Redis, options?: RedisAdapterOptions): IoredisAdapter {
    return new IoredisAdapter(client, options);
  }

  /**
   * Execute a Lua script with automatic loading, caching, and NOSCRIPT retry handling
   * @private
   */
  private async _executeScript<T>(
    scriptCacheKey: string,
    scriptBody: string,
    keys: string[],
    args: (string | number)[],
    retryAttempt = 0
  ): Promise<T> {
    let scriptSHA = this.scriptSHAs.get(scriptCacheKey);

    if (!scriptSHA) {
      try {
        scriptSHA = await this.withTimeout(
          this.client.script('LOAD', scriptBody) as Promise<string>
        );
        this.scriptSHAs.set(scriptCacheKey, scriptSHA);
      } catch (error) {
        throw new Error(`Failed to load script ${scriptCacheKey}`, { cause: error });
      }
    }

    try {
      const result = await this.withTimeout(
        this.client.evalsha(scriptSHA, keys.length, ...keys, ...args.map(a => a.toString()))
      );
      return result as T;
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage.includes(REDIS_ERROR_NOSCRIPT)) {
        this.scriptSHAs.delete(scriptCacheKey);

        if (retryAttempt < MAX_SCRIPT_RETRY_ATTEMPTS) {
          return this._executeScript(scriptCacheKey, scriptBody, keys, args, retryAttempt + 1);
        }

        throw new Error(
          `Script execution failed after ${MAX_SCRIPT_RETRY_ATTEMPTS} NOSCRIPT retries`,
          { cause: error }
        );
      }

      throw new Error('Script execution failed', { cause: error });
    }
  }

  async setNX(key: string, value: string, ttl: number): Promise<string | null> {
    this.validateKey(key);
    this.validateValue(value);
    this.validateTTL(ttl);

    const prefixedKey = this.prefixKey(key);

    try {
      const result = await this.withTimeout(this.client.set(prefixedKey, value, 'PX', ttl, 'NX'));

      return result as string | null;
    } catch (error) {
      throw new Error(`Failed to acquire lock: ${(error as Error).message}`);
    }
  }

  async get(key: string): Promise<string | null> {
    this.validateKey(key);

    const prefixedKey = this.prefixKey(key);

    try {
      return await this.withTimeout(this.client.get(prefixedKey));
    } catch (error) {
      throw new Error(`Failed to get key: ${(error as Error).message}`);
    }
  }

  async del(key: string): Promise<number> {
    this.validateKey(key);

    const prefixedKey = this.prefixKey(key);

    try {
      return await this.withTimeout(this.client.del(prefixedKey));
    } catch (error) {
      throw new Error(`Failed to delete key: ${(error as Error).message}`);
    }
  }

  async delIfMatch(key: string, value: string): Promise<boolean> {
    this.validateKey(key);
    this.validateValue(value);

    const prefixedKey = this.prefixKey(key);

    try {
      const result = await this.withTimeout(
        this.client.eval(DELETE_IF_MATCH_SCRIPT, 1, prefixedKey, value) as Promise<number>
      );

      return result === 1;
    } catch (error) {
      throw new Error(`Failed to conditionally delete key: ${(error as Error).message}`);
    }
  }

  async extendIfMatch(key: string, value: string, ttl: number): Promise<boolean> {
    this.validateKey(key);
    this.validateValue(value);
    this.validateTTL(ttl);

    const prefixedKey = this.prefixKey(key);

    try {
      const result = await this.withTimeout(
        this.client.eval(
          EXTEND_IF_MATCH_SCRIPT,
          1,
          prefixedKey,
          value,
          ttl.toString()
        ) as Promise<number>
      );

      return result === 1;
    } catch (error) {
      throw new Error(`Failed to extend lock TTL: ${(error as Error).message}`);
    }
  }

  async atomicExtend(
    key: string,
    value: string,
    minTTL: number,
    newTTL: number
  ): Promise<AtomicExtensionResult> {
    this.validateKey(key);
    this.validateValue(value);
    this.validateTTL(newTTL);

    if (!Number.isInteger(minTTL) || minTTL <= 0) {
      throw new TypeError('Minimum TTL must be a positive integer');
    }

    const prefixedKey = this.prefixKey(key);

    const result = await this._executeScript<[number, number]>(
      SCRIPT_CACHE_KEY_ATOMIC_EXTEND,
      ATOMIC_EXTEND_SCRIPT,
      [prefixedKey],
      [value, minTTL, newTTL]
    );

    return this.interpretAtomicExtensionResult(prefixedKey, minTTL, result);
  }

  async batchSetNX(keys: string[], values: string[], ttl: number): Promise<BatchAcquireResult> {
    if (keys.length !== values.length) {
      throw new TypeError('Keys and values arrays must have the same length');
    }

    if (keys.length === 0) {
      throw new TypeError('At least one key is required for batch acquisition');
    }

    keys.forEach(k => this.validateKey(k));
    values.forEach(v => this.validateValue(v));
    this.validateTTL(ttl);

    const prefixedKeys = keys.map(k => this.prefixKey(k));

    const result = await this._executeScript<[number, number, string?]>(
      SCRIPT_CACHE_KEY_BATCH_ACQUIRE,
      BATCH_ACQUIRE_SCRIPT,
      prefixedKeys,
      [...values, ttl]
    );

    const [resultCode, countOrIndex, failedKey] = result;

    if (resultCode === 1) {
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

  async ping(): Promise<string> {
    try {
      return await this.withTimeout(this.client.ping());
    } catch (error) {
      throw new Error(`Ping failed: ${(error as Error).message}`);
    }
  }

  isConnected(): boolean {
    return this.client.status === REDIS_STATUS_READY;
  }

  async disconnect(): Promise<void> {
    try {
      // Clear cached script SHAs on disconnect to prevent stale references
      this.scriptSHAs.clear();
      this.client.disconnect();
    } catch (error) {
      if (this.options.logger) {
        this.options.logger.warn('Warning during Redis disconnect', {
          adapter: 'ioredis',
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Get the underlying ioredis client (for advanced usage)
   */
  getClient(): Redis {
    return this.client;
  }
}
