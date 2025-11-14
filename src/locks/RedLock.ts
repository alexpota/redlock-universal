/**
 * RedLock implementation for distributed Redis locking
 * Implements the Redlock algorithm as specified by Redis documentation
 */

import type { RedisAdapter } from '../types/adapters.js';
import type { Lock, LockHandle, RedLockConfig } from '../types/locks.js';
import type { ILogger } from '../monitoring/Logger.js';
import { LockAcquisitionError, LockReleaseError, LockExtensionError } from '../types/errors.js';
import { generateLockId, generateLockValue, safeCompare } from '../utils/crypto.js';
import { executeWithAutoExtension, type ExtendedAbortSignal } from '../utils/auto-extension.js';
import { DEFAULTS, ERROR_MESSAGES } from '../constants.js';

// Redis response constants
const REDIS_OK_RESPONSE = 'OK';

// RedLock algorithm constants
const DISTRIBUTED_RETRY_MULTIPLIER = 2;
const QUORUM_DIVISOR = 2;
const QUORUM_OFFSET = 1;

/**
 * Result of attempting to acquire a lock on a single Redis node
 */
interface NodeLockResult {
  /** Whether the lock was successfully acquired */
  readonly success: boolean;
  /** The adapter that was used */
  readonly adapter: RedisAdapter;
  /** Node identifier for debugging */
  readonly nodeId: string;
  /** Error if acquisition failed */
  readonly error?: Error;
  /** Time taken for this operation in milliseconds */
  readonly operationTime: number;
}

/**
 * RedLock implementation for distributed Redis instances
 * Provides reliability across multiple Redis nodes using quorum consensus
 */
export class RedLock implements Lock {
  private readonly adapters: readonly RedisAdapter[];
  private readonly config: Required<Omit<RedLockConfig, 'logger'>> & { logger?: ILogger };

  constructor(config: RedLockConfig) {
    this.adapters = config.adapters;
    const baseConfig = {
      adapters: config.adapters,
      key: config.key,
      ttl: config.ttl ?? DEFAULTS.TTL,
      quorum: config.quorum ?? Math.floor(config.adapters.length / QUORUM_DIVISOR) + QUORUM_OFFSET,
      retryAttempts: config.retryAttempts ?? DEFAULTS.RETRY_ATTEMPTS,
      retryDelay: config.retryDelay ?? DEFAULTS.RETRY_DELAY * DISTRIBUTED_RETRY_MULTIPLIER,
      clockDriftFactor: config.clockDriftFactor ?? DEFAULTS.CLOCK_DRIFT_FACTOR,
    };

    this.config = config.logger ? { ...baseConfig, logger: config.logger } : baseConfig;

    this.validateConfig();
  }

  /**
   * Validate RedLock configuration
   */
  private validateConfig(): void {
    if (!this.config.adapters || this.config.adapters.length === 0) {
      throw new Error('At least one Redis adapter is required for RedLock');
    }

    if (!this.config.key || typeof this.config.key !== 'string') {
      throw new Error('Lock key must be a non-empty string');
    }

    if (this.config.ttl <= 0 || !Number.isInteger(this.config.ttl)) {
      throw new Error('TTL must be a positive integer');
    }

    if (this.config.quorum < 1 || this.config.quorum > this.config.adapters.length) {
      throw new Error(
        `Quorum must be between 1 and ${this.config.adapters.length} (number of adapters)`
      );
    }

    if (this.config.retryAttempts < 0 || !Number.isInteger(this.config.retryAttempts)) {
      throw new Error('Retry attempts must be a non-negative integer');
    }

    if (this.config.retryDelay < 0 || !Number.isInteger(this.config.retryDelay)) {
      throw new Error('Retry delay must be a non-negative integer');
    }

    if (this.config.clockDriftFactor < 0 || this.config.clockDriftFactor >= 1) {
      throw new Error('Clock drift factor must be between 0 and 1');
    }
  }

  /**
   * Attempt to acquire the distributed lock using Redlock algorithm
   */
  async acquire(): Promise<LockHandle> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const lockValue = generateLockValue();
        const result = await this.attemptLockAcquisition(lockValue);

