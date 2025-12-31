import type {
  RedisAdapterOptions,
  AtomicExtensionResult,
  BatchAcquireResult,
  LockInspection,
} from '../types/adapters.js';
import {
  BaseAdapter,
  ATOMIC_EXTEND_SCRIPT,
  DELETE_IF_MATCH_SCRIPT,
  EXTEND_IF_MATCH_SCRIPT,
  BATCH_ACQUIRE_SCRIPT,
  INSPECT_SCRIPT,
  SCRIPT_CACHE_KEYS,
  REDIS_SCRIPT_SUCCESS,
} from './BaseAdapter.js';

// Redis error constants
const REDIS_ERROR_NOSCRIPT = 'NOSCRIPT';

const MAX_SCRIPT_RETRY_ATTEMPTS = 1;

/**
 * Interface representing a GLIDE client's method signatures.
 * GLIDE is Valkey's official client library.
 */
export interface GlideClientLike {
  set(
    key: string,
    value: string,
    options?: {
      conditionalSet?: 'onlyIfExists' | 'onlyIfDoesNotExist';
      expiry?: { type: 'PX' | 'EX' | 'PXAT' | 'EXAT'; count: number };
    }
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
  del(keys: string[]): Promise<number>;
  customCommand(args: string[]): Promise<unknown>;
  close(): Promise<void> | void;
}

/**
 * Redis adapter for Valkey GLIDE clients.
 * Provides unified interface for GLIDE-specific operations.
 *
 * GLIDE (GLIde for Distributed Execution) is Valkey's official client library
 * that supports both Valkey and Redis servers.
 */
export class GlideAdapter extends BaseAdapter {
  private readonly client: GlideClientLike;

  constructor(client: GlideClientLike, options: RedisAdapterOptions = {}) {
    super(options);
    this.client = client;
  }

  /**
   * Factory method to create adapter from client
   */
  static from(client: GlideClientLike, options?: RedisAdapterOptions): GlideAdapter {
    return new GlideAdapter(client, options);
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
        scriptSHA = (await this.withTimeout(
          this.client.customCommand(['SCRIPT', 'LOAD', scriptBody])
        )) as string;
        this.scriptSHAs.set(scriptCacheKey, scriptSHA);
      } catch (error) {
        throw new Error(`Failed to load script ${scriptCacheKey}`, { cause: error });
      }
    }

    try {
      const result = await this.withTimeout(
        this.client.customCommand([
          'EVALSHA',
          scriptSHA,
          keys.length.toString(),
          ...keys,
          ...args.map(a => a.toString()),
        ])
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
      const result = await this.withTimeout(
        this.client.set(prefixedKey, value, {
          conditionalSet: 'onlyIfDoesNotExist',
          expiry: { type: 'PX', count: ttl },
        })
      );

      return result;
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
      // GLIDE del takes an array of keys
      return await this.withTimeout(this.client.del([prefixedKey]));
    } catch (error) {
      throw new Error(`Failed to delete key: ${(error as Error).message}`);
    }
  }

  async delIfMatch(key: string, value: string): Promise<boolean> {
    this.validateKey(key);
    this.validateValue(value);

    const prefixedKey = this.prefixKey(key);

    const result = await this._executeScript<number>(
      SCRIPT_CACHE_KEYS.DELETE_IF_MATCH,
      DELETE_IF_MATCH_SCRIPT,
      [prefixedKey],
      [value]
    );

    return result === REDIS_SCRIPT_SUCCESS;
  }

  async extendIfMatch(key: string, value: string, ttl: number): Promise<boolean> {
    this.validateKey(key);
    this.validateValue(value);
    this.validateTTL(ttl);

    const prefixedKey = this.prefixKey(key);

    const result = await this._executeScript<number>(
      SCRIPT_CACHE_KEYS.EXTEND_IF_MATCH,
      EXTEND_IF_MATCH_SCRIPT,
      [prefixedKey],
      [value, ttl]
    );

    return result === REDIS_SCRIPT_SUCCESS;
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
      SCRIPT_CACHE_KEYS.ATOMIC_EXTEND,
      ATOMIC_EXTEND_SCRIPT,
      [prefixedKey],
      [value, minTTL, newTTL]
    );

    return this.interpretAtomicExtensionResult(prefixedKey, minTTL, result);
  }

  async batchSetNX(keys: string[], values: string[], ttl: number): Promise<BatchAcquireResult> {
    this.validateBatchAcquisition(keys, values, ttl);

    const prefixedKeys = keys.map(k => this.prefixKey(k));

    const result = await this._executeScript<[number, number, string?]>(
      SCRIPT_CACHE_KEYS.BATCH_ACQUIRE,
      BATCH_ACQUIRE_SCRIPT,
      prefixedKeys,
      [...values, ttl]
    );

    return this.parseBatchAcquireResult(result, keys);
  }

  async inspect(key: string): Promise<LockInspection | null> {
    this.validateKey(key);

    const prefixedKey = this.prefixKey(key);

    // Execute Lua script that atomically gets value and TTL
    // Returns [value, ttl] array or null if key doesn't exist
    const result = await this._executeScript<[string, number] | null>(
      SCRIPT_CACHE_KEYS.INSPECT,
      INSPECT_SCRIPT,
      [prefixedKey],
      []
    );

    return this.parseInspectionResult(result);
  }

  async ping(): Promise<string> {
    try {
      const result = await this.withTimeout(this.client.customCommand(['PING']));
      return result as string;
    } catch (error) {
      throw new Error(`Ping failed: ${(error as Error).message}`);
    }
  }

  isConnected(): boolean {
    // GLIDE manages connection state internally and automatically reconnects
    // Unlike ioredis, it doesn't expose a status property
    // For simplicity, we assume connection is active if client exists
    return true;
  }

  async disconnect(): Promise<void> {
    try {
      // Clear cached script SHAs on disconnect to prevent stale references
      this.scriptSHAs.clear();
      await this.client.close();
    } catch (error) {
      if (this.options.logger) {
        this.options.logger.warn('Warning during GLIDE disconnect', {
          adapter: 'glide',
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Get the underlying GLIDE client (for advanced usage)
   */
  getClient(): GlideClientLike {
    return this.client;
  }
}
