import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryAdapter } from '../../../src/adapters/MemoryAdapter.js';
import { SimpleLock } from '../../../src/locks/SimpleLock.js';
import { LeanSimpleLock } from '../../../src/locks/LeanSimpleLock.js';

describe('MemoryAdapter Integration', () => {
  let adapter: MemoryAdapter;

  beforeEach(() => {
    adapter = new MemoryAdapter();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe('with SimpleLock', () => {
    it('should acquire and release lock', async () => {
      const lock = new SimpleLock({
        adapter,
        key: 'test-lock',
        ttl: 5000,
      });

      const handle = await lock.acquire();
      expect(handle).toBeDefined();
      expect(handle.key).toBe('test-lock');
      expect(handle.value).toBeDefined();
      expect(handle.acquiredAt).toBeLessThanOrEqual(Date.now());

      // Lock should be visible in adapter
      const inspection = await adapter.inspect('test-lock');
      expect(inspection?.value).toBe(handle.value);

      await lock.release(handle);

      // Lock should be gone
      const afterRelease = await adapter.inspect('test-lock');
      expect(afterRelease).toBeNull();
    });

    it('should block second acquisition while lock held', async () => {
      const lock1 = new SimpleLock({ adapter, key: 'shared-resource', ttl: 5000 });
      const lock2 = new SimpleLock({
        adapter,
        key: 'shared-resource',
        ttl: 5000,
        retryAttempts: 1,
        retryDelay: 50,
      });

      const handle1 = await lock1.acquire();
      expect(handle1.value).toBeDefined();

      // Second lock should fail
      await expect(lock2.acquire()).rejects.toThrow();

      await lock1.release(handle1);

      // Now second lock should succeed
      const handle2 = await lock2.acquire();
      expect(handle2.value).toBeDefined();
      await lock2.release(handle2);
    });

    it('should work with using() auto-release pattern', async () => {
      const lock = new SimpleLock({ adapter, key: 'auto-release', ttl: 5000 });

      let executedCriticalSection = false;

      await lock.using(async () => {
        executedCriticalSection = true;

        // Lock should be held
        const inspection = await adapter.inspect('auto-release');
        expect(inspection).not.toBeNull();
      });

      expect(executedCriticalSection).toBe(true);

      // Lock should be released
      const afterUsing = await adapter.inspect('auto-release');
      expect(afterUsing).toBeNull();
    });

    it('should release lock on using() error', async () => {
      const lock = new SimpleLock({ adapter, key: 'error-release', ttl: 5000 });

      await expect(
        lock.using(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      // Lock should still be released
      const afterError = await adapter.inspect('error-release');
      expect(afterError).toBeNull();
    });
  });

  describe('with LeanSimpleLock', () => {
    it('should work with lean performance mode', async () => {
      const lock = new LeanSimpleLock({
        adapter,
        key: 'lean-lock',
        ttl: 5000,
      });

      const handle = await lock.acquire();
      expect(handle.value).toBeDefined();
      expect(handle.key).toBe('lean-lock');

      await lock.release(handle);

      const afterRelease = await adapter.inspect('lean-lock');
      expect(afterRelease).toBeNull();
    });
  });

  describe('inspect feature', () => {
    it('should inspect lock state during using()', async () => {
      const lock = new SimpleLock({ adapter, key: 'inspectable', ttl: 5000 });

      await lock.using(async () => {
        const inspection = await adapter.inspect('inspectable');

        expect(inspection).not.toBeNull();
        expect(inspection?.value).toBeDefined();
        expect(inspection?.ttl).toBeGreaterThan(0);
        expect(inspection?.ttl).toBeLessThanOrEqual(5000);
      });
    });

    it('should return null for non-existent lock', async () => {
      const result = await adapter.inspect('does-not-exist');
      expect(result).toBeNull();
    });
  });

  describe('batch operations', () => {
    it('should acquire batch locks and work with multiple SimpleLocks', async () => {
      // First acquire batch
      const result = await adapter.batchSetNX(
        ['batch1', 'batch2', 'batch3'],
        ['owner1', 'owner2', 'owner3'],
        5000
      );

      expect(result.success).toBe(true);

      // All keys should be locked
      expect(await adapter.inspect('batch1')).not.toBeNull();
      expect(await adapter.inspect('batch2')).not.toBeNull();
      expect(await adapter.inspect('batch3')).not.toBeNull();

      // SimpleLock should not be able to acquire any of these
      const lock = new SimpleLock({
        adapter,
        key: 'batch1',
        ttl: 5000,
        retryAttempts: 0,
      });

      await expect(lock.acquire()).rejects.toThrow();
    });
  });

  describe('TTL and expiration', () => {
    it('should allow acquisition after TTL expires', async () => {
      const lock = new SimpleLock({ adapter, key: 'expiring', ttl: 100 });

      const handle1 = await lock.acquire();
      expect(handle1.value).toBeDefined();

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should be able to acquire again (without releasing)
      const lock2 = new SimpleLock({ adapter, key: 'expiring', ttl: 5000 });
      const handle2 = await lock2.acquire();
      expect(handle2.value).toBeDefined();

      await lock2.release(handle2);
    });
  });
});
