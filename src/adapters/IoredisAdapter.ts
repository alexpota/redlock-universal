import type { Redis, Cluster } from 'ioredis';
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
import { executeScript, RELEASE_WITH_SCRIPT_BODY, type ScriptCalls } from './script-execution.js';
import { emitWarningOnce } from '../utils/warnings.js';

type IoredisClient = Redis | Cluster;

const DOUBLE_KEY_PREFIX_WARNING_CODE = 'REDLOCK_UNIVERSAL_DOUBLE_KEY_PREFIX';

// Redis command constants
const REDIS_STATUS_READY = 'ready';

/**
 * Redis adapter for ioredis v5+ clients.
 * Supports both standalone Redis and Redis Cluster connections.
 */
export class IoredisAdapter extends BaseAdapter {
  private readonly client: IoredisClient;

  constructor(client: IoredisClient, options: RedisAdapterOptions = {}) {
    super(options);
    this.client = client;
    this.warnIfDoubleKeyPrefix();
  }

  /**
   * Warn once per process when the client and the adapter both set a key prefix: ioredis puts
   * its own prefix in front of the adapter's, so every lock key carries both
   */
  private warnIfDoubleKeyPrefix(): void {
    const clientPrefix = this.client.options?.keyPrefix;
    const adapterPrefix = this.options.keyPrefix;
    if (!clientPrefix || !adapterPrefix) {
      return;
    }

    const message =
      `ioredis keyPrefix "${clientPrefix}" and adapter keyPrefix "${adapterPrefix}" are both set, ` +
      `so lock keys are stored as "${clientPrefix}${adapterPrefix}<key>". Set the prefix in one place.`;

    if (emitWarningOnce(DOUBLE_KEY_PREFIX_WARNING_CODE, message)) {
      this.options.logger?.warn(message, { clientPrefix, adapterPrefix });
    }
  }

  /**
   * Factory method to create adapter from client
   */
  static from(client: IoredisClient, options?: RedisAdapterOptions): IoredisAdapter {
    return new IoredisAdapter(client, options);
  }

  /**
   * Execute a Lua script by SHA, sending the script itself when the node does not have it
   * @private
   */
  private async _executeScript<T>(
    scriptCacheKey: string,
    scriptBody: string,
    keys: string[],
    args: (string | number)[]
  ): Promise<T> {
    return executeScript<T>(
      this.scriptSHAs,
      scriptCacheKey,
      scriptBody,
      this.scriptCalls(scriptBody, keys, args)
    );
  }

  private scriptCalls(scriptBody: string, keys: string[], args: (string | number)[]): ScriptCalls {
    const stringArgs = args.map(a => a.toString());

    return {
      evalSha: sha =>
        this.withTimeout(this.client.evalsha(sha, keys.length, ...keys, ...stringArgs)),
      // Same lowercase name as ioredis's built-in command, so the keys are found for routing
      evalScript: () =>
        this.withTimeout(this.client.call('eval', scriptBody, keys.length, ...keys, ...stringArgs)),
    };
  }

  /**
   * Release with EVAL, sending the script itself, so it does not depend on the server's
   * script cache. Used for best-effort cleanup after an attempt that failed or timed out
   * @internal
   */
  async [RELEASE_WITH_SCRIPT_BODY](key: string, value: string): Promise<boolean> {
    const calls = this.scriptCalls(DELETE_IF_MATCH_SCRIPT, [this.prefixKey(key)], [value]);
    return (await calls.evalScript()) === REDIS_SCRIPT_SUCCESS;
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
      throw new Error(`Failed to acquire lock: ${(error as Error).message}`, { cause: error });
    }
  }

  async get(key: string): Promise<string | null> {
    this.validateKey(key);

    const prefixedKey = this.prefixKey(key);

    try {
      return await this.withTimeout(this.client.get(prefixedKey));
    } catch (error) {
      throw new Error(`Failed to get key: ${(error as Error).message}`, { cause: error });
    }
  }

  async del(key: string): Promise<number> {
    this.validateKey(key);

    const prefixedKey = this.prefixKey(key);

    try {
      return await this.withTimeout(this.client.del(prefixedKey));
    } catch (error) {
      throw new Error(`Failed to delete key: ${(error as Error).message}`, { cause: error });
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
      return await this.withTimeout(this.client.ping());
    } catch (error) {
      throw new Error(`Ping failed: ${(error as Error).message}`, { cause: error });
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
  getClient(): IoredisClient {
    return this.client;
  }
}
