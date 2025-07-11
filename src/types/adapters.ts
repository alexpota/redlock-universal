/**
 * Redis adapter types for universal client support
 */

/**
 * Configuration options for Redis adapters
 */
export interface RedisAdapterOptions {
  /** Prefix to add to all keys */
  readonly keyPrefix?: string;
  /** Maximum number of retries for failed operations */
  readonly maxRetries?: number;
  /** Delay between retries in milliseconds */
  readonly retryDelay?: number;
  /** Timeout for Redis operations in milliseconds */
  readonly timeout?: number;
}

/**
 * Universal Redis adapter interface
 * Abstracts differences between node-redis and ioredis
 */
export interface RedisAdapter {
  /**
   * Set key with value if not exists, with TTL in milliseconds
   * @param key - Redis key
   * @param value - Value to set
   * @param ttl - Time to live in milliseconds
   * @returns Promise resolving to 'OK' on success, null if key exists
   */
  setNX(key: string, value: string, ttl: number): Promise<string | null>;

  /**
   * Get value by key
   * @param key - Redis key
   * @returns Promise resolving to value or null if not found
   */
  get(key: string): Promise<string | null>;

  /**
   * Delete key
   * @param key - Key to delete
   * @returns Promise resolving to number of deleted keys
   */
  del(key: string): Promise<number>;

  /**
   * Delete key only if value matches (atomic operation)
   * @param key - Redis key
   * @param value - Expected value
   * @returns Promise resolving to true if deleted, false otherwise
   */
  delIfMatch(key: string, value: string): Promise<boolean>;

  /**
   * Extend TTL of a key only if value matches (atomic operation)
   * @param key - Redis key
   * @param value - Expected value
   * @param ttl - New TTL in milliseconds
   * @returns Promise resolving to true if extended, false otherwise
   */
  extendIfMatch(key: string, value: string, ttl: number): Promise<boolean>;

  /**
   * Ping Redis server
   * @returns Promise resolving to 'PONG'
   */
  ping(): Promise<string>;

  /**
   * Check if adapter is connected
   * @returns Connection status
   */
  isConnected(): boolean;

  /**
   * Disconnect from Redis
   * @returns Promise that resolves when disconnected
   */
  disconnect(): Promise<void>;
}

/**
 * Factory function type for creating Redis adapters
 */
export type AdapterFactory = (client: unknown) => RedisAdapter;
