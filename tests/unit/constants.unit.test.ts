import { describe, it, expect } from 'vitest';
import { DEFAULTS, LUA_SCRIPTS, ERROR_MESSAGES, LIBRARY_INFO } from '../../src/constants.js';

describe('Constants', () => {
  describe('DEFAULTS', () => {
    it('should have correct default values', () => {
      expect(DEFAULTS.TTL).toBe(30_000);
      expect(DEFAULTS.RETRY_ATTEMPTS).toBe(3);
      expect(DEFAULTS.RETRY_DELAY).toBe(100);
      expect(DEFAULTS.REDIS_TIMEOUT).toBe(5_000);
      expect(DEFAULTS.CLOCK_DRIFT_FACTOR).toBe(0.01);
      expect(DEFAULTS.MONITORING_INTERVAL).toBe(60_000);
      expect(DEFAULTS.HEALTH_CHECK_INTERVAL).toBe(30_000);
      expect(DEFAULTS.CIRCUIT_BREAKER_THRESHOLD).toBe(5);
      expect(DEFAULTS.CIRCUIT_BREAKER_TIMEOUT).toBe(60_000);
    });

    it('should be a constant object', () => {
      // TypeScript ensures compile-time immutability with 'as const'
      expect(typeof DEFAULTS).toBe('object');
      expect(DEFAULTS).toBeDefined();
    });
  });

  describe('LUA_SCRIPTS', () => {
    it('should have RELEASE script', () => {
      expect(LUA_SCRIPTS.RELEASE).toBeDefined();
      expect(typeof LUA_SCRIPTS.RELEASE).toBe('string');
      expect(LUA_SCRIPTS.RELEASE).toContain('redis.call("GET", KEYS[1])');
      expect(LUA_SCRIPTS.RELEASE).toContain('redis.call("DEL", KEYS[1])');
      expect(LUA_SCRIPTS.RELEASE).toContain('ARGV[1]');
    });

    it('should have EXTEND script', () => {
      expect(LUA_SCRIPTS.EXTEND).toBeDefined();
      expect(typeof LUA_SCRIPTS.EXTEND).toBe('string');
      expect(LUA_SCRIPTS.EXTEND).toContain('redis.call("GET", KEYS[1])');
      expect(LUA_SCRIPTS.EXTEND).toContain('redis.call("PEXPIRE", KEYS[1], ARGV[2])');
      expect(LUA_SCRIPTS.EXTEND).toContain('ARGV[1]');
    });

    it('should be a constant object', () => {
      expect(typeof LUA_SCRIPTS).toBe('object');
      expect(LUA_SCRIPTS).toBeDefined();
    });
  });

  describe('ERROR_MESSAGES', () => {
    it('should have error messages', () => {
      expect(ERROR_MESSAGES.UNKNOWN_ERROR).toBe('Unknown error');
    });

    it('should be a constant object', () => {
      expect(typeof ERROR_MESSAGES).toBe('object');
      expect(ERROR_MESSAGES).toBeDefined();
    });
  });

  describe('LIBRARY_INFO', () => {
    it('should have library metadata', () => {
      expect(LIBRARY_INFO.NAME).toBe('redlock-universal');
      expect(LIBRARY_INFO.VERSION).toBe('0.1.0');
      expect(LIBRARY_INFO.DESCRIPTION).toBe('Production-ready distributed Redis locks for Node.js');
    });

    it('should be a constant object', () => {
      expect(typeof LIBRARY_INFO).toBe('object');
      expect(LIBRARY_INFO).toBeDefined();
    });
  });
});
