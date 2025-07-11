import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient as createNodeRedisClient } from 'redis';
import Redis from 'ioredis';
import { NodeRedisAdapter, IoredisAdapter } from '../../../src/adapters/index.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';
import { TEST_CONFIG, generateTestKey, getRedisUrl } from '../../shared/constants.js';

describe('Redis Adapter Integration Tests', () => {
  let nodeRedisClient: any;
  let ioredisClient: Redis;
  let nodeAdapter: RedisAdapter;
  let ioAdapter: RedisAdapter;

  const getTestKey = () => generateTestKey('test-lock');
  const testValue = 'unique-lock-value';
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

  // No need to flushDb since we use unique keys with process.pid

  describe.each([
    ['NodeRedisAdapter', () => nodeAdapter],
    ['IoredisAdapter', () => ioAdapter],
  ])('%s', (adapterName, getAdapter) => {
    let adapter: RedisAdapter;
    let testKey: string;

    beforeEach(() => {
      adapter = getAdapter();
      testKey = getTestKey();
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

    describe('key prefix', () => {
      it('should use key prefix when configured', async () => {
        const prefixedAdapter =
          adapterName === 'NodeRedisAdapter'
            ? new NodeRedisAdapter(nodeRedisClient, { keyPrefix: 'test:' })
            : new IoredisAdapter(ioredisClient, { keyPrefix: 'test:' });

        await prefixedAdapter.setNX('my-key', testValue, testTTL);

        // Check that the prefixed key exists
        const directValue =
          adapterName === 'NodeRedisAdapter'
            ? await nodeRedisClient.get('test:my-key')
            : await ioredisClient.get('test:my-key');

        expect(directValue).toBe(testValue);

        // Check that unprefixed key does not exist
        const unprefixedValue =
          adapterName === 'NodeRedisAdapter'
            ? await nodeRedisClient.get('my-key')
            : await ioredisClient.get('my-key');

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
        await expect(adapter.setNX(testKey, '', testTTL)).rejects.toThrow(
          'Lock value must be a non-empty string'
        );
      });

      it('should validate TTL format', async () => {
        await expect(adapter.setNX(testKey, testValue, -1)).rejects.toThrow(
          'TTL must be a positive integer'
        );
      });
    });
  });

  describe('cross-adapter compatibility', () => {
    it('should work with locks set by different adapters', async () => {
      const testKey = getTestKey();

      // Set lock with node-redis adapter
      await nodeAdapter.setNX(testKey, testValue, testTTL);

      // Read with ioredis adapter
      const value = await ioAdapter.get(testKey);
      expect(value).toBe(testValue);

      // Delete with ioredis adapter
      const deleted = await ioAdapter.delIfMatch(testKey, testValue);
      expect(deleted).toBe(true);

      // Verify deletion with node-redis adapter
      const finalValue = await nodeAdapter.get(testKey);
      expect(finalValue).toBeNull();
    });
  });
});
