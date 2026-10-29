import type { RedisAdapter } from '../types/adapters.js';
import type { LockHandle } from '../types/locks.js';
import type { ILogger } from '../monitoring/Logger.js';
import { SimpleLock } from '../locks/SimpleLock.js';
import { RedLock } from '../locks/RedLock.js';
import { DEFAULTS, ERROR_MESSAGES } from '../constants.js';
import { generateLockValue, generateLockId } from '../utils/crypto.js';
import {
  assertTtlAboveDrift,
  clockDriftFor,
  releaseQuietly,
  validityExceededError,
} from '../utils/validity.js';
import { LockAcquisitionError } from '../types/errors.js';
import { executeWithAutoExtension, type ExtendedAbortSignal } from '../utils/auto-extension.js';

/** Node ids in handle metadata, same format as RedLock handles */
const NODE_ID_PREFIX = 'node-';

/**
 * Configuration for LockManager
 */
export interface LockManagerConfig {
  /** Redis adapters/clients to use */
  readonly nodes: RedisAdapter[];
  /** Default TTL for locks in milliseconds */
  readonly defaultTTL?: number;
  /** Default retry attempts */
  readonly defaultRetryAttempts?: number;
  /** Default retry delay in milliseconds */
  readonly defaultRetryDelay?: number;
  /** Optional logger for operational visibility */
  readonly logger?: ILogger;
  /** Monitoring configuration */
  readonly monitoring?: {
    readonly enabled?: boolean;
    readonly metricsPort?: number;
    readonly healthCheckInterval?: number;
  };
}

/**
 * Lock statistics for monitoring
 */
export interface LockStats {
  readonly totalLocks: number;
  readonly activeLocks: number;
  readonly acquiredLocks: number;
  readonly failedLocks: number;
  readonly averageAcquisitionTime: number;
  readonly averageHoldTime: number;
}

/**
 * Production-ready lock manager for Redis distributed locking
 * Provides centralized management of locks with monitoring and health checks
 */
export class LockManager {
  private readonly config: Required<Omit<LockManagerConfig, 'logger'>> & {
    readonly logger?: ILogger;
  };
  private readonly activeLocks = new Map<string, LockHandle>();
  private readonly stats = {
    totalLocks: 0,
    activeLocks: 0,
    acquiredLocks: 0,
    failedLocks: 0,
    // Running totals keep averages exact without storing every sample
    acquisitionTimeTotal: 0,
    acquisitionCount: 0,
    holdTimeTotal: 0,
    holdCount: 0,
  };

  constructor(config: LockManagerConfig) {
    const baseConfig = {
      nodes: config.nodes,
      defaultTTL: config.defaultTTL ?? DEFAULTS.TTL,
      defaultRetryAttempts: config.defaultRetryAttempts ?? DEFAULTS.RETRY_ATTEMPTS,
      defaultRetryDelay: config.defaultRetryDelay ?? DEFAULTS.RETRY_DELAY,
      monitoring: {
        enabled: config.monitoring?.enabled ?? false,
        metricsPort: config.monitoring?.metricsPort ?? 9090,
        healthCheckInterval: config.monitoring?.healthCheckInterval ?? 30000,
      },
    };

    this.config = config.logger ? { ...baseConfig, logger: config.logger } : baseConfig;

    this.validateConfig();
  }

  /**
   * Validate configuration parameters
   */
  private validateConfig(): void {
    if (!this.config.nodes || this.config.nodes.length === 0) {
      throw new Error('At least one Redis node is required');
    }

    if (this.config.defaultTTL <= 0) {
      throw new Error('Default TTL must be positive');
    }

    if (this.config.defaultRetryAttempts < 0) {
      throw new Error('Default retry attempts must be non-negative');
    }

    if (this.config.defaultRetryDelay < 0) {
      throw new Error('Default retry delay must be non-negative');
    }
  }

