import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createLock,
  createLocks,
  createPrefixedLock,
  createRedlock,
  createRedlocks,
  type CreateLockConfig,
  type CreateRedlockConfig,
} from '../../src/factory.js';
import { SimpleLock } from '../../src/locks/SimpleLock.js';
import { LeanSimpleLock } from '../../src/locks/LeanSimpleLock.js';
import { RedLock } from '../../src/locks/RedLock.js';
import { ConfigurationError } from '../../src/types/errors.js';
import type { RedisAdapter, AtomicExtensionResult } from '../../src/types/adapters.js';

describe('Factory Functions', () => {
  let mockAdapter: RedisAdapter;

  beforeEach(() => {
    mockAdapter = {
      setNX: vi.fn(),
      del: vi.fn(),
      get: vi.fn(),
      delIfMatch: vi.fn(),
      extendIfMatch: vi.fn(),
      atomicExtend: vi.fn().mockResolvedValue({
        resultCode: 1,
        actualTTL: 5000,
        message: 'Extended successfully',
      } as AtomicExtensionResult),
      ping: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
      disconnect: vi.fn(),
    };
  });

  describe('createLock', () => {
    it('should create a standard SimpleLock by default', () => {
      const config: CreateLockConfig = {
        adapter: mockAdapter,
        key: 'test-key',
      };

      const lock = createLock(config);
      expect(lock).toBeInstanceOf(SimpleLock);
    });

    it('should create a LeanSimpleLock when performance is lean', () => {
      const config: CreateLockConfig = {
        adapter: mockAdapter,
        key: 'test-key',
        performance: 'lean',
      };

      const lock = createLock(config);
      expect(lock).toBeInstanceOf(LeanSimpleLock);
    });

    it('should create a SimpleLock when performance is standard', () => {
      const config: CreateLockConfig = {
        adapter: mockAdapter,
        key: 'test-key',
        performance: 'standard',
      };

      const lock = createLock(config);
      expect(lock).toBeInstanceOf(SimpleLock);
    });

    it('should create a SimpleLock when performance is enterprise', () => {
      const config: CreateLockConfig = {
        adapter: mockAdapter,
        key: 'test-key',
        performance: 'enterprise',
      };

      const lock = createLock(config);
      expect(lock).toBeInstanceOf(SimpleLock);
    });

    it('should pass all configuration options', () => {
      const config: CreateLockConfig = {
        adapter: mockAdapter,
        key: 'test-key',
        ttl: 15000,
        retryAttempts: 5,
        retryDelay: 200,
      };

      const lock = createLock(config);
      expect(lock).toBeInstanceOf(SimpleLock);
    });

    it('should throw error when config is missing', () => {
      expect(() => createLock(null as any)).toThrow(ConfigurationError);
      expect(() => createLock(null as any)).toThrow('Lock configuration is required');
    });

    it('should throw error when adapter is missing', () => {
      const config = {
        key: 'test-key',
      } as any;

      expect(() => createLock(config)).toThrow(ConfigurationError);
      expect(() => createLock(config)).toThrow('Redis adapter is required');
    });

    it('should throw error when key is missing', () => {
      const config = {
        adapter: mockAdapter,
      } as any;

      expect(() => createLock(config)).toThrow(ConfigurationError);
      expect(() => createLock(config)).toThrow('Lock key is required');
    });

    it('should throw error when key is empty string', () => {
      const config: CreateLockConfig = {
        adapter: mockAdapter,
        key: '',
      };

      expect(() => createLock(config)).toThrow(ConfigurationError);
      expect(() => createLock(config)).toThrow('Lock key is required');
    });
  });

  describe('createLocks', () => {
    it('should create multiple locks with shared configuration', () => {
      const keys = ['key1', 'key2', 'key3'];
      const options = {
        ttl: 15000,
        retryAttempts: 5,
      };

      const locks = createLocks(mockAdapter, keys, options);

      expect(locks).toHaveLength(3);
      locks.forEach(lock => {
        expect(lock).toBeInstanceOf(SimpleLock);
      });
    });

    it('should create locks with default options when none provided', () => {
      const keys = ['key1', 'key2'];
      const locks = createLocks(mockAdapter, keys);

      expect(locks).toHaveLength(2);
      locks.forEach(lock => {
        expect(lock).toBeInstanceOf(SimpleLock);
      });
    });

    it('should create lean locks when performance mode specified', () => {
      const keys = ['key1', 'key2'];
      const options = { performance: 'lean' as const };

      const locks = createLocks(mockAdapter, keys, options);

      expect(locks).toHaveLength(2);
      locks.forEach(lock => {
        expect(lock).toBeInstanceOf(LeanSimpleLock);
      });
    });

    it('should throw error when adapter is missing', () => {
      const keys = ['key1', 'key2'];

      expect(() => createLocks(null as any, keys)).toThrow(ConfigurationError);
      expect(() => createLocks(null as any, keys)).toThrow('Redis adapter is required');
    });

    it('should throw error when keys array is empty', () => {
      expect(() => createLocks(mockAdapter, [])).toThrow(ConfigurationError);
      expect(() => createLocks(mockAdapter, [])).toThrow('At least one lock key is required');
    });

    it('should throw error when keys is null', () => {
      expect(() => createLocks(mockAdapter, null as any)).toThrow(ConfigurationError);
      expect(() => createLocks(mockAdapter, null as any)).toThrow(
        'At least one lock key is required'
      );
    });
  });

  describe('createPrefixedLock', () => {
    it('should create lock with prefixed key', () => {
      const lock = createPrefixedLock(mockAdapter, 'locks:', 'user-update', {
        ttl: 10000,
      });

      expect(lock).toBeInstanceOf(SimpleLock);
    });

    it('should create lean lock when performance mode specified', () => {
      const lock = createPrefixedLock(mockAdapter, 'locks:', 'user-update', {
        performance: 'lean',
      });

      expect(lock).toBeInstanceOf(LeanSimpleLock);
    });

    it('should throw error when prefix is missing', () => {
      expect(() => createPrefixedLock(mockAdapter, '', 'key')).toThrow(ConfigurationError);
      expect(() => createPrefixedLock(mockAdapter, '', 'key')).toThrow(
        'Both prefix and key are required'
      );
    });

    it('should throw error when key is missing', () => {
      expect(() => createPrefixedLock(mockAdapter, 'prefix:', '')).toThrow(ConfigurationError);
      expect(() => createPrefixedLock(mockAdapter, 'prefix:', '')).toThrow(
        'Both prefix and key are required'
      );
    });

    it('should throw error when both prefix and key are missing', () => {
      expect(() => createPrefixedLock(mockAdapter, '', '')).toThrow(ConfigurationError);
      expect(() => createPrefixedLock(mockAdapter, '', '')).toThrow(
        'Both prefix and key are required'
      );
    });
  });

  describe('createRedlock', () => {
    let mockAdapters: RedisAdapter[];

    beforeEach(() => {
      mockAdapters = [{ ...mockAdapter }, { ...mockAdapter }, { ...mockAdapter }] as RedisAdapter[];
    });

    it('should create a RedLock instance', () => {
      const config: CreateRedlockConfig = {
        adapters: mockAdapters,
        key: 'distributed-key',
      };

      const lock = createRedlock(config);
      expect(lock).toBeInstanceOf(RedLock);
    });

    it('should pass all configuration options', () => {
      const config: CreateRedlockConfig = {
        adapters: mockAdapters,
        key: 'distributed-key',
        ttl: 25000,
        quorum: 2,
        retryAttempts: 4,
        retryDelay: 150,
        clockDriftFactor: 0.02,
      };

      const lock = createRedlock(config);
      expect(lock).toBeInstanceOf(RedLock);
    });

    it('should throw error when config is missing', () => {
      expect(() => createRedlock(null as any)).toThrow(ConfigurationError);
      expect(() => createRedlock(null as any)).toThrow('RedLock configuration is required');
    });

    it('should throw error when adapters array is empty', () => {
      const config: CreateRedlockConfig = {
        adapters: [],
        key: 'test-key',
      };

      expect(() => createRedlock(config)).toThrow(ConfigurationError);
      expect(() => createRedlock(config)).toThrow(
        'At least one Redis adapter is required for RedLock'
      );
    });

    it('should throw error when adapters is missing', () => {
      const config = {
        key: 'test-key',
      } as any;

      expect(() => createRedlock(config)).toThrow(ConfigurationError);
      expect(() => createRedlock(config)).toThrow(
        'At least one Redis adapter is required for RedLock'
      );
    });

    it('should throw error when key is missing', () => {
      const config = {
        adapters: mockAdapters,
      } as any;

      expect(() => createRedlock(config)).toThrow(ConfigurationError);
      expect(() => createRedlock(config)).toThrow('Lock key is required');
    });

    it('should throw error when key is empty string', () => {
      const config: CreateRedlockConfig = {
        adapters: mockAdapters,
        key: '',
      };

      expect(() => createRedlock(config)).toThrow(ConfigurationError);
      expect(() => createRedlock(config)).toThrow('Lock key is required');
    });
  });

  describe('createRedlocks', () => {
    let mockAdapters: RedisAdapter[];

    beforeEach(() => {
      mockAdapters = [{ ...mockAdapter }, { ...mockAdapter }, { ...mockAdapter }] as RedisAdapter[];
    });

    it('should create multiple RedLocks with shared configuration', () => {
      const keys = ['resource1', 'resource2', 'resource3'];
      const options = {
        ttl: 20000,
        quorum: 2,
        retryAttempts: 5,
      };

      const locks = createRedlocks(mockAdapters, keys, options);

      expect(locks).toHaveLength(3);
      locks.forEach(lock => {
        expect(lock).toBeInstanceOf(RedLock);
      });
    });

    it('should create RedLocks with default options when none provided', () => {
      const keys = ['resource1', 'resource2'];
      const locks = createRedlocks(mockAdapters, keys);

      expect(locks).toHaveLength(2);
      locks.forEach(lock => {
        expect(lock).toBeInstanceOf(RedLock);
      });
    });

    it('should throw error when adapters array is empty', () => {
      const keys = ['resource1', 'resource2'];

      expect(() => createRedlocks([], keys)).toThrow(ConfigurationError);
      expect(() => createRedlocks([], keys)).toThrow('At least one Redis adapter is required');
    });

    it('should throw error when adapters is null', () => {
      const keys = ['resource1', 'resource2'];

      expect(() => createRedlocks(null as any, keys)).toThrow(ConfigurationError);
      expect(() => createRedlocks(null as any, keys)).toThrow(
        'At least one Redis adapter is required'
      );
    });

    it('should throw error when keys array is empty', () => {
      expect(() => createRedlocks(mockAdapters, [])).toThrow(ConfigurationError);
      expect(() => createRedlocks(mockAdapters, [])).toThrow('At least one lock key is required');
    });

    it('should throw error when keys is null', () => {
      expect(() => createRedlocks(mockAdapters, null as any)).toThrow(ConfigurationError);
      expect(() => createRedlocks(mockAdapters, null as any)).toThrow(
        'At least one lock key is required'
      );
    });
  });
});
