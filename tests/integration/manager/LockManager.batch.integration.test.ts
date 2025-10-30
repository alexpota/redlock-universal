import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient as createNodeRedisClient } from 'redis';
import Redis from 'ioredis';
import { LockManager, NodeRedisAdapter, IoredisAdapter } from '../../../src/index.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';
import { TEST_CONFIG, generateTestKey, getRedisUrl } from '../../shared/constants.js';
import { LockAcquisitionError } from '../../../src/types/errors.js';

describe('LockManager Batch Acquisition Integration Tests', () => {
  let nodeRedisClient: any;
  let ioredisClient: Redis;
  let nodeAdapter: RedisAdapter;
  let ioAdapter: RedisAdapter;

  const testTTL = TEST_CONFIG.DEFAULT_TTL;

  beforeAll(async () => {
    // Setup node-redis client
    nodeRedisClient = createNodeRedisClient({
      url: getRedisUrl(),
    });
    await nodeRedisClient.connect();

    // Setup ioredis client
    ioredisClient = new Redis(getRedisUrl());

    // Create adapters
    nodeAdapter = new NodeRedisAdapter(nodeRedisClient);
    ioAdapter = new IoredisAdapter(ioredisClient);
  });

  afterAll(async () => {
    await nodeRedisClient?.disconnect();
    ioredisClient?.disconnect();
  });

  describe.each([
    ['NodeRedisAdapter', () => nodeAdapter],
    ['IoredisAdapter', () => ioAdapter],
  ])('%s', (adapterName, getAdapter) => {
    let adapter: RedisAdapter;
    let manager: LockManager;

    beforeEach(() => {
      adapter = getAdapter();
      manager = new LockManager({ nodes: [adapter], defaultTTL: testTTL });
    });

    describe('acquireBatch', () => {
      it('should acquire multiple locks atomically', async () => {
        const keys = [
          generateTestKey('batch-lock-1'),
          generateTestKey('batch-lock-2'),
          generateTestKey('batch-lock-3'),
        ];

        const handles = await manager.acquireBatch(keys);

        // Verify all handles created
        expect(handles).toHaveLength(3);

        for (let i = 0; i < handles.length; i++) {
          const handle = handles[i]!;
          expect(handle.key).toBe(keys.sort()[i]); // Keys are sorted internally
          expect(handle.value).toBeDefined();
          expect(handle.id).toBeDefined();
          expect(handle.ttl).toBe(testTTL);
          expect(handle.metadata?.strategy).toBe('simple');
        }

        // Verify all locks exist in Redis
        for (const handle of handles) {
          const value = await adapter.get(handle.key);
          expect(value).toBe(handle.value);
        }

        // Clean up
        await manager.releaseBatch(handles);
      });

      it('should fail atomically if any key is already locked', async () => {
        const keys = [
          generateTestKey('batch-lock-1'),
          generateTestKey('batch-lock-2'),
          generateTestKey('batch-lock-3'),
        ];

        // Pre-acquire one of the locks
        const blockingLock = await manager.acquireLock(keys[1]!);

        // Try to batch acquire (should fail)
        await expect(manager.acquireBatch(keys)).rejects.toThrow(LockAcquisitionError);

        // Verify none of the locks were acquired
        const values = await Promise.all(keys.map(key => adapter.get(key)));

        // Only the blocking lock should exist
        expect(values[0]).toBeNull(); // keys[0] not locked
        expect(values[1]).toBe(blockingLock.value); // keys[1] still locked by blockingLock
        expect(values[2]).toBeNull(); // keys[2] not locked

        // Clean up
        await manager.releaseLock(blockingLock);
      });

      it('should handle key sorting to prevent deadlocks', async () => {
        const keys = [generateTestKey('c-key'), generateTestKey('a-key'), generateTestKey('b-key')];

        const handles = await manager.acquireBatch(keys);

        // Verify keys were sorted
        const sortedKeys = [...keys].sort();
        for (let i = 0; i < handles.length; i++) {
          expect(handles[i]!.key).toBe(sortedKeys[i]);
        }

        await manager.releaseBatch(handles);
      });

      it('should reject empty key array', async () => {
        await expect(manager.acquireBatch([])).rejects.toThrow(
          'At least one key is required for batch acquisition'
        );
      });

      it('should respect custom TTL', async () => {
        const customTTL = 5000;
        const keys = [generateTestKey('batch-ttl-1'), generateTestKey('batch-ttl-2')];

        const handles = await manager.acquireBatch(keys, { ttl: customTTL });

        for (const handle of handles) {
          expect(handle.ttl).toBe(customTTL);
        }

        await manager.releaseBatch(handles);
      });

      it('should work with single key (edge case)', async () => {
        const keys = [generateTestKey('single-batch')];

        const handles = await manager.acquireBatch(keys);

        expect(handles).toHaveLength(1);
        expect(handles[0]!.key).toBe(keys[0]);

        await manager.releaseBatch(handles);
      });

      it('should handle large batch (10 locks)', async () => {
        const keys = Array.from({ length: 10 }, (_, i) => generateTestKey(`batch-large-${i}`));

        const startTime = Date.now();
        const handles = await manager.acquireBatch(keys);
        const duration = Date.now() - startTime;

        // Verify all acquired
        expect(handles).toHaveLength(10);

        // Verify performance - should be much faster than sequential
        // (single round-trip vs 10 round-trips)
        expect(duration).toBeLessThan(100); // Generous threshold

        // Verify stats updated correctly
        const stats = manager.getStats();
        expect(stats.acquiredLocks).toBeGreaterThanOrEqual(10);
        expect(stats.activeLocks).toBeGreaterThanOrEqual(10);

        await manager.releaseBatch(handles);
      });
    });

    describe('releaseBatch', () => {
      it('should release multiple locks', async () => {
        const keys = [
          generateTestKey('batch-release-1'),
          generateTestKey('batch-release-2'),
          generateTestKey('batch-release-3'),
        ];

        const handles = await manager.acquireBatch(keys);
        const results = await manager.releaseBatch(handles);

        // All should be successfully released
        expect(results).toHaveLength(3);
        expect(results.every(r => r === true)).toBe(true);

        // Verify all locks gone
        for (const handle of handles) {
          const value = await adapter.get(handle.key);
          expect(value).toBeNull();
        }
      });

      it('should return false for already released locks', async () => {
        const keys = [generateTestKey('batch-double-release')];

        const handles = await manager.acquireBatch(keys);

        // First release
        const firstRelease = await manager.releaseBatch(handles);
        expect(firstRelease[0]).toBe(true);

        // Second release (already released)
        const secondRelease = await manager.releaseBatch(handles);
        expect(secondRelease[0]).toBe(false);
      });

      it('should handle empty array', async () => {
        const results = await manager.releaseBatch([]);
        expect(results).toHaveLength(0);
      });
    });

    describe('stats tracking', () => {
      it('should correctly track batch acquisition stats', async () => {
        const keys = [
          generateTestKey('stats-1'),
          generateTestKey('stats-2'),
          generateTestKey('stats-3'),
        ];

        const beforeStats = manager.getStats();
        const beforeTotal = beforeStats.totalLocks;
        const beforeAcquired = beforeStats.acquiredLocks;

        await manager.acquireBatch(keys);

        const afterStats = manager.getStats();

        // Should increment by 3
        expect(afterStats.totalLocks).toBe(beforeTotal + 3);
        expect(afterStats.acquiredLocks).toBe(beforeAcquired + 3);
        expect(afterStats.activeLocks).toBe(beforeStats.activeLocks + 3);
      });

      it('should track failed batch acquisition', async () => {
        const keys = [generateTestKey('stats-fail-1'), generateTestKey('stats-fail-2')];

        // Pre-lock one key
        const blocker = await manager.acquireLock(keys[0]!);

        const beforeStats = manager.getStats();
        const beforeFailed = beforeStats.failedLocks;

        try {
          await manager.acquireBatch(keys);
        } catch {
          // Expected to fail
        }

        const afterStats = manager.getStats();

        // Failed count should increase by 2 (all keys in batch)
        expect(afterStats.failedLocks).toBe(beforeFailed + 2);

        await manager.releaseLock(blocker);
      });
    });

    describe('prefix handling', () => {
      it('should show unprefixed key in error messages when using keyPrefix', async () => {
        // Create adapter with prefix
        const prefixedAdapter =
          adapterName === 'NodeRedisAdapter'
            ? new NodeRedisAdapter(nodeRedisClient, { keyPrefix: 'test-prefix:' })
            : new IoredisAdapter(ioredisClient, { keyPrefix: 'test-prefix:' });

        const prefixedManager = new LockManager({ nodes: [prefixedAdapter], defaultTTL: testTTL });

        const keys = [generateTestKey('prefix-test-1'), generateTestKey('prefix-test-2')];

        // Pre-lock one key directly (with prefix)
        await prefixedAdapter.setNX(keys[0]!, 'blocker', testTTL);

        try {
          await prefixedManager.acquireBatch(keys);
          expect.fail('Should have thrown LockAcquisitionError');
        } catch (error) {
          expect(error).toBeInstanceOf(LockAcquisitionError);
          // Error should show unprefixed key (user-facing)
          expect((error as LockAcquisitionError).key).toBe(keys[0]);
          expect((error as LockAcquisitionError).message).toContain(keys[0]!);
          // Should NOT contain the prefix
          expect((error as LockAcquisitionError).message).not.toContain('test-prefix:');
        }

        // Cleanup
        await prefixedAdapter.del(keys[0]!);
      });
    });

    describe('release resilience', () => {
      it('should attempt all releases even if some fail', async () => {
        const keys = [
          generateTestKey('resilient-1'),
          generateTestKey('resilient-2'),
          generateTestKey('resilient-3'),
        ];

        const handles = await manager.acquireBatch(keys);

        // Manually delete middle lock to cause release failure
        await adapter.del(handles[1]!.key);

        const results = await manager.releaseBatch(handles);

        // Should have attempted all three releases
        expect(results).toHaveLength(3);

        // First and third should succeed, middle should fail (already deleted)
        expect(results[0]).toBe(true); // Success
        expect(results[1]).toBe(false); // Failed (already deleted)
        expect(results[2]).toBe(true); // Success

        // Verify locks are gone (for successful releases)
        const value1 = await adapter.get(handles[0]!.key);
        const value2 = await adapter.get(handles[1]!.key);
        const value3 = await adapter.get(handles[2]!.key);

        expect(value1).toBeNull();
        expect(value2).toBeNull(); // Was already deleted
        expect(value3).toBeNull();
      });
    });
  });
});
