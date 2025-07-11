import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SimpleLock } from '../../../src/locks/SimpleLock.js';
import {
  LockAcquisitionError,
  LockReleaseError,
  LockExtensionError,
} from '../../../src/types/errors.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';

describe('SimpleLock Unit Tests', () => {
  let mockAdapter: RedisAdapter;
  let lock: SimpleLock;

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

    lock = new SimpleLock({
      adapter: mockAdapter,
      key: 'test-lock',
      ttl: 5000,
    });
  });

  describe('constructor', () => {
    it('should create lock with default values', () => {
      const config = lock.getConfig();

      expect(config.key).toBe('test-lock');
      expect(config.ttl).toBe(5000);
      expect(config.retryAttempts).toBe(3);
      expect(config.retryDelay).toBe(100);
    });

    it('should validate required configuration', () => {
      expect(
        () =>
          new SimpleLock({
            adapter: mockAdapter,
            key: '',
            ttl: 5000,
          })
      ).toThrow('Lock key must be a non-empty string');

      expect(
        () =>
          new SimpleLock({
            adapter: mockAdapter,
            key: 'test',
            ttl: 0,
          })
      ).toThrow('TTL must be a positive integer');

      expect(
        () =>
          new SimpleLock({
            adapter: mockAdapter,
            key: 'test',
            ttl: 5000,
            retryAttempts: -1,
          })
      ).toThrow('Retry attempts must be a non-negative integer');
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

    it('should throw LockAcquisitionError after max retries', async () => {
      mockAdapter.setNX = vi.fn().mockResolvedValue(null);

      await expect(lock.acquire()).rejects.toThrow(LockAcquisitionError);
      expect(mockAdapter.setNX).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });

    it('should handle Redis errors', async () => {
      mockAdapter.setNX = vi.fn().mockRejectedValue(new Error('Redis connection failed'));

      await expect(lock.acquire()).rejects.toThrow(LockAcquisitionError);
    });
  });

  describe('release', () => {
    it('should successfully release lock', async () => {
      mockAdapter.delIfMatch = vi.fn().mockResolvedValue(true);

      const handle = {
        id: 'test-id',
        key: 'test-lock',
        value: 'test-value',
        acquiredAt: Date.now(),
        ttl: 5000,
        metadata: { attempts: 1, acquisitionTime: 10, strategy: 'simple' as const },
      };

      const result = await lock.release(handle);

      expect(mockAdapter.delIfMatch).toHaveBeenCalledWith('test-lock', 'test-value');
      expect(result).toBe(true);
    });

    it('should return false when lock was already released', async () => {
      mockAdapter.delIfMatch = vi.fn().mockResolvedValue(false);

      const handle = {
        id: 'test-id',
        key: 'test-lock',
        value: 'test-value',
        acquiredAt: Date.now(),
        ttl: 5000,
        metadata: { attempts: 1, acquisitionTime: 10, strategy: 'simple' as const },
      };

      const result = await lock.release(handle);

      expect(result).toBe(false);
    });

    it('should validate lock handle', async () => {
      await expect(lock.release(null as any)).rejects.toThrow('Lock handle is required');

      await expect(
        lock.release({
          id: 'test-id',
          key: 'wrong-key',
          value: 'test-value',
          acquiredAt: Date.now(),
          ttl: 5000,
          metadata: { attempts: 1, acquisitionTime: 10, strategy: 'simple' as const },
        })
      ).rejects.toThrow('Lock handle key "wrong-key" does not match lock key "test-lock"');
    });

    it('should handle Redis errors', async () => {
      mockAdapter.delIfMatch = vi.fn().mockRejectedValue(new Error('Redis error'));

      const handle = {
        id: 'test-id',
        key: 'test-lock',
        value: 'test-value',
        acquiredAt: Date.now(),
        ttl: 5000,
        metadata: { attempts: 1, acquisitionTime: 10, strategy: 'simple' as const },
      };

      await expect(lock.release(handle)).rejects.toThrow(LockReleaseError);
    });
  });

  describe('extend', () => {
    it('should successfully extend lock TTL', async () => {
      mockAdapter.extendIfMatch = vi.fn().mockResolvedValue(true);

      const handle = {
        id: 'test-id',
        key: 'test-lock',
        value: 'test-value',
        acquiredAt: Date.now(),
        ttl: 5000,
        metadata: { attempts: 1, acquisitionTime: 10, strategy: 'simple' as const },
      };

      const result = await lock.extend(handle, 10000);

      expect(mockAdapter.extendIfMatch).toHaveBeenCalledWith('test-lock', 'test-value', 10000);
      expect(result).toBe(true);
    });

    it('should return false when lock value does not match', async () => {
      mockAdapter.extendIfMatch = vi.fn().mockResolvedValue(false);

      const handle = {
        id: 'test-id',
        key: 'test-lock',
        value: 'old-value',
        acquiredAt: Date.now(),
        ttl: 5000,
        metadata: { attempts: 1, acquisitionTime: 10, strategy: 'simple' as const },
      };

      const result = await lock.extend(handle, 10000);

      expect(result).toBe(false);
    });

    it('should validate TTL value', async () => {
      const handle = {
        id: 'test-id',
        key: 'test-lock',
        value: 'test-value',
        acquiredAt: Date.now(),
        ttl: 5000,
        metadata: { attempts: 1, acquisitionTime: 10, strategy: 'simple' as const },
      };

      await expect(lock.extend(handle, 0)).rejects.toThrow('TTL must be a positive integer');
      await expect(lock.extend(handle, -1000)).rejects.toThrow('TTL must be a positive integer');
      await expect(lock.extend(handle, 1.5)).rejects.toThrow('TTL must be a positive integer');
    });

    it('should handle Redis errors', async () => {
      mockAdapter.extendIfMatch = vi.fn().mockRejectedValue(new Error('Redis error'));

      const handle = {
        id: 'test-id',
        key: 'test-lock',
        value: 'test-value',
        acquiredAt: Date.now(),
        ttl: 5000,
        metadata: { attempts: 1, acquisitionTime: 10, strategy: 'simple' as const },
      };

      await expect(lock.extend(handle, 10000)).rejects.toThrow(LockExtensionError);
    });
  });

  describe('isLocked', () => {
    it('should return true when key exists', async () => {
      mockAdapter.get = vi.fn().mockResolvedValue('some-value');

      const result = await lock.isLocked('test-key');

      expect(mockAdapter.get).toHaveBeenCalledWith('test-key');
      expect(result).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      mockAdapter.get = vi.fn().mockResolvedValue(null);

      const result = await lock.isLocked('test-key');

      expect(result).toBe(false);
    });

    it('should return false on Redis errors', async () => {
      mockAdapter.get = vi.fn().mockRejectedValue(new Error('Redis error'));

      const result = await lock.isLocked('test-key');

      expect(result).toBe(false);
    });
  });

  describe('configuration access', () => {
    it('should provide read-only access to configuration', () => {
      const config = lock.getConfig();

      expect(config).toEqual({
        adapter: mockAdapter,
        key: 'test-lock',
        ttl: 5000,
        retryAttempts: 3,
        retryDelay: 100,
      });

      // Ensure it's a copy, not reference
      config.ttl = 99999;
      expect(lock.getConfig().ttl).toBe(5000);
    });

    it('should provide access to underlying adapter', () => {
      const adapter = lock.getAdapter();
      expect(adapter).toBe(mockAdapter);
    });
  });
});
