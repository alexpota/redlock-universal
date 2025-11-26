import type {
  RedisAdapterOptions,
  AtomicExtensionResult,
  BatchAcquireResult,
  LockInspection,
} from '../types/adapters.js';
import { BaseAdapter } from './BaseAdapter.js';

/**
 * Internal storage entry for memory-based locks
 */
interface MemoryLockEntry {
  /** Lock value (owner token) */
  readonly value: string;
  /** Absolute expiration timestamp in milliseconds */
  readonly expiresAt: number;
  /** Timeout handle for automatic cleanup (with .unref()) */
  readonly timeout: ReturnType<typeof setTimeout>;
}

/**
 * In-memory Redis adapter for testing without a real Redis instance.
 *
 * **TESTING ONLY**: This adapter is NOT suitable for production use.
 * It lacks persistence, cross-process synchronization, and network reliability.
 *
 * This adapter implements the full RedisAdapter interface using an in-memory Map,
 * allowing unit tests to run without Docker or Redis dependencies.
 *
 * Key behaviors:
 * - TTL expiration via setTimeout with .unref() (won't prevent process exit)
 * - Lazy expiration check on reads (Date.now() > expiresAt)
 * - Synchronous batch operations for atomicity (JavaScript single-threaded)
 * - Identical semantics to Redis adapters (returns same types, throws same errors)
 */
export class MemoryAdapter extends BaseAdapter {
  private readonly storage = new Map<string, MemoryLockEntry>();

  constructor(options: RedisAdapterOptions = {}) {
    super(options);
  }

  /**
   * Factory method to create adapter with options
   */
  static create(options?: RedisAdapterOptions): MemoryAdapter {
    return new MemoryAdapter(options);
  }

  /**
   * Get the current number of active locks
   */
  get size(): number {
    return this.storage.size;
  }

  /**
   * Clear all locks and timers (useful in test beforeEach/afterEach)
   */
  clear(): void {
    for (const entry of this.storage.values()) {
      clearTimeout(entry.timeout);
    }
    this.storage.clear();
  }

  /**
   * Check if a key is expired (lazy expiration)
   */
  private isExpired(entry: MemoryLockEntry): boolean {
    return Date.now() > entry.expiresAt;
  }

  /**
   * Get entry if it exists and is not expired, otherwise clean up and return null
   */
  private getValidEntry(prefixedKey: string): MemoryLockEntry | null {
    const entry = this.storage.get(prefixedKey);
    if (!entry) {
      return null;
    }

    if (this.isExpired(entry)) {
      // Lazy cleanup of expired entry
      clearTimeout(entry.timeout);
      this.storage.delete(prefixedKey);
      return null;
    }

    return entry;
  }

  /**
   * Set a key with value and TTL, returning the timeout handle
   */
  private setWithExpiry(prefixedKey: string, value: string, ttl: number): void {
    // Clear any existing entry first
    const existingEntry = this.storage.get(prefixedKey);
    if (existingEntry) {
      clearTimeout(existingEntry.timeout);
    }

    const expiresAt = Date.now() + ttl;

    // Create timeout for automatic cleanup
    // .unref() ensures this timer won't prevent Node.js process from exiting
    const timeout = setTimeout(() => {
      this.storage.delete(prefixedKey);
    }, ttl);
    timeout.unref();

    this.storage.set(prefixedKey, { value, expiresAt, timeout });
  }

  async setNX(key: string, value: string, ttl: number): Promise<string | null> {
    this.validateKey(key);
    this.validateValue(value);
    this.validateTTL(ttl);

    const prefixedKey = this.prefixKey(key);

    // Check if key exists and is not expired
    const existingEntry = this.getValidEntry(prefixedKey);
    if (existingEntry) {
      return null; // Key already exists
    }

    this.setWithExpiry(prefixedKey, value, ttl);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    this.validateKey(key);

    const prefixedKey = this.prefixKey(key);
    const entry = this.getValidEntry(prefixedKey);

    return entry?.value ?? null;
  }

