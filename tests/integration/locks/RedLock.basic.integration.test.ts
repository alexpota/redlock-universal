import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient as createNodeRedisClient } from 'redis';
import Redis from 'ioredis';
import { RedLock, NodeRedisAdapter, IoredisAdapter } from '../../../src/index.js';
import { LockAcquisitionError } from '../../../src/types/errors.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';
import {
  TEST_CONFIG,
  REDIS_CONFIG,
  generateTestKey,
  delay,
  getRedisUrl,
} from '../../shared/constants.js';

describe('RedLock Basic Integration Tests', () => {
  const nodeRedisClients: any[] = [];
  const ioredisClients: Redis[] = [];
  const adapters: RedisAdapter[] = [];

  beforeAll(async () => {
    // Setup multiple Redis connections for distributed locking
    // Note: In production, these would be different Redis servers
    // For testing, we use different databases on same instance

    // Create node-redis clients for distributed testing
    for (let i = 0; i < REDIS_CONFIG.DISTRIBUTED_INSTANCES; i++) {
      const client = createNodeRedisClient({
        url: getRedisUrl(),
        database: i,
      });
      await client.connect();
      nodeRedisClients.push(client);
      adapters.push(new NodeRedisAdapter(client));
    }

    // Create ioredis clients for mixed client testing
    for (
      let i = REDIS_CONFIG.IOREDIS_START_DB;
      i < REDIS_CONFIG.IOREDIS_START_DB + REDIS_CONFIG.IOREDIS_INSTANCES;
      i++
    ) {
      const client = new Redis({
        host: REDIS_CONFIG.DEFAULT_HOST,
        port: REDIS_CONFIG.DEFAULT_PORT,
        db: i,
      });
      ioredisClients.push(client);
      adapters.push(new IoredisAdapter(client));
    }

    // Verify all connections are working
    for (let i = 0; i < adapters.length; i++) {
      const result = await adapters[i].ping();
      expect(result).toBe('PONG');
    }
  });

  afterAll(async () => {
    // Cleanup all connections
    await Promise.all(nodeRedisClients.map(client => client.disconnect()));
    ioredisClients.forEach(client => client.disconnect());
  });

  describe('Basic RedLock Operations', () => {
    let redlock: RedLock;
    let testKey: string;

    beforeEach(() => {
      testKey = generateTestKey('redlock');
      redlock = new RedLock({
        adapters: adapters.slice(0, REDIS_CONFIG.DISTRIBUTED_INSTANCES),
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum: TEST_CONFIG.DEFAULT_QUORUM_5,
        retryAttempts: TEST_CONFIG.DEFAULT_RETRY_ATTEMPTS,
        retryDelay: TEST_CONFIG.DEFAULT_RETRY_DELAY,
        clockDriftFactor: TEST_CONFIG.DEFAULT_CLOCK_DRIFT,
      });
    });

    it('should acquire distributed lock across real Redis instances', async () => {
      const handle = await redlock.acquire();

      expect(handle).toMatchObject({
        key: testKey,
        value: expect.any(String),
        acquiredAt: expect.any(Number),
        ttl: TEST_CONFIG.DEFAULT_TTL,
        metadata: expect.objectContaining({
          strategy: 'redlock',
          attempts: 1,
          acquisitionTime: expect.any(Number),
          nodes: expect.any(Array),
        }),
      });

      // Verify lock exists on majority of Redis instances
      let lockedNodes = 0;
      for (const adapter of adapters.slice(0, REDIS_CONFIG.DISTRIBUTED_INSTANCES)) {
        const value = await adapter.get(testKey);
        if (value === handle.value) {
          lockedNodes++;
        }
      }
      expect(lockedNodes).toBeGreaterThanOrEqual(TEST_CONFIG.DEFAULT_QUORUM_5);

      // Clean up
      await redlock.release(handle);
    });

    it('should release distributed lock from all Redis instances', async () => {
      const handle = await redlock.acquire();

      // Verify lock is acquired
      const isLocked = await redlock.isLocked(testKey);
      expect(isLocked).toBe(true);

      // Release the lock
      const released = await redlock.release(handle);
      expect(released).toBe(true);

      // Verify lock is released from all instances
      let lockedNodes = 0;
      for (const adapter of adapters.slice(0, REDIS_CONFIG.DISTRIBUTED_INSTANCES)) {
        const value = await adapter.get(testKey);
        if (value !== null) {
          lockedNodes++;
        }
      }
      expect(lockedNodes).toBe(0);

      // Verify status check
      const isUnlocked = await redlock.isLocked(testKey);
      expect(isUnlocked).toBe(false);
    });

    it('should extend distributed lock TTL', async () => {
      const handle = await redlock.acquire();
      const extendedTTL = TEST_CONFIG.DEFAULT_TTL + TEST_CONFIG.TTL_EXTENSION;

      // Extend the lock
      const extended = await redlock.extend(handle, extendedTTL);
      expect(extended).toBe(true);

      // Verify lock still exists with correct value
      let validNodes = 0;
      for (const adapter of adapters.slice(0, REDIS_CONFIG.DISTRIBUTED_INSTANCES)) {
        const value = await adapter.get(testKey);
        if (value === handle.value) {
          validNodes++;
        }
      }
      expect(validNodes).toBeGreaterThanOrEqual(TEST_CONFIG.DEFAULT_QUORUM_5);

      // Clean up
      await redlock.release(handle);
    });

    it('should handle lock contention between RedLock instances', async () => {
      const redlock1 = new RedLock({
        adapters: adapters.slice(0, REDIS_CONFIG.DISTRIBUTED_INSTANCES),
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum: TEST_CONFIG.DEFAULT_QUORUM_5,
        retryAttempts: 1,
        retryDelay: TEST_CONFIG.FAST_RETRY_DELAY,
      });

      const redlock2 = new RedLock({
        adapters: adapters.slice(0, REDIS_CONFIG.DISTRIBUTED_INSTANCES),
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum: TEST_CONFIG.DEFAULT_QUORUM_5,
        retryAttempts: 1,
        retryDelay: TEST_CONFIG.FAST_RETRY_DELAY,
      });

      // First lock should succeed
      const handle1 = await redlock1.acquire();
      expect(handle1).toBeDefined();

      // Second lock should fail
      await expect(redlock2.acquire()).rejects.toThrow(LockAcquisitionError);

      // After releasing first lock, second should succeed
      await redlock1.release(handle1);
      const handle2 = await redlock2.acquire();
      expect(handle2).toBeDefined();

      // Clean up
      await redlock2.release(handle2);
    });

    it('should work with TTL expiration', async () => {
      const shortRedlock = new RedLock({
        adapters: adapters.slice(0, REDIS_CONFIG.DISTRIBUTED_INSTANCES),
        key: testKey,
        ttl: TEST_CONFIG.SHORT_TTL,
        quorum: TEST_CONFIG.DEFAULT_QUORUM_5,
      });

      const handle = await shortRedlock.acquire();
      expect(handle).toBeDefined();

      // Wait for TTL to expire
      await delay(TEST_CONFIG.SHORT_TTL + TEST_CONFIG.TTL_BUFFER);

      // Lock should be automatically released
      const isLocked = await shortRedlock.isLocked(testKey);
      expect(isLocked).toBe(false);

      // Should be able to acquire again
      const handle2 = await shortRedlock.acquire();
      expect(handle2).toBeDefined();

      // Clean up
      await shortRedlock.release(handle2);
    });
  });

  describe('Mixed Redis Client Types', () => {
    it('should work with both node-redis and ioredis clients', async () => {
      const testKey = generateTestKey('mixed');
      const mixedClientCount = REDIS_CONFIG.NODE_REDIS_INSTANCES + REDIS_CONFIG.IOREDIS_INSTANCES;
      const mixedQuorum = Math.floor(mixedClientCount / 2) + 1;

      const mixedRedlock = new RedLock({
        adapters: [
          ...adapters.slice(0, REDIS_CONFIG.NODE_REDIS_INSTANCES),
          ...adapters.slice(
            REDIS_CONFIG.IOREDIS_START_DB,
            REDIS_CONFIG.IOREDIS_START_DB + REDIS_CONFIG.IOREDIS_INSTANCES
          ),
        ],
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum: mixedQuorum,
        retryAttempts: TEST_CONFIG.DEFAULT_RETRY_ATTEMPTS,
        retryDelay: TEST_CONFIG.DEFAULT_RETRY_DELAY,
      });

      const handle = await mixedRedlock.acquire();
      expect(handle).toBeDefined();
      expect(handle.metadata?.nodes?.length).toBeGreaterThanOrEqual(mixedQuorum);

      // Verify lock exists across both client types
      let nodeRedisLocked = 0;
      let ioredisLocked = 0;

      for (let i = 0; i < REDIS_CONFIG.NODE_REDIS_INSTANCES; i++) {
        const value = await adapters[i].get(testKey);
        if (value === handle.value) nodeRedisLocked++;
      }

      for (
        let i = REDIS_CONFIG.IOREDIS_START_DB;
        i < REDIS_CONFIG.IOREDIS_START_DB + REDIS_CONFIG.IOREDIS_INSTANCES;
        i++
      ) {
        const value = await adapters[i].get(testKey);
        if (value === handle.value) ioredisLocked++;
      }

      expect(nodeRedisLocked + ioredisLocked).toBeGreaterThanOrEqual(mixedQuorum);

      // Clean up
      await mixedRedlock.release(handle);
    });
  });

  describe('Failure Scenarios', () => {
    it('should handle partial Redis node failures', async () => {
      const testKey = generateTestKey('failure');

      // Create redlock with all adapters
      const redlock = new RedLock({
        adapters: adapters.slice(0, REDIS_CONFIG.DISTRIBUTED_INSTANCES),
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum: TEST_CONFIG.DEFAULT_QUORUM_5,
        retryAttempts: 1,
        retryDelay: TEST_CONFIG.FAST_RETRY_DELAY,
      });

      // Simulate node failure by disconnecting one client
      const failingClient = nodeRedisClients[4];
      await failingClient.disconnect();

      // Should still be able to acquire lock with remaining nodes
      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Verify lock acquired on available nodes
      let lockedNodes = 0;
      for (let i = 0; i < REDIS_CONFIG.DISTRIBUTED_INSTANCES - 1; i++) {
        // Skip the disconnected one
        const value = await adapters[i].get(testKey);
        if (value === handle.value) {
          lockedNodes++;
        }
      }
      expect(lockedNodes).toBeGreaterThanOrEqual(TEST_CONFIG.DEFAULT_QUORUM_5);

      // Clean up
      await redlock.release(handle);

      // Reconnect for cleanup
      await failingClient.connect();
    });

    it('should fail when insufficient nodes are available', async () => {
      const testKey = generateTestKey('insufficient');

      // Disconnect majority of nodes
      const clientsToDisconnect = nodeRedisClients.slice(2, REDIS_CONFIG.DISTRIBUTED_INSTANCES);
      await Promise.all(clientsToDisconnect.map(client => client.disconnect()));

      const redlock = new RedLock({
        adapters: adapters.slice(0, REDIS_CONFIG.DISTRIBUTED_INSTANCES),
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum: TEST_CONFIG.DEFAULT_QUORUM_5,
        retryAttempts: 1,
        retryDelay: TEST_CONFIG.FAST_RETRY_DELAY,
      });

      // Should fail to acquire lock
      await expect(redlock.acquire()).rejects.toThrow(LockAcquisitionError);

      // Reconnect for cleanup
      await Promise.all(clientsToDisconnect.map(client => client.connect()));
    });
  });

  describe('Performance and Timing', () => {
    it('should acquire lock within reasonable time', async () => {
      const testKey = generateTestKey('performance');
      const redlock = new RedLock({
        adapters: adapters.slice(0, REDIS_CONFIG.DISTRIBUTED_INSTANCES),
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum: TEST_CONFIG.DEFAULT_QUORUM_5,
        retryAttempts: 0, // No retries for pure performance test
      });

      const startTime = Date.now();
      const handle = await redlock.acquire();
      const acquisitionTime = Date.now() - startTime;

      // Should acquire within configured timeout for local Redis
      expect(acquisitionTime).toBeLessThan(TEST_CONFIG.PERFORMANCE_TIMEOUT);
      expect(handle.metadata?.acquisitionTime).toBeLessThanOrEqual(acquisitionTime + 1);

      // Clean up
      await redlock.release(handle);
    });

    it('should handle concurrent acquisition attempts correctly', async () => {
      const testKey = generateTestKey('concurrent');
      const numConcurrentAttempts = 5;

      const redlocks = Array.from(
        { length: numConcurrentAttempts },
        () =>
          new RedLock({
            adapters: adapters.slice(0, 5),
            key: testKey,
            ttl: TEST_CONFIG.DEFAULT_TTL,
            quorum: 3,
            retryAttempts: 1,
            retryDelay: 50,
          })
      );

      // Attempt to acquire locks concurrently
      const acquisitionPromises = redlocks.map(redlock => redlock.acquire().catch(error => error));

      const results = await Promise.all(acquisitionPromises);

      // Count successes and failures
      const successes = results.filter(result => !(result instanceof Error));
      const failures = results.filter(result => result instanceof Error);

      // Only one should succeed
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(numConcurrentAttempts - 1);

      // Clean up the successful lock
      if (successes.length > 0) {
        const successIndex = results.findIndex(result => !(result instanceof Error));
        await redlocks[successIndex].release(successes[0]);
      }
    });
  });

  describe('Configuration Validation', () => {
    it('should work with minimum viable configuration', async () => {
      const testKey = generateTestKey('minimal');
      const minRedlock = new RedLock({
        adapters: adapters.slice(0, 1),
        key: testKey,
        // All other options use defaults
      });

      const handle = await minRedlock.acquire();
      expect(handle).toBeDefined();

      const released = await minRedlock.release(handle);
      expect(released).toBe(true);
    });

    it('should respect custom quorum settings', async () => {
      const testKey = generateTestKey('custom-quorum');
      const customQuorum = 4;
      const redlock = new RedLock({
        adapters: adapters.slice(0, 5),
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum: customQuorum,
      });

      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Verify at least customQuorum nodes have the lock
      let lockedNodes = 0;
      for (const adapter of adapters.slice(0, 5)) {
        const value = await adapter.get(testKey);
        if (value === handle.value) {
          lockedNodes++;
        }
      }
      expect(lockedNodes).toBeGreaterThanOrEqual(customQuorum);

      // Clean up
      await redlock.release(handle);
    });
  });

  describe('Utility Functions', () => {
    it('should provide accurate configuration access', () => {
      const testKey = generateTestKey('config-access');
      const redlock = new RedLock({
        adapters: adapters.slice(0, 3),
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum: 2,
        retryAttempts: 5,
        retryDelay: 200,
        clockDriftFactor: 0.02,
      });

      const config = redlock.getConfig();
      expect(config.key).toBe(testKey);
      expect(config.ttl).toBe(TEST_CONFIG.DEFAULT_TTL);
      expect(config.quorum).toBe(2);
      expect(config.retryAttempts).toBe(5);
      expect(config.retryDelay).toBe(200);
      expect(config.clockDriftFactor).toBe(0.02);

      expect(redlock.getQuorum()).toBe(2);
      expect(redlock.getAdapters().length).toBe(3);
    });
  });
});
