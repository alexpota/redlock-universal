/**
 * Redis adapter types for universal client support
 */

/**
 * Common Redis SET command options
 */
export interface SetOptions {
  /** Not eXists - Only set if key doesn't exist */
  readonly NX?: boolean;
  /** Set expiration in milliseconds */
  readonly PX?: number;
  /** Set expiration in seconds */
  readonly EX?: number;
}

/**
 * Result of a SET operation
 */
export type SetResult = 'OK' | null;

/**
 * Universal Redis adapter interface
 * Abstracts differences between node-redis and ioredis
 */
export interface RedisAdapter {
  /**
   * Set a key-value pair with options
   * @param key - Redis key
   * @param value - Value to set
   * @param options - SET command options
   * @returns Promise resolving to 'OK' on success, null on failure
   */
  set(key: string, value: string, options?: SetOptions): Promise<SetResult>;

  /**
   * Get value by key
   * @param key - Redis key
   * @returns Promise resolving to value or null if not found
   */
  get(key: string): Promise<string | null>;

  /**
   * Delete keys
   * @param keys - Keys to delete
   * @returns Promise resolving to number of deleted keys
   */
  del(...keys: string[]): Promise<number>;

  /**
   * Execute Lua script
   * @param script - Lua script
   * @param keys - Keys for the script
   * @param args - Arguments for the script
   * @returns Promise resolving to script result
   */
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;

  /**
   * Check if adapter is connected
   * @returns Promise resolving to connection status
   */
  isConnected(): Promise<boolean>;

  /**
   * Get adapter type for debugging
   */
  readonly type: 'node-redis' | 'ioredis';
}

/**
 * Factory function type for creating Redis adapters
 */
export type AdapterFactory = (client: unknown) => RedisAdapter;