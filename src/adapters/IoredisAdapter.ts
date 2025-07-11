import type { Redis } from 'ioredis';
import type { RedisAdapterOptions } from '../types/adapters.js';
import { BaseAdapter } from './BaseAdapter.js';

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
   * Set key with value if not exists, with TTL in milliseconds
   */
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

    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;

    try {
      const result = await this.withTimeout(
        this.client.eval(script, 1, prefixedKey, value) as Promise<number>
      );

      return result === 1;
    } catch (error) {
      throw new Error(`Failed to conditionally delete key: ${(error as Error).message}`);
    }
  }

  /**
   * Extend TTL of key only if value matches (atomic operation)
   * Uses Lua script to ensure atomicity
   */
  async extendIfMatch(key: string, value: string, ttl: number): Promise<boolean> {
    this.validateKey(key);
    this.validateValue(value);
    this.validateTTL(ttl);

    const prefixedKey = this.prefixKey(key);

    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("PEXPIRE", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

    try {
      const result = await this.withTimeout(
        this.client.eval(script, 1, prefixedKey, value, ttl.toString()) as Promise<number>
      );

      return result === 1;
    } catch (error) {
      throw new Error(`Failed to extend lock TTL: ${(error as Error).message}`);
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
    return this.client.status === 'ready';
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    try {
      this.client.disconnect();
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        process.stderr.write(`Warning during disconnect: ${(error as Error).message}\n`);
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
