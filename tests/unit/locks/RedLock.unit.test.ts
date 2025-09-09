import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RedLock } from '../../../src/locks/RedLock.js';
import { LockAcquisitionError } from '../../../src/types/errors.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';
import type { RedLockConfig } from '../../../src/types/locks.js';
import {
  generateTestKey,
  TEST_STRINGS,
  TEST_CONFIG,
  TIMING_CONFIG,
} from '../../shared/constants.js';

// Mock Redis adapter for testing
class MockRedisAdapter implements RedisAdapter {
  private storage = new Map<string, string>();
  private readonly nodeId: string;
  public setNXCallCount = 0;
  public getCallCount = 0;
  public delCallCount = 0;
  public delIfMatchCallCount = 0;
  public shouldFailSetNX = false;
  public shouldFailGet = false;
  public shouldFailDel = false;
  public simulateLatency = 0;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  async setNX(key: string, value: string, ttl: number): Promise<string | null> {
    this.setNXCallCount++;
    if (this.simulateLatency > 0) {
      await new Promise(resolve => setTimeout(resolve, this.simulateLatency));
    }
    if (this.shouldFailSetNX) {
      throw new Error(`Mock setNX failure on ${this.nodeId}`);
    }
    if (this.storage.has(key)) {
      return null; // Key already exists
    }
    this.storage.set(key, value);
    // Simulate TTL expiration
    setTimeout(() => this.storage.delete(key), ttl);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    this.getCallCount++;
    if (this.shouldFailGet) {
      throw new Error(`Mock get failure on ${this.nodeId}`);
    }
    return this.storage.get(key) || null;
  }

  async del(key: string): Promise<number> {
    this.delCallCount++;
    if (this.shouldFailDel) {
      throw new Error(`Mock del failure on ${this.nodeId}`);
    }
    const existed = this.storage.has(key);
    this.storage.delete(key);
    return existed ? 1 : 0;
  }

  async delIfMatch(key: string, value: string): Promise<boolean> {
    this.delIfMatchCallCount++;
    if (this.shouldFailDel) {
      throw new Error(`Mock delIfMatch failure on ${this.nodeId}`);
    }
    const currentValue = this.storage.get(key);
    if (currentValue === value) {
      this.storage.delete(key);
      return true;
    }
    return false;
  }

