import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient as createNodeRedisClient } from 'redis';
import Redis from 'ioredis';
import { createLock } from '../../src/index.js';
import { NodeRedisAdapter, IoredisAdapter } from '../../src/adapters/index.js';
import { generateTestKey, getRedisUrl } from '../shared/constants.js';

describe('redlock-universal E2E Tests', () => {
  let nodeRedisClient: any;
  let ioredisClient: Redis;

  beforeAll(async () => {
    // Setup Redis clients
    nodeRedisClient = createNodeRedisClient({
      url: getRedisUrl(),
    });
    await nodeRedisClient.connect();

    ioredisClient = new Redis(getRedisUrl());
  });

  afterAll(async () => {
    await nodeRedisClient?.disconnect();
    ioredisClient?.disconnect();
  });

  // No need to flushDb since we use unique keys with process.pid

  const getTestKey = () => generateTestKey('test-lifecycle');

  describe('Simple Lock Complete Lifecycle', () => {
    it('should handle complete lock lifecycle with node-redis', async () => {
      const testKey = getTestKey();
      const adapter = new NodeRedisAdapter(nodeRedisClient);
      const lock = createLock({
        adapter,
        key: testKey,
        ttl: 10000,
      });

      // Acquire lock
      const handle = await lock.acquire();
      expect(handle).toBeDefined();
      expect(handle.key).toBe(testKey);

      // Verify lock is held
      const isLocked = await lock.isLocked(testKey);
      expect(isLocked).toBe(true);

      // Extend lock
      const extended = await lock.extend(handle, 15000);
      expect(extended).toBe(true);

      // Verify still locked
      const stillLocked = await lock.isLocked(testKey);
      expect(stillLocked).toBe(true);

      // Release lock
      const released = await lock.release(handle);
      expect(released).toBe(true);

      // Verify lock is released
      const isReleased = await lock.isLocked(testKey);
      expect(isReleased).toBe(false);
    });

    it('should handle complete lock lifecycle with ioredis', async () => {
      const testKey = getTestKey();
      const adapter = new IoredisAdapter(ioredisClient);
      const lock = createLock({
        adapter,
        key: testKey,
        ttl: 10000,
      });

      // Acquire lock
      const handle = await lock.acquire();
      expect(handle).toBeDefined();
      expect(handle.key).toBe(testKey);

      // Verify lock is held
      const isLocked = await lock.isLocked(testKey);
      expect(isLocked).toBe(true);

      // Extend lock
      const extended = await lock.extend(handle, 15000);
      expect(extended).toBe(true);

      // Release lock
      const released = await lock.release(handle);
      expect(released).toBe(true);

      // Verify lock is released
      const isReleased = await lock.isLocked(testKey);
      expect(isReleased).toBe(false);
    });
  });

  describe('Lock Contention Scenarios', () => {
    it('should handle concurrent lock attempts correctly', async () => {
      const testKey = getTestKey();
      const adapter = new NodeRedisAdapter(nodeRedisClient);
      const lock1 = createLock({
        adapter,
        key: testKey,
        ttl: 5000,
        retryAttempts: 0, // No retries for faster test
      });
      const lock2 = createLock({
        adapter,
        key: testKey,
        ttl: 5000,
        retryAttempts: 0,
      });

      // First lock should succeed
      const handle1 = await lock1.acquire();
      expect(handle1).toBeDefined();

      // Second lock should fail (same key)
      await expect(lock2.acquire()).rejects.toThrow();

      // After releasing first lock, second should be able to acquire
      await lock1.release(handle1);
      const handle2 = await lock2.acquire();
      expect(handle2).toBeDefined();

      // Clean up
      await lock2.release(handle2);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid release attempts gracefully', async () => {
      const testKey = getTestKey();
      const adapter = new NodeRedisAdapter(nodeRedisClient);
      const lock = createLock({
        adapter,
        key: testKey,
        ttl: 5000,
      });

      const handle = await lock.acquire();

      // Manually delete the key to simulate lock expiration
      await nodeRedisClient.del(testKey);

      // Release should return false (key no longer exists)
      const released = await lock.release(handle);
      expect(released).toBe(false);
    });

    it('should handle extension of expired locks gracefully', async () => {
      const testKey = getTestKey();
      const adapter = new NodeRedisAdapter(nodeRedisClient);
      const lock = createLock({
        adapter,
        key: testKey,
        ttl: 100, // Very short TTL
      });

      const handle = await lock.acquire();

      // Wait for lock to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Extension should fail
      const extended = await lock.extend(handle, 5000);
      expect(extended).toBe(false);
    });
  });

  describe('Cross-Client Compatibility', () => {
    it('should work consistently across different Redis clients', async () => {
      const testKey = getTestKey();
      const nodeAdapter = new NodeRedisAdapter(nodeRedisClient);
      const ioredisAdapter = new IoredisAdapter(ioredisClient);

      const nodeLock = createLock({
        adapter: nodeAdapter,
        key: testKey,
        ttl: 5000,
      });

      const ioredisLock = createLock({
        adapter: ioredisAdapter,
        key: testKey,
        ttl: 5000,
        retryAttempts: 0,
      });

      // Acquire with node-redis
      const handle = await nodeLock.acquire();

      // Should not be able to acquire with ioredis (same key)
      await expect(ioredisLock.acquire()).rejects.toThrow();

      // Release with node-redis
      await nodeLock.release(handle);

      // Now should be able to acquire with ioredis
      const ioredisHandle = await ioredisLock.acquire();
      expect(ioredisHandle).toBeDefined();

      // Clean up
      await ioredisLock.release(ioredisHandle);
    });
  });
});
