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
import { executeScript } from './script-execution.js';

/**
 * Flexible type for node-redis clients.
 *
 * Using 'any' here is a justified compromise because:
 * 1. Redis client types are extremely complex and vary based on installed modules
 * 2. Type safety is maintained at our adapter's public API boundary
 * 3. We validate all inputs and type all outputs
 * 4. Redis command behavior is stable and well-documented
 * 5. The 'any' is private and doesn't leak to library users
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FlexibleRedisClient = any;

/**
 * Redis adapter for node-redis v4+ clients.
 * Provides unified interface for node-redis specific operations.
 */
export class NodeRedisAdapter extends BaseAdapter {
  private readonly client: FlexibleRedisClient;

  constructor(client: FlexibleRedisClient, options: RedisAdapterOptions = {}) {
    super(options);
    this.client = client;
  }

  /**
   * Factory method to create adapter from client
   */
  static from(client: FlexibleRedisClient, options?: RedisAdapterOptions): NodeRedisAdapter {
    return new NodeRedisAdapter(client, options);
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
    const scriptArgs = [keys.length.toString(), ...keys, ...args.map(a => a.toString())];

    // Both commands go through sendCommand: node-redis 4 cluster clients route evalSha()
    // without its keys. Cluster clients (they expose `masters`) take the routing key first.
    const send = (command: string[]): Promise<T> =>
      ('masters' in this.client
        ? this.client.sendCommand(keys[0], false, command)
        : this.client.sendCommand(command)) as Promise<T>;

    return executeScript<T>(this.scriptSHAs, scriptCacheKey, scriptBody, {
      evalSha: sha => this.withTimeout(send(['EVALSHA', sha, ...scriptArgs])),
      evalScript: () => this.withTimeout(send(['EVAL', scriptBody, ...scriptArgs])),
    });
  }

  async setNX(key: string, value: string, ttl: number): Promise<string | null> {
    this.validateKey(key);
    this.validateValue(value);
    this.validateTTL(ttl);

    const prefixedKey = this.prefixKey(key);

    try {
      const result = await this.withTimeout(
        this.client.set(prefixedKey, value, {
          NX: true,
          PX: ttl,
        })
      );

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
      throw new Error(`Ping failed: ${(error as Error).message}`);
    }
  }

  isConnected(): boolean {
    return this.client.isReady;
  }

  async disconnect(): Promise<void> {
    try {
      // Clear cached script SHAs on disconnect to prevent stale references
      this.scriptSHAs.clear();
      await this.client.disconnect();
    } catch (error) {
      if (this.options.logger) {
        this.options.logger.warn('Warning during Redis disconnect', {
          adapter: 'node-redis',
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Get the underlying node-redis client (for advanced usage)
   */
  getClient(): FlexibleRedisClient {
    return this.client;
  }
}
