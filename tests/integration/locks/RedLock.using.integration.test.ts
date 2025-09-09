import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient as createNodeRedisClient } from 'redis';
import { RedLock, NodeRedisAdapter } from '../../../src/index.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';
import {
  generateTestKey,
  delay,
  getRedisUrl,
  TEST_CONFIG,
  TIMING_CONFIG,
  TEST_EXPECTATIONS,
  TEST_MESSAGES,
  TEST_DATA,
} from '../../shared/constants.js';

// RedLock-specific test key prefixes
const REDLOCK_TEST_KEYS = {
  BASIC: 'redlock:using:basic',
  CONCURRENT: 'redlock:using:concurrent',
  AUTO_EXTEND: 'redlock:using:autoextend',
  QUORUM_FAIL: 'redlock:using:quorumfail',
  PARTIAL_EXTEND: 'redlock:using:partialextend',
  DISCONNECT: 'redlock:using:disconnect',
  MAJORITY_LOSS: 'redlock:using:majorityloss',
  TIMING: 'redlock:using:timing',
  MULTI_EXTEND: 'redlock:using:multiextend',
  JOB_PROCESS: 'redlock:using:jobprocess',
  CACHE_WARM: 'redlock:using:cachewarm',
  LEADER: 'redlock:using:leader',
  RECOVERY: 'redlock:using:recovery',
} as const;

// Helper functions - Note: these will be scoped within the describe block
let createRedLockConfig: (
  key: string,
  overrides?: Partial<ConstructorParameters<typeof RedLock>[0]>
) => ConstructorParameters<typeof RedLock>[0];

const waitForExtensionAttempt = (baseDelay?: number) =>
  delay((baseDelay ?? TIMING_CONFIG.DELAY_ROUTINE) + TIMING_CONFIG.DELAY_MEDIUM_LARGE);

