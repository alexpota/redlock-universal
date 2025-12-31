import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GlideAdapter } from '../../../src/adapters/GlideAdapter.js';
import { TEST_STRINGS } from '../../shared/constants.js';

describe('GlideAdapter Unit Tests', () => {
  let mockClient: any;
  let adapter: GlideAdapter;

  beforeEach(() => {
    mockClient = {
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      customCommand: vi.fn(),
      close: vi.fn(),
    };

    adapter = new GlideAdapter(mockClient);
  });

  describe('setNX', () => {
    it('should call GLIDE set with conditionalSet and expiry options', async () => {
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
          conditionalSet: 'onlyIfDoesNotExist',
          expiry: { type: 'PX', count: 5000 },
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
    it('should call GLIDE get and return value', async () => {
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
    it('should call GLIDE del with array of keys and return count', async () => {
      mockClient.del.mockResolvedValue(1);

      const result = await adapter.del(TEST_STRINGS.ADAPTER_TEST_KEY);

      expect(mockClient.del).toHaveBeenCalledWith([TEST_STRINGS.ADAPTER_TEST_KEY]);
      expect(result).toBe(1);
    });
  });

  describe('delIfMatch', () => {
    it('should execute Lua script for atomic delete-if-match', async () => {
      // First call loads script, second executes it
      mockClient.customCommand
        .mockResolvedValueOnce('mock-sha') // SCRIPT LOAD
        .mockResolvedValueOnce(1); // EVALSHA

      const result = await adapter.delIfMatch(
        TEST_STRINGS.ADAPTER_TEST_KEY,
        TEST_STRINGS.TEST_VALUE
      );

      expect(mockClient.customCommand).toHaveBeenCalledWith(['SCRIPT', 'LOAD', expect.any(String)]);
      expect(mockClient.customCommand).toHaveBeenCalledWith([
        'EVALSHA',
        'mock-sha',
        '1',
        TEST_STRINGS.ADAPTER_TEST_KEY,
        TEST_STRINGS.TEST_VALUE,
      ]);
      expect(result).toBe(true);
    });

    it('should return false when value does not match', async () => {
      mockClient.customCommand.mockResolvedValueOnce('mock-sha').mockResolvedValueOnce(0);

      const result = await adapter.delIfMatch(TEST_STRINGS.ADAPTER_TEST_KEY, 'wrong-value');

      expect(result).toBe(false);
    });
  });

  describe('extendIfMatch', () => {
    it('should execute Lua script for atomic extend-if-match', async () => {
      mockClient.customCommand.mockResolvedValueOnce('mock-sha').mockResolvedValueOnce(1);

      const result = await adapter.extendIfMatch(
        TEST_STRINGS.ADAPTER_TEST_KEY,
        TEST_STRINGS.TEST_VALUE,
        10000
      );

      expect(mockClient.customCommand).toHaveBeenCalledWith(['SCRIPT', 'LOAD', expect.any(String)]);
      expect(mockClient.customCommand).toHaveBeenCalledWith([
        'EVALSHA',
        'mock-sha',
        '1',
        TEST_STRINGS.ADAPTER_TEST_KEY,
        TEST_STRINGS.TEST_VALUE,
        '10000',
      ]);
      expect(result).toBe(true);
    });

    it('should return false when value does not match', async () => {
      mockClient.customCommand.mockResolvedValueOnce('mock-sha').mockResolvedValueOnce(0);

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
    it('should call GLIDE customCommand with PING', async () => {
      mockClient.customCommand.mockResolvedValue('PONG');

      const result = await adapter.ping();

      expect(mockClient.customCommand).toHaveBeenCalledWith(['PING']);
      expect(result).toBe('PONG');
    });
  });

  describe('isConnected', () => {
    it('should return true by default (GLIDE manages connection internally)', () => {
      expect(adapter.isConnected()).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('should call client close', async () => {
      await adapter.disconnect();

      expect(mockClient.close).toHaveBeenCalled();
    });

    it('should handle close errors gracefully', async () => {
      mockClient.close.mockImplementation(() => {
        throw new Error('Close failed');
      });

      // Should not throw
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('key prefixing', () => {
    it('should add prefix to keys when configured', async () => {
      const prefixedAdapter = new GlideAdapter(mockClient, { keyPrefix: 'test:' });
      mockClient.get.mockResolvedValue('value');

      await prefixedAdapter.get('key');

      expect(mockClient.get).toHaveBeenCalledWith('test:key');
    });
  });

  describe('timeout handling', () => {
    it('should timeout operations after configured time', async () => {
      const slowAdapter = new GlideAdapter(mockClient, { timeout: 100 });
      mockClient.get.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 200)));

      await expect(slowAdapter.get('key')).rejects.toThrow('Operation timed out after 100ms');
    });
  });
});
