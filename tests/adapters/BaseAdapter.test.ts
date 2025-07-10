import { describe, it, expect } from 'vitest';
import { BaseAdapter } from '../../src/adapters/BaseAdapter.js';
import type { RedisAdapterOptions } from '../../src/types/adapters.js';

// Concrete implementation for testing
class TestAdapter extends BaseAdapter {
  constructor(options?: RedisAdapterOptions) {
    super(options);
  }

  async setNX(): Promise<string | null> {
    return 'OK';
  }
  async get(): Promise<string | null> {
    return null;
  }
  async del(): Promise<number> {
    return 0;
  }
  async delIfMatch(): Promise<boolean> {
    return false;
  }
  async ping(): Promise<string> {
    return 'PONG';
  }
  isConnected(): boolean {
    return true;
  }
  async disconnect(): Promise<void> {}

  // Expose protected methods for testing
  public testValidateKey(key: string): void {
    return this.validateKey(key);
  }

  public testValidateValue(value: string): void {
    return this.validateValue(value);
  }

  public testValidateTTL(ttl: number): void {
    return this.validateTTL(ttl);
  }

  public testPrefixKey(key: string): string {
    return this.prefixKey(key);
  }

  public testWithTimeout<T>(operation: Promise<T>, timeout?: number): Promise<T> {
    return this.withTimeout(operation, timeout);
  }
}

describe('BaseAdapter', () => {
  describe('constructor', () => {
    it('should use default options when none provided', () => {
      const adapter = new TestAdapter();
      expect(adapter['options'].keyPrefix).toBe('');
      expect(adapter['options'].maxRetries).toBe(3);
      expect(adapter['options'].retryDelay).toBe(100);
      expect(adapter['options'].timeout).toBe(5000);
    });

    it('should override default options when provided', () => {
      const options: RedisAdapterOptions = {
        keyPrefix: 'test:',
        maxRetries: 5,
        retryDelay: 200,
        timeout: 10000,
      };

      const adapter = new TestAdapter(options);
      expect(adapter['options'].keyPrefix).toBe('test:');
      expect(adapter['options'].maxRetries).toBe(5);
      expect(adapter['options'].retryDelay).toBe(200);
      expect(adapter['options'].timeout).toBe(10000);
    });
  });

  describe('validateKey', () => {
    it('should accept valid keys', () => {
      const adapter = new TestAdapter();
      expect(() => adapter.testValidateKey('valid-key')).not.toThrow();
      expect(() => adapter.testValidateKey('key:with:colons')).not.toThrow();
      expect(() => adapter.testValidateKey('key_with_underscores')).not.toThrow();
    });

    it('should reject empty or invalid keys', () => {
      const adapter = new TestAdapter();
      expect(() => adapter.testValidateKey('')).toThrow('Lock key must be a non-empty string');
      expect(() => adapter.testValidateKey(null as any)).toThrow(
        'Lock key must be a non-empty string'
      );
      expect(() => adapter.testValidateKey(undefined as any)).toThrow(
        'Lock key must be a non-empty string'
      );
    });

    it('should reject keys that are too long', () => {
      const adapter = new TestAdapter();
      const longKey = 'a'.repeat(513);
      expect(() => adapter.testValidateKey(longKey)).toThrow(
        'Lock key must be less than 512 characters'
      );
    });

    it('should reject keys with newlines', () => {
      const adapter = new TestAdapter();
      expect(() => adapter.testValidateKey('key\nwith\nnewlines')).toThrow(
        'Lock key cannot contain newline characters'
      );
      expect(() => adapter.testValidateKey('key\rwith\rcarriagereturns')).toThrow(
        'Lock key cannot contain newline characters'
      );
    });
  });

  describe('validateValue', () => {
    it('should accept valid values', () => {
      const adapter = new TestAdapter();
      expect(() => adapter.testValidateValue('valid-value')).not.toThrow();
      expect(() => adapter.testValidateValue('value:with:colons')).not.toThrow();
    });

    it('should reject empty or invalid values', () => {
      const adapter = new TestAdapter();
      expect(() => adapter.testValidateValue('')).toThrow('Lock value must be a non-empty string');
      expect(() => adapter.testValidateValue(null as any)).toThrow(
        'Lock value must be a non-empty string'
      );
    });

    it('should reject values that are too long', () => {
      const adapter = new TestAdapter();
      const longValue = 'a'.repeat(1025);
      expect(() => adapter.testValidateValue(longValue)).toThrow(
        'Lock value must be less than 1024 characters'
      );
    });
  });

  describe('validateTTL', () => {
    it('should accept valid TTL values', () => {
      const adapter = new TestAdapter();
      expect(() => adapter.testValidateTTL(1000)).not.toThrow();
      expect(() => adapter.testValidateTTL(30000)).not.toThrow();
      expect(() => adapter.testValidateTTL(86400000)).not.toThrow(); // 24 hours
    });

    it('should reject invalid TTL values', () => {
      const adapter = new TestAdapter();
      expect(() => adapter.testValidateTTL(0)).toThrow('TTL must be a positive integer');
      expect(() => adapter.testValidateTTL(-1)).toThrow('TTL must be a positive integer');
      expect(() => adapter.testValidateTTL(1.5)).toThrow('TTL must be a positive integer');
      expect(() => adapter.testValidateTTL(86400001)).toThrow('TTL cannot exceed 24 hours');
    });
  });

  describe('prefixKey', () => {
    it('should add prefix when configured', () => {
      const adapter = new TestAdapter({ keyPrefix: 'locks:' });
      expect(adapter.testPrefixKey('my-key')).toBe('locks:my-key');
    });

    it('should not add prefix when not configured', () => {
      const adapter = new TestAdapter();
      expect(adapter.testPrefixKey('my-key')).toBe('my-key');
    });

    it('should handle empty prefix', () => {
      const adapter = new TestAdapter({ keyPrefix: '' });
      expect(adapter.testPrefixKey('my-key')).toBe('my-key');
    });
  });

  describe('withTimeout', () => {
    it('should resolve when operation completes before timeout', async () => {
      const adapter = new TestAdapter();
      const operation = Promise.resolve('success');

      const result = await adapter.testWithTimeout(operation, 1000);
      expect(result).toBe('success');
    });

    it('should reject when operation times out', async () => {
      const adapter = new TestAdapter();
      const operation = new Promise(resolve => setTimeout(() => resolve('late'), 200));

      await expect(adapter.testWithTimeout(operation, 100)).rejects.toThrow(
        'Operation timed out after 100ms'
      );
    });

    it('should use default timeout when not specified', async () => {
      const adapter = new TestAdapter({ timeout: 100 });
      const operation = new Promise(resolve => setTimeout(() => resolve('late'), 200));

      await expect(adapter.testWithTimeout(operation)).rejects.toThrow(
        'Operation timed out after 100ms'
      );
    });
  });
});