        if (result.success) {
          const acquisitionTime = Date.now() - startTime;
          return {
            id: generateLockId(),
            key: this.config.key,
            value: lockValue,
            acquiredAt: Date.now(),
            ttl: this.config.ttl,
            metadata: {
              attempts: attempt + 1,
              acquisitionTime,
              nodes: result.successfulNodes,
              strategy: 'redlock',
            },
          };
        }

        lastError = new Error(
          `RedLock quorum not achieved: ${result.successCount}/${this.config.quorum} required`
        );

        // Release any partial locks acquired
        await this.releasePartialLocks(result.nodeResults, lockValue);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(ERROR_MESSAGES.UNKNOWN_ERROR);
      }

      // Wait before retrying (except on last attempt)
      if (attempt < this.config.retryAttempts) {
        await this.sleep(this.config.retryDelay);
      }
    }

    throw new LockAcquisitionError(
      this.config.key,
      this.config.retryAttempts + 1,
      lastError || new Error(ERROR_MESSAGES.UNKNOWN_ERROR)
    );
  }

  /**
   * Attempt to acquire lock on all Redis nodes
   */
  private async attemptLockAcquisition(lockValue: string): Promise<{
    success: boolean;
    successCount: number;
    successfulNodes: string[];
    nodeResults: NodeLockResult[];
  }> {
    const startTime = Date.now();

    // Try to acquire lock on all nodes simultaneously
    const lockPromises = this.adapters.map((adapter, index) =>
      this.acquireOnSingleNode(adapter, lockValue, `node-${index}`)
    );

    const nodeResults = await Promise.allSettled(lockPromises);
    const actualResults: NodeLockResult[] = nodeResults.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          success: false,
          adapter: this.adapters[index]!,
          nodeId: `node-${index}`,
          error: result.reason,
          operationTime: Date.now() - startTime,
        };
      }
    });

    const successfulResults = actualResults.filter(result => result.success);
    const successCount = successfulResults.length;

    // Check if we have quorum
    const hasQuorum = successCount >= this.config.quorum;

    // Calculate time spent on lock acquisition
    const totalTime = Date.now() - startTime;

    // Account for clock drift - reduce effective TTL
    const driftTime = Math.floor(this.config.ttl * this.config.clockDriftFactor) + 2;
    const effectiveTime = totalTime + driftTime;

    // If acquisition took too long relative to TTL, it's not safe
    if (effectiveTime >= this.config.ttl) {
      return {
        success: false,
        successCount,
        successfulNodes: successfulResults.map(r => r.nodeId),
        nodeResults: actualResults,
      };
    }

    return {
      success: hasQuorum,
      successCount,
      successfulNodes: successfulResults.map(r => r.nodeId),
      nodeResults: actualResults,
    };
  }

  /**
   * Attempt to acquire lock on a single Redis node
   */
  private async acquireOnSingleNode(
    adapter: RedisAdapter,
    lockValue: string,
    nodeId: string
  ): Promise<NodeLockResult> {
    const startTime = Date.now();

    try {
      const result = await adapter.setNX(this.config.key, lockValue, this.config.ttl);
      const operationTime = Date.now() - startTime;

      return {
        success: result === REDIS_OK_RESPONSE,
        adapter,
        nodeId,
        operationTime,
      };
    } catch (error) {
      const operationTime = Date.now() - startTime;
      return {
        success: false,
        adapter,
        nodeId,
        error: error instanceof Error ? error : new Error(ERROR_MESSAGES.UNKNOWN_ERROR),
        operationTime,
      };
    }
  }

  /**
   * Release any partially acquired locks to prevent deadlocks
   */
  private async releasePartialLocks(
    nodeResults: NodeLockResult[],
    lockValue: string
  ): Promise<void> {
    const releasePromises = nodeResults
      .filter(result => result.success)
      .map(result =>
        result.adapter.delIfMatch(this.config.key, lockValue).catch(() => {
          // Ignore release errors for partial cleanup
        })
      );

    await Promise.allSettled(releasePromises);
  }

  /**
   * Release a previously acquired distributed lock
   */
  async release(handle: LockHandle): Promise<boolean> {
    this.validateHandle(handle);

    try {
      // Try to release lock on all nodes simultaneously
      const releasePromises = this.adapters.map(adapter =>
        adapter.delIfMatch(handle.key, handle.value)
      );

      const results = await Promise.allSettled(releasePromises);
      const successfulReleases = results.filter(
        result => result.status === 'fulfilled' && result.value === true
      ).length;

      // Consider release successful if we released from at least quorum nodes
      return successfulReleases >= this.config.quorum;
    } catch (error) {
      throw new LockReleaseError(
        handle.key,
        'redis_error',
        error instanceof Error ? error : new Error(ERROR_MESSAGES.UNKNOWN_ERROR)
      );
    }
  }

  /**
   * Extend the TTL of an existing distributed lock
   */
  async extend(handle: LockHandle, ttl: number): Promise<boolean> {
    this.validateHandle(handle);

    if (ttl <= 0 || !Number.isInteger(ttl)) {
      throw new Error('TTL must be a positive integer');
    }

    try {
      // Check current lock values on all nodes first
      const checkPromises = this.adapters.map(adapter => adapter.get(handle.key));
      const checkResults = await Promise.allSettled(checkPromises);

      const validNodes = checkResults.filter(result => {
        if (result.status === 'rejected') return false;
        const value = result.value;
        return value !== null && safeCompare(value, handle.value);
      });

      // Need quorum of nodes to have valid lock value
      if (validNodes.length < this.config.quorum) {
        return false;
      }

      // Extend TTL on all nodes using extendIfMatch for atomicity
      const extendPromises = this.adapters.map(adapter =>
        adapter.extendIfMatch(handle.key, handle.value, ttl)
      );

      const extendResults = await Promise.allSettled(extendPromises);
      const successfulExtensions = extendResults.filter(
        result => result.status === 'fulfilled' && result.value === true
      ).length;

      return successfulExtensions >= this.config.quorum;
    } catch (error) {
      throw new LockExtensionError(
        handle.key,
        'redis_error',
        error instanceof Error ? error : new Error(ERROR_MESSAGES.UNKNOWN_ERROR)
      );
    }
  }

  /**
   * Check if the distributed lock is currently held
   */
  async isLocked(key: string): Promise<boolean> {
    try {
      const checkPromises = this.adapters.map(adapter => adapter.get(key));
      const results = await Promise.allSettled(checkPromises);

      const lockedNodes = results.filter(
        result => result.status === 'fulfilled' && result.value !== null
      ).length;

      // Consider locked if quorum of nodes have the key
      return lockedNodes >= this.config.quorum;
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate lock handle
   */
  private validateHandle(handle: LockHandle): void {
    if (!handle) {
      throw new Error('Lock handle is required');
    }

    if (!handle.id || !handle.key || !handle.value) {
      throw new Error('Invalid lock handle: missing required properties');
    }

    if (handle.key !== this.config.key) {
      throw new Error(
        `Lock handle key "${handle.key}" does not match RedLock key "${this.config.key}"`
      );
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get RedLock configuration (for debugging)
   */
  getConfig(): Readonly<RedLockConfig> {
    return { ...this.config };
  }

  /**
   * Get all underlying Redis adapters (for advanced usage)
   */
  getAdapters(): readonly RedisAdapter[] {
    return this.adapters;
  }

  /**
   * Get the underlying Redis adapter for atomic operations
   * RedLock manages multiple adapters, so returns null
   */
  getAdapter(): RedisAdapter | null {
    return null;
  }

  /**
   * Get quorum requirement
   */
  getQuorum(): number {
    return this.config.quorum;
  }

  /**
   * Execute a routine with automatic lock management and extension
   * Auto-extends when remaining TTL < 20% (extends at ~80% consumed)
   * Uses quorum-based extension strategy (continues if majority of nodes succeed)
   * Provides AbortSignal when extension fails
   */
  async using<T>(routine: (signal: ExtendedAbortSignal) => Promise<T>): Promise<T> {
    const handle = await this.acquire();
    const baseConfig = {
      locks: [this],
      handles: [handle],
      ttl: this.config.ttl,
      routine,
    };

    return executeWithAutoExtension(
      this.config.logger ? { ...baseConfig, logger: this.config.logger } : baseConfig
    );
  }
}
