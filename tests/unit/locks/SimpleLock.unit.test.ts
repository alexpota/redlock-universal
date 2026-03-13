import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SimpleLock } from '../../../src/locks/SimpleLock.js';
import {
  LockAcquisitionError,
  LockReleaseError,
  LockExtensionError,
} from '../../../src/types/errors.js';
import type { RedisAdapter, AtomicExtensionResult } from '../../../src/types/adapters.js';
import { TEST_CONFIG } from '../../shared/constants.js';

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
      atomicExtend: vi.fn().mockResolvedValue({
        resultCode: 1,
        actualTTL: 5000,
        message: 'Extended successfully',
      } as AtomicExtensionResult),
      ping: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
      disconnect: vi.fn(),
    };

    lock = new SimpleLock({
      adapter: mockAdapter,
      key: 'test-lock',
      ttl: TEST_CONFIG.DEFAULT_TTL,
    });
  });

  describe('constructor', () => {
    it('should create lock with default values', () => {
      const config = lock.getConfig();

      expect(config.key).toBe('test-lock');
      expect(config.ttl).toBe(TEST_CONFIG.DEFAULT_TTL);
      expect(config.retryAttempts).toBe(3);
      expect(config.retryDelay).toBe(TEST_CONFIG.DEFAULT_RETRY_DELAY);
    });

    it('should validate required configuration', () => {
      expect(
        () =>
          new SimpleLock({
            adapter: mockAdapter,
            key: '',
            ttl: TEST_CONFIG.DEFAULT_TTL,
          })
      ).toThrow('Lock key must be a non-empty string');

      expect(
        () =>
          new SimpleLock({
            adapter: mockAdapter,
            key: 'test',
            ttl: TEST_CONFIG.ZERO_TTL,
          })
      ).toThrow('TTL must be a positive integer');

      expect(
        () =>
          new SimpleLock({
            adapter: mockAdapter,
            key: 'test',
            ttl: TEST_CONFIG.DEFAULT_TTL,
            retryAttempts: TEST_CONFIG.INVALID_RETRY_ATTEMPTS,
          })
      ).toThrow('Retry attempts must be a non-negative integer');
    });
  });

  describe('acquire', () => {
    it('should successfully acquire lock on first attempt', async () => {
      mockAdapter.setNX = vi.fn().mockResolvedValue('OK');

      const handle = await lock.acquire();

      expect(mockAdapter.setNX).toHaveBeenCalledWith(
        'test-lock',
        expect.any(String),
        TEST_CONFIG.DEFAULT_TTL
      );
      expect(handle).toMatchObject({
        id: expect.any(String),
        key: 'test-lock',
        value: expect.any(String),
        acquiredAt: expect.any(Number),
        ttl: TEST_CONFIG.DEFAULT_TTL,
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
        ttl: TEST_CONFIG.DEFAULT_TTL,
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
        ttl: TEST_CONFIG.DEFAULT_TTL,
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
          ttl: TEST_CONFIG.DEFAULT_TTL,
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
        ttl: TEST_CONFIG.DEFAULT_TTL,
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
        ttl: TEST_CONFIG.DEFAULT_TTL,
        metadata: { attempts: 1, acquisitionTime: 10, strategy: 'simple' as const },
      };

      const result = await lock.extend(handle, TEST_CONFIG.UNIT_EXTENDED_TTL);

      expect(mockAdapter.extendIfMatch).toHaveBeenCalledWith(
        'test-lock',
        'test-value',
        TEST_CONFIG.UNIT_EXTENDED_TTL
      );
      expect(result).toBe(true);
    });

    it('should return false when lock value does not match', async () => {
      mockAdapter.extendIfMatch = vi.fn().mockResolvedValue(false);

      const handle = {
        id: 'test-id',
        key: 'test-lock',
        value: 'old-value',
        acquiredAt: Date.now(),
        ttl: TEST_CONFIG.DEFAULT_TTL,
        metadata: { attempts: 1, acquisitionTime: 10, strategy: 'simple' as const },
      };

      const result = await lock.extend(handle, TEST_CONFIG.UNIT_EXTENDED_TTL);

      expect(result).toBe(false);
    });

    it('should validate TTL value', async () => {
      const handle = {
        id: 'test-id',
        key: 'test-lock',
        value: 'test-value',
        acquiredAt: Date.now(),
        ttl: TEST_CONFIG.DEFAULT_TTL,
        metadata: { attempts: 1, acquisitionTime: 10, strategy: 'simple' as const },
      };

      await expect(lock.extend(handle, 0)).rejects.toThrow('TTL must be a positive integer');
      await expect(lock.extend(handle, TEST_CONFIG.INVALID_TTL)).rejects.toThrow(
        'TTL must be a positive integer'
      );
      await expect(lock.extend(handle, 1.5)).rejects.toThrow('TTL must be a positive integer');
    });

    it('should handle Redis errors', async () => {
      mockAdapter.extendIfMatch = vi.fn().mockRejectedValue(new Error('Redis error'));

      const handle = {
        id: 'test-id',
        key: 'test-lock',
        value: 'test-value',
        acquiredAt: Date.now(),
        ttl: TEST_CONFIG.DEFAULT_TTL,
        metadata: { attempts: 1, acquisitionTime: 10, strategy: 'simple' as const },
      };

      await expect(lock.extend(handle, TEST_CONFIG.UNIT_EXTENDED_TTL)).rejects.toThrow(
        LockExtensionError
      );
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
        ttl: TEST_CONFIG.DEFAULT_TTL,
        retryAttempts: TEST_CONFIG.UNIT_DEFAULT_RETRY_ATTEMPTS,
        retryDelay: TEST_CONFIG.DEFAULT_RETRY_DELAY,
      });

      // Ensure it's read-only and cannot be modified
      expect(() => {
        (config as any).ttl = 99999;
      }).toThrow();
      expect(lock.getConfig().ttl).toBe(TEST_CONFIG.DEFAULT_TTL);
    });

    it('should provide access to underlying adapter', () => {
      const adapter = lock.getAdapter();
      expect(adapter).toBe(mockAdapter);
    });
  });

  describe('using() API', () => {
    describe('basic functionality', () => {
      it('should execute routine successfully and release lock', async () => {
        // Mock successful lock acquisition
        mockAdapter.setNX = vi.fn().mockResolvedValue('OK');
        mockAdapter.delIfMatch = vi.fn().mockResolvedValue(true);

        const mockRoutine = vi.fn().mockResolvedValue('success');

        const result = await lock.using(mockRoutine);

        expect(result).toBe('success');
        expect(mockRoutine).toHaveBeenCalledWith(
          expect.objectContaining({
            aborted: false,
          })
        );
        expect(mockAdapter.delIfMatch).toHaveBeenCalledWith('test-lock', expect.any(String));
      });

      it('should provide AbortSignal with error property to routine', async () => {
        mockAdapter.setNX = vi.fn().mockResolvedValue('OK');
        mockAdapter.delIfMatch = vi.fn().mockResolvedValue(true);

        const mockRoutine = vi.fn().mockImplementation(signal => {
          expect(signal).toHaveProperty('aborted');
          expect(signal).toHaveProperty('error');
          expect(typeof signal.addEventListener).toBe('function');
          return Promise.resolve('done');
        });

        await lock.using(mockRoutine);

        expect(mockRoutine).toHaveBeenCalled();
      });

      it('should clean up even if routine throws error', async () => {
        mockAdapter.setNX = vi.fn().mockResolvedValue('OK');
        mockAdapter.delIfMatch = vi.fn().mockResolvedValue(true);

        const mockRoutine = vi.fn().mockRejectedValue(new Error('routine error'));

        await expect(lock.using(mockRoutine)).rejects.toThrow('routine error');
        expect(mockAdapter.delIfMatch).toHaveBeenCalled();
      });

      it('should handle lock acquisition failure', async () => {
        mockAdapter.setNX = vi.fn().mockRejectedValue(new Error('Redis connection failed'));

        const mockRoutine = vi.fn();

        await expect(lock.using(mockRoutine)).rejects.toThrow();
        expect(mockRoutine).not.toHaveBeenCalled();
      });
    });

    // Note: Auto-extension functionality is thoroughly tested in integration tests
    // Timer-based unit tests are omitted here to avoid memory issues with fake timers

    describe('cleanup and error handling', () => {
      it('should still release lock even if release fails', async () => {
        mockAdapter.setNX = vi.fn().mockResolvedValue('OK');
        mockAdapter.delIfMatch = vi.fn().mockRejectedValue(new Error('Release failed'));

        const mockRoutine = vi.fn().mockResolvedValue('success');

        // Should not throw even if release fails
        const result = await lock.using(mockRoutine);

        expect(result).toBe('success');
        // Verify routine was executed despite release failure
        expect(mockRoutine).toHaveBeenCalled();
        // Verify release was attempted
        expect(mockAdapter.delIfMatch).toHaveBeenCalled();
      });
    });

    // Performance and timing tests are covered in integration tests

    describe('AbortSignal integration', () => {
      it('should check signal.aborted in routine', async () => {
        mockAdapter.setNX = vi.fn().mockResolvedValue('OK');
        mockAdapter.delIfMatch = vi.fn().mockResolvedValue(true);

        const mockRoutine = vi.fn().mockImplementation(async signal => {
          expect(signal.aborted).toBe(false);

          // Simulate checking abort signal during execution
          if (signal.aborted) {
            throw new Error('Operation was aborted');
          }

          return 'success';
        });

        const result = await lock.using(mockRoutine);
        expect(result).toBe('success');
      });
    });
  });

  describe('circuit breaker', () => {
    it('should stay closed when failures are below threshold', async () => {
      const cbLock = new SimpleLock({
        adapter: mockAdapter,
        key: 'test-lock',
        ttl: TEST_CONFIG.DEFAULT_TTL,
        retryAttempts: 0,
      });

      // Fail 4 times (below default threshold of 5)
      mockAdapter.setNX = vi.fn().mockRejectedValue(new Error('Redis error'));

      for (let i = 0; i < 4; i++) {
        await expect(cbLock.acquire()).rejects.toThrow(LockAcquisitionError);
      }

      // 5th attempt should succeed (breaker still closed)
      mockAdapter.setNX = vi.fn().mockResolvedValue('OK');
      const handle = await cbLock.acquire();

      expect(handle).toMatchObject({ key: 'test-lock' });
      expect(cbLock.getHealth().circuitBreaker.state).toBe('closed');
    });

    it('should open after reaching failure threshold', async () => {
      const cbLock = new SimpleLock({
        adapter: mockAdapter,
        key: 'test-lock',
        ttl: TEST_CONFIG.DEFAULT_TTL,
        retryAttempts: 0,
      });

      // Fail 5 times to trip the breaker
      mockAdapter.setNX = vi.fn().mockRejectedValue(new Error('Redis error'));

      for (let i = 0; i < 5; i++) {
        await expect(cbLock.acquire()).rejects.toThrow(LockAcquisitionError);
      }

      expect(cbLock.getHealth().circuitBreaker.state).toBe('open');

      // Next acquire should throw circuit breaker error without calling setNX
      mockAdapter.setNX = vi.fn();

      await expect(cbLock.acquire()).rejects.toThrow('Circuit breaker is open');
      expect(mockAdapter.setNX).not.toHaveBeenCalled();
    });

    it('should transition to half-open after resetTimeout expires', async () => {
      vi.useFakeTimers();
      try {
        const cbLock = new SimpleLock({
          adapter: mockAdapter,
          key: 'test-lock',
          ttl: TEST_CONFIG.DEFAULT_TTL,
          retryAttempts: 0,
        });

        // Trip the breaker with 5 failures
        mockAdapter.setNX = vi.fn().mockRejectedValue(new Error('Redis error'));

        for (let i = 0; i < 5; i++) {
          await cbLock.acquire().catch(() => {});
        }

        expect(cbLock.getHealth().circuitBreaker.state).toBe('open');

        // Advance past the default 60000ms resetTimeout
        vi.advanceTimersByTime(60001);

        // Set up mocks for successful probe
        mockAdapter.setNX = vi.fn().mockResolvedValue('OK');
        mockAdapter.ping = vi.fn().mockResolvedValue('PONG');

        const handle = await cbLock.acquire();

        expect(handle).toMatchObject({ key: 'test-lock' });
        expect(cbLock.getHealth().circuitBreaker.state).toBe('closed');
      } finally {
        vi.useRealTimers();
      }
    });

    it('should re-open if probe fails in half-open state', async () => {
      vi.useFakeTimers();
      try {
        const cbLock = new SimpleLock({
          adapter: mockAdapter,
          key: 'test-lock',
          ttl: TEST_CONFIG.DEFAULT_TTL,
          retryAttempts: 0,
        });

        // Trip the breaker with 5 failures
        mockAdapter.setNX = vi.fn().mockRejectedValue(new Error('Redis error'));

        for (let i = 0; i < 5; i++) {
          await cbLock.acquire().catch(() => {});
        }

        expect(cbLock.getHealth().circuitBreaker.state).toBe('open');

        // Advance past resetTimeout
        vi.advanceTimersByTime(60001);

        // Keep setNX and ping rejecting
        mockAdapter.setNX = vi.fn().mockRejectedValue(new Error('Redis still down'));
        mockAdapter.ping = vi.fn().mockRejectedValue(new Error('Redis still down'));

        // Should throw LockAcquisitionError (the actual Redis error, not circuit breaker message)
        await expect(cbLock.acquire()).rejects.toThrow(LockAcquisitionError);

        expect(cbLock.getHealth().circuitBreaker.state).toBe('open');
      } finally {
        vi.useRealTimers();
      }
    });

    it('should reset failure counter on success', async () => {
      // Use default lock which has retryAttempts: 3
      // Fail 3 times then succeed on 4th call
      mockAdapter.setNX = vi
        .fn()
        .mockRejectedValueOnce(new Error('Redis error'))
        .mockRejectedValueOnce(new Error('Redis error'))
        .mockRejectedValueOnce(new Error('Redis error'))
        .mockResolvedValueOnce('OK');

      const handle = await lock.acquire();

      expect(handle).toMatchObject({ key: 'test-lock' });
      expect(lock.getHealth().circuitBreaker.failures).toBe(0);
      expect(lock.getHealth().circuitBreaker.state).toBe('closed');
    });

    it('should reflect breaker state via getHealth()', () => {
      const health = lock.getHealth();

      expect(health.circuitBreaker.state).toBe('closed');
      expect(health.circuitBreaker.failures).toBe(0);
      expect(health.circuitBreaker.openedAt).toBe(0);
    });

    it('should not trip when circuitBreaker is disabled', async () => {
      const disabledLock = new SimpleLock({
        adapter: mockAdapter,
        key: 'test-lock',
        ttl: TEST_CONFIG.DEFAULT_TTL,
        retryAttempts: 0,
        circuitBreaker: false,
      });

      // Fail 10 times (well past default threshold)
      mockAdapter.setNX = vi.fn().mockRejectedValue(new Error('Redis error'));

      for (let i = 0; i < 10; i++) {
        await expect(disabledLock.acquire()).rejects.toThrow(LockAcquisitionError);
      }

      // Should still succeed (breaker never tripped)
      mockAdapter.setNX = vi.fn().mockResolvedValue('OK');
      const handle = await disabledLock.acquire();

      expect(handle).toMatchObject({ key: 'test-lock' });
    });

    it('should respect custom failureThreshold', async () => {
      const customLock = new SimpleLock({
        adapter: mockAdapter,
        key: 'test-lock',
        ttl: TEST_CONFIG.DEFAULT_TTL,
        retryAttempts: 0,
        circuitBreaker: { failureThreshold: 2 },
      });

      mockAdapter.setNX = vi.fn().mockRejectedValue(new Error('Redis error'));

      // First failure — should still be closed
      await expect(customLock.acquire()).rejects.toThrow(LockAcquisitionError);
      expect(customLock.getHealth().circuitBreaker.state).toBe('closed');

      // Second failure — should open
      await expect(customLock.acquire()).rejects.toThrow(LockAcquisitionError);
      expect(customLock.getHealth().circuitBreaker.state).toBe('open');
    });

    it('should respect custom resetTimeout', async () => {
      vi.useFakeTimers();
      try {
        const customLock = new SimpleLock({
          adapter: mockAdapter,
          key: 'test-lock',
          ttl: TEST_CONFIG.DEFAULT_TTL,
          retryAttempts: 0,
          circuitBreaker: { failureThreshold: 2, resetTimeout: 5000 },
        });

        // Trip the breaker with 2 failures
        mockAdapter.setNX = vi.fn().mockRejectedValue(new Error('Redis error'));

        for (let i = 0; i < 2; i++) {
          await customLock.acquire().catch(() => {});
        }

        expect(customLock.getHealth().circuitBreaker.state).toBe('open');

        // Advance 3000ms — should still be open
        vi.advanceTimersByTime(3000);
        await expect(customLock.acquire()).rejects.toThrow('Circuit breaker is open');

        // Advance 2001ms more (total 5001ms past opening)
        vi.advanceTimersByTime(2001);

        mockAdapter.setNX = vi.fn().mockResolvedValue('OK');
        mockAdapter.ping = vi.fn().mockResolvedValue('PONG');

        const handle = await customLock.acquire();

        expect(handle).toMatchObject({ key: 'test-lock' });
        expect(customLock.getHealth().circuitBreaker.state).toBe('closed');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
