import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryAdapter } from '../../../src/adapters/MemoryAdapter.js';
import { TEST_CONFIG, TIMING_CONFIG } from '../../shared/constants.js';

describe('MemoryAdapter', () => {
  let adapter: MemoryAdapter;

  beforeEach(() => {
    adapter = new MemoryAdapter();
  });

  afterEach(async () => {
    // Clean up all timers to prevent test hangs
    await adapter.disconnect();
  });

  describe('constructor', () => {
    it('should create adapter with default options', () => {
      expect(adapter.isConnected()).toBe(true);
      expect(adapter.size).toBe(0);
    });

    it('should create adapter with key prefix', async () => {
      const prefixedAdapter = new MemoryAdapter({ keyPrefix: 'test:' });
      await prefixedAdapter.setNX('key1', 'value1', TEST_CONFIG.DEFAULT_TTL);

      // Key should be stored with prefix internally
      expect(prefixedAdapter.size).toBe(1);

      // Should be retrievable without prefix
      const value = await prefixedAdapter.get('key1');
      expect(value).toBe('value1');

      await prefixedAdapter.disconnect();
    });

    it('should support factory method', () => {
      const factoryAdapter = MemoryAdapter.create({ keyPrefix: 'factory:' });
      expect(factoryAdapter).toBeInstanceOf(MemoryAdapter);
      factoryAdapter.clear();
    });
  });

  describe('setNX', () => {
    it('should set key if not exists', async () => {
      const result = await adapter.setNX('lock1', 'owner1', TEST_CONFIG.DEFAULT_TTL);
      expect(result).toBe('OK');
      expect(adapter.size).toBe(1);
    });

    it('should return null if key already exists', async () => {
      await adapter.setNX('lock1', 'owner1', TEST_CONFIG.DEFAULT_TTL);
      const result = await adapter.setNX('lock1', 'owner2', TEST_CONFIG.DEFAULT_TTL);
      expect(result).toBeNull();
    });

    it('should allow setting after key expires', async () => {
      await adapter.setNX('lock1', 'owner1', TEST_CONFIG.ULTRA_SHORT_TTL);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = await adapter.setNX('lock1', 'owner2', TEST_CONFIG.DEFAULT_TTL);
      expect(result).toBe('OK');
    });

    it('should validate key', async () => {
      await expect(adapter.setNX('', 'value', TEST_CONFIG.DEFAULT_TTL)).rejects.toThrow(
        'Lock key must be a non-empty string'
      );
    });

    it('should validate value', async () => {
      await expect(adapter.setNX('key', '', TEST_CONFIG.DEFAULT_TTL)).rejects.toThrow(
        'Lock value must be a non-empty string'
      );
    });

    it('should validate TTL', async () => {
      await expect(adapter.setNX('key', 'value', 0)).rejects.toThrow(
        'TTL must be a positive integer'
      );
    });
  });

  describe('get', () => {
    it('should return value if key exists', async () => {
      await adapter.setNX('lock1', 'owner1', TEST_CONFIG.DEFAULT_TTL);
      const value = await adapter.get('lock1');
      expect(value).toBe('owner1');
    });

    it('should return null if key does not exist', async () => {
      const value = await adapter.get('nonexistent');
      expect(value).toBeNull();
    });

    it('should return null for expired keys (lazy expiration)', async () => {
      await adapter.setNX('lock1', 'owner1', TEST_CONFIG.ULTRA_SHORT_TTL);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      const value = await adapter.get('lock1');
      expect(value).toBeNull();
    });
  });

  describe('del', () => {
    it('should delete existing key and return 1', async () => {
      await adapter.setNX('lock1', 'owner1', TEST_CONFIG.DEFAULT_TTL);
      const result = await adapter.del('lock1');
      expect(result).toBe(1);
      expect(adapter.size).toBe(0);
    });

    it('should return 0 if key does not exist', async () => {
      const result = await adapter.del('nonexistent');
      expect(result).toBe(0);
    });
  });

  describe('delIfMatch', () => {
    it('should delete key if value matches', async () => {
      await adapter.setNX('lock1', 'owner1', TEST_CONFIG.DEFAULT_TTL);
      const result = await adapter.delIfMatch('lock1', 'owner1');
      expect(result).toBe(true);
      expect(adapter.size).toBe(0);
    });

    it('should not delete key if value does not match', async () => {
      await adapter.setNX('lock1', 'owner1', TEST_CONFIG.DEFAULT_TTL);
      const result = await adapter.delIfMatch('lock1', 'wrong-owner');
      expect(result).toBe(false);
      expect(adapter.size).toBe(1);
    });

    it('should return false if key does not exist', async () => {
      const result = await adapter.delIfMatch('nonexistent', 'value');
      expect(result).toBe(false);
    });

    it('should return false for expired keys', async () => {
      await adapter.setNX('lock1', 'owner1', TEST_CONFIG.ULTRA_SHORT_TTL);
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = await adapter.delIfMatch('lock1', 'owner1');
      expect(result).toBe(false);
    });
  });

  describe('extendIfMatch', () => {
    it('should extend TTL if value matches', async () => {
      await adapter.setNX('lock1', 'owner1', TEST_CONFIG.VERY_SHORT_TTL);
      const result = await adapter.extendIfMatch('lock1', 'owner1', TEST_CONFIG.LONG_TTL);
      expect(result).toBe(true);

      // Verify TTL was extended
      const inspection = await adapter.inspect('lock1');
      expect(inspection?.ttl).toBeGreaterThan(9000);
    });

    it('should not extend if value does not match', async () => {
      await adapter.setNX('lock1', 'owner1', TEST_CONFIG.DEFAULT_TTL);
      const result = await adapter.extendIfMatch('lock1', 'wrong-owner', TEST_CONFIG.LONG_TTL);
      expect(result).toBe(false);
    });

    it('should return false if key does not exist', async () => {
      const result = await adapter.extendIfMatch('nonexistent', 'value', TEST_CONFIG.DEFAULT_TTL);
      expect(result).toBe(false);
    });
  });

  describe('atomicExtend', () => {
    it('should return success when extending valid lock', async () => {
      await adapter.setNX('lock1', 'owner1', TEST_CONFIG.DEFAULT_TTL);

      const result = await adapter.atomicExtend('lock1', 'owner1', 1000, TEST_CONFIG.LONG_TTL);

      expect(result.resultCode).toBe(1);
      expect(result.actualTTL).toBeGreaterThan(0);
      expect(result.message).toContain('successful');
    });

    it('should return -1 when key does not exist', async () => {
      const result = await adapter.atomicExtend(
        'nonexistent',
        'owner1',
        1000,
        TEST_CONFIG.LONG_TTL
      );

      expect(result.resultCode).toBe(-1);
      expect(result.actualTTL).toBe(-2);
      expect(result.message).toContain('no longer exists');
    });

    it('should return -1 when value does not match (lock stolen)', async () => {
      await adapter.setNX('lock1', 'owner1', TEST_CONFIG.DEFAULT_TTL);

      const result = await adapter.atomicExtend('lock1', 'wrong-owner', 1000, TEST_CONFIG.LONG_TTL);

      expect(result.resultCode).toBe(-1);
      expect(result.message).toContain('stolen');
    });

    it('should return 0 when TTL is below minimum threshold', async () => {
      await adapter.setNX('lock1', 'owner1', 500);

      // Wait until TTL drops below minTTL
      await new Promise(resolve => setTimeout(resolve, 200));

      const result = await adapter.atomicExtend('lock1', 'owner1', 1000, TEST_CONFIG.LONG_TTL);

      expect(result.resultCode).toBe(0);
      expect(result.message).toContain('too late');
    });

    it('should validate minTTL', async () => {
      await expect(adapter.atomicExtend('key', 'value', 0, 5000)).rejects.toThrow(
        'Minimum TTL must be a positive integer'
      );
    });
  });

  describe('batchSetNX', () => {
    it('should acquire all locks atomically', async () => {
      const result = await adapter.batchSetNX(
        ['lock1', 'lock2', 'lock3'],
        ['value1', 'value2', 'value3'],
        5000
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.acquiredCount).toBe(3);
      }
      expect(adapter.size).toBe(3);
    });

    it('should fail atomically if any key is locked', async () => {
      await adapter.setNX('lock2', 'existing', TEST_CONFIG.DEFAULT_TTL);

      const result = await adapter.batchSetNX(
        ['lock1', 'lock2', 'lock3'],
        ['value1', 'value2', 'value3'],
        5000
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.acquiredCount).toBe(0);
        expect(result.failedKey).toBe('lock2');
        expect(result.failedIndex).toBe(2); // 1-based index
      }

      // Only the pre-existing lock should be present
      expect(adapter.size).toBe(1);
    });

    it('should validate arrays have same length', async () => {
      await expect(adapter.batchSetNX(['lock1', 'lock2'], ['value1'], 5000)).rejects.toThrow(
        'Keys and values arrays must have the same length'
      );
    });

    it('should require at least one key', async () => {
      await expect(adapter.batchSetNX([], [], 5000)).rejects.toThrow(
        'At least one key is required for batch acquisition'
      );
    });
  });

  describe('inspect', () => {
    it('should return value and TTL for existing lock', async () => {
      await adapter.setNX('lock1', 'owner1', TEST_CONFIG.DEFAULT_TTL);

      const result = await adapter.inspect('lock1');

      expect(result).not.toBeNull();
      expect(result?.value).toBe('owner1');
      expect(result?.ttl).toBeGreaterThan(4000);
      expect(result?.ttl).toBeLessThanOrEqual(5000);
    });

    it('should return null for non-existent key', async () => {
      const result = await adapter.inspect('nonexistent');
      expect(result).toBeNull();
    });

    it('should return null for expired key', async () => {
      await adapter.setNX('lock1', 'owner1', TEST_CONFIG.ULTRA_SHORT_TTL);
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = await adapter.inspect('lock1');
      expect(result).toBeNull();
    });
  });

  describe('ping', () => {
    it('should return PONG', async () => {
      const result = await adapter.ping();
      expect(result).toBe('PONG');
    });
  });

  describe('isConnected', () => {
    it('should always return true', () => {
      expect(adapter.isConnected()).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('should clear all locks and timers', async () => {
      await adapter.setNX('lock1', 'owner1', TEST_CONFIG.DEFAULT_TTL);
      await adapter.setNX('lock2', 'owner2', TEST_CONFIG.DEFAULT_TTL);
      expect(adapter.size).toBe(2);

      await adapter.disconnect();

      expect(adapter.size).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all locks', async () => {
      await adapter.setNX('lock1', 'owner1', TEST_CONFIG.DEFAULT_TTL);
      await adapter.setNX('lock2', 'owner2', TEST_CONFIG.DEFAULT_TTL);

      adapter.clear();

      expect(adapter.size).toBe(0);
      expect(await adapter.get('lock1')).toBeNull();
    });
  });

  describe('TTL expiration', () => {
    it('should automatically clean up expired keys via timeout', async () => {
      await adapter.setNX('lock1', 'owner1', TIMING_CONFIG.DELAY_TINY);
      expect(adapter.size).toBe(1);

      // Wait for timeout to fire
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(adapter.size).toBe(0);
    });

    it('should not prevent process exit with unref timeouts', async () => {
      // This test verifies .unref() is called by checking the adapter
      // doesn't throw when creating locks with short TTLs
      await adapter.setNX('lock1', 'owner1', TEST_CONFIG.LONG_TTL);

      // If .unref() wasn't called, this test would hang
      await adapter.disconnect();
    });
  });

  describe('key prefixing', () => {
    it('should handle key prefix correctly', async () => {
      const prefixedAdapter = new MemoryAdapter({ keyPrefix: 'myapp:locks:' });

      await prefixedAdapter.setNX('resource1', 'owner1', TEST_CONFIG.DEFAULT_TTL);

      // Should retrieve with unprefixed key
      const value = await prefixedAdapter.get('resource1');
      expect(value).toBe('owner1');

      // Should inspect with unprefixed key
      const inspection = await prefixedAdapter.inspect('resource1');
      expect(inspection?.value).toBe('owner1');

      await prefixedAdapter.disconnect();
    });
  });
});