  /**
   * Create a simple lock for single Redis instance
   */
  createSimpleLock(
    key: string,
    options: {
      readonly ttl?: number;
      readonly retryAttempts?: number;
      readonly retryDelay?: number;
      readonly nodeIndex?: number;
    } = {}
  ): SimpleLock {
    const nodeIndex = options.nodeIndex ?? 0;

    if (nodeIndex >= this.config.nodes.length) {
      throw new Error(`Node index ${nodeIndex} is out of range`);
    }

    return new SimpleLock({
      adapter: this.config.nodes[nodeIndex]!,
      key,
      ttl: options.ttl ?? this.config.defaultTTL,
      retryAttempts: options.retryAttempts ?? this.config.defaultRetryAttempts,
      retryDelay: options.retryDelay ?? this.config.defaultRetryDelay,
    });
  }

  /**
   * Create a distributed RedLock for multiple Redis instances
   */
  createRedLock(
    key: string,
    options: {
      readonly ttl?: number;
      readonly retryAttempts?: number;
      readonly retryDelay?: number;
      readonly quorum?: number;
      readonly clockDriftFactor?: number;
    } = {}
  ): RedLock {
    if (this.config.nodes.length < 3) {
      throw new Error('RedLock requires at least 3 Redis nodes for proper distributed locking');
    }

    return new RedLock({
      adapters: this.config.nodes,
      key,
      ttl: options.ttl ?? this.config.defaultTTL,
      retryAttempts: options.retryAttempts ?? this.config.defaultRetryAttempts,
      retryDelay: options.retryDelay ?? this.config.defaultRetryDelay,
      quorum: options.quorum ?? Math.floor(this.config.nodes.length / 2) + 1,
      clockDriftFactor: options.clockDriftFactor ?? 0.01,
    });
  }

  /**
   * Acquire a lock with automatic tracking
   */
  async acquireLock(
    key: string,
    options: {
      readonly ttl?: number;
      readonly retryAttempts?: number;
      readonly retryDelay?: number;
      readonly useRedLock?: boolean;
    } = {}
  ): Promise<LockHandle> {
    const startTime = Date.now();
    this.stats.totalLocks++;

    try {
      const lock = options.useRedLock
        ? this.createRedLock(key, options)
        : this.createSimpleLock(key, options);

      const handle = await lock.acquire();

      this.recordAcquisitionTime(Date.now() - startTime);
      this.stats.acquiredLocks++;
      this.stats.activeLocks++;

      this.activeLocks.set(handle.id, handle);

      return handle;
    } catch (error) {
      this.stats.failedLocks++;
      throw error;
    }
  }

  /**
   * Release a tracked lock
   */
  async releaseLock(handle: LockHandle): Promise<boolean> {
    this.untrackLock(handle);
    const lock =
      handle.metadata?.strategy === 'redlock'
        ? this.createRedLock(handle.key)
        : this.createSimpleLock(handle.key);

    return lock.release(handle);
  }

