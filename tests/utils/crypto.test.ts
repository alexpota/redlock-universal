import { describe, it, expect } from 'vitest';
import {
  generateLockValue,
  generateLockId,
  safeCompare,
  createLockValueWithMetadata,
  parseLockValue,
  isValidLockValue,
} from '../../src/utils/crypto.js';

describe('Crypto Utilities', () => {
  describe('generateLockValue', () => {
    it('should generate unique lock values', () => {
      const value1 = generateLockValue();
      const value2 = generateLockValue();

      expect(value1).toBeDefined();
      expect(value2).toBeDefined();
      expect(value1).not.toBe(value2);
      expect(typeof value1).toBe('string');
      expect(value1.length).toBe(32); // 16 bytes = 32 hex chars
    });

    it('should generate hex-encoded values', () => {
      const value = generateLockValue();
      expect(value).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe('generateLockId', () => {
    it('should generate unique lock IDs', () => {
      const id1 = generateLockId();
      const id2 = generateLockId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });

    it('should include timestamp and random parts', () => {
      const before = Date.now();
      const id = generateLockId();
      const after = Date.now();

      expect(id).toMatch(/^\d+-[0-9a-f]{12}$/);

      const [timestampStr] = id.split('-');
      const timestamp = parseInt(timestampStr, 10);

      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('safeCompare', () => {
    it('should return true for identical strings', () => {
      const str = 'test-string';
      expect(safeCompare(str, str)).toBe(true);
      expect(safeCompare('hello', 'hello')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(safeCompare('hello', 'world')).toBe(false);
      expect(safeCompare('test', 'Test')).toBe(false);
    });

    it('should return false for different length strings', () => {
      expect(safeCompare('short', 'longer')).toBe(false);
      expect(safeCompare('a', 'ab')).toBe(false);
    });

    it('should handle empty strings', () => {
      expect(safeCompare('', '')).toBe(true);
      expect(safeCompare('', 'a')).toBe(false);
      expect(safeCompare('a', '')).toBe(false);
    });

    it('should be timing-safe (basic test)', () => {
      // This is a basic test - real timing attack testing would be more complex
      const longString1 = 'a'.repeat(1000);
      const longString2 = 'b'.repeat(1000);
      const differentAtStart = `b${'a'.repeat(999)}`;

      // Should return false regardless of where difference occurs
      expect(safeCompare(longString1, longString2)).toBe(false);
      expect(safeCompare(longString1, differentAtStart)).toBe(false);
    });
  });

  describe('createLockValueWithMetadata', () => {
    it('should create value with default node ID', () => {
      const value = createLockValueWithMetadata();
      expect(value).toMatch(/^node:\d+:[0-9a-f]{16}$/);
    });

    it('should create value with custom node ID', () => {
      const value = createLockValueWithMetadata('server-1');
      expect(value).toMatch(/^server-1:\d+:[0-9a-f]{16}$/);
    });

    it('should include current timestamp', () => {
      const before = Date.now();
      const value = createLockValueWithMetadata('test');
      const after = Date.now();

      const parts = value.split(':');
      const timestamp = parseInt(parts[1], 10);

      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('parseLockValue', () => {
    it('should parse valid lock value with metadata', () => {
      const nodeId = 'server-1';
      const value = createLockValueWithMetadata(nodeId);
      const parsed = parseLockValue(value);

      expect(parsed).toBeDefined();
      expect(parsed!.nodeId).toBe(nodeId);
      expect(typeof parsed!.timestamp).toBe('number');
      expect(parsed!.random).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should return null for invalid format', () => {
      expect(parseLockValue('invalid')).toBeNull();
      expect(parseLockValue('one:two')).toBeNull();
      expect(parseLockValue('one:two:three:four')).toBeNull();
      expect(parseLockValue('')).toBeNull();
    });

    it('should return null for invalid timestamp', () => {
      expect(parseLockValue('node:invalid:abc123')).toBeNull();
      expect(parseLockValue('node:12.34:abc123')).toBeNull();
    });

    it('should handle regular lock values', () => {
      const regularValue = generateLockValue();
      expect(parseLockValue(regularValue)).toBeNull();
    });
  });

  describe('isValidLockValue', () => {
    it('should accept valid lock values', () => {
      expect(isValidLockValue(generateLockValue())).toBe(true);
      expect(isValidLockValue(createLockValueWithMetadata())).toBe(true);
      expect(isValidLockValue('simple-lock-value')).toBe(true);
      expect(isValidLockValue('lock-123-abc')).toBe(true);
    });

    it('should reject invalid values', () => {
      expect(isValidLockValue('')).toBe(false);
      expect(isValidLockValue(null as any)).toBe(false);
      expect(isValidLockValue(undefined as any)).toBe(false);
      expect(isValidLockValue(123 as any)).toBe(false);
    });

    it('should reject values that are too short or too long', () => {
      expect(isValidLockValue('short')).toBe(false); // < 8 chars
      expect(isValidLockValue('a'.repeat(257))).toBe(false); // > 256 chars
      expect(isValidLockValue('a'.repeat(8))).toBe(true); // exactly 8 chars
      expect(isValidLockValue('a'.repeat(256))).toBe(true); // exactly 256 chars
    });

    it('should reject values with unsafe characters', () => {
      expect(isValidLockValue('value\nwith\nnewline')).toBe(false);
      expect(isValidLockValue('value\rwith\rcarriage')).toBe(false);
      expect(isValidLockValue('value\x00with\x00null')).toBe(false);
    });
  });

  describe('security properties', () => {
    it('should generate cryptographically strong values', () => {
      // Generate many values and check for patterns
      const values = new Set();
      const numValues = 1000;

      for (let i = 0; i < numValues; i++) {
        values.add(generateLockValue());
      }

      // All values should be unique
      expect(values.size).toBe(numValues);
    });

    it('should generate unpredictable IDs', () => {
      const ids = new Set();
      const numIds = 1000;

      for (let i = 0; i < numIds; i++) {
        ids.add(generateLockId());
      }

      // All IDs should be unique (except for timestamp collisions)
      expect(ids.size).toBeGreaterThan(numIds * 0.99); // Allow for some timestamp collisions
    });
  });
});
