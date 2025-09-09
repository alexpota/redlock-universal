import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient as createNodeRedisClient } from 'redis';
import { SimpleLock, NodeRedisAdapter } from '../../../src/index.js';
import {
  generateTestKey,
  delay,
  getRedisUrl,
  TEST_CONFIG,
  TIMING_CONFIG,
  TEST_EXPECTATIONS,
  TEST_MESSAGES,
  TEST_DATA,
  TEST_TIMEOUTS,
} from '../../shared/constants.js';

// SimpleLock-specific test key prefixes
const SIMPLE_TEST_KEYS = {
  BASIC: 'using:basic',
  ERROR: 'using:error',
  CONCURRENT: 'using:concurrent',
  AUTO_EXTEND: 'using:autoextend',
  EXTENSION_FAIL: 'using:extensionfail',
  MULTI_EXTEND: 'using:multiextend',
  TIMING: 'using:timing',
  RAPID: 'using:rapid',
  DISCONNECT: 'using:disconnect',
  EXTERNAL: 'using:external',
  TRANSACTION: 'using:transaction',
  FILE_PROCESS: 'using:fileprocess',
} as const;

// Helper functions - Note: these will be scoped within the describe block
let createSimpleLockConfig: (
  key: string,
  overrides?: Partial<ConstructorParameters<typeof SimpleLock>[0]>
) => ConstructorParameters<typeof SimpleLock>[0];

const waitForExtensionAttempt = (baseDelay?: number) =>
  delay((baseDelay ?? TIMING_CONFIG.DELAY_LONG) + TIMING_CONFIG.DELAY_MEDIUM);

const assertLockState = async (lock: SimpleLock, key: string, expectedState: boolean) => {
  const isLocked = await lock.isLocked(key);
  expect(isLocked).toBe(expectedState);
};

const assertSignalState = (
  signal: AbortSignal & { error?: Error },
  aborted: boolean,
  hasError?: boolean
) => {
  expect(signal.aborted).toBe(aborted);
  if (hasError !== undefined) {
    expect(signal.error ? true : false).toBe(hasError);
  }
};

const ensureClientConnection = async (client: any): Promise<void> => {
  if (!client.isReady) {
    await client.connect();
  }
};

const cleanupTestKeys = async (client: any): Promise<void> => {
  try {
    await ensureClientConnection(client);
    const testKeys = await client.keys('test:*');
    if (testKeys.length > 0) {
      await client.del(testKeys);
    }
  } catch (error) {
    console.warn(`Failed to clean up client keys: ${error}`);
  }
};

const simulateTransactionSteps = async (
  signal: AbortSignal & { error?: Error }
): Promise<string[]> => {
  const steps: string[] = [];

  steps.push('begin');

  await delay(TIMING_CONFIG.DELAY_LARGE);
  steps.push('read');
  assertSignalState(signal, false);

  await delay(TIMING_CONFIG.DELAY_EXTENDED);
  steps.push('process');
  assertSignalState(signal, false);

  await delay(TIMING_CONFIG.DELAY_LARGE);
  steps.push('write');
  assertSignalState(signal, false);

  await delay(TIMING_CONFIG.DELAY_SMALL);
  steps.push('commit');

  return steps;
};

const simulateFileProcessing = async (
  totalFiles: number,
  signal: AbortSignal & { error?: Error }
): Promise<number[]> => {
  const progress: number[] = [];

  for (let i = 0; i < totalFiles; i++) {
    await delay(TIMING_CONFIG.INTERVAL_FILE_PROCESS);
    progress.push(i + 1);

    if (signal.aborted) {
      throw new Error(
        `${TEST_MESSAGES.ERRORS.PROCESSING_CANCELLED} ${i + 1}: ${signal.error?.message}`
      );
    }
  }

  return progress;
};

/**
 * SimpleLock using() API integration tests with Redis.
 * Validates auto-extension, error handling, and real-world scenarios.
 */
