import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient as createNodeRedisClient } from 'redis';
import Redis from 'ioredis';
import { SimpleLock, NodeRedisAdapter, IoredisAdapter, createLock } from '../../../src/index.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';

describe('SimpleLock Integration Tests', () => {
  let nodeRedisClient: any;
  let ioredisClient: Redis;
  let nodeAdapter: RedisAdapter;
  let ioAdapter: RedisAdapter;

  const testTTL = 5000;
  const getTestKey = () =>
    `test-simple-lock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${process.pid}`;

  beforeAll(async () => {
    // Setup node-redis client
    nodeRedisClient = createNodeRedisClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    await nodeRedisClient.connect();

    // Setup ioredis client
    ioredisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

    // Create adapters
    nodeAdapter = new NodeRedisAdapter(nodeRedisClient);
    ioAdapter = new IoredisAdapter(ioredisClient);
  });

  afterAll(async () => {
    await nodeRedisClient?.disconnect();
    ioredisClient?.disconnect();
  });

  // No need to flushDb since we use unique keys with process.pid

  describe.each([
    ['NodeRedisAdapter', () => nodeAdapter],
    ['IoredisAdapter', () => ioAdapter],
  ])('%s', (adapterName, getAdapter) => {
    let adapter: RedisAdapter;
    let testKey: string;

    beforeEach(() => {
      adapter = getAdapter();
      testKey = getTestKey(); // Generate unique key for each test
    });

    describe('SimpleLock basic operations', () => {
      it('should acquire and release a lock successfully', async () => {
        const lock = new SimpleLock({
          adapter,
          key: testKey,
          ttl: testTTL,
        });

        // Acquire lock
        const handle = await lock.acquire();
        expect(handle).toBeDefined();
        expect(handle.key).toBe(testKey);
        expect(handle.value).toBeDefined();
        expect(handle.id).toBeDefined();
        expect(handle.ttl).toBe(testTTL);
        expect(handle.metadata?.strategy).toBe('simple');

        // Verify lock exists
        const isLocked = await lock.isLocked(testKey);
        expect(isLocked).toBe(true);

        // Release lock
        const released = await lock.release(handle);
        expect(released).toBe(true);

        // Verify lock is gone
        const stillLocked = await lock.isLocked(testKey);
        expect(stillLocked).toBe(false);
      });

      it('should prevent concurrent lock acquisition', async () => {
        const lock1 = new SimpleLock({
          adapter,
          key: testKey,
          ttl: testTTL,
          retryAttempts: 1,
          retryDelay: 50,
        });

        const lock2 = new SimpleLock({
          adapter,
          key: testKey,
          ttl: testTTL,
          retryAttempts: 1,
          retryDelay: 50,
        });

        // First lock should succeed
        const handle1 = await lock1.acquire();
        expect(handle1).toBeDefined();

        // Second lock should fail
        await expect(lock2.acquire()).rejects.toThrow('Failed to acquire lock');

        // Release first lock
        await lock1.release(handle1);

        // Now second lock should succeed
        const handle2 = await lock2.acquire();
        expect(handle2).toBeDefined();
        await lock2.release(handle2);
      });

      it('should respect TTL and auto-expire locks', async () => {
        const shortTTL = 100; // 100ms
        const lock = new SimpleLock({
          adapter,
          key: testKey,
          ttl: shortTTL,
        });

        // Acquire lock with short TTL
        const handle = await lock.acquire();
        expect(handle).toBeDefined();

        // Verify lock exists
        let isLocked = await lock.isLocked(testKey);
        expect(isLocked).toBe(true);

        // Wait for TTL to expire
        await new Promise(resolve => setTimeout(resolve, shortTTL + 50));

        // Lock should be expired
        isLocked = await lock.isLocked(testKey);
        expect(isLocked).toBe(false);
      });

      it('should retry acquisition with configurable attempts', async () => {
        const lock1 = new SimpleLock({
          adapter,
          key: testKey,
          ttl: 200, // Short TTL so it expires during retries
        });

        const lock2 = new SimpleLock({
          adapter,
          key: testKey,
          ttl: testTTL,
          retryAttempts: 5,
          retryDelay: 100,
        });

        // First lock acquires
        await lock1.acquire();

        // Second lock should eventually succeed after first expires
        const startTime = Date.now();
        const handle2 = await lock2.acquire();
        const duration = Date.now() - startTime;

        expect(handle2).toBeDefined();
        expect(duration).toBeGreaterThan(100); // Should have waited for retries
        expect(handle2.metadata?.attempts).toBeGreaterThan(1);

        await lock2.release(handle2);
      });
    });

    describe('lock extension', () => {
      it('should extend lock TTL successfully', async () => {
        const lock = new SimpleLock({
          adapter,
          key: testKey,
          ttl: 200, // Short initial TTL
        });

        const handle = await lock.acquire();

        // Extend the lock
        const extended = await lock.extend(handle, 5000);
        expect(extended).toBe(true);

        // Lock should still exist after original TTL
        await new Promise(resolve => setTimeout(resolve, 300));
        const stillLocked = await lock.isLocked(testKey);
        expect(stillLocked).toBe(true);

        await lock.release(handle);
      });

      it('should fail to extend expired lock', async () => {
        const lock = new SimpleLock({
          adapter,
          key: testKey,
          ttl: 100, // Very short TTL
        });

        const handle = await lock.acquire();

        // Wait for lock to expire
        await new Promise(resolve => setTimeout(resolve, 150));

        // Try to extend expired lock
        const extended = await lock.extend(handle, 5000);
        expect(extended).toBe(false);
      });

      it('should fail to extend lock with wrong handle', async () => {
        const lock1 = new SimpleLock({ adapter, key: testKey, ttl: testTTL });
        const lock2 = new SimpleLock({ adapter, key: testKey, ttl: testTTL });

        const handle1 = await lock1.acquire();

        // Create fake handle with wrong value
        const fakeHandle = { ...handle1, value: 'wrong-value' };

        const extended = await lock2.extend(fakeHandle, 5000);
        expect(extended).toBe(false);

        await lock1.release(handle1);
      });
    });

    describe('error handling', () => {
      it('should validate configuration', () => {
        expect(() => {
          new SimpleLock({
            adapter,
            key: '',
            ttl: testTTL,
          });
        }).toThrow('Lock key must be a non-empty string');

        expect(() => {
          new SimpleLock({
            adapter,
            key: testKey,
            ttl: -1,
          });
        }).toThrow('TTL must be a positive integer');

        expect(() => {
          new SimpleLock({
            adapter,
            key: testKey,
            ttl: testTTL,
            retryAttempts: -1,
          });
        }).toThrow('Retry attempts must be a non-negative integer');
      });

      it('should validate lock handle on release', async () => {
        const lock = new SimpleLock({ adapter, key: testKey, ttl: testTTL });

        await expect(lock.release(null as any)).rejects.toThrow('Lock handle is required');

        await expect(
          lock.release({
            id: 'test',
            key: 'wrong-key',
            value: 'test',
            acquiredAt: Date.now(),
            ttl: testTTL,
          })
        ).rejects.toThrow('does not match lock key');
      });

      it('should handle release of non-existent lock gracefully', async () => {
        const lock = new SimpleLock({ adapter, key: testKey, ttl: testTTL });

        const fakeHandle = {
          id: 'fake-id',
          key: testKey,
          value: 'fake-value',
          acquiredAt: Date.now(),
          ttl: testTTL,
        };

        const released = await lock.release(fakeHandle);
        expect(released).toBe(false);
      });
    });

    describe('factory function', () => {
      it('should create lock using createLock factory', async () => {
        const lock = createLock({
          adapter,
          key: testKey,
          ttl: testTTL,
          retryAttempts: 2,
        });

        expect(lock).toBeInstanceOf(SimpleLock);

        const handle = await lock.acquire();
        expect(handle).toBeDefined();

        const released = await lock.release(handle);
        expect(released).toBe(true);
      });

      it('should validate factory configuration', () => {
        expect(() => createLock(null as any)).toThrow('Lock configuration is required');

        expect(() =>
          createLock({
            adapter: null as any,
            key: testKey,
          })
        ).toThrow('Redis adapter is required');

        expect(() =>
          createLock({
            adapter,
            key: '',
          })
        ).toThrow('Lock key is required');
      });
    });

    describe('concurrent operations', () => {
      it('should handle multiple concurrent acquisitions correctly', async () => {
        const numConcurrent = 10;
        const locks = Array.from({ length: numConcurrent }, () =>
          createLock({
            adapter,
            key: testKey,
            ttl: testTTL,
            retryAttempts: 0, // No retries for this test
          })
        );

        // Try to acquire all locks concurrently
        const promises = locks.map(lock => lock.acquire().catch(() => null));
        const results = await Promise.all(promises);

        // Only one should succeed
        const successful = results.filter(result => result !== null);
        expect(successful).toHaveLength(1);

        // Release the successful lock
        if (successful[0]) {
          await locks[0].release(successful[0]);
        }
      });

      it('should handle rapid acquire/release cycles', async () => {
        const lock = createLock({ adapter, key: testKey, ttl: testTTL });

        // Perform rapid acquire/release cycles
        for (let i = 0; i < 5; i++) {
          const handle = await lock.acquire();
          const released = await lock.release(handle);
          expect(released).toBe(true);
        }
      });
    });
  });

  describe('cross-adapter compatibility', () => {
    it('should work with locks created by different adapters', async () => {
      const testKey = getTestKey();

      const nodeLock = createLock({
        adapter: nodeAdapter,
        key: testKey,
        ttl: testTTL,
      });

      const ioLock = createLock({
        adapter: ioAdapter,
        key: testKey,
        ttl: testTTL,
      });

      // Acquire with node-redis adapter
      const handle = await nodeLock.acquire();

      // Should be visible to ioredis adapter
      const isLocked = await ioLock.isLocked(testKey);
      expect(isLocked).toBe(true);

      // Release with node-redis adapter
      const released = await nodeLock.release(handle);
      expect(released).toBe(true);

      // Should no longer be visible to ioredis adapter
      const stillLocked = await ioLock.isLocked(testKey);
      expect(stillLocked).toBe(false);
    });
  });
});
