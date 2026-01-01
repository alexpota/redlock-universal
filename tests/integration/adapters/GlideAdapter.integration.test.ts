import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GlideClient, GlideClientConfiguration } from '@valkey/valkey-glide';
import { GlideAdapter } from '../../../src/adapters/index.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';
import {
  TEST_CONFIG,
  ATOMIC_EXTENSION_RESULT_CODES,
  TTL_VALUES,
  generateTestKey,
  getValkeyHost,
  getValkeyPort,
} from '../../shared/constants.js';

// Only run GlideAdapter tests when testing against Valkey server
const isValkeyServer = process.env.TEST_SERVER === 'valkey';

describe.skipIf(!isValkeyServer)('GlideAdapter Integration Tests', () => {
  let glideClient: GlideClient;
  let adapter: RedisAdapter;

  const getTestKey = () => generateTestKey('glide-test-lock');
  const testValue = 'unique-lock-value';
  const testTTL = TEST_CONFIG.DEFAULT_TTL;

  beforeAll(async () => {
    const config: GlideClientConfiguration = {
      addresses: [{ host: getValkeyHost(), port: getValkeyPort() }],
    };
    glideClient = await GlideClient.createClient(config);
    adapter = new GlideAdapter(glideClient);
  });

  afterAll(async () => {
    if (adapter) {
      await adapter.disconnect();
    }
  });

  describe('ping', () => {
    it('should return PONG', async () => {
      const result = await adapter.ping();
      expect(result).toBe('PONG');
    });
  });

  describe('isConnected', () => {
    it('should return true when connected', () => {
      expect(adapter.isConnected()).toBe(true);
    });
  });

  describe('setNX', () => {
    let testKey: string;

    beforeEach(() => {
      testKey = getTestKey();
    });

    it('should acquire lock when key does not exist', async () => {
      const result = await adapter.setNX(testKey, testValue, testTTL);
      expect(result).toBe('OK');

      // Verify the key was set
      const value = await adapter.get(testKey);
      expect(value).toBe(testValue);
    });

    it('should fail to acquire lock when key already exists', async () => {
      // Set the key first
      await adapter.setNX(testKey, testValue, testTTL);

      // Try to set it again
      const result = await adapter.setNX(testKey, 'different-value', testTTL);
      expect(result).toBeNull();

      // Verify original value is unchanged
      const value = await adapter.get(testKey);
      expect(value).toBe(testValue);
    });

    it('should set TTL correctly', async () => {
      await adapter.setNX(testKey, testValue, 100); // 100ms TTL

      // Key should exist immediately
      let value = await adapter.get(testKey);
      expect(value).toBe(testValue);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Key should be gone
      value = await adapter.get(testKey);
      expect(value).toBeNull();
    });
  });

  describe('get', () => {
    let testKey: string;

    beforeEach(() => {
      testKey = getTestKey();
    });

    it('should return value for existing key', async () => {
      await adapter.setNX(testKey, testValue, testTTL);
      const result = await adapter.get(testKey);
      expect(result).toBe(testValue);
    });

    it('should return null for non-existing key', async () => {
      const result = await adapter.get('non-existing-key');
      expect(result).toBeNull();
    });
  });

  describe('del', () => {
    let testKey: string;

    beforeEach(() => {
      testKey = getTestKey();
    });

    it('should delete existing key', async () => {
      await adapter.setNX(testKey, testValue, testTTL);

      const deleteCount = await adapter.del(testKey);
      expect(deleteCount).toBe(1);

      const value = await adapter.get(testKey);
      expect(value).toBeNull();
    });

    it('should return 0 for non-existing key', async () => {
      const deleteCount = await adapter.del('non-existing-key');
      expect(deleteCount).toBe(0);
    });
  });

  describe('delIfMatch', () => {
    let testKey: string;

    beforeEach(() => {
      testKey = getTestKey();
    });

    it('should delete key when value matches', async () => {
      await adapter.setNX(testKey, testValue, testTTL);

      const deleted = await adapter.delIfMatch(testKey, testValue);
      expect(deleted).toBe(true);

      const value = await adapter.get(testKey);
      expect(value).toBeNull();
    });

    it('should not delete key when value does not match', async () => {
      await adapter.setNX(testKey, testValue, testTTL);

      const deleted = await adapter.delIfMatch(testKey, 'wrong-value');
      expect(deleted).toBe(false);

      const value = await adapter.get(testKey);
      expect(value).toBe(testValue);
    });

    it('should return false for non-existing key', async () => {
      const deleted = await adapter.delIfMatch('non-existing-key', testValue);
      expect(deleted).toBe(false);
    });
  });

  describe('extendIfMatch', () => {
    let testKey: string;

    beforeEach(() => {
      testKey = getTestKey();
    });

    it('should extend TTL when value matches', async () => {
      await adapter.setNX(testKey, testValue, 200); // Short TTL

      // Extend the TTL
      const extended = await adapter.extendIfMatch(testKey, testValue, testTTL);
      expect(extended).toBe(true);

      // Wait longer than original TTL
      await new Promise(resolve => setTimeout(resolve, 250));

      // Key should still exist due to extension
      const value = await adapter.get(testKey);
      expect(value).toBe(testValue);
    });

    it('should not extend TTL when value does not match', async () => {
      await adapter.setNX(testKey, testValue, testTTL);

      const extended = await adapter.extendIfMatch(testKey, 'wrong-value', testTTL);
      expect(extended).toBe(false);
    });

    it('should return false for non-existing key', async () => {
      const extended = await adapter.extendIfMatch('non-existing-key', testValue, testTTL);
      expect(extended).toBe(false);
    });
  });

  describe('key prefix', () => {
    it('should use key prefix when configured', async () => {
      const prefixedAdapter = new GlideAdapter(glideClient, { keyPrefix: 'test:' });

      await prefixedAdapter.setNX('my-key', testValue, testTTL);

      // Check that the prefixed key exists using raw GLIDE command
      const directValue = await glideClient.get('test:my-key');
      expect(directValue).toBe(testValue);

      // Check that unprefixed key does not exist
      const unprefixedValue = await glideClient.get('my-key');
      expect(unprefixedValue).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should validate key format', async () => {
      await expect(adapter.setNX('', testValue, testTTL)).rejects.toThrow(
        'Lock key must be a non-empty string'
      );
    });

    it('should validate value format', async () => {
      const testKey = getTestKey();
      await expect(adapter.setNX(testKey, '', testTTL)).rejects.toThrow(
        'Lock value must be a non-empty string'
      );
    });

    it('should validate TTL format', async () => {
      const testKey = getTestKey();
      await expect(adapter.setNX(testKey, testValue, -1)).rejects.toThrow(
        'TTL must be a positive integer'
      );
    });
  });

  describe('atomicExtend', () => {
    let testKey: string;

    beforeEach(() => {
      testKey = getTestKey();
    });

    it('should extend when value matches and TTL above threshold', async () => {
      await adapter.setNX(testKey, testValue, TEST_CONFIG.VERY_SHORT_TTL);

      const result = await adapter.atomicExtend(
        testKey,
        testValue,
        TEST_CONFIG.ULTRA_SHORT_TTL,
        testTTL
      );
      expect(result.resultCode).toBe(ATOMIC_EXTENSION_RESULT_CODES.SUCCESS);
      expect(result.actualTTL).toBeGreaterThan(0);
    });

    it('should not extend when value does not match', async () => {
      await adapter.setNX(testKey, testValue, testTTL);

      const result = await adapter.atomicExtend(
        testKey,
        'wrong-value',
        TEST_CONFIG.ULTRA_SHORT_TTL * 2,
        testTTL
      );
      expect(result.resultCode).toBe(ATOMIC_EXTENSION_RESULT_CODES.VALUE_MISMATCH);
    });

    it('should indicate key missing for non-existing key', async () => {
      const result = await adapter.atomicExtend(
        'non-existing-key',
        testValue,
        TEST_CONFIG.ULTRA_SHORT_TTL * 2,
        testTTL
      );
      expect(result.resultCode).toBe(ATOMIC_EXTENSION_RESULT_CODES.VALUE_MISMATCH);
      expect(result.actualTTL).toBe(TTL_VALUES.KEY_NOT_EXISTS);
    });
  });

  describe('batchSetNX', () => {
    it('should acquire all locks atomically when none exist', async () => {
      const keys = [getTestKey(), getTestKey(), getTestKey()];
      const values = ['value1', 'value2', 'value3'];

      const result = await adapter.batchSetNX(keys, values, testTTL);
      expect(result.success).toBe(true);
      expect(result.acquiredCount).toBe(3);

      // Verify all keys were set
      for (let i = 0; i < keys.length; i++) {
        const value = await adapter.get(keys[i]);
        expect(value).toBe(values[i]);
      }
    });

    it('should fail atomically if any key exists', async () => {
      const keys = [getTestKey(), getTestKey(), getTestKey()];
      const values = ['value1', 'value2', 'value3'];

      // Pre-set the second key
      await adapter.setNX(keys[1], 'existing-value', testTTL);

      const result = await adapter.batchSetNX(keys, values, testTTL);
      expect(result.success).toBe(false);
      expect(result.acquiredCount).toBe(0);
      if (!result.success) {
        expect(result.failedKey).toBe(keys[1]);
      }

      // Verify none of the other keys were set (atomic rollback)
      const firstValue = await adapter.get(keys[0]);
      expect(firstValue).toBeNull();

      const thirdValue = await adapter.get(keys[2]);
      expect(thirdValue).toBeNull();
    });
  });

  describe('inspect', () => {
    let testKey: string;

    beforeEach(() => {
      testKey = getTestKey();
    });

    it('should return lock info for existing key', async () => {
      await adapter.setNX(testKey, testValue, testTTL);

      const result = await adapter.inspect(testKey);
      expect(result).not.toBeNull();
      expect(result!.value).toBe(testValue);
      expect(result!.ttl).toBeGreaterThan(0);
      expect(result!.ttl).toBeLessThanOrEqual(testTTL);
    });

    it('should return null for non-existing key', async () => {
      const result = await adapter.inspect('non-existing-key');
      expect(result).toBeNull();
    });
  });
});