describe('SimpleLock using() API Integration Tests', () => {
  let redisClient: any;
  let adapter: NodeRedisAdapter;

  // Initialize helper function with access to adapter
  const initializeHelpers = () => {
    createSimpleLockConfig = (
      key: string,
      overrides: Partial<ConstructorParameters<typeof SimpleLock>[0]> = {}
    ) => ({
      adapter,
      key,
      ttl: TEST_CONFIG.LONG_TTL,
      ...overrides,
    });
  };

  beforeAll(async () => {
    redisClient = createNodeRedisClient({
      url: getRedisUrl(),
    });
    await redisClient.connect();
    adapter = new NodeRedisAdapter(redisClient);

    // Initialize helper functions after adapter is available
    initializeHelpers();

    // Verify connection
    const result = await adapter.ping();
    expect(result).toBe('PONG');
  });

  afterAll(async () => {
    if (redisClient?.isReady) {
      await redisClient.disconnect();
    }
  });

  beforeEach(async () => {
    await cleanupTestKeys(redisClient);
  });

  describe('basic using() functionality', () => {
    it('should execute routine successfully and release lock', async () => {
      const testKey = generateTestKey(SIMPLE_TEST_KEYS.BASIC);
      const lock = new SimpleLock(createSimpleLockConfig(testKey));

      let routineExecuted = false;
      const result = await lock.using(async signal => {
        routineExecuted = true;
        assertSignalState(signal, false);
        await assertLockState(lock, testKey, true);
        return TEST_MESSAGES.RESULTS.SUCCESS;
      });

      expect(result).toBe(TEST_MESSAGES.RESULTS.SUCCESS);
      expect(routineExecuted).toBe(true);
      await assertLockState(lock, testKey, false);
    });

    it('should handle routine errors and still release lock', async () => {
      const testKey = generateTestKey(SIMPLE_TEST_KEYS.ERROR);
      const lock = new SimpleLock(createSimpleLockConfig(testKey));

      await expect(
        lock.using(async () => {
          throw new Error(TEST_MESSAGES.ERRORS.ROUTINE_FAILED);
        })
      ).rejects.toThrow(TEST_MESSAGES.ERRORS.ROUTINE_FAILED);

      await assertLockState(lock, testKey, false);
    });

    it('should prevent concurrent access during routine', async () => {
      const testKey = generateTestKey(SIMPLE_TEST_KEYS.CONCURRENT);
      const lock1 = new SimpleLock(createSimpleLockConfig(testKey));
      const lock2 = new SimpleLock(
        createSimpleLockConfig(testKey, {
          retryAttempts: TEST_CONFIG.SINGLE_RETRY_ATTEMPT,
          retryDelay: TEST_CONFIG.FAST_RETRY_DELAY,
        })
      );

      let lock1Executed = false;
      let lock2Failed = false;

      const promise1 = lock1.using(async () => {
        lock1Executed = true;
        await delay(TIMING_CONFIG.DELAY_EXTENDED);
        return TEST_MESSAGES.RESULTS.FIRST_LOCK;
      });

      await delay(TIMING_CONFIG.DELAY_TINY);
      const promise2 = lock2
        .using(async () => TEST_MESSAGES.RESULTS.SECOND_LOCK)
        .catch(() => {
          lock2Failed = true;
          return TEST_MESSAGES.RESULTS.FAILED_LOCK;
        });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBe(TEST_MESSAGES.RESULTS.FIRST_LOCK);
      expect(result2).toBe(TEST_MESSAGES.RESULTS.FAILED_LOCK);
      expect(lock1Executed).toBe(true);
      expect(lock2Failed).toBe(true);
    });
  });

  describe('auto-extension with real Redis', () => {
    it('should auto-extend lock during long-running routine', async () => {
      const testKey = generateTestKey(SIMPLE_TEST_KEYS.AUTO_EXTEND);
      const lock = new SimpleLock(
        createSimpleLockConfig(testKey, {
          ttl: TEST_CONFIG.VERY_SHORT_TTL,
        })
      );

      let extensionOccurred = false;
      const startTime = Date.now();

      const result = await lock.using(async signal => {
        await delay(TIMING_CONFIG.DELAY_EXTENSION_TRIGGER_COMPAT);

        if (await lock.isLocked(testKey)) {
          extensionOccurred = true;
        }

        assertSignalState(signal, false);
        await delay(TIMING_CONFIG.DELAY_ROUTINE);

        return TEST_MESSAGES.RESULTS.EXTENDED_SUCCESS;
      });

      const totalTime = Date.now() - startTime;

      expect(result).toBe(TEST_MESSAGES.RESULTS.EXTENDED_SUCCESS);
      expect(totalTime).toBeGreaterThan(TIMING_CONFIG.DELAY_TOTAL_EXTENDED_TIME);
      expect(extensionOccurred).toBe(true);
      await assertLockState(lock, testKey, false);
    });

    it('should abort routine when extension fails due to lock loss', async () => {
      const testKey = generateTestKey(SIMPLE_TEST_KEYS.EXTENSION_FAIL);
      const lock = new SimpleLock(
        createSimpleLockConfig(testKey, {
          ttl: TEST_CONFIG.VERY_SHORT_TTL,
        })
      );

      let routineAborted = false;
      let capturedError: Error | undefined;

      const result = await lock.using(async signal => {
        await delay(TIMING_CONFIG.DELAY_EXTENSION_TRIGGER_COMPAT);
        await redisClient.del(testKey);
        await waitForExtensionAttempt();

        if (signal.aborted) {
          routineAborted = true;
          capturedError = signal.error;
        }

        return TEST_MESSAGES.RESULTS.SHOULD_NOT_COMPLETE;
      });

      expect(result).toBe(TEST_MESSAGES.RESULTS.SHOULD_NOT_COMPLETE);
      expect(routineAborted).toBe(true);
      expect(capturedError).toBeInstanceOf(Error);
      expect(capturedError?.message).toContain(TEST_MESSAGES.ERRORS.EXTEND_FAILURE);
    });

    it('should handle multiple extensions for very long routines', async () => {
      const testKey = generateTestKey(SIMPLE_TEST_KEYS.MULTI_EXTEND);
      const lock = new SimpleLock(
        createSimpleLockConfig(testKey, {
          ttl: TEST_CONFIG.SHORT_TTL,
        })
      );

      const extensionTimes: number[] = [];
      const startTime = Date.now();
      const iterations = 4;

      const result = await lock.using(async signal => {
        for (let i = 0; i < iterations; i++) {
          await delay(TIMING_CONFIG.DELAY_ROUTINE);

          if (await lock.isLocked(testKey)) {
            extensionTimes.push(Date.now() - startTime);
          }

          assertSignalState(signal, false);
        }

        return TEST_MESSAGES.RESULTS.MULTI_EXTENDED;
      });

      expect(result).toBe(TEST_MESSAGES.RESULTS.MULTI_EXTENDED);
      expect(extensionTimes.length).toBeGreaterThan(TEST_EXPECTATIONS.MIN_EXTENSIONS);

      for (let i = 1; i < extensionTimes.length; i++) {
        const interval = extensionTimes[i] - extensionTimes[i - 1];
        expect(interval).toBeGreaterThan(TIMING_CONFIG.INTERVAL_MIN_EXTENSION);
        expect(interval).toBeLessThan(TIMING_CONFIG.INTERVAL_MAX_EXTENSION);
      }
    });
  });

  describe('timing and performance', () => {
    it('should respect extension threshold timing', async () => {
      const testKey = generateTestKey(SIMPLE_TEST_KEYS.TIMING);
      const lock = new SimpleLock(
        createSimpleLockConfig(testKey, {
          ttl: TEST_CONFIG.MEDIUM_TTL,
        })
      );

      const timings: number[] = [];
      const startTime = Date.now();

      await lock.using(async () => {
        await delay(
          TIMING_CONFIG.DELAY_EXTENSION_THRESHOLD - TIMING_CONFIG.DELAY_EXTENSION_THRESHOLD_OFFSET
        );
        timings.push(Date.now() - startTime);

        await delay(TIMING_CONFIG.DELAY_EXTENSION_THRESHOLD_BUFFER);
        timings.push(Date.now() - startTime);

        return TEST_MESSAGES.RESULTS.TIMING_TEST;
      });

      expect(timings[0]).toBeLessThan(TIMING_CONFIG.DELAY_EXTENSION_THRESHOLD);
      expect(timings[1]).toBeGreaterThan(TIMING_CONFIG.DELAY_EXTENSION_THRESHOLD);
      expect(timings[1] - timings[0]).toBeLessThan(TEST_EXPECTATIONS.EXTENSION_TIMING_MAX);
    });

    it('should handle rapid routine completion without extension', async () => {
      const testKey = generateTestKey(SIMPLE_TEST_KEYS.RAPID);
      const lock = new SimpleLock(createSimpleLockConfig(testKey));

      const startTime = Date.now();

      const result = await lock.using(async signal => {
        await delay(TIMING_CONFIG.DELAY_TINY);
        assertSignalState(signal, false);
        return TEST_MESSAGES.RESULTS.RAPID_COMPLETION;
      });

      const totalTime = Date.now() - startTime;

      expect(result).toBe(TEST_MESSAGES.RESULTS.RAPID_COMPLETION);
      expect(totalTime).toBeLessThan(TIMING_CONFIG.DELAY_RAPID_MAX);
      await assertLockState(lock, testKey, false);
    });
  });

  describe('error handling and edge cases', () => {
    it(
      'should handle Redis disconnection during routine',
      async () => {
        const testKey = generateTestKey(SIMPLE_TEST_KEYS.DISCONNECT);
        const lock = new SimpleLock(
          createSimpleLockConfig(testKey, {
            ttl: TEST_CONFIG.MEDIUM_TTL,
          })
        );

        let disconnectionHandled = false;

        const result = await lock.using(async signal => {
          await delay(TIMING_CONFIG.DELAY_ROUTINE);
          await redisClient.disconnect();
          await delay(TIMING_CONFIG.DELAY_EXTENDED);

          if (signal.aborted) {
            disconnectionHandled = true;
          }

          return TEST_MESSAGES.RESULTS.HANDLE_DISCONNECT;
        });

        expect(result).toBe(TEST_MESSAGES.RESULTS.HANDLE_DISCONNECT);
        expect(disconnectionHandled).toBe(true);
      },
      TEST_TIMEOUTS.DISCONNECT_TEST
    );

    it('should handle lock key deletion by external process', async () => {
      const testKey = generateTestKey(SIMPLE_TEST_KEYS.EXTERNAL);

      const externalClient = createNodeRedisClient({
        url: getRedisUrl(),
      });
      await externalClient.connect();

      const lock = new SimpleLock(
        createSimpleLockConfig(testKey, {
          ttl: TEST_CONFIG.MEDIUM_TTL,
        })
      );

      let externalDeletionDetected = false;

      try {
        const result = await lock.using(async signal => {
          await delay(TIMING_CONFIG.DELAY_LONG);
          await externalClient.del(testKey);
          await delay(TIMING_CONFIG.DELAY_ROUTINE);

          if (signal.aborted) {
            externalDeletionDetected = true;
          }

          return TEST_MESSAGES.RESULTS.EXTERNAL_DELETION;
        });

        expect(result).toBe(TEST_MESSAGES.RESULTS.EXTERNAL_DELETION);
        expect(externalDeletionDetected).toBe(true);
      } finally {
        await externalClient.disconnect();
        await ensureClientConnection(redisClient);
      }
    });
  });

  describe('real world scenarios', () => {
    it('should handle database transaction simulation', async () => {
      const testKey = generateTestKey(SIMPLE_TEST_KEYS.TRANSACTION);
      const lock = new SimpleLock(createSimpleLockConfig(testKey));

      const result = await lock.using(async signal => {
        const transactionSteps = await simulateTransactionSteps(signal);
        expect(transactionSteps).toEqual(TEST_DATA.TRANSACTION_STEPS);
        return TEST_MESSAGES.RESULTS.TRANSACTION_COMPLETE;
      });

      expect(result).toBe(TEST_MESSAGES.RESULTS.TRANSACTION_COMPLETE);
      await assertLockState(lock, testKey, false);
    });

    it('should handle file processing simulation with progress tracking', async () => {
      const testKey = generateTestKey(SIMPLE_TEST_KEYS.FILE_PROCESS);
      const lock = new SimpleLock(
        createSimpleLockConfig(testKey, {
          ttl: TEST_CONFIG.EXTENDED_TTL,
        })
      );

      const result = await lock.using(async signal => {
        const progress = await simulateFileProcessing(TEST_EXPECTATIONS.TOTAL_FILES, signal);
        expect(progress).toHaveLength(TEST_EXPECTATIONS.TOTAL_FILES);
        expect(progress[progress.length - 1]).toBe(TEST_EXPECTATIONS.TOTAL_FILES);
        return TEST_MESSAGES.RESULTS.FILES_PROCESSED;
      });

      expect(result).toBe(TEST_MESSAGES.RESULTS.FILES_PROCESSED);
    });
  });
});
