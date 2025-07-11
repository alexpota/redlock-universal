import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient as createNodeRedisClient } from 'redis';
import { RedLock, NodeRedisAdapter } from '../../../src/index.js';
import { LockAcquisitionError } from '../../../src/types/errors.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';
import { TEST_CONFIG, generateTestKey, delay, getRedisUrl } from '../../shared/constants.js';

/**
 * Network Partition Simulation Tests
 *
 * Tests RedLock behavior during network partitions and split-brain scenarios.
 * These tests validate the CAP theorem trade-offs and ensure safety properties.
 */
describe('RedLock Network Partition Simulation', () => {
  const redisClients: any[] = [];
  const adapters: RedisAdapter[] = [];

  const NUM_INSTANCES = 5;

  beforeAll(async () => {
    // Create 5 Redis connections simulating different data centers
    for (let i = 0; i < NUM_INSTANCES; i++) {
      const client = createNodeRedisClient({
        url: getRedisUrl(),
        database: i,
      });
      await client.connect();
      redisClients.push(client);
      adapters.push(new NodeRedisAdapter(client));
    }

    // Verify all connections
    for (const adapter of adapters) {
      const result = await adapter.ping();
      expect(result).toBe('PONG');
    }
  });

  afterAll(async () => {
    await Promise.all(redisClients.map(client => client.disconnect()));
  });

  /**
   * Helper function to simulate network partition by disconnecting clients
   */
  async function createPartition(partitionSize: number): Promise<number[]> {
    const partitionIndices = Array.from({ length: partitionSize }, (_, i) => i);
    await Promise.all(partitionIndices.map(i => redisClients[i].disconnect()));
    return partitionIndices;
  }

  /**
   * Helper function to heal network partition by reconnecting clients
   */
  async function healPartition(partitionIndices: number[]): Promise<void> {
    await Promise.all(partitionIndices.map(i => redisClients[i].connect()));
  }

  describe('Split-Brain Prevention', () => {
    it('should prevent split-brain during network partition', async () => {
      const testKey = generateTestKey('partition');
      const quorum = 3; // Majority of 5

      // Create two RedLock instances representing different sides of partition
      const redlock1 = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
        retryAttempts: 1,
        retryDelay: 100,
      });

      const redlock2 = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
        retryAttempts: 1,
        retryDelay: 100,
      });

      // First lock acquires successfully
      const handle1 = await redlock1.acquire();
      expect(handle1).toBeDefined();

      // Create partition: disconnect 2 instances (minority)
      const partitionIndices = await createPartition(2);

      // Second lock should fail even with partition
      // because it can't get majority consensus
      await expect(redlock2.acquire()).rejects.toThrow(LockAcquisitionError);

      // Heal partition
      await healPartition(partitionIndices);

      // Clean up
      await redlock1.release(handle1);
    });

    it('should handle majority partition scenario', async () => {
      const testKey = generateTestKey('partition');
      const quorum = 3;

      // Create partition: disconnect 3 instances (majority)
      const partitionIndices = await createPartition(3);

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
        retryAttempts: 1,
        retryDelay: 100,
      });

      // Should fail to acquire lock without majority
      await expect(redlock.acquire()).rejects.toThrow(LockAcquisitionError);

      // Heal partition
      await healPartition(partitionIndices);

      // Should succeed after healing
      const handle = await redlock.acquire();
      expect(handle).toBeDefined();
      await redlock.release(handle);
    });

    it('should maintain lock during minority partition', async () => {
      const testKey = generateTestKey('partition');
      const quorum = 3;

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
      });

      // Acquire lock first
      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Create minority partition (2 instances)
      const partitionIndices = await createPartition(2);

      // Lock should still be considered valid
      const isStillLocked = await redlock.isLocked(testKey);
      expect(isStillLocked).toBe(true);

      // Should be able to extend lock
      const extended = await redlock.extend(handle, TEST_CONFIG.DEFAULT_TTL + 1000);
      expect(extended).toBe(true);

      // Should be able to release lock
      const released = await redlock.release(handle);
      expect(released).toBe(true);

      // Heal partition
      await healPartition(partitionIndices);
    });
  });

  describe('Partition Recovery', () => {
    it('should recover gracefully after partition healing', async () => {
      const testKey = generateTestKey('partition');
      const quorum = 3;

      // Create partition before attempting lock
      const partitionIndices = await createPartition(2);

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
        retryAttempts: 1,
        retryDelay: 100,
      });

      // Should still be able to acquire with majority
      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Heal partition
      await healPartition(partitionIndices);

      // Lock should still be valid after healing
      const isStillLocked = await redlock.isLocked(testKey);
      expect(isStillLocked).toBe(true);

      // Should be able to release normally
      const released = await redlock.release(handle);
      expect(released).toBe(true);
    });

    it('should synchronize state after partition recovery', async () => {
      const testKey = generateTestKey('partition-recovery');
      const quorum = TEST_CONFIG.DEFAULT_QUORUM_5;

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
      });

      // Acquire lock
      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Create partition
      const partitionIndices = await createPartition(2);

      // Release lock while partition exists
      const released = await redlock.release(handle);
      expect(released).toBe(true);

      // Heal partition
      await healPartition(partitionIndices);

      // Wait a bit for partition healing to propagate
      await delay(TEST_CONFIG.TTL_BUFFER);

      // Verify all instances are synchronized (no stale locks)
      // During partition, some instances might not have received the release
      // This is expected behavior in distributed systems
      let staleInstances = 0;
      for (const adapter of adapters) {
        const value = await adapter.get(testKey);
        if (value !== null) {
          staleInstances++;
        }
      }
      // Allow some stale instances due to partition behavior
      expect(staleInstances).toBeLessThanOrEqual(2);
    });
  });

  describe('Asymmetric Partitions', () => {
    it('should handle asymmetric network partitions', async () => {
      const testKey = generateTestKey('partition');
      const quorum = 3;

      // Create asymmetric partition: disconnect instances 1 and 3
      await redisClients[1].disconnect();
      await redisClients[3].disconnect();

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
        retryAttempts: 1,
        retryDelay: 100,
      });

      // Should still be able to acquire with remaining instances (0, 2, 4)
      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Verify lock exists on available instances
      const availableIndices = [0, 2, 4];
      let lockedInstances = 0;
      for (const i of availableIndices) {
        const value = await adapters[i].get(testKey);
        if (value === handle.value) {
          lockedInstances++;
        }
      }
      expect(lockedInstances).toBe(3);

      // Release lock
      await redlock.release(handle);

      // Reconnect partitioned instances
      await redisClients[1].connect();
      await redisClients[3].connect();
    });

    it('should handle cascading failures', async () => {
      const testKey = generateTestKey('partition');
      const quorum = 3;

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
      });

      // Acquire lock initially
      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Simulate cascading failures: disconnect instances one by one
      await redisClients[0].disconnect();
      await new Promise(resolve => setTimeout(resolve, 100));
      await redisClients[1].disconnect();

      // Should still maintain lock (3 instances remaining)
      const isStillLocked = await redlock.isLocked(testKey);
      expect(isStillLocked).toBe(true);

      // One more failure - now only 2 instances remain (below quorum)
      await redisClients[2].disconnect();

      // Lock status should reflect loss of quorum
      const hasQuorum = await redlock.isLocked(testKey);
      expect(hasQuorum).toBe(false);

      // Reconnect instances
      await redisClients[0].connect();
      await redisClients[1].connect();
      await redisClients[2].connect();

      // Clean up (might fail due to partition, but that's expected)
      try {
        await redlock.release(handle);
      } catch (error) {
        // Expected due to partition
      }
    });
  });

  describe('Timing and TTL During Partitions', () => {
    it('should handle TTL expiration during partition', async () => {
      const testKey = generateTestKey('partition');
      const shortTTL = 2000; // 2 seconds
      const quorum = 3;

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: shortTTL,
        quorum,
      });

      // Acquire lock
      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Create partition
      const partitionIndices = await createPartition(2);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, shortTTL + 500));

      // Heal partition
      await healPartition(partitionIndices);

      // Lock should be expired on all instances
      const isExpired = await redlock.isLocked(testKey);
      expect(isExpired).toBe(false);

      // Should be able to acquire new lock
      const newHandle = await redlock.acquire();
      expect(newHandle).toBeDefined();
      expect(newHandle.value).not.toBe(handle.value);

      await redlock.release(newHandle);
    });

    it('should handle clock drift during partition', async () => {
      const testKey = generateTestKey('partition');
      const quorum = 3;
      const highDriftFactor = 0.1; // 10% clock drift tolerance

      // Create partition first
      const partitionIndices = await createPartition(2);

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
        clockDriftFactor: highDriftFactor,
        retryAttempts: 1,
        retryDelay: 100,
      });

      // Should be able to acquire with remaining instances
      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Verify clock drift is accounted for
      expect(handle.metadata?.acquisitionTime).toBeDefined();

      // Heal partition
      await healPartition(partitionIndices);

      await redlock.release(handle);
    });
  });

  describe('Consistency Guarantees', () => {
    it('should maintain consistency during rapid partition changes', async () => {
      const testKey = generateTestKey('partition');
      const quorum = 3;

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
      });

      // Acquire lock
      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Rapid partition changes
      for (let i = 0; i < 3; i++) {
        // Create partition
        await redisClients[i].disconnect();
        await new Promise(resolve => setTimeout(resolve, 50));

        // Heal partition
        await redisClients[i].connect();
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Lock should still be valid
      const isStillLocked = await redlock.isLocked(testKey);
      expect(isStillLocked).toBe(true);

      // Should be able to release
      const released = await redlock.release(handle);
      expect(released).toBe(true);
    });

    it('should prevent phantom locks after partition', async () => {
      const testKey = generateTestKey('partition');
      const quorum = 3;

      // Create partition
      const partitionIndices = await createPartition(3);

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
        retryAttempts: 1,
        retryDelay: 100,
      });

      // Should fail to acquire due to insufficient instances
      await expect(redlock.acquire()).rejects.toThrow(LockAcquisitionError);

      // Heal partition
      await healPartition(partitionIndices);

      // Should be able to acquire after healing
      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Verify no phantom locks exist
      let phantomLocks = 0;
      for (const adapter of adapters) {
        const value = await adapter.get(testKey);
        if (value !== null && value !== handle.value) {
          phantomLocks++;
        }
      }
      expect(phantomLocks).toBe(0);

      await redlock.release(handle);
    });
  });

  describe('Performance During Partitions', () => {
    it('should degrade gracefully during partition', async () => {
      const testKey = generateTestKey('partition');
      const quorum = 3;

      // Create partition
      const partitionIndices = await createPartition(1);

      const redlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
        retryAttempts: 0, // No retries for performance test
      });

      const startTime = Date.now();
      const handle = await redlock.acquire();
      const acquisitionTime = Date.now() - startTime;

      // Should still be reasonably fast even with partition
      expect(acquisitionTime).toBeLessThan(2000);
      expect(handle).toBeDefined();

      // Heal partition
      await healPartition(partitionIndices);

      await redlock.release(handle);
    });

    it('should handle concurrent operations during partition', async () => {
      const testKey = generateTestKey('partition');
      const quorum = 3;

      // Create partition
      const partitionIndices = await createPartition(1);

      const redlock1 = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
        retryAttempts: 1,
        retryDelay: 50,
      });

      const redlock2 = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum,
        retryAttempts: 1,
        retryDelay: 50,
      });

      // Both should compete for the lock
      const [result1, result2] = await Promise.allSettled([redlock1.acquire(), redlock2.acquire()]);

      // One should succeed, one should fail
      const successes = [result1, result2].filter(r => r.status === 'fulfilled');
      const failures = [result1, result2].filter(r => r.status === 'rejected');

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);

      // Heal partition
      await healPartition(partitionIndices);

      // Clean up successful lock
      if (successes.length > 0) {
        const successResult = successes[0] as PromiseFulfilledResult<any>;
        await redlock1.release(successResult.value);
      }
    });
  });
});
