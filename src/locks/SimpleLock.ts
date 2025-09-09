import type { RedisAdapter } from '../types/adapters.js';
import type { Lock, LockHandle, SimpleLockConfig } from '../types/locks.js';
import type { Logger } from '../monitoring/Logger.js';
import { LockAcquisitionError, LockReleaseError, LockExtensionError } from '../types/errors.js';
import { generateLockValue, generateLockId } from '../utils/crypto.js';
import {
  executeWithSingleLockExtension,
  type ExtendedAbortSignal,
} from '../utils/auto-extension.js';
import { DEFAULTS, ERROR_MESSAGES } from '../constants.js';

// Redis response constants
const REDIS_OK_RESPONSE = 'OK';

/**
 * Simple lock implementation for single Redis instance
 * Provides reliable locking with retry logic and proper error handling
 * Memory-optimized for production 24/7 systems
 */
export class SimpleLock implements Lock {
  private readonly adapter: RedisAdapter;
  private readonly key: string;
  private readonly ttl: number;
  private readonly retryAttempts: number;
  private readonly retryDelay: number;
  private readonly logger: Logger | undefined;
  private readonly correlationId?: string;
  private readonly onAcquire?: (handle: LockHandle) => void;
  private readonly onRelease?: (handle: LockHandle) => void;
  private _configCache?: Readonly<SimpleLockConfig>;

  private _lastHealthCheck: number = 0;
  private _healthCheckInterval: number = DEFAULTS.HEALTH_CHECK_INTERVAL;
  private _isHealthy: boolean = true;

  private _circuitBreakerFailures: number = 0;
  private _circuitBreakerThreshold: number = DEFAULTS.CIRCUIT_BREAKER_THRESHOLD;
  private _circuitBreakerTimeout: number = DEFAULTS.CIRCUIT_BREAKER_TIMEOUT;
  private _circuitBreakerOpenedAt: number = 0;
  private _circuitBreakerState: 'closed' | 'open' | 'half-open' = 'closed';

  private readonly _metadataTemplate: {
    strategy: 'simple';
    correlationId?: string;
  };

  constructor(config: SimpleLockConfig) {
    this.validateConfig(config);

    this.adapter = config.adapter;
    this.key = config.key;
    this.ttl = config.ttl ?? DEFAULTS.TTL;
    this.retryAttempts = config.retryAttempts ?? DEFAULTS.RETRY_ATTEMPTS;
    this.retryDelay = config.retryDelay ?? DEFAULTS.RETRY_DELAY;
    this.logger = config.logger;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.correlationId = (config as any).correlationId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.onAcquire = (config as any).onAcquire;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.onRelease = (config as any).onRelease;

    this._metadataTemplate = Object.freeze({
      strategy: 'simple' as const,
      ...(this.correlationId && { correlationId: this.correlationId }),
    });
  }

  /**
   * Validate configuration parameters
   */
  private validateConfig(config: SimpleLockConfig): void {
    if (!config.key || typeof config.key !== 'string') {
      throw new Error('Lock key must be a non-empty string');
    }

    const ttl = config.ttl ?? DEFAULTS.TTL;
    if (ttl <= 0 || !Number.isInteger(ttl)) {
      throw new Error('TTL must be a positive integer');
    }

    const retryAttempts = config.retryAttempts ?? DEFAULTS.RETRY_ATTEMPTS;
    if (retryAttempts < 0 || !Number.isInteger(retryAttempts)) {
      throw new Error('Retry attempts must be a non-negative integer');
    }

    const retryDelay = config.retryDelay ?? DEFAULTS.RETRY_DELAY;
    if (retryDelay < 0 || !Number.isInteger(retryDelay)) {
      throw new Error('Retry delay must be a non-negative integer');
    }
  }

  /**
   * Circuit breaker pattern implementation
   */
  private updateCircuitBreaker(isSuccess: boolean): void {
    const now = Date.now();

    if (isSuccess) {
      this._circuitBreakerFailures = 0;
      if (this._circuitBreakerState === 'half-open') {
        this._circuitBreakerState = 'closed';
        if (this.logger) {
          this.logger.info('Circuit breaker closed - Redis recovered', {
            key: this.key,
            correlationId: this.correlationId,
            circuitBreakerState: this._circuitBreakerState,
          });
        }
      }
    } else {
      this._circuitBreakerFailures++;

      if (
        this._circuitBreakerState === 'closed' &&
        this._circuitBreakerFailures >= this._circuitBreakerThreshold
      ) {
        this._circuitBreakerState = 'open';
        this._circuitBreakerOpenedAt = now;
        if (this.logger) {
          this.logger.error('Circuit breaker opened - Redis failing', undefined, {
            key: this.key,
            correlationId: this.correlationId,
            failures: this._circuitBreakerFailures,
            circuitBreakerState: this._circuitBreakerState,
          });
        }
      }
    }

    if (
      this._circuitBreakerState === 'open' &&
      now - this._circuitBreakerOpenedAt > this._circuitBreakerTimeout
    ) {
      this._circuitBreakerState = 'half-open';
      if (this.logger) {
        this.logger.info('Circuit breaker half-open - testing Redis', {
          key: this.key,
          correlationId: this.correlationId,
          circuitBreakerState: this._circuitBreakerState,
        });
      }
    }
  }

  /**
   * Check if circuit breaker allows operation
   */
  private isCircuitBreakerOpen(): boolean {
    return this._circuitBreakerState === 'open';
  }