  async del(key: string): Promise<number> {
    this.validateKey(key);

    const prefixedKey = this.prefixKey(key);
    const entry = this.storage.get(prefixedKey);

    if (!entry) {
      return 0;
    }

    clearTimeout(entry.timeout);
    this.storage.delete(prefixedKey);
    return 1;
  }

  async delIfMatch(key: string, value: string): Promise<boolean> {
    this.validateKey(key);
    this.validateValue(value);

    const prefixedKey = this.prefixKey(key);
    const entry = this.getValidEntry(prefixedKey);

    if (!entry || entry.value !== value) {
      return false;
    }

    clearTimeout(entry.timeout);
    this.storage.delete(prefixedKey);
    return true;
  }

  async extendIfMatch(key: string, value: string, ttl: number): Promise<boolean> {
    this.validateKey(key);
    this.validateValue(value);
    this.validateTTL(ttl);

    const prefixedKey = this.prefixKey(key);
    const entry = this.getValidEntry(prefixedKey);

    if (!entry || entry.value !== value) {
      return false;
    }

    // Clear old timeout and set new expiration
    clearTimeout(entry.timeout);
    this.setWithExpiry(prefixedKey, value, ttl);
    return true;
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
    const entry = this.storage.get(prefixedKey);

    // Key doesn't exist
    if (!entry) {
      return this.interpretAtomicExtensionResult(prefixedKey, minTTL, [-1, -2]);
    }

    const now = Date.now();
    const remainingTTL = entry.expiresAt - now;

    // Key is expired (lazy check)
    if (remainingTTL <= 0) {
      clearTimeout(entry.timeout);
      this.storage.delete(prefixedKey);
      return this.interpretAtomicExtensionResult(prefixedKey, minTTL, [-1, -2]);
    }

    // Check if we have enough time remaining for safe extension
    if (remainingTTL < minTTL) {
      return this.interpretAtomicExtensionResult(prefixedKey, minTTL, [0, remainingTTL]);
    }

    // Value mismatch - lock stolen
    if (entry.value !== value) {
      return this.interpretAtomicExtensionResult(prefixedKey, minTTL, [-1, remainingTTL]);
    }

    // Success - extend the lock
    clearTimeout(entry.timeout);
    this.setWithExpiry(prefixedKey, value, newTTL);
    return this.interpretAtomicExtensionResult(prefixedKey, minTTL, [1, remainingTTL]);
  }

  async batchSetNX(keys: string[], values: string[], ttl: number): Promise<BatchAcquireResult> {
    this.validateBatchAcquisition(keys, values, ttl);

    const prefixedKeys = keys.map(k => this.prefixKey(k));

    // Phase 1: Check all keys are available (atomic - synchronous in JS)
    for (let i = 0; i < prefixedKeys.length; i++) {
      const prefixedKey = prefixedKeys[i];

      if (!prefixedKey) {
        throw new Error(`Invalid prefixed key at index ${i} during batch acquisition`);
      }

      const entry = this.getValidEntry(prefixedKey);

      if (entry) {
        // Key already locked
        return {
          success: false,
          acquiredCount: 0,
          failedIndex: i + 1, // 1-based index to match Lua script
          failedKey: this.stripPrefix(prefixedKey),
        };
      }
    }

    // Phase 2: All keys available - acquire atomically
    for (let i = 0; i < prefixedKeys.length; i++) {
      const prefixedKey = prefixedKeys[i];
      const value = values[i];

      if (!prefixedKey || !value) {
        throw new Error(
          `Invalid key or value at index ${i} during batch acquisition. This should never happen.`
        );
      }

      this.setWithExpiry(prefixedKey, value, ttl);
    }

    return {
      success: true,
      acquiredCount: keys.length,
    };
  }

  async inspect(key: string): Promise<LockInspection | null> {
    this.validateKey(key);

    const prefixedKey = this.prefixKey(key);
    const entry = this.getValidEntry(prefixedKey);

    if (!entry) {
      return null;
    }

    const ttl = entry.expiresAt - Date.now();
    return { value: entry.value, ttl };
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  isConnected(): boolean {
    return true;
  }

  async disconnect(): Promise<void> {
    // Delegate to clear() to avoid code duplication
    this.clear();
  }
}
