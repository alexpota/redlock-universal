/**
 * Auto-extension utility for lock management
 * Provides clean separation between lock implementations and auto-extension logic
 */

import type { Lock, LockHandle } from '../types/locks.js';
import type { ILogger } from '../monitoring/Logger.js';
import type { AtomicExtensionResult } from '../types/adapters.js';
import { DEFAULTS } from '../constants.js';

/**
 * Configuration for auto-extension
 */
export interface AutoExtensionConfig<T> {
  /** Lock instances to manage */
  readonly locks: readonly Lock[];
  /** Lock handles to extend */
  readonly handles: readonly LockHandle[];
  /** TTL for extensions */
  readonly ttl: number;
  /** Function to execute while holding locks */
  readonly routine: (signal: AbortSignal) => Promise<T>;
  /** Extension threshold ratio (default: 0.2 = extend at 80% TTL consumed) */
  readonly extensionThresholdRatio?: number;
  /** Minimum interval between extension attempts */
  readonly minExtensionInterval?: number;
  /** Optional logger for error reporting */
  readonly logger?: ILogger;
}

/**
 * Enhanced AbortSignal with error information
 */
export interface ExtendedAbortSignal extends AbortSignal {
  /** Error that caused the abort (if any) */
  readonly error?: Error;
}

/**
 * Result of an individual lock extension attempt
 */
interface IndividualExtensionResult {
  /** Whether this specific lock was extended successfully */
  readonly success: boolean;
  /** Error if extension failed */
  readonly error: Error | null;
  /** Atomic extension result with TTL feedback (if available) */
  readonly atomicResult: AtomicExtensionResult | null;
}

/**
 * Result of an extension attempt across all locks
 */
interface ExtensionResult {
  /** Whether all locks were successfully extended */
  readonly success: boolean;
  /** Keys that failed to extend (only if not successful) */
  readonly failedKeys?: string[] | undefined;
  /** Single consolidated error (only if not successful) */
  readonly error?: Error | undefined;
}

/**
 * Execute a routine with automatic lock extension
 *
 * This utility function provides auto-extension for any lock implementation,
 * avoiding code duplication between SimpleLock and RedLock.
 *
 * @param config - Configuration for auto-extension
 * @returns Promise resolving to the routine result
 */