  /**
   * Acquire multiple locks atomically in a single Redis operation
   *
   * **IMPORTANT - Deadlock Prevention:**
   * Keys are automatically sorted alphabetically before acquisition to prevent deadlocks.
   * The returned lock handles will be in SORTED key order, NOT the original input order.
   *
   * **Atomicity Guarantee:**
   * All locks are acquired atomically using a Lua script - either all succeed or none do.
   * Redis guarantees that Lua scripts execute atomically without interruption.
   *
   * **Retry Behavior:**
   * When a key is already locked, acquireBatch will retry according to the configured
   * retryAttempts and retryDelay options. This allows handling temporary lock contention.
   *
   * **Example:**
   * ```typescript
   * // Input: ['user:3', 'user:1', 'user:2']
   * const handles = await manager.acquireBatch(['user:3', 'user:1', 'user:2']);
   * // Returns handles in sorted order: ['user:1', 'user:2', 'user:3']
   * ```
   *
   * @param keys - Array of lock keys to acquire (will be sorted internally)
   * @param options - Acquisition options
   * @param options.ttl - Lock time-to-live in milliseconds (defaults to manager's defaultTTL)
   * @param options.nodeIndex - Redis node index to use (defaults to 0)
   * @param options.retryAttempts - Number of retry attempts (defaults to manager's defaultRetryAttempts)
   * @param options.retryDelay - Delay between retries in milliseconds (defaults to manager's defaultRetryDelay)
   * @returns Promise resolving to array of lock handles in SORTED key order
   * @throws {Error} If keys array is empty or contains duplicates
   * @throws {LockAcquisitionError} If any key is already locked after all retry attempts
   */
  async acquireBatch(
    keys: string[],
    options: {
      readonly ttl?: number;
      readonly nodeIndex?: number;
      readonly retryAttempts?: number;
      readonly retryDelay?: number;
    } = {}
  ): Promise<LockHandle[]> {
    if (keys.length === 0) {
      throw new Error('At least one key is required for batch acquisition');
    }

    // Check for duplicate keys to prevent subtle bugs
    const uniqueKeys = new Set(keys);
    if (uniqueKeys.size !== keys.length) {
      const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
      throw new Error(
        `Duplicate keys detected in batch acquisition: ${[...new Set(duplicates)].join(', ')}`
      );
    }

    const nodeIndex = options.nodeIndex ?? 0;

    if (nodeIndex >= this.config.nodes.length) {
      throw new Error(`Node index ${nodeIndex} is out of range`);
    }

    const adapter = this.config.nodes[nodeIndex]!;
    const ttl = options.ttl ?? this.config.defaultTTL;
    assertTtlAboveDrift(ttl);
    const retryAttempts = options.retryAttempts ?? this.config.defaultRetryAttempts;
    const retryDelay = options.retryDelay ?? this.config.defaultRetryDelay;
    const startTime = Date.now();
    const drift = clockDriftFor(ttl);
    const sortedKeys = [...keys].sort();

    this.stats.totalLocks += sortedKeys.length;

    if (this.config.logger) {
      this.config.logger.info('Starting batch lock acquisition', {
        keyCount: sortedKeys.length,
        keys: sortedKeys.slice(0, 10), // Log first 10 to avoid huge logs
        ttl,
        nodeIndex,
        retryAttempts,
        retryDelay,
      });
    }

    let lastError: Error | null = null;
    let lastFailedKey: string | undefined;
    let lastFailedIndex: number | undefined;

    for (let attempt = 0; attempt <= retryAttempts; attempt++) {
      const values = sortedKeys.map(() => generateLockValue());

      try {
        // The server starts the TTLs when it runs the script, so the locks are valid from here
        const sentAt = Date.now();
        const startedAt = performance.now();
        const result = await adapter.batchSetNX(sortedKeys, values, ttl);
        const elapsed = performance.now() - startedAt;

        if (result.success && elapsed + drift < ttl) {
          const acquisitionTime = Date.now() - startTime;

          const handles: LockHandle[] = sortedKeys.map((key, index) => ({
            id: generateLockId(),
            key,
            value: values[index]!,
            acquiredAt: sentAt,
            ttl,
            metadata: {
              attempts: attempt + 1,
              acquisitionTime,
              nodes: [`${NODE_ID_PREFIX}${nodeIndex}`],
              strategy: 'simple' as const,
            },
          }));

          this.recordAcquisitionTime(acquisitionTime);
          this.stats.acquiredLocks += handles.length;
          this.stats.activeLocks += handles.length;

          for (const handle of handles) {
            this.activeLocks.set(handle.id, handle);
          }

          if (this.config.logger) {
            this.config.logger.info('Batch lock acquisition succeeded', {
              lockCount: handles.length,
              acquisitionTime,
              avgTimePerLock: acquisitionTime / handles.length,
              attempts: attempt + 1,
            });
          }

          return handles;
        }

        if (result.success) {
          // Granted too late to be safe: give the keys back and try again
          sortedKeys.forEach((key, index) => releaseQuietly(adapter, key, values[index]!));
          lastError = validityExceededError(elapsed, drift, ttl);
          lastFailedKey = sortedKeys[0];
          lastFailedIndex = 0;
        } else {
          // Acquisition failed - key is already locked
          lastFailedKey = result.failedKey;
          lastFailedIndex = result.failedIndex;
          lastError = new Error(
            `Batch acquisition failed: key "${result.failedKey}" at index ${result.failedIndex} is already locked`
          );

          if (this.config.logger && attempt < retryAttempts) {
            this.config.logger.debug?.('Batch lock acquisition attempt failed, retrying', {
              attempt: attempt + 1,
              maxAttempts: retryAttempts + 1,
              failedKey: result.failedKey,
              failedIndex: result.failedIndex,
              retryDelay,
            });
          }
        }
      } catch (error) {
        // Unexpected error (network, Redis, etc.)
        lastError = error as Error;
        // The script may still have run: release this attempt's values without waiting
        sortedKeys.forEach((key, index) => releaseQuietly(adapter, key, values[index]!));
        lastFailedKey = sortedKeys[0];
        lastFailedIndex = 0;

        if (this.config.logger && error instanceof Error) {
          this.config.logger.error('Unexpected error during batch acquisition attempt', error, {
            attempt: attempt + 1,
            maxAttempts: retryAttempts + 1,
            keyCount: sortedKeys.length,
          });
        }
      }

      // Wait before next retry (unless this was the last attempt)
      if (attempt < retryAttempts) {
        await this.sleep(retryDelay);
      }
    }

    // All retries exhausted
    this.stats.failedLocks += sortedKeys.length;

    if (this.config.logger) {
      this.config.logger.error(
        'Batch lock acquisition failed after all retries',
        lastError ?? new Error('Lock acquisition failed'),
        {
          failedKey: lastFailedKey,
          failedIndex: lastFailedIndex,
          attemptedKeys: sortedKeys.length,
          totalAttempts: retryAttempts + 1,
          acquisitionTime: Date.now() - startTime,
        }
      );
    }

    throw new LockAcquisitionError(
      lastFailedKey ?? sortedKeys[0]!,
      retryAttempts + 1,
      lastError ?? new Error('Lock acquisition failed')
    );
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private recordAcquisitionTime(ms: number): void {
    this.stats.acquisitionTimeTotal += ms;
    this.stats.acquisitionCount++;
  }

  private recordHoldTime(ms: number): void {
    this.stats.holdTimeTotal += ms;
    this.stats.holdCount++;
  }

  /**
   * Stop tracking a lock and record how long it was held (no-op if it is not tracked)
   */
  private untrackLock(handle: LockHandle): void {
    if (this.activeLocks.delete(handle.id)) {
      this.stats.activeLocks--;
      this.recordHoldTime(Date.now() - handle.acquiredAt);
    }
  }

  /**
   * Node a batch handle was acquired on, as recorded by acquireBatch (node 0 if absent)
   */
  private batchNodeIndex(handle: LockHandle): number {
    const nodeId = handle.metadata?.nodes?.[0] ?? `${NODE_ID_PREFIX}0`;
    return Number(nodeId.slice(NODE_ID_PREFIX.length));
  }

  /**
   * Release multiple locks
   *
   * @param handles - Array of lock handles to release
   * @returns Promise resolving to array of results (true if released, false if already expired)
   */
  async releaseBatch(handles: LockHandle[]): Promise<boolean[]> {
    const releasePromises = handles.map(async handle => {
      this.untrackLock(handle);

      const lock = this.createSimpleLock(handle.key, { nodeIndex: this.batchNodeIndex(handle) });
      return lock.release(handle);
    });

    const results = await Promise.allSettled(releasePromises);
    return results.map(result => (result.status === 'fulfilled' ? result.value : false));
  }

  /**
   * Acquire and manage multiple locks with automatic extension
   * Combines batch acquisition with auto-extension for long-running operations
   *
   * @param keys - Array of lock keys to acquire
   * @param routine - Function to execute while holding all locks
   * @param options - Lock configuration options
   * @param options.ttl - Lock time-to-live in milliseconds (defaults to manager's defaultTTL)
   * @param options.nodeIndex - Redis node index to use (defaults to 0)
   * @param options.retryAttempts - Number of retry attempts (defaults to manager's defaultRetryAttempts)
   * @param options.retryDelay - Delay between retries in milliseconds (defaults to manager's defaultRetryDelay)
   * @returns Promise resolving to the routine result
   */
  async usingBatch<T>(
    keys: string[],
    routine: (signal: ExtendedAbortSignal) => Promise<T>,
    options: {
      readonly ttl?: number;
      readonly nodeIndex?: number;
      readonly retryAttempts?: number;
      readonly retryDelay?: number;
    } = {}
  ): Promise<T> {
    const handles = await this.acquireBatch(keys, options);
    const ttl = options.ttl ?? this.config.defaultTTL;
    const locks = handles.map(handle =>
      this.createSimpleLock(handle.key, { nodeIndex: this.batchNodeIndex(handle) })
    );

    try {
      return await executeWithAutoExtension({
        locks,
        handles,
        ttl,
        routine,
      });
    } finally {
      // The locks are released by now, whether the routine returned or threw
      for (const handle of handles) {
        this.untrackLock(handle);
      }
    }
  }

  /**
   * Get current lock statistics
   */
  getStats(): LockStats {
    const avgAcquisitionTime =
      this.stats.acquisitionCount > 0
        ? this.stats.acquisitionTimeTotal / this.stats.acquisitionCount
        : 0;

    const avgHoldTime =
      this.stats.holdCount > 0 ? this.stats.holdTimeTotal / this.stats.holdCount : 0;

    return {
      totalLocks: this.stats.totalLocks,
      activeLocks: this.stats.activeLocks,
      acquiredLocks: this.stats.acquiredLocks,
      failedLocks: this.stats.failedLocks,
      averageAcquisitionTime: avgAcquisitionTime,
      averageHoldTime: avgHoldTime,
    };
  }

  /**
   * Get list of currently active locks
   */
  getActiveLocks(): LockHandle[] {
    return Array.from(this.activeLocks.values());
  }

  /**
   * Check health of all Redis nodes
   */
  async checkHealth(): Promise<{
    healthy: boolean;
    nodes: Array<{ index: number; healthy: boolean; error?: string }>;
  }> {
    const nodeResults = await Promise.allSettled(
      this.config.nodes.map(async (adapter, index) => {
        try {
          const result = await adapter.ping();
          return { index, healthy: result === 'PONG' };
        } catch (error) {
          return {
            index,
            healthy: false,
            error: error instanceof Error ? error.message : ERROR_MESSAGES.UNKNOWN_ERROR,
          };
        }
      })
    );

    const nodes = nodeResults.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value
        : {
            index,
            healthy: false,
            error: 'Health check failed',
          }
    );

    const healthyCount = nodes.filter(node => node.healthy).length;
    const healthy = healthyCount >= Math.ceil(this.config.nodes.length / 2);

    return { healthy, nodes };
  }

