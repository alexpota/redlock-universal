import type { RedisAdapterOptions, AtomicExtensionResult } from '../types/adapters.js';
import { BaseAdapter, ATOMIC_EXTEND_SCRIPT } from './BaseAdapter.js';

// Redis error constants
const REDIS_ERROR_NOSCRIPT = 'NOSCRIPT';
const SCRIPT_CACHE_KEY = 'ATOMIC_EXTEND';

// Lua scripts for atomic operations
const DELETE_IF_MATCH_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;

const EXTEND_IF_MATCH_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
  else
    return 0
  end
`;

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

    try {
      const result = await this.withTimeout(
        this.client.eval(DELETE_IF_MATCH_SCRIPT, {
          keys: [prefixedKey],
          arguments: [value],
        }) as Promise<number>
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
        this.client.eval(EXTEND_IF_MATCH_SCRIPT, {
          keys: [prefixedKey],
          arguments: [value, ttl.toString()],
        }) as Promise<number>
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

    let scriptSHA = this.scriptSHAs.get(SCRIPT_CACHE_KEY);

    if (!scriptSHA) {
      try {
        scriptSHA = await this.withTimeout(
          this.client.scriptLoad(ATOMIC_EXTEND_SCRIPT) as Promise<string>
        );
        this.scriptSHAs.set(SCRIPT_CACHE_KEY, scriptSHA);
      } catch (error) {
        throw new Error(`Failed to load atomic extension script: ${(error as Error).message}`);
      }
    }

    try {
      const result = await this.withTimeout(
        this.client.evalSha(scriptSHA, {
          keys: [prefixedKey],
          arguments: [value, minTTL.toString(), newTTL.toString()],
        }) as Promise<[number, number]>
      );

      return this.interpretAtomicExtensionResult(prefixedKey, minTTL, result);
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage.includes(REDIS_ERROR_NOSCRIPT)) {
        this.scriptSHAs.delete(SCRIPT_CACHE_KEY);
        return this.atomicExtend(key, value, minTTL, newTTL);
      }

      throw new Error(`Atomic extension failed: ${errorMessage}`);
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
    return this.client.isReady;
  }

  async disconnect(): Promise<void> {
    try {
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
