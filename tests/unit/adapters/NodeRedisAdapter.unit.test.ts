import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NodeRedisAdapter } from '../../../src/adapters/NodeRedisAdapter.js';
import { TEST_STRINGS } from '../../shared/constants.js';

describe('NodeRedisAdapter Unit Tests', () => {
  let mockClient: any;
  let adapter: NodeRedisAdapter;

  beforeEach(() => {
    // Create mock Redis client
    mockClient = {
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      eval: vi.fn(),
      scriptLoad: vi.fn(),
      evalSha: vi.fn(),
      ping: vi.fn(),
      disconnect: vi.fn(),
      isReady: true,
    };

    adapter = new NodeRedisAdapter(mockClient);
  });

  describe('setNX', () => {
    it('should call Redis SET with NX and PX options', async () => {
      mockClient.set.mockResolvedValue('OK');

      const result = await adapter.setNX(
        TEST_STRINGS.ADAPTER_TEST_KEY,
        TEST_STRINGS.TEST_VALUE,
        5000
      );

      expect(mockClient.set).toHaveBeenCalledWith(
        TEST_STRINGS.ADAPTER_TEST_KEY,
        TEST_STRINGS.TEST_VALUE,
        {
          NX: true,
          PX: 5000,
        }
      );
      expect(result).toBe('OK');
    });

    it('should return null when key already exists', async () => {
      mockClient.set.mockResolvedValue(null);

      const result = await adapter.setNX(
        TEST_STRINGS.ADAPTER_TEST_KEY,
        TEST_STRINGS.TEST_VALUE,
        5000
      );

      expect(result).toBeNull();
    });

    it('should validate key format', async () => {
      await expect(adapter.setNX('', 'value', 1000)).rejects.toThrow(
        'Lock key must be a non-empty string'
      );
    });

    it('should validate TTL value', async () => {
      await expect(adapter.setNX('key', 'value', 0)).rejects.toThrow(
        'TTL must be a positive integer'
      );
    });
  });

  describe('get', () => {
    it('should call Redis GET and return value', async () => {
      mockClient.get.mockResolvedValue(TEST_STRINGS.TEST_VALUE);

      const result = await adapter.get(TEST_STRINGS.ADAPTER_TEST_KEY);

      expect(mockClient.get).toHaveBeenCalledWith(TEST_STRINGS.ADAPTER_TEST_KEY);
      expect(result).toBe(TEST_STRINGS.TEST_VALUE);
    });

    it('should return null when key does not exist', async () => {
      mockClient.get.mockResolvedValue(null);

      const result = await adapter.get(TEST_STRINGS.ADAPTER_TEST_KEY);

      expect(result).toBeNull();
    });
  });

  describe('del', () => {
    it('should call Redis DEL and return count', async () => {
      mockClient.del.mockResolvedValue(1);

      const result = await adapter.del(TEST_STRINGS.ADAPTER_TEST_KEY);

      expect(mockClient.del).toHaveBeenCalledWith(TEST_STRINGS.ADAPTER_TEST_KEY);
      expect(result).toBe(1);
    });
  });

  describe('delIfMatch', () => {
    it('should execute Lua script for atomic delete-if-match', async () => {
      mockClient.scriptLoad.mockResolvedValue('mock-sha');
      mockClient.evalSha.mockResolvedValue(1);

      const result = await adapter.delIfMatch(
        TEST_STRINGS.ADAPTER_TEST_KEY,
        TEST_STRINGS.TEST_VALUE
      );

      expect(mockClient.scriptLoad).toHaveBeenCalled();
      expect(mockClient.evalSha).toHaveBeenCalledWith('mock-sha', {
        keys: [TEST_STRINGS.ADAPTER_TEST_KEY],
        arguments: [TEST_STRINGS.TEST_VALUE],
      });
      expect(result).toBe(true);
    });

    it('should return false when value does not match', async () => {
      mockClient.scriptLoad.mockResolvedValue('mock-sha');
      mockClient.evalSha.mockResolvedValue(0);

      const result = await adapter.delIfMatch(TEST_STRINGS.ADAPTER_TEST_KEY, 'wrong-value');

      expect(result).toBe(false);
    });
  });

  describe('extendIfMatch', () => {
    it('should execute Lua script for atomic extend-if-match', async () => {
      mockClient.scriptLoad.mockResolvedValue('mock-sha');
      mockClient.evalSha.mockResolvedValue(1);

      const result = await adapter.extendIfMatch(
        TEST_STRINGS.ADAPTER_TEST_KEY,
        TEST_STRINGS.TEST_VALUE,
        10000
      );

      expect(mockClient.scriptLoad).toHaveBeenCalled();
      expect(mockClient.evalSha).toHaveBeenCalledWith('mock-sha', {
        keys: [TEST_STRINGS.ADAPTER_TEST_KEY],
        arguments: [TEST_STRINGS.TEST_VALUE, '10000'],
      });
      expect(result).toBe(true);
    });

    it('should return false when value does not match', async () => {
      mockClient.scriptLoad.mockResolvedValue('mock-sha');
      mockClient.evalSha.mockResolvedValue(0);

      const result = await adapter.extendIfMatch(
        TEST_STRINGS.ADAPTER_TEST_KEY,
        'wrong-value',
        10000
      );

      expect(result).toBe(false);
    });

    it('should validate TTL value', async () => {
      await expect(adapter.extendIfMatch('key', 'value', -1)).rejects.toThrow(
        'TTL must be a positive integer'
      );
    });
  });

  describe('ping', () => {
    it('should call Redis PING', async () => {
      mockClient.ping.mockResolvedValue('PONG');

      const result = await adapter.ping();

      expect(mockClient.ping).toHaveBeenCalled();
      expect(result).toBe('PONG');
    });
  });

  describe('isConnected', () => {
    it('should return client ready status', () => {
      expect(adapter.isConnected()).toBe(true);

      mockClient.isReady = false;
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should call client disconnect', async () => {
      await adapter.disconnect();

      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('should handle disconnect errors gracefully', async () => {
      mockClient.disconnect.mockRejectedValue(new Error('Disconnect failed'));

      // Should not throw
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('key prefixing', () => {
    it('should add prefix to keys when configured', async () => {
      const prefixedAdapter = new NodeRedisAdapter(mockClient, { keyPrefix: 'test:' });
      mockClient.get.mockResolvedValue('value');

      await prefixedAdapter.get('key');

      expect(mockClient.get).toHaveBeenCalledWith('test:key');
    });
  });

  describe('timeout handling', () => {
    it('should timeout operations after configured time', async () => {
      const slowAdapter = new NodeRedisAdapter(mockClient, { timeout: 100 });
      mockClient.get.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 200)));

      await expect(slowAdapter.get('key')).rejects.toThrow('Operation timed out after 100ms');
    });
  });
});
