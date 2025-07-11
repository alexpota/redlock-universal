import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient as createNodeRedisClient } from 'redis';
import { RedLock, NodeRedisAdapter } from '../../../src/index.js';
import { LockAcquisitionError } from '../../../src/types/errors.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';
import { TEST_CONFIG, REDIS_CONFIG, generateTestKey, getRedisUrl } from '../../shared/constants.js';

/**
 * Multi-Instance RedLock Validation Tests
 *
 * Tests RedLock behavior with multiple Redis instances simulating real distributed scenarios.
 * These tests validate the core distributed locking guarantees across multiple Redis servers.
 */
describe('RedLock Multi-Instance Validation', () => {
  const redisInstances: any[] = [];
  const adapters: RedisAdapter[] = [];

  beforeAll(async () => {
    // Create connections to different Redis instances (simulated via different databases)
    // In real production, these would be different Redis servers on different hosts
    for (let i = 0; i < REDIS_CONFIG.DISTRIBUTED_INSTANCES; i++) {
      try {
        const client = createNodeRedisClient({
          url: getRedisUrl(),
          database: i, // Use different databases to simulate different servers
        });
        await client.connect();
        redisInstances.push(client);
        adapters.push(new NodeRedisAdapter(client));
      } catch (error) {
        console.warn(`Failed to connect to Redis database ${i}:`, error);
      }
    }

    // Ensure we have enough instances for meaningful testing
    if (adapters.length < 3) {
      throw new Error(
        `Need at least 3 Redis instances for multi-instance testing, got ${adapters.length}. ` +
          'Make sure Redis is running and accessible.'
      );
    }

    // Verify all connections
    for (let i = 0; i < adapters.length; i++) {
      const result = await adapters[i].ping();
      expect(result).toBe('PONG');
    }
  });

  afterAll(async () => {
    await Promise.all(
      redisInstances.map(async client => {
        try {
          if (client.isReady) {
            await client.disconnect();
          }
        } catch (error) {
          // Ignore disconnect errors during cleanup
        }
      })
    );
  });

  describe('Distributed Lock Guarantees', () => {
    it('should maintain mutual exclusion across all Redis instances', async () => {
      const testKey = generateTestKey('multi-instance');
      const numInstances = adapters.length;
      const quorum = Math.floor(numInstances / 2) + 1;

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
        retryAttempts: 2,
        retryDelay: 100,
      });

      // Acquire lock
      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Verify lock exists on at least quorum instances
      let lockedInstances = 0;
      for (const adapter of adapters) {
        const value = await adapter.get(testKey);
        if (value === handle.value) {
          lockedInstances++;
        }
      }
      expect(lockedInstances).toBeGreaterThanOrEqual(quorum);

      // Verify no other process can acquire the same lock
      const competingRedlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
        retryAttempts: 1,
        retryDelay: 50,
      });

      await expect(competingRedlock.acquire()).rejects.toThrow(LockAcquisitionError);

      // Release and verify cleanup
      await redlock.release(handle);
    });

    it('should handle Byzantine failures (minority node failures)', async () => {
      const testKey = generateTestKey('multi-instance');
      const numInstances = adapters.length;
      const quorum = Math.floor(numInstances / 2) + 1;
      const failureCount = Math.floor(numInstances / 2); // Minority failures

      // Simulate failure by disconnecting minority of instances
      const failingInstances = redisInstances.slice(0, failureCount);
      await Promise.all(
        failingInstances.map(async client => {
          try {
            if (client.isReady) {
              await client.disconnect();
            }
          } catch (error) {
            // Ignore disconnect errors
          }
        })
      );

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
        retryAttempts: 2,
        retryDelay: 100,
      });

      // Should still be able to acquire lock with remaining instances
      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Verify lock acquired on available instances
      let lockedInstances = 0;
      for (let i = failureCount; i < adapters.length; i++) {
        const value = await adapters[i].get(testKey);
        if (value === handle.value) {
          lockedInstances++;
        }
      }
      expect(lockedInstances).toBeGreaterThanOrEqual(quorum);

      // Release lock
      await redlock.release(handle);

      // Reconnect failed instances
      for (let i = 0; i < failureCount; i++) {
        try {
          if (!failingInstances[i].isReady) {
            await failingInstances[i].connect();
          }
        } catch (error) {
          // Ignore reconnect errors
        }
      }
    });

    it('should fail when majority of instances are unavailable', async () => {
      const testKey = generateTestKey('multi-instance');
      const numInstances = adapters.length;
      const quorum = Math.floor(numInstances / 2) + 1;
      const majorityFailureCount = Math.ceil(numInstances / 2); // Majority failures

      // Disconnect majority of instances
      const failingInstances = redisInstances.slice(0, majorityFailureCount);
      await Promise.all(
        failingInstances.map(async client => {
          try {
            if (client.isReady) {
              await client.disconnect();
            }
          } catch (error) {
            // Ignore disconnect errors
          }
        })
      );

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
        retryAttempts: 1,
        retryDelay: 50,
      });

      // Should fail to acquire lock
      await expect(redlock.acquire()).rejects.toThrow(LockAcquisitionError);

      // Reconnect failed instances
      for (let i = 0; i < majorityFailureCount; i++) {
        try {
          if (!failingInstances[i].isReady) {
            await failingInstances[i].connect();
          }
        } catch (error) {
          // Ignore reconnect errors
        }
      }
    });
  });

  describe('Quorum Behavior', () => {
    it('should respect custom quorum requirements', async () => {
      const testKey = generateTestKey('multi-instance');
      const customQuorum = Math.min(4, adapters.length);

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum: customQuorum,
        retryAttempts: 2,
        retryDelay: 100,
      });

      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Verify exactly the required quorum or more instances have the lock
      let lockedInstances = 0;
      for (const adapter of adapters) {
        const value = await adapter.get(testKey);
        if (value === handle.value) {
          lockedInstances++;
        }
      }
      expect(lockedInstances).toBeGreaterThanOrEqual(customQuorum);

      await redlock.release(handle);
    });

    it('should handle edge case with quorum equals total instances', async () => {
      const testKey = generateTestKey('multi-instance');
      const totalInstances = adapters.length;

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum: totalInstances, // All instances must succeed
        retryAttempts: 1,
        retryDelay: 50,
      });

      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Verify all instances have the lock
      let lockedInstances = 0;
      for (const adapter of adapters) {
        const value = await adapter.get(testKey);
        if (value === handle.value) {
          lockedInstances++;
        }
      }
      expect(lockedInstances).toBe(totalInstances);

      await redlock.release(handle);
    });
  });

  describe('Clock Drift and Timing', () => {
    it('should handle clock drift protection', async () => {
      const testKey = generateTestKey('multi-instance');
      const shortTTL = 10; // Extremely short TTL
      const highDriftFactor = 0.9; // 90% clock drift tolerance

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: shortTTL,
        quorum: Math.floor(adapters.length / 2) + 1,
        clockDriftFactor: highDriftFactor,
        retryAttempts: 0, // No retries for timing test
      });

      // This should fail due to clock drift protection
      // Even a 6ms acquisition + 90% drift = 11.4ms which exceeds 10ms TTL
      await expect(redlock.acquire()).rejects.toThrow(LockAcquisitionError);
    });

    it('should succeed with reasonable TTL and clock drift', async () => {
      const testKey = generateTestKey('multi-instance');
      const reasonableTTL = 5000; // 5 seconds
      const normalDriftFactor = 0.01; // 1% clock drift

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: reasonableTTL,
        quorum: Math.floor(adapters.length / 2) + 1,
        clockDriftFactor: normalDriftFactor,
        retryAttempts: 1,
      });

      const handle = await redlock.acquire();
      expect(handle).toBeDefined();
      expect(handle.metadata?.acquisitionTime).toBeLessThan(reasonableTTL);

      await redlock.release(handle);
    });
  });

  describe('Lock Extension and Expiration', () => {
    it('should extend lock across all instances', async () => {
      const testKey = generateTestKey('multi-instance');
      const initialTTL = 2000;
      const extendedTTL = 5000;

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: initialTTL,
        quorum: Math.floor(adapters.length / 2) + 1,
      });

      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Extend the lock
      const extended = await redlock.extend(handle, extendedTTL);
      expect(extended).toBe(true);

      // Verify lock still exists with correct value
      let validInstances = 0;
      for (const adapter of adapters) {
        const value = await adapter.get(testKey);
        if (value === handle.value) {
          validInstances++;
        }
      }
      expect(validInstances).toBeGreaterThanOrEqual(redlock.getQuorum());

      await redlock.release(handle);
    });

    it('should handle automatic expiration across instances', async () => {
      const testKey = generateTestKey('multi-instance');
      const shortTTL = 1000; // 1 second

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: shortTTL,
        quorum: Math.floor(adapters.length / 2) + 1,
      });

      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, shortTTL + 500));

      // Verify lock expired on all instances
      let expiredInstances = 0;
      for (const adapter of adapters) {
        const value = await adapter.get(testKey);
        if (value === null) {
          expiredInstances++;
        }
      }
      expect(expiredInstances).toBe(adapters.length);

      // Should be able to acquire new lock
      const newHandle = await redlock.acquire();
      expect(newHandle).toBeDefined();
      expect(newHandle.value).not.toBe(handle.value);

      await redlock.release(newHandle);
    });
  });

  describe('High Availability Scenarios', () => {
    it('should maintain lock when minority instances fail after acquisition', async () => {
      const testKey = generateTestKey('multi-instance');
      const quorum = Math.floor(adapters.length / 2) + 1;

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
      });

      // Acquire lock
      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Disconnect minority of instances after acquisition
      const failureCount = Math.floor(adapters.length / 2);
      const failingInstances = redisInstances.slice(0, failureCount);
      await Promise.all(failingInstances.map(client => client.disconnect()));

      // Lock should still be considered valid
      const isStillLocked = await redlock.isLocked(testKey);
      expect(isStillLocked).toBe(true);

      // Should be able to extend lock
      const extended = await redlock.extend(handle, TEST_CONFIG.DEFAULT_TTL + 1000);
      expect(extended).toBe(true);

      // Should be able to release lock
      const released = await redlock.release(handle);
      expect(released).toBe(true);

      // Reconnect failed instances
      for (let i = 0; i < failureCount; i++) {
        await failingInstances[i].connect();
      }
    });

    it('should handle rolling restart of Redis instances', async () => {
      const testKey = generateTestKey('multi-instance');
      const quorum = Math.floor(adapters.length / 2) + 1;

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
      });

      // Acquire initial lock
      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Simulate rolling restart by disconnecting and reconnecting instances one by one
      for (let i = 0; i < Math.floor(adapters.length / 2); i++) {
        await redisInstances[i].disconnect();
        await new Promise(resolve => setTimeout(resolve, 100));
        await redisInstances[i].connect();
      }

      // Lock should still be valid after rolling restart
      const isStillLocked = await redlock.isLocked(testKey);
      expect(isStillLocked).toBe(true);

      await redlock.release(handle);
    });
  });

  describe('Performance Under Load', () => {
    it('should handle concurrent lock attempts across instances', async () => {
      const testKey = generateTestKey('multi-instance');
      const numCompetitors = 10;
      const quorum = Math.floor(adapters.length / 2) + 1;

      const redlocks = Array.from(
        { length: numCompetitors },
        () =>
          new RedLock({
            adapters,
            key: testKey,
            ttl: TEST_CONFIG.DEFAULT_TTL,
            quorum,
            retryAttempts: 2,
            retryDelay: 50,
          })
      );

      // Start all acquisition attempts simultaneously
      const acquisitionPromises = redlocks.map(redlock => redlock.acquire().catch(error => error));

      const results = await Promise.all(acquisitionPromises);

      // Count successes and failures
      const successes = results.filter(result => !(result instanceof Error));
      const failures = results.filter(result => result instanceof Error);

      // Only one should succeed (mutual exclusion)
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(numCompetitors - 1);

      // All failures should be LockAcquisitionError
      failures.forEach(failure => {
        expect(failure).toBeInstanceOf(LockAcquisitionError);
      });

      // Clean up successful lock
      if (successes.length > 0) {
        const successIndex = results.findIndex(result => !(result instanceof Error));
        await redlocks[successIndex].release(successes[0]);
      }
    });

    it('should maintain performance with increased instance count', async () => {
      const testKey = generateTestKey('multi-instance');
      const startTime = Date.now();

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum: Math.floor(adapters.length / 2) + 1,
        retryAttempts: 0, // No retries for performance test
      });

      const handle = await redlock.acquire();
      const acquisitionTime = Date.now() - startTime;

      // Should acquire within reasonable time even with multiple instances
      // Allow more time for multiple instances but still reasonable
      expect(acquisitionTime).toBeLessThan(1000);

      await redlock.release(handle);
    });
  });
});
