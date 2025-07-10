import type { RedisClientType } from 'redis';
import type { RedisAdapterOptions } from '../types/adapters.js';
import { BaseAdapter } from './BaseAdapter.js';

/**
 * Redis adapter for node-redis v4+ clients.
 * Provides unified interface for node-redis specific operations.
 */
export class NodeRedisAdapter extends BaseAdapter {
  private readonly client: RedisClientType;

  constructor(client: RedisClientType, options: RedisAdapterOptions = {}) {
    super(options);
    this.client = client;
  }

  /**
   * Factory method to create adapter from client
   */
  static from(client: RedisClientType, options?: RedisAdapterOptions): NodeRedisAdapter {
    return new NodeRedisAdapter(client, options);
  }

  /**
   * Set key with value if not exists, with TTL in milliseconds
   */
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

  /**
   * Get value for key
   */
  async get(key: string): Promise<string | null> {
    this.validateKey(key);

    const prefixedKey = this.prefixKey(key);

    try {
      return await this.withTimeout(this.client.get(prefixedKey));
    } catch (error) {
      throw new Error(`Failed to get key: ${(error as Error).message}`);
    }
  }

  /**
   * Delete key
   */
  async del(key: string): Promise<number> {
    this.validateKey(key);

    const prefixedKey = this.prefixKey(key);

    try {
      return await this.withTimeout(this.client.del(prefixedKey));
    } catch (error) {
      throw new Error(`Failed to delete key: ${(error as Error).message}`);
    }
  }

  /**
   * Delete key only if value matches (atomic operation)
   * Uses Lua script to ensure atomicity
   */
  async delIfMatch(key: string, value: string): Promise<boolean> {
    this.validateKey(key);
    this.validateValue(value);

    const prefixedKey = this.prefixKey(key);

    // Lua script for atomic get-and-delete-if-match
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;

    try {
      const result = await this.withTimeout(
        this.client.eval(script, {
          keys: [prefixedKey],
          arguments: [value],
        }) as Promise<number>
      );

      return result === 1;
    } catch (error) {
      throw new Error(`Failed to conditionally delete key: ${(error as Error).message}`);
    }
  }

  /**
   * Ping Redis server
   */
  async ping(): Promise<string> {
    try {
      return await this.withTimeout(this.client.ping());
    } catch (error) {
      throw new Error(`Ping failed: ${(error as Error).message}`);
    }
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.client.isReady;
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    try {
      await this.client.disconnect();
    } catch (error) {
      // Log but don't throw on disconnect errors
      console.warn(`Warning during disconnect: ${(error as Error).message}`);
    }
  }

  /**
   * Get the underlying node-redis client (for advanced usage)
   */
  getClient(): RedisClientType {
    return this.client;
  }
}