  async extendIfMatch(key: string, value: string, ttl: number): Promise<boolean> {
    if (this.shouldFailDel) {
      throw new Error(`Mock extendIfMatch failure on ${this.nodeId}`);
    }
    const currentValue = this.storage.get(key);
    if (currentValue === value) {
      // Simulate TTL extension by resetting the timeout
      setTimeout(() => this.storage.delete(key), ttl);
      return true;
    }
    return false;
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  isConnected(): boolean {
    return true;
  }

  async disconnect(): Promise<void> {
    this.storage.clear();
  }

  // Test helpers
  getNodeId(): string {
    return this.nodeId;
  }

  hasKey(key: string): boolean {
    return this.storage.has(key);
  }

  clear(): void {
    this.storage.clear();
  }

  reset(): void {
    this.setNXCallCount = 0;
    this.getCallCount = 0;
    this.delCallCount = 0;
    this.delIfMatchCallCount = 0;
    this.shouldFailSetNX = false;
    this.shouldFailGet = false;
    this.shouldFailDel = false;
    this.simulateLatency = 0;
    this.storage.clear();
  }
}

describe('RedLock', () => {
  let adapters: MockRedisAdapter[];
  let redlock: RedLock;
  const getTestKey = () => generateTestKey('test:redlock:key');

  beforeEach(() => {
    // Create 5 mock adapters for comprehensive testing
    adapters = [
      new MockRedisAdapter('redis-1'),
      new MockRedisAdapter('redis-2'),
      new MockRedisAdapter('redis-3'),
      new MockRedisAdapter('redis-4'),
      new MockRedisAdapter('redis-5'),
    ];

    const testKey = getTestKey();
    const config: RedLockConfig = {
      adapters,
      key: testKey,
      ttl: TEST_CONFIG.LONG_TTL,
      quorum: TEST_CONFIG.DEFAULT_QUORUM_5, // Majority of 5
      retryAttempts: TEST_CONFIG.DEFAULT_RETRY_ATTEMPTS,
      retryDelay: TEST_CONFIG.FAST_RETRY_DELAY,
      clockDriftFactor: TEST_CONFIG.DEFAULT_CLOCK_DRIFT,
    };

    redlock = new RedLock(config);
  });

  afterEach(() => {
    adapters.forEach(adapter => adapter.reset());
  });

  describe('Configuration Validation', () => {
    it('should throw error with no adapters', () => {
      expect(() => {
        new RedLock({
          adapters: [],
          key: getTestKey(),
        });
      }).toThrow('At least one Redis adapter is required for RedLock');
    });

    it('should throw error with invalid key', () => {
      expect(() => {
        new RedLock({
          adapters: [adapters[0]],
          key: '',
        });
      }).toThrow('Lock key must be a non-empty string');
    });

    it('should throw error with invalid TTL', () => {
      expect(() => {
        new RedLock({
          adapters: [adapters[0]],
          key: getTestKey(),
          ttl: TEST_CONFIG.INVALID_TTL,
        });
      }).toThrow('TTL must be a positive integer');
    });

    it('should throw error with invalid quorum', () => {
      expect(() => {
        new RedLock({
          adapters: adapters.slice(0, 3),
          key: getTestKey(),
          quorum: 5, // More than available adapters
        });
      }).toThrow('Quorum must be between 1 and 3');
    });

    it('should throw error with invalid clock drift factor', () => {
      expect(() => {
        new RedLock({
          adapters: [adapters[0]],
          key: getTestKey(),
          clockDriftFactor: 1.5, // Invalid - greater than 1
        });
      }).toThrow('Clock drift factor must be between 0 and 1');
    });

    it('should use default values for optional parameters', () => {
      const lock = new RedLock({
        adapters: adapters.slice(0, 3),
        key: getTestKey(),
      });

      const config = lock.getConfig();
      expect(config.ttl).toBe(30000); // DEFAULTS.TTL
      expect(config.quorum).toBe(2); // Majority of 3
      expect(config.retryAttempts).toBe(3); // DEFAULTS.RETRY_ATTEMPTS
      expect(config.clockDriftFactor).toBe(0.01); // DEFAULTS.CLOCK_DRIFT_FACTOR
    });
  });

  describe('Lock Acquisition', () => {
    it('should successfully acquire lock with quorum', async () => {
      const handle = await redlock.acquire();

      expect(handle).toMatchObject({
        key: redlock.getConfig().key,
        value: expect.any(String),
        acquiredAt: expect.any(Number),
        ttl: TEST_CONFIG.LONG_TTL,
        metadata: expect.objectContaining({
          strategy: 'redlock',
          attempts: 1,
          acquisitionTime: expect.any(Number),
          nodes: expect.any(Array),
        }),
      });

      // Verify quorum nodes have the lock
      const testKey = redlock.getConfig().key;
      const lockedNodes = adapters.filter(adapter => adapter.hasKey(testKey));
      expect(lockedNodes.length).toBeGreaterThanOrEqual(3);

      // Verify all adapters were called
      adapters.forEach(adapter => {
        expect(adapter.setNXCallCount).toBe(1);
      });
    });

    it('should retry on initial failure and succeed', async () => {
      // Make first attempt fail on majority of nodes (prevent quorum)
      adapters[0].shouldFailSetNX = true;
      adapters[1].shouldFailSetNX = true;
      adapters[2].shouldFailSetNX = true;

      // Make retries succeed after first attempt fails
      setTimeout(() => {
        adapters[0].shouldFailSetNX = false;
        adapters[1].shouldFailSetNX = false;
        adapters[2].shouldFailSetNX = false;
      }, TIMING_CONFIG.UNIT_RETRY_TIMEOUT_BUFFER); // After retry delay of 50ms

      const handle = await redlock.acquire();

      expect(handle.metadata?.attempts).toBeGreaterThan(1);
      expect(adapters[0].setNXCallCount).toBeGreaterThan(1);
    });

    it('should fail when quorum cannot be achieved', async () => {
      // Ensure all adapters are reset first
      adapters.forEach(adapter => adapter.reset());

      // Fail majority of nodes (3 out of 5, so only 2 succeed < quorum of 3)
      adapters[0].shouldFailSetNX = true;
      adapters[1].shouldFailSetNX = true;
      adapters[2].shouldFailSetNX = true;

      await expect(redlock.acquire()).rejects.toThrow(LockAcquisitionError);
    });

    it('should handle clock drift by rejecting slow acquisitions', async () => {
      // Simulate very slow network
      adapters.forEach(adapter => {
        adapter.simulateLatency = 5000; // 5 seconds
      });

      // Use short TTL to trigger clock drift protection
      // With 5000ms latency + drift, should exceed 5500ms TTL
      const fastRedlock = new RedLock({
        adapters,
        key: getTestKey(),
        ttl: TEST_CONFIG.CLOCK_DRIFT_TTL, // 5.5 seconds - less than latency + drift
        clockDriftFactor: TEST_CONFIG.HIGH_CLOCK_DRIFT, // Higher drift factor for test
        retryAttempts: 0, // No retries for faster test
      });

      await expect(fastRedlock.acquire()).rejects.toThrow(LockAcquisitionError);
    }, 15000); // 15 second timeout

    it('should clean up partial locks on failure', async () => {
      // Make exactly 2 nodes succeed (less than quorum of 3)
      adapters[3].shouldFailSetNX = true;
      adapters[4].shouldFailSetNX = true;
      adapters[2].shouldFailSetNX = true;

      await expect(redlock.acquire()).rejects.toThrow(LockAcquisitionError);

      // Verify partial locks were cleaned up
      await new Promise(resolve => setTimeout(resolve, TIMING_CONFIG.UNIT_QUICK_DELAY));
      const testKey = redlock.getConfig().key;
      const lockedNodes = adapters.filter(adapter => adapter.hasKey(testKey));
      expect(lockedNodes.length).toBe(0);
    });

    it('should handle lock contention', async () => {
      // Simulate existing locks on some nodes
      const testKey = redlock.getConfig().key;
      await adapters[0].setNX(testKey, 'other-lock-value', 10000);
      await adapters[1].setNX(testKey, 'other-lock-value', 10000);

      // Should still succeed with remaining nodes
      const handle = await redlock.acquire();
      expect(handle).toBeDefined();

      // Verify lock acquired on available nodes
      const lockedNodesWithCorrectValue: MockRedisAdapter[] = [];
      for (const adapter of adapters) {
        if (adapter.hasKey(testKey)) {
          const value = await adapter.get(testKey);
          if (value === handle.value) {
            lockedNodesWithCorrectValue.push(adapter);
          }
        }
      }
      expect(lockedNodesWithCorrectValue.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Lock Release', () => {
    it('should successfully release distributed lock', async () => {
      const handle = await redlock.acquire();
      const released = await redlock.release(handle);

      expect(released).toBe(true);

      // Verify lock removed from all nodes
      const testKey = redlock.getConfig().key;
      const lockedNodes = adapters.filter(adapter => adapter.hasKey(testKey));
      expect(lockedNodes.length).toBe(0);

      adapters.forEach(adapter => {
        expect(adapter.delIfMatchCallCount).toBe(1);
      });
    });

    it('should handle partial release failures gracefully', async () => {
      const handle = await redlock.acquire();

      // Make some nodes fail during release
      adapters[0].shouldFailDel = true;
      adapters[1].shouldFailDel = true;

      const released = await redlock.release(handle);

      // Should still consider release successful if quorum released
      expect(released).toBe(true);
    });

    it('should fail release when quorum cannot be achieved', async () => {
      const handle = await redlock.acquire();

      // Make majority of nodes fail during release
      adapters[0].shouldFailDel = true;
      adapters[1].shouldFailDel = true;
      adapters[2].shouldFailDel = true;

      const released = await redlock.release(handle);
      expect(released).toBe(false);
    });

    it('should validate lock handle', async () => {
      const invalidHandle = {
        id: 'invalid',
        key: 'wrong-key',
        value: 'wrong-value',
        acquiredAt: Date.now(),
        ttl: TEST_CONFIG.LONG_TTL,
      };

      await expect(redlock.release(invalidHandle)).rejects.toThrow(
        'Lock handle key "wrong-key" does not match RedLock key'
      );
    });

    it('should handle missing lock handle properties', async () => {
      const invalidHandle = {
        id: '',
        key: redlock.getConfig().key,
        value: '',
        acquiredAt: Date.now(),
        ttl: TEST_CONFIG.LONG_TTL,
      };

      await expect(redlock.release(invalidHandle)).rejects.toThrow(
        'Invalid lock handle: missing required properties'
      );
    });
  });

  describe('Lock Extension', () => {
    it('should successfully extend distributed lock', async () => {
      const handle = await redlock.acquire();
      const extended = await redlock.extend(handle, 20000);

      expect(extended).toBe(true);

      // Verify nodes still have the lock
      const testKey = redlock.getConfig().key;
      const lockedNodes = adapters.filter(adapter => adapter.hasKey(testKey));
      expect(lockedNodes.length).toBeGreaterThanOrEqual(3);
    });

    it('should fail extension when lock expired', async () => {
      const handle = await redlock.acquire();

      // Manually clear locks to simulate expiration
      adapters.forEach(adapter => adapter.clear());

      const extended = await redlock.extend(handle, 20000);
      expect(extended).toBe(false);
    });

    it('should fail extension when quorum lost', async () => {
      const handle = await redlock.acquire();

      // Clear majority of locks
      adapters[0].clear();
      adapters[1].clear();
      adapters[2].clear();

      const extended = await redlock.extend(handle, 20000);
      expect(extended).toBe(false);
    });

    it('should validate TTL parameter', async () => {
      const handle = await redlock.acquire();

      await expect(redlock.extend(handle, -1000)).rejects.toThrow('TTL must be a positive integer');
    });
  });

  describe('Lock Status Check', () => {
    it('should correctly detect locked state', async () => {
      const handle = await redlock.acquire();
      const testKey = redlock.getConfig().key;
      const isLocked = await redlock.isLocked(testKey);

      expect(isLocked).toBe(true);

      await redlock.release(handle);
      const isUnlocked = await redlock.isLocked(testKey);

      expect(isUnlocked).toBe(false);
    });

    it('should handle partial lock states', async () => {
      // Manually set locks on some nodes
      const testKey = redlock.getConfig().key;
      await adapters[0].setNX(testKey, TEST_STRINGS.SOME_VALUE, 10000);
      await adapters[1].setNX(testKey, TEST_STRINGS.SOME_VALUE, 10000);

      const isLocked = await redlock.isLocked(testKey);
      expect(isLocked).toBe(false); // Less than quorum

      // Add one more to reach quorum
      await adapters[2].setNX(testKey, TEST_STRINGS.SOME_VALUE, 10000);

      const isLockedWithQuorum = await redlock.isLocked(testKey);
      expect(isLockedWithQuorum).toBe(true);
    });

    it('should handle Redis errors gracefully', async () => {
      adapters.forEach(adapter => {
        adapter.shouldFailGet = true;
      });

      const testKey = redlock.getConfig().key;
      const isLocked = await redlock.isLocked(testKey);
      expect(isLocked).toBe(false); // Default to unlocked on errors
    });
  });

  describe('Configuration Access', () => {
    it('should provide read-only access to configuration', () => {
      const config = redlock.getConfig();

      expect(config).toMatchObject({
        adapters: expect.any(Array),
        key: redlock.getConfig().key,
        ttl: TEST_CONFIG.LONG_TTL,
        quorum: TEST_CONFIG.DEFAULT_QUORUM_5,
        retryAttempts: TEST_CONFIG.DEFAULT_RETRY_ATTEMPTS,
        retryDelay: TEST_CONFIG.FAST_RETRY_DELAY,
        clockDriftFactor: TEST_CONFIG.DEFAULT_CLOCK_DRIFT,
      });

      // Verify it's a copy, not reference
      expect(config).not.toBe(redlock.getConfig());
    });

    it('should provide access to adapters', () => {
      const lockAdapters = redlock.getAdapters();
      expect(lockAdapters).toBe(adapters);
      expect(lockAdapters.length).toBe(5);
    });

    it('should provide quorum information', () => {
      const quorum = redlock.getQuorum();
      expect(quorum).toBe(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle all nodes failing', async () => {
      adapters.forEach(adapter => {
        adapter.shouldFailSetNX = true;
      });

      await expect(redlock.acquire()).rejects.toThrow(LockAcquisitionError);
    });

    it('should work with single node (quorum = 1)', async () => {
      const singleNodeLock = new RedLock({
        adapters: [adapters[0]],
        key: getTestKey(),
        quorum: TEST_CONFIG.SINGLE_RETRY_ATTEMPT,
      });

      const handle = await singleNodeLock.acquire();
      expect(handle).toBeDefined();

      const released = await singleNodeLock.release(handle);
      expect(released).toBe(true);
    });

    it('should handle exactly quorum success scenario', async () => {
      // Fail exactly 2 nodes (leaving 3 for quorum)
      adapters[3].shouldFailSetNX = true;
      adapters[4].shouldFailSetNX = true;

      const handle = await redlock.acquire();
      expect(handle).toBeDefined();
      expect(handle.metadata?.nodes?.length).toBe(3);
    });

    it('should handle concurrent acquisition attempts', async () => {
      const promises = [redlock.acquire(), redlock.acquire(), redlock.acquire()];

      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');

      // Only one should succeed
      expect(successful.length).toBe(1);
      expect(failed.length).toBe(2);
    });

    describe('using() API', () => {
      it('should execute routine with automatic lock management', async () => {
        // Setup adapters to succeed on quorum
        adapters[0].reset();
        adapters[1].reset();
        adapters[2].reset();

        const testKey = getTestKey();
        const testRedlock = new RedLock({
          adapters,
          key: testKey,
          ttl: TEST_CONFIG.DEFAULT_TTL,
          quorum: TEST_CONFIG.DEFAULT_QUORUM_3,
        });

        let routineExecuted = false;
        const result = await testRedlock.using(async signal => {
          routineExecuted = true;
          expect(signal).toBeDefined();
          expect(signal.aborted).toBe(false);
          expect(signal.error).toBeUndefined();

          // Verify lock is held on at least quorum nodes
          const lockedNodes = adapters.filter(a => a.hasKey(testKey)).length;
          expect(lockedNodes).toBeGreaterThanOrEqual(2);

          return 'test-result';
        });

        expect(result).toBe('test-result');
        expect(routineExecuted).toBe(true);

        // Verify locks are released
        const remainingLocks = adapters.filter(a => a.hasKey(testKey)).length;
        expect(remainingLocks).toBe(0);
      });

      it('should handle routine errors and still cleanup', async () => {
        adapters.forEach(a => a.reset());

        const testKey = getTestKey();
        const testRedlock = new RedLock({
          adapters,
          key: testKey,
          ttl: TEST_CONFIG.DEFAULT_TTL,
          quorum: TEST_CONFIG.DEFAULT_QUORUM_3,
        });

        const testError = new Error('Routine failed');

        await expect(
          testRedlock.using(async () => {
            throw testError;
          })
        ).rejects.toThrow('Routine failed');

        // Verify locks are still released after error
        const remainingLocks = adapters.filter(a => a.hasKey(testKey)).length;
        expect(remainingLocks).toBe(0);
      });

      it('should provide AbortSignal to routine', async () => {
        adapters.forEach(a => a.reset());

        const testKey = getTestKey();
        const testRedlock = new RedLock({
          adapters,
          key: testKey,
          ttl: TEST_CONFIG.DEFAULT_TTL,
          quorum: TEST_CONFIG.DEFAULT_QUORUM_3,
        });

        let signalReceived: AbortSignal | undefined;

        await testRedlock.using(async signal => {
          signalReceived = signal;

          // Verify signal has expected properties
          expect(typeof signal.aborted).toBe('boolean');
          expect(signal.addEventListener).toBeDefined();
          expect(signal.removeEventListener).toBeDefined();

          // Signal should have error property (even if undefined)
          expect('error' in signal).toBe(true);

          return 'done';
        });

        expect(signalReceived).toBeDefined();
      });

      it('should handle lock acquisition failure', async () => {
        // Make all adapters fail to acquire lock
        adapters.forEach(a => {
          a.reset();
          a.shouldFailSetNX = true;
        });

        const testKey = getTestKey();
        const testRedlock = new RedLock({
          adapters,
          key: testKey,
          ttl: TEST_CONFIG.DEFAULT_TTL,
          quorum: TEST_CONFIG.DEFAULT_QUORUM_3,
          retryAttempts: 0, // Don't retry for faster test
        });

        const mockRoutine = vi.fn();

        await expect(testRedlock.using(mockRoutine)).rejects.toThrow(LockAcquisitionError);

        // Routine should not be called if lock acquisition fails
        expect(mockRoutine).not.toHaveBeenCalled();
      });

      it('should release lock even if routine returns immediately', async () => {
        adapters.forEach(a => a.reset());

        const testKey = getTestKey();
        const testRedlock = new RedLock({
          adapters,
          key: testKey,
          ttl: TEST_CONFIG.DEFAULT_TTL,
          quorum: TEST_CONFIG.DEFAULT_QUORUM_3,
        });

        // Very fast routine
        await testRedlock.using(async () => 'instant');

        // All locks should be released
        const remainingLocks = adapters.filter(a => a.hasKey(testKey)).length;
        expect(remainingLocks).toBe(0);
      });
    });
  });
});