  /**
   * Clean up expired locks from tracking
   */
  async cleanupExpiredLocks(): Promise<number> {
    const now = Date.now();
    const expiredLocks: string[] = [];

    for (const [id, handle] of this.activeLocks) {
      if (handle.acquiredAt + handle.ttl < now) {
        expiredLocks.push(id);
      }
    }

    for (const id of expiredLocks) {
      this.activeLocks.delete(id);
      this.stats.activeLocks--;
    }

    return expiredLocks.length;
  }

  /**
   * Get metrics in Prometheus format (if monitoring enabled)
   */
  getMetrics(): string {
    if (!this.config.monitoring.enabled) {
      return '';
    }

    const stats = this.getStats();

    return `
# HELP redlock_locks_total Total number of lock operations
# TYPE redlock_locks_total counter
redlock_locks_total ${stats.totalLocks}

# HELP redlock_locks_active Current number of active locks
# TYPE redlock_locks_active gauge
redlock_locks_active ${stats.activeLocks}

# HELP redlock_locks_acquired_total Total number of successfully acquired locks
# TYPE redlock_locks_acquired_total counter
redlock_locks_acquired_total ${stats.acquiredLocks}

# HELP redlock_locks_failed_total Total number of failed lock operations
# TYPE redlock_locks_failed_total counter
redlock_locks_failed_total ${stats.failedLocks}

# HELP redlock_acquisition_duration_ms Average lock acquisition time in milliseconds
# TYPE redlock_acquisition_duration_ms gauge
redlock_acquisition_duration_ms ${stats.averageAcquisitionTime}

# HELP redlock_hold_duration_ms Average lock hold time in milliseconds
# TYPE redlock_hold_duration_ms gauge
redlock_hold_duration_ms ${stats.averageHoldTime}
    `.trim();
  }
}