const assertLockState = async (redlock: RedLock, key: string, expectedState: boolean) => {
  const isLocked = await redlock.isLocked(key);
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

const cleanupTestKeys = async (clients: any[]): Promise<void> => {
  for (const client of clients) {
    try {
      await ensureClientConnection(client);
      const testKeys = await client.keys('test:*');
      if (testKeys.length > 0) {
        await client.del(testKeys);
      }
    } catch (error) {
      console.warn(`Failed to clean up client keys: ${error}`);
    }
  }
};

const processItemsWithLockValidation = async (
  redlock: RedLock,
  testKey: string,
  items: readonly string[],
  processInterval: number,
  signal: AbortSignal & { error?: Error }
): Promise<string[]> => {
  const processedItems: string[] = [];

  for (const item of items) {
    await delay(processInterval);

    if (signal.aborted) {
      throw new Error(`Processing cancelled for ${item}: ${signal.error?.message}`);
    }

    processedItems.push(item);
    await assertLockState(redlock, testKey, true);
  }

  return processedItems;
};

const simulateLeaderDuties = async (
  redlock: RedLock,
  testKey: string,
  duties: readonly string[],
  dutyInterval: number,
  signal: AbortSignal & { error?: Error }
): Promise<string[]> => {
  const completedTasks: string[] = [];

  for (const duty of duties) {
    await delay(dutyInterval);

    if (signal.aborted) {
      throw new Error(`Lost leadership during ${duty}: ${signal.error?.message}`);
    }

    completedTasks.push(duty);
    await assertLockState(redlock, testKey, true);
  }

  return completedTasks;
};

const simulateCacheWarming = async (
  redlock: RedLock,
  testKey: string,
  dataEntries: ReadonlyArray<{ key: string; value: string }>,
  fetchInterval: number,
  signal: AbortSignal & { error?: Error }
): Promise<Record<string, string>> => {
  const cacheEntries: Record<string, string> = {};

  for (const entry of dataEntries) {
    await delay(fetchInterval);

    if (signal.aborted) {
      throw new Error(`Cache warming aborted: ${signal.error?.message}`);
    }

    cacheEntries[entry.key] = entry.value;
    await assertLockState(redlock, testKey, true);
  }

  return cacheEntries;
};

/**
 * RedLock using() API integration tests with distributed Redis instances.
 * Validates auto-extension, quorum behavior, and network partition handling.
 */
describe('RedLock using() API Integration Tests', () => {
  let redisClients: any[];
  let adapters: RedisAdapter[];

  // Initialize helper function with access to adapters
  const initializeHelpers = () => {
    createRedLockConfig = (
      key: string,
      overrides: Partial<ConstructorParameters<typeof RedLock>[0]> = {}
    ) => ({
      adapters,
      key,
      ttl: TEST_CONFIG.LONG_TTL,
      quorum: TEST_CONFIG.DEFAULT_QUORUM_3,
      ...overrides,
    });
  };

  beforeAll(async () => {
    redisClients = [];
    adapters = [];

    for (let i = 0; i < TEST_CONFIG.USING_API_INSTANCES; i++) {
      const client = createNodeRedisClient({
        url: getRedisUrl(),
        database: i, // Use different databases to simulate different instances
      });
      await client.connect();
      redisClients.push(client);
      adapters.push(new NodeRedisAdapter(client));
    }

    // Initialize helper functions after adapters are available
    initializeHelpers();

    // Verify all connections
    for (const adapter of adapters) {
      const result = await adapter.ping();
      expect(result).toBe('PONG');
    }
  });

  afterAll(async () => {
    await Promise.all(redisClients.map(client => client.disconnect()));
  });

  beforeEach(async () => {
    await cleanupTestKeys(redisClients);
  });

  describe('basic distributed using() functionality', () => {
    it('should execute routine successfully with distributed locks', async () => {
      const testKey = generateTestKey(REDLOCK_TEST_KEYS.BASIC);
      const redlock = new RedLock(createRedLockConfig(testKey));

      let routineExecuted = false;
      const result = await redlock.using(async signal => {
        routineExecuted = true;
        assertSignalState(signal, false);
        await assertLockState(redlock, testKey, true);
        return TEST_MESSAGES.RESULTS.DISTRIBUTED_SUCCESS;
      });

      expect(result).toBe(TEST_MESSAGES.RESULTS.DISTRIBUTED_SUCCESS);
      expect(routineExecuted).toBe(true);
      await assertLockState(redlock, testKey, false);
    });

    it('should prevent concurrent distributed access', async () => {
      const testKey = generateTestKey(REDLOCK_TEST_KEYS.CONCURRENT);
      const redlock1 = new RedLock(createRedLockConfig(testKey));
      const redlock2 = new RedLock(
        createRedLockConfig(testKey, {
          retryAttempts: 1,
          retryDelay: TEST_CONFIG.FAST_RETRY_DELAY,
        })
      );

      let lock1Executed = false;
      let lock2Failed = false;

      const promise1 = redlock1.using(async () => {
        lock1Executed = true;
        await delay(TIMING_CONFIG.DELAY_EXTENDED);
        return TEST_MESSAGES.RESULTS.FIRST_LOCK;
      });

      await delay(TIMING_CONFIG.DELAY_TINY);
      const promise2 = redlock2
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

  describe('distributed auto-extension with quorum', () => {
    it('should auto-extend distributed lock when quorum succeeds', async () => {
      const testKey = generateTestKey(REDLOCK_TEST_KEYS.AUTO_EXTEND);
      const redlock = new RedLock(
        createRedLockConfig(testKey, {
          ttl: TEST_CONFIG.VERY_SHORT_TTL,
        })
      );

      let extensionOccurred = false;
      const startTime = Date.now();

      const result = await redlock.using(async signal => {
        await delay(TIMING_CONFIG.DELAY_EXTENSION_TRIGGER_COMPAT);

        if (await redlock.isLocked(testKey)) {
          extensionOccurred = true;
        }

        assertSignalState(signal, false);
        await delay(TIMING_CONFIG.DELAY_ROUTINE);

        return TEST_MESSAGES.RESULTS.EXTENDED;
      });

      const totalTime = Date.now() - startTime;

      expect(result).toBe(TEST_MESSAGES.RESULTS.EXTENDED);
      expect(totalTime).toBeGreaterThan(TIMING_CONFIG.DELAY_TOTAL_EXTENDED_TIME);
      expect(extensionOccurred).toBe(true);
    });

    it('should abort when distributed extension quorum fails', async () => {
      const testKey = generateTestKey(REDLOCK_TEST_KEYS.QUORUM_FAIL);
      const redlock = new RedLock(
        createRedLockConfig(testKey, {
          ttl: TEST_CONFIG.VERY_SHORT_TTL,
        })
      );

      let routineAborted = false;
      let capturedError: Error | undefined;

      const result = await redlock.using(async signal => {
        await delay(TIMING_CONFIG.DELAY_ROUTINE);

        await redisClients[0].del(testKey);
        await redisClients[1].del(testKey);

        await waitForExtensionAttempt();

        if (signal.aborted) {
          routineAborted = true;
          capturedError = signal.error;
        }

        return TEST_MESSAGES.RESULTS.SHOULD_ABORT;
      });

      expect(result).toBe(TEST_MESSAGES.RESULTS.SHOULD_ABORT);
      expect(routineAborted).toBe(true);
      expect(capturedError).toBeInstanceOf(Error);
      expect(capturedError?.message).toContain(TEST_MESSAGES.ERRORS.QUORUM_FRAGMENT);
    });

    it('should continue when partial extension succeeds (meets quorum)', async () => {
      const testKey = generateTestKey(REDLOCK_TEST_KEYS.PARTIAL_EXTEND);
      const redlock = new RedLock(
        createRedLockConfig(testKey, {
          ttl: TEST_CONFIG.VERY_SHORT_TTL,
        })
      );

      const result = await redlock.using(async signal => {
        await delay(TIMING_CONFIG.DELAY_ROUTINE);
        await redisClients[2].del(testKey);
        await waitForExtensionAttempt();

        assertSignalState(signal, false);
        return TEST_MESSAGES.RESULTS.PARTIAL_SUCCESS;
      });

      expect(result).toBe(TEST_MESSAGES.RESULTS.PARTIAL_SUCCESS);
    });
  });

  describe('network partition simulation', () => {
    it('should handle instance disconnection during routine', async () => {
      const testKey = generateTestKey(REDLOCK_TEST_KEYS.DISCONNECT);
      const redlock = new RedLock(
        createRedLockConfig(testKey, {
          ttl: Math.round(TEST_CONFIG.MEDIUM_TTL * 1.33), // 4000ms
        })
      );

      let partitionHandled = false;

      const result = await redlock.using(async signal => {
        await delay(TIMING_CONFIG.DELAY_LONG);
        await redisClients[0].disconnect();
        await delay(TIMING_CONFIG.DELAY_EXTENDED);

        if (!signal.aborted) {
          partitionHandled = true;
        }

        return TEST_MESSAGES.RESULTS.PARTITION_HANDLED;
      });

      expect(result).toBe(TEST_MESSAGES.RESULTS.PARTITION_HANDLED);
      expect(partitionHandled).toBe(true);
      await redisClients[0].connect();
    });

    it('should abort when majority of instances are lost', async () => {
      const testKey = generateTestKey(REDLOCK_TEST_KEYS.MAJORITY_LOSS);
      const redlock = new RedLock(
        createRedLockConfig(testKey, {
          ttl: TEST_CONFIG.MEDIUM_TTL,
        })
      );

      let majorityLossDetected = false;
      let capturedError: Error | undefined;

      const result = await redlock.using(async signal => {
        await delay(TIMING_CONFIG.DELAY_ROUTINE + 200);

        await redisClients[0].disconnect();
        await redisClients[1].disconnect();
        await waitForExtensionAttempt(TIMING_CONFIG.DELAY_LONG);

        if (signal.aborted) {
          majorityLossDetected = true;
          capturedError = signal.error;
        }

        return TEST_MESSAGES.RESULTS.MAJORITY_LOSS;
      });

      expect(result).toBe(TEST_MESSAGES.RESULTS.MAJORITY_LOSS);
      expect(majorityLossDetected).toBe(true);
      expect(capturedError?.message).toContain(TEST_MESSAGES.ERRORS.EXTEND_FAILURE);

      await redisClients[0].connect();
      await redisClients[1].connect();
    });
  });

  describe('distributed timing and performance', () => {
    it('should coordinate extension timing across instances', async () => {
      const testKey = generateTestKey(REDLOCK_TEST_KEYS.TIMING);
      const redlock = new RedLock(
        createRedLockConfig(testKey, {
          ttl: TEST_CONFIG.MEDIUM_TTL,
        })
      );

      const lockCounts: number[] = [];
      const checkCount = 4;

      await redlock.using(async () => {
        for (let i = 0; i < checkCount; i++) {
          await delay(TIMING_CONFIG.INTERVAL_TIMING_CHECK);

          let count = 0;
          for (const client of redisClients) {
            const exists = await client.exists(testKey);
            if (exists) count++;
          }
          lockCounts.push(count);
        }

        return TEST_MESSAGES.RESULTS.TIMING_COORDINATION;
      });

      expect(lockCounts).toHaveLength(checkCount);
      const quorumMaintained = lockCounts.every(count => count >= TEST_CONFIG.DEFAULT_QUORUM_3);
      expect(quorumMaintained).toBe(true);
    });

    it('should handle multiple extensions efficiently', async () => {
      const testKey = generateTestKey(REDLOCK_TEST_KEYS.MULTI_EXTEND);
      const redlock = new RedLock(
        createRedLockConfig(testKey, {
          ttl: TEST_CONFIG.SHORT_TTL,
        })
      );

      const extensionTimings: number[] = [];
      const startTime = Date.now();
      const iterations = 5;

      const result = await redlock.using(async signal => {
        for (let i = 0; i < iterations; i++) {
          await delay(TIMING_CONFIG.DELAY_ROUTINE);

          if (await redlock.isLocked(testKey)) {
            extensionTimings.push(Date.now() - startTime);
          }

          assertSignalState(signal, false);
        }

        return TEST_MESSAGES.RESULTS.MULTI_EXTENSION;
      });

      expect(result).toBe(TEST_MESSAGES.RESULTS.MULTI_EXTENSION);
      expect(extensionTimings.length).toBeGreaterThan(TEST_EXPECTATIONS.MIN_EXTENSIONS);

      for (let i = 1; i < extensionTimings.length; i++) {
        const interval = extensionTimings[i] - extensionTimings[i - 1];
        expect(interval).toBeGreaterThan(TEST_EXPECTATIONS.MIN_INTERVAL);
        expect(interval).toBeLessThan(TEST_EXPECTATIONS.MAX_INTERVAL);
      }
    });
  });

  describe('real-world distributed scenarios', () => {
    it('should handle distributed job processing', async () => {
      const testKey = generateTestKey(REDLOCK_TEST_KEYS.JOB_PROCESS);
      const redlock = new RedLock(
        createRedLockConfig(testKey, {
          ttl: Math.round(TEST_CONFIG.LONG_TTL * 1.2), // 12000ms
        })
      );

      const result = await redlock.using(async signal => {
        const processedItems = await processItemsWithLockValidation(
          redlock,
          testKey,
          TEST_DATA.JOB_ITEMS,
          TIMING_CONFIG.DELAY_LARGE,
          signal
        );

        return `Processed ${processedItems.length} items with distributed coordination`;
      });

      expect(result).toBe(TEST_MESSAGES.RESULTS.JOB_PROCESSING);
      await assertLockState(redlock, testKey, false);
    });

    it('should handle distributed cache warming', async () => {
      const testKey = generateTestKey(REDLOCK_TEST_KEYS.CACHE_WARM);
      const redlock = new RedLock(createRedLockConfig(testKey));

      const result = await redlock.using(async signal => {
        const cacheEntries = await simulateCacheWarming(
          redlock,
          testKey,
          TEST_DATA.CACHE_ENTRIES,
          TIMING_CONFIG.INTERVAL_CACHE_PROCESS,
          signal
        );

        expect(Object.keys(cacheEntries)).toHaveLength(TEST_DATA.CACHE_ENTRIES.length);
        expect(cacheEntries['user:1']).toBe('userData1');
        expect(cacheEntries['config:app']).toBe('appConfig');

        return TEST_MESSAGES.RESULTS.CACHE_WARMED;
      });

      expect(result).toBe(TEST_MESSAGES.RESULTS.CACHE_WARMED);
    });

    it('should handle distributed leader election scenario', async () => {
      const testKey = generateTestKey(REDLOCK_TEST_KEYS.LEADER);
      const redlock = new RedLock(
        createRedLockConfig(testKey, {
          ttl: Math.round(TEST_CONFIG.MEDIUM_TTL * 1.33), // 4000ms
        })
      );

      const result = await redlock.using(async signal => {
        const completedTasks = await simulateLeaderDuties(
          redlock,
          testKey,
          TEST_DATA.LEADER_DUTIES,
          TIMING_CONFIG.INTERVAL_LEADER_DUTIES,
          signal
        );

        expect(completedTasks).toEqual(TEST_DATA.LEADER_DUTIES);
        return TEST_MESSAGES.RESULTS.LEADERSHIP_COMPLETE;
      });

      expect(result).toBe(TEST_MESSAGES.RESULTS.LEADERSHIP_COMPLETE);
      await assertLockState(redlock, testKey, false);
    });
  });

  describe('error recovery and resilience', () => {
    it('should recover from temporary instance failures', async () => {
      const testKey = generateTestKey(REDLOCK_TEST_KEYS.RECOVERY);
      const redlock = new RedLock(createRedLockConfig(testKey));

      let recoverySuccessful = false;

      const result = await redlock.using(async signal => {
        await delay(TIMING_CONFIG.DELAY_ROUTINE);
        await redisClients[2].disconnect();
        await delay(TIMING_CONFIG.DELAY_MEDIUM_LARGE);
        await redisClients[2].connect();
        await waitForExtensionAttempt(TIMING_CONFIG.DELAY_LONG);

        if (!signal.aborted) {
          recoverySuccessful = true;
        }

        return TEST_MESSAGES.RESULTS.RECOVERY_TEST;
      });

      expect(result).toBe(TEST_MESSAGES.RESULTS.RECOVERY_TEST);
      expect(recoverySuccessful).toBe(true);
    });
  });
});