export async function executeWithAutoExtension<T>(config: AutoExtensionConfig<T>): Promise<T> {
  const {
    locks,
    handles,
    ttl,
    routine,
    extensionThresholdRatio = DEFAULTS.AUTO_EXTENSION_THRESHOLD_RATIO,
    minExtensionInterval = DEFAULTS.MIN_EXTENSION_INTERVAL,
    logger,
  } = config;

  if (locks.length !== handles.length) {
    throw new Error('Number of locks and handles must match');
  }

  if (locks.length === 0) {
    throw new Error('At least one lock must be provided');
  }

  let extensionTimer: ReturnType<typeof setTimeout> | null = null;
  let extending: Promise<ExtensionResult> | undefined;
  let isAborted = false;
  let abortError: Error | undefined;
  let lastExtensionTime = Math.max(...handles.map(h => h.acquiredAt));

  const threshold = Math.floor(ttl * extensionThresholdRatio);

  const abortController = new AbortController();

  const enhancedSignal = abortController.signal as ExtendedAbortSignal;
  Object.defineProperty(enhancedSignal, 'error', {
    get: () => abortError,
    enumerable: true,
    configurable: false,
  });

  const scheduleExtension = (): void => {
    if (extensionTimer) {
      clearTimeout(extensionTimer);
    }

    const now = Date.now();
    const timeUntilExpiry = lastExtensionTime + ttl - now;
    const timeUntilExtension = timeUntilExpiry - threshold;

    const safeExtensionTime = Math.max(timeUntilExtension, minExtensionInterval);

    if (safeExtensionTime <= minExtensionInterval) {
      void attemptExtension();
    } else {
      extensionTimer = setTimeout(attemptExtension, safeExtensionTime);
    }
  };

  const attemptExtension = async (): Promise<void> => {
    if (isAborted) return;

    const extensionPromises = locks.map(async (lock, index): Promise<IndividualExtensionResult> => {
      try {
        const handle = handles[index]!;

        const adapter = lock.getAdapter?.();
        if (adapter && adapter.atomicExtend) {
          // Use appropriate buffer ratio based on lock distribution strategy
          const isDistributed = locks.length > 1;
          const bufferRatio = isDistributed
            ? DEFAULTS.DISTRIBUTED_EXTENSION_BUFFER_RATIO
            : DEFAULTS.SINGLE_NODE_EXTENSION_BUFFER_RATIO;
          const proportionalSafetyBuffer = Math.min(
            DEFAULTS.ATOMIC_EXTENSION_SAFETY_BUFFER,
            Math.floor(ttl * bufferRatio)
          );
          const atomicResult = await adapter.atomicExtend(
            handle.key,
            handle.value,
            proportionalSafetyBuffer,
            ttl
          );

          if (logger) {
            const level = atomicResult.resultCode === 1 ? 'info' : 'warn';
            logger[level]('Atomic extension attempt', {
              key: handle.key,
              resultCode: atomicResult.resultCode,
              actualTTL: atomicResult.actualTTL,
              message: atomicResult.message,
            });
          }

          return {
            success: atomicResult.resultCode === 1,
            error: atomicResult.resultCode === 1 ? null : new Error(atomicResult.message),
            atomicResult,
          };
        }

        const result = await lock.extend(handle, ttl);
        return { success: result, error: null, atomicResult: null };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error : new Error('Extension failed'),
          atomicResult: null,
        };
      }
    });

    extending = Promise.all(extensionPromises).then(results => {
      const successes = results.map(r => r.success);
      const allSuccess = successes.every(Boolean);
      let failedLocks: string[] | undefined;

      if (allSuccess) {
        lastExtensionTime = Date.now();

        const atomicResults = results
          .map(r => r.atomicResult)
          .filter((result): result is AtomicExtensionResult => result !== null);

        if (atomicResults.length > 0 && logger) {
          logger.info('All locks extended successfully with atomic protection', {
            lockCount: results.length,
            atomicCount: atomicResults.length,
            avgRemainingTTL: Math.round(
              atomicResults.reduce((sum, r) => sum + r.actualTTL, 0) / atomicResults.length
            ),
          });
        }

        scheduleExtension();
      } else {
        failedLocks = handles
          .map((handle, i) => (successes[i] ? null : handle.key))
          .filter(Boolean) as string[];

        const atomicFailures = results
          .filter(r => !r.success && r.atomicResult)
          .map(r => `${r.atomicResult!.message} (TTL: ${r.atomicResult!.actualTTL}ms)`);

        const errorMessage =
          atomicFailures.length > 0
            ? `Failed to extend locks with atomic protection: ${atomicFailures.join('; ')}`
            : `Failed to extend ${failedLocks.length === 1 ? 'lock' : 'locks'}: ${failedLocks.join(', ')}`;

        abortError = new Error(errorMessage);
        isAborted = true;
        abortController.abort();
      }

      return {
        success: allSuccess,
        failedKeys: failedLocks,
        error: allSuccess ? undefined : abortError,
      };
    });
  };

  try {
    scheduleExtension();

    return await routine(enhancedSignal);
  } finally {
    if (extensionTimer) {
      clearTimeout(extensionTimer);
      extensionTimer = null;
    }

    if (extending) {
      await extending.catch(() => {});
    }

    const releasePromises = locks.map(async (lock, index) => {
      try {
        await lock.release(handles[index]!);
      } catch (error) {
        const releaseError = error instanceof Error ? error : new Error('Unknown error');

        if (logger) {
          logger.error('Failed to release lock in using()', releaseError, {
            key: handles[index]!.key,
            lockIndex: index,
          });
        }
      }
    });

    await Promise.allSettled(releasePromises);
  }
}

/**
 * Convenience function for single lock auto-extension
 */
export async function executeWithSingleLockExtension<T>(
  lock: Lock,
  handle: LockHandle,
  ttl: number,
  routine: (signal: AbortSignal) => Promise<T>,
  logger?: ILogger
): Promise<T> {
  const baseConfig = {
    locks: [lock],
    handles: [handle],
    ttl,
    routine,
  };

  return executeWithAutoExtension(logger ? { ...baseConfig, logger } : baseConfig);
}