  /**
   * Check Redis connection health periodically
   */
  private async checkConnectionHealth(): Promise<void> {
    const now = Date.now();
    if (now - this._lastHealthCheck < this._healthCheckInterval) {
      return;
    }

    this._lastHealthCheck = now;

    try {
      await this.adapter.ping();
      this.updateCircuitBreaker(true);
      if (!this._isHealthy) {
        this._isHealthy = true;
        if (this.logger) {
          this.logger.info('Redis connection recovered', {
            key: this.key,
            correlationId: this.correlationId,
            healthStatus: 'recovered',
          });
        }
      }
    } catch (error) {
      this._isHealthy = false;
      this.updateCircuitBreaker(false);
      if (this.logger) {
        this.logger.error('Redis health check failed', error as Error, {
          key: this.key,
          correlationId: this.correlationId,
          healthStatus: 'failed',
        });
      }
    }
  }

  /**
   * Attempt to acquire the lock
   */
  async acquire(): Promise<LockHandle> {
    if (this.isCircuitBreakerOpen()) {
      throw new LockAcquisitionError(
        this.key,
        0,
        new Error('Circuit breaker is open - Redis is failing')
      );
    }

    await this.checkConnectionHealth();

    const startTime = Date.now();
    let lastError: Error | null = null;
    const lockValue = generateLockValue();

    for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
      try {
        const result = await this.adapter.setNX(this.key, lockValue, this.ttl);

        this.updateCircuitBreaker(true);

        if (result === REDIS_OK_RESPONSE) {
          const acquisitionTime = Date.now() - startTime;
          const acquiredAt = Date.now();

          const handle: LockHandle = {
            id: generateLockId(),
            key: this.key,
            value: lockValue,
            acquiredAt,
            ttl: this.ttl,
            metadata: {
              attempts: attempt + 1,
              acquisitionTime,
              ...this._metadataTemplate,
            },
          };

          this.onAcquire?.(handle);

          return handle;
        }

        if (!lastError) {
          lastError = new Error(`Lock "${this.key}" is already held`);
        }
      } catch (error) {
        lastError = error as Error;

        this.updateCircuitBreaker(false);

        if (error instanceof Error && error.message?.includes('ECONNREFUSED')) {
          if (this.logger) {
            this.logger.error('Redis connection failed for lock', error, {
              key: this.key,
              correlationId: this.correlationId,
              attempt: attempt + 1,
              circuitBreaker: this._circuitBreakerState,
            });
          }
        }
      }

      if (attempt < this.retryAttempts) {
        await this.sleep(this.retryDelay);
      }
    }

    throw new LockAcquisitionError(
      this.key,
      this.retryAttempts + 1,
      lastError || new Error(ERROR_MESSAGES.UNKNOWN_ERROR)
    );
  }

  /**
   * Release a previously acquired lock
   */
  async release(handle: LockHandle): Promise<boolean> {
    this.validateHandle(handle);

    try {
      const released = await this.adapter.delIfMatch(handle.key, handle.value);

      this.onRelease?.(handle);

      return released;
    } catch (error) {
      throw new LockReleaseError(handle.key, 'redis_error', error as Error);
    }
  }

  /**
   * Extend the TTL of an existing lock
   */
  async extend(handle: LockHandle, ttl: number): Promise<boolean> {
    this.validateHandle(handle);

    if (ttl <= 0 || !Number.isInteger(ttl)) {
      throw new Error('TTL must be a positive integer');
    }

    try {
      // Use the atomic extendIfMatch method to safely extend the lock
      return await this.adapter.extendIfMatch(handle.key, handle.value, ttl);
    } catch (error) {
      throw new LockExtensionError(handle.key, 'redis_error', error as Error);
    }
  }

  /**
   * Check if a lock is currently held
   */
  async isLocked(key: string): Promise<boolean> {
    try {
      const value = await this.adapter.get(key);
      return value !== null;
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

    if (handle.key !== this.key) {
      throw new Error(`Lock handle key "${handle.key}" does not match lock key "${this.key}"`);
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get lock configuration (for debugging)
   */
  getConfig(): Readonly<SimpleLockConfig> {
    if (!this._configCache) {
      this._configCache = Object.freeze({
        adapter: this.adapter,
        key: this.key,
        ttl: this.ttl,
        retryAttempts: this.retryAttempts,
        retryDelay: this.retryDelay,
      });
    }
    return this._configCache;
  }

  /**
   * Get the underlying Redis adapter (for advanced usage)
   */
  getAdapter(): RedisAdapter | null {
    return this.adapter;
  }

  /**
   * Get connection health status
   */
  getHealth(): {
    healthy: boolean;
    lastCheck: number;
    connected: boolean;
    circuitBreaker: {
      state: 'closed' | 'open' | 'half-open';
      failures: number;
      openedAt: number;
    };
  } {
    return {
      healthy: this._isHealthy,
      lastCheck: this._lastHealthCheck,
      connected: this.adapter.isConnected(),
      circuitBreaker: {
        state: this._circuitBreakerState,
        failures: this._circuitBreakerFailures,
        openedAt: this._circuitBreakerOpenedAt,
      },
    };
  }

  /**
   * Execute a routine with automatic lock management and extension
   * Auto-extends when remaining TTL < 20% (extends at ~80% consumed)
   * Provides AbortSignal when extension fails
   *
   * @param routine - Function to execute while holding the lock
   * @returns Result of the routine
   */
  async using<T>(routine: (signal: ExtendedAbortSignal) => Promise<T>): Promise<T> {
    const handle = await this.acquire();
    if (this.logger) {
      return executeWithSingleLockExtension(this, handle, this.ttl, routine, this.logger);
    } else {
      return executeWithSingleLockExtension(this, handle, this.ttl, routine);
    }
  }
}
