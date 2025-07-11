import type { RedisAdapter } from '../types/adapters.js';
import type { LockHandle } from '../types/locks.js';
import { SimpleLock } from '../locks/SimpleLock.js';
import { RedLock } from '../locks/RedLock.js';
import { DEFAULTS } from '../constants.js';

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
 * Enterprise-grade lock manager for Redis distributed locking
 * Provides centralized management of locks with monitoring and health checks
 */
export class LockManager {
  private readonly config: Required<LockManagerConfig>;
  private readonly activeLocks = new Map<string, LockHandle>();
  private readonly stats = {
    totalLocks: 0,
    activeLocks: 0,
    acquiredLocks: 0,
    failedLocks: 0,
    acquisitionTimes: [] as number[],
    holdTimes: [] as number[],
  };

  constructor(config: LockManagerConfig) {
    this.config = {
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

      const acquisitionTime = Date.now() - startTime;
      this.stats.acquisitionTimes.push(acquisitionTime);
      this.stats.acquiredLocks++;
      this.stats.activeLocks++;

      // Track the lock
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
    const holdTime = Date.now() - handle.acquiredAt;
    this.stats.holdTimes.push(holdTime);

    // Remove from tracking
    this.activeLocks.delete(handle.id);
    this.stats.activeLocks--;

    // Create appropriate lock instance and release
    const lock =
      handle.metadata?.strategy === 'redlock'
        ? this.createRedLock(handle.key)
        : this.createSimpleLock(handle.key);

    return lock.release(handle);
  }

  /**
   * Get current lock statistics
   */
  getStats(): LockStats {
    const avgAcquisitionTime =
      this.stats.acquisitionTimes.length > 0
        ? this.stats.acquisitionTimes.reduce((a, b) => a + b, 0) /
          this.stats.acquisitionTimes.length
        : 0;

    const avgHoldTime =
      this.stats.holdTimes.length > 0
        ? this.stats.holdTimes.reduce((a, b) => a + b, 0) / this.stats.holdTimes.length
        : 0;

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
            error: error instanceof Error ? error.message : 'Unknown error',
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
