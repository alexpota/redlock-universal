import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeanSimpleLock } from '../../../src/locks/LeanSimpleLock.js';
import {
  LockAcquisitionError,
  LockReleaseError,
  LockExtensionError,
} from '../../../src/types/errors.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';

describe('LeanSimpleLock Unit Tests', () => {
  let mockAdapter: RedisAdapter;
  let lock: LeanSimpleLock;

  beforeEach(() => {
    // Create mock adapter
    mockAdapter = {
      setNX: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      delIfMatch: vi.fn(),
      extendIfMatch: vi.fn(),
      ping: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
      disconnect: vi.fn(),
    };

    lock = new LeanSimpleLock({
      adapter: mockAdapter,
      key: 'test-lock',
      ttl: 5000,
    });
  });

  describe('constructor', () => {
    it('should create lock with minimal memory footprint', () => {
      expect(lock).toBeInstanceOf(LeanSimpleLock);
    });

    it('should use default values when not provided', () => {
      const minimalLock = new LeanSimpleLock({
        adapter: mockAdapter,
        key: 'minimal',
      });
      expect(minimalLock).toBeInstanceOf(LeanSimpleLock);
    });
  });

  describe('acquire', () => {
    it('should successfully acquire lock on first attempt', async () => {
      mockAdapter.setNX = vi.fn().mockResolvedValue('OK');

      const handle = await lock.acquire();

      expect(mockAdapter.setNX).toHaveBeenCalledWith('test-lock', expect.any(String), 5000);
      expect(handle).toMatchObject({
        id: expect.any(String),
        key: 'test-lock',
        value: expect.any(String),
        acquiredAt: expect.any(Number),
        ttl: 5000,
        metadata: {
          attempts: 1,
          acquisitionTime: expect.any(Number),
          strategy: 'simple',
        },
      });
    });

    it('should retry when lock is already held', async () => {
      mockAdapter.setNX = vi
        .fn()
        .mockResolvedValueOnce(null) // First attempt fails
        .mockResolvedValueOnce('OK'); // Second attempt succeeds

      const handle = await lock.acquire();

      expect(mockAdapter.setNX).toHaveBeenCalledTimes(2);
      expect(handle.metadata?.attempts).toBe(2);
    });

    it('should throw LockAcquisitionError after all retries fail', async () => {
      mockAdapter.setNX = vi.fn().mockResolvedValue(null);

      await expect(lock.acquire()).rejects.toThrow(LockAcquisitionError);
      expect(mockAdapter.setNX).toHaveBeenCalledTimes(4); // Initial + 3 retries (default)
    });

    it('should handle Redis errors during acquisition', async () => {
      const redisError = new Error('Redis connection failed');
      mockAdapter.setNX = vi.fn().mockRejectedValue(redisError);

      await expect(lock.acquire()).rejects.toThrow(LockAcquisitionError);
    });

    it('should generate unique lock values', async () => {
      mockAdapter.setNX = vi.fn().mockResolvedValue('OK');

      const handle1 = await lock.acquire();
      const handle2 = await lock.acquire();

      expect(handle1.value).not.toBe(handle2.value);
    });

    it('should include process.pid in lock value for uniqueness', async () => {
      mockAdapter.setNX = vi.fn().mockResolvedValue('OK');

      const handle = await lock.acquire();

      expect(handle.value).toContain(process.pid.toString());
    });
  });

  describe('release', () => {
    it('should successfully release lock', async () => {
      mockAdapter.delIfMatch = vi.fn().mockResolvedValue(true);

      const handle = {
        id: 'test-value',
        key: 'test-lock',
        value: 'test-value',
        acquiredAt: Date.now(),
        ttl: 5000,
      };

      const result = await lock.release(handle);

      expect(result).toBe(true);
      expect(mockAdapter.delIfMatch).toHaveBeenCalledWith('test-lock', 'test-value');
    });

    it('should return false when lock already released', async () => {
      mockAdapter.delIfMatch = vi.fn().mockResolvedValue(false);

      const handle = {
        id: 'test-value',
        key: 'test-lock',
        value: 'test-value',
        acquiredAt: Date.now(),
        ttl: 5000,
      };

      const result = await lock.release(handle);

      expect(result).toBe(false);
    });

    it('should throw LockReleaseError on Redis error', async () => {
      const redisError = new Error('Redis connection failed');
      mockAdapter.delIfMatch = vi.fn().mockRejectedValue(redisError);

      const handle = {
        id: 'test-value',
        key: 'test-lock',
        value: 'test-value',
        acquiredAt: Date.now(),
        ttl: 5000,
      };

      await expect(lock.release(handle)).rejects.toThrow(LockReleaseError);
    });
  });

  describe('extend', () => {
    it('should successfully extend lock TTL', async () => {
      mockAdapter.extendIfMatch = vi.fn().mockResolvedValue(true);

      const handle = {
        id: 'test-value',
        key: 'test-lock',
        value: 'test-value',
        acquiredAt: Date.now(),
        ttl: 5000,
      };

      const result = await lock.extend(handle, 10000);

      expect(result).toBe(true);
      expect(mockAdapter.extendIfMatch).toHaveBeenCalledWith('test-lock', 'test-value', 10000);
    });

    it('should return false when lock expired', async () => {
      mockAdapter.extendIfMatch = vi.fn().mockResolvedValue(false);

      const handle = {
        id: 'test-value',
        key: 'test-lock',
        value: 'test-value',
        acquiredAt: Date.now(),
        ttl: 5000,
      };

      const result = await lock.extend(handle, 10000);

      expect(result).toBe(false);
    });

    it('should throw LockExtensionError on Redis error', async () => {
      const redisError = new Error('Redis connection failed');
      mockAdapter.extendIfMatch = vi.fn().mockRejectedValue(redisError);

      const handle = {
        id: 'test-value',
        key: 'test-lock',
        value: 'test-value',
        acquiredAt: Date.now(),
        ttl: 5000,
      };

      await expect(lock.extend(handle, 10000)).rejects.toThrow(LockExtensionError);
    });
  });

  describe('isLocked', () => {
    it('should return true when key is locked', async () => {
      mockAdapter.get = vi.fn().mockResolvedValue('some-value');

      const result = await lock.isLocked('test-lock');

      expect(result).toBe(true);
      expect(mockAdapter.get).toHaveBeenCalledWith('test-lock');
    });

    it('should return false when key is not locked', async () => {
      mockAdapter.get = vi.fn().mockResolvedValue(null);

      const result = await lock.isLocked('test-lock');

      expect(result).toBe(false);
    });

    it('should return false on Redis error', async () => {
      mockAdapter.get = vi.fn().mockRejectedValue(new Error('Redis error'));

      const result = await lock.isLocked('test-lock');

      expect(result).toBe(false);
    });
  });

  describe('memory optimization', () => {
    it('should use minimal object creation during acquire', async () => {
      mockAdapter.setNX = vi.fn().mockResolvedValue('OK');

      const handle = await lock.acquire();

      // Verify handle has only essential properties
      const expectedKeys = ['id', 'key', 'value', 'acquiredAt', 'ttl', 'metadata'];
      expect(Object.keys(handle)).toEqual(expectedKeys);

      // Verify metadata has only essential properties
      expect(Object.keys(handle.metadata!)).toEqual(['attempts', 'acquisitionTime', 'strategy']);
    });
  });
});
