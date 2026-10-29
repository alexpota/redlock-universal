/**
 * RedLock implementation for distributed Redis locking
 * Implements the Redlock algorithm as specified by Redis documentation
 */

import type { RedisAdapter } from '../types/adapters.js';
import type { Lock, LockHandle, RedLockConfig } from '../types/locks.js';
import type { ILogger } from '../monitoring/Logger.js';
import { LockAcquisitionError, LockReleaseError, LockExtensionError } from '../types/errors.js';
import { generateLockId, generateLockValue } from '../utils/crypto.js';
import { executeWithAutoExtension, type ExtendedAbortSignal } from '../utils/auto-extension.js';
import { emitWarningOnce } from '../utils/warnings.js';
import {
  assertTtlAboveDrift,
  clockDriftFor,
  releaseQuietly,
  validityExceededError,
} from '../utils/validity.js';
import { DEFAULTS, ERROR_MESSAGES } from '../constants.js';

// Redis response constants
const REDIS_OK_RESPONSE = 'OK';

// RedLock algorithm constants
const DISTRIBUTED_RETRY_MULTIPLIER = 2;
const QUORUM_DIVISOR = 2;
const QUORUM_OFFSET = 1;
const MINORITY_QUORUM_WARNING_CODE = 'REDLOCK_UNIVERSAL_MINORITY_QUORUM';

/**
 * Resolve once `quorum` results are successes, or once so many have failed that the quorum
 * is out of reach, without waiting for the other nodes. Nodes that have not replied by then
 * are undefined in the result. The pending promises must not reject.
 */
function settleOnQuorum<T>(
  pending: ReadonlyArray<Promise<T>>,
  quorum: number,
  isSuccess: (result: T) => boolean
): Promise<Array<T | undefined>> {
  return new Promise(resolve => {
    // Dense, so nodes that have not replied map to undefined rather than holes
    const results = new Array<T | undefined>(pending.length).fill(undefined);
    const failureLimit = pending.length - quorum;
    let successes = 0;
    let failures = 0;

    pending.forEach((promise, index) => {
      void promise.then(result => {
        results[index] = result;
        if (isSuccess(result)) {
          successes++;
        } else {
          failures++;
        }
        if (successes >= quorum || failures > failureLimit) {
          resolve(results.slice());
        }
      });
    });
  });
}

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
    this.warnIfMinorityQuorum();
  }

  /**
   * Warn once per process when the quorum is not a majority: two clients can then
   * hold the same lock on disjoint sets of nodes
   */
  private warnIfMinorityQuorum(): void {
    const { quorum, adapters, key, logger } = this.config;
    if (quorum > adapters.length / QUORUM_DIVISOR) {
      return;
    }

    const majority = Math.floor(adapters.length / QUORUM_DIVISOR) + QUORUM_OFFSET;
    const message =
      `RedLock quorum ${quorum} of ${adapters.length} nodes is not a majority, so two clients ` +
      `can hold the same lock at once. Use a quorum of at least ${majority}.`;

    if (emitWarningOnce(MINORITY_QUORUM_WARNING_CODE, message)) {
      logger?.warn(message, { key, quorum, nodes: adapters.length });
    }
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

    assertTtlAboveDrift(this.config.ttl, this.config.clockDriftFactor);
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
        // Each node starts the TTL when it receives the request, so the lock is valid from here
        const attemptStartedAt = Date.now();
        const result = await this.attemptLockAcquisition(lockValue, performance.now());

        if (result.success) {
          const acquisitionTime = Date.now() - startTime;
          return {
            id: generateLockId(),
            key: this.config.key,
            value: lockValue,
            acquiredAt: attemptStartedAt,
            ttl: this.config.ttl,
            metadata: {
              attempts: attempt + 1,
              acquisitionTime,
              nodes: result.successfulNodes,
              strategy: 'redlock',
            },
          };
        }

        lastError =
          result.validityExceeded ??
          new Error(
            `RedLock quorum not achieved: ${result.successCount}/${this.config.quorum} required`
          );

        // Release what this attempt may have set, without waiting for slow nodes
        this.releasePartialLocks(result.nodeResults, lockValue);
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
  private async attemptLockAcquisition(
    lockValue: string,
    startedAt: number
  ): Promise<{
    success: boolean;
    successCount: number;
    successfulNodes: string[];
    /** Each node's reply when the outcome was decided; undefined while it is still in flight */
    nodeResults: ReadonlyArray<NodeLockResult | undefined>;
    validityExceeded?: Error;
  }> {
    const startTime = Date.now();

    // Try to acquire lock on all nodes simultaneously; stop waiting once the outcome is decided
    const replies = this.adapters.map((adapter, index) =>
      this.acquireOnSingleNode(adapter, lockValue, `node-${index}`)
    );
    const nodeResults = await settleOnQuorum(replies, this.config.quorum, result => result.success);
    // A node that has not replied by now does not count towards the quorum
    const actualResults: NodeLockResult[] = nodeResults.map(
      (result, index) =>
        result ?? {
          success: false,
          adapter: this.adapters[index]!,
          nodeId: `node-${index}`,
          operationTime: Date.now() - startTime,
        }
    );

    const successfulResults = actualResults.filter(result => result.success);
    const successCount = successfulResults.length;

    // Check if we have quorum
    const hasQuorum = successCount >= this.config.quorum;

    // Time spent on lock acquisition, on the monotonic clock
    const elapsed = performance.now() - startedAt;

    // Account for clock drift - reduce effective TTL
    const drift = clockDriftFor(this.config.ttl, this.config.clockDriftFactor);

    // If acquisition took too long relative to TTL, it's not safe
    if (elapsed + drift >= this.config.ttl) {
      return {
        success: false,
        successCount,
        successfulNodes: successfulResults.map(r => r.nodeId),
        nodeResults,
        ...(hasQuorum && {
          validityExceeded: validityExceededError(elapsed, drift, this.config.ttl),
        }),
      };
    }

    return {
      success: hasQuorum,
      successCount,
      successfulNodes: successfulResults.map(r => r.nodeId),
      nodeResults,
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
   * Release this attempt's value, without waiting, on every node that set it or may have:
   * nodes that granted, failed, timed out or have not replied yet. A node still in flight gets
   * the release right away; it travels behind the SET on the same connection, so it runs after
   * it, before a retry's SET. Nodes that answered "not set" are skipped
   */
  private releasePartialLocks(
    nodeResults: ReadonlyArray<NodeLockResult | undefined>,
    lockValue: string
  ): void {
    nodeResults.forEach((result, index) => {
      if (!result || result.success || result.error) {
        releaseQuietly(this.adapters[index]!, this.config.key, lockValue);
      }
    });
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
      // extendIfMatch checks ownership atomically on each node, so a separate read round
      // would only delay the extension until the slowest node replies
      const extendResults = await settleOnQuorum(
        this.adapters.map(adapter =>
          adapter.extendIfMatch(handle.key, handle.value, ttl).catch(() => false)
        ),
        this.config.quorum,
        extended => extended
      );
      const successfulExtensions = extendResults.filter(extended => extended === true).length;

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
    } catch (_error) {
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
