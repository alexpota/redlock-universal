import { describe, it, expect } from 'vitest';
import * as RedlockUniversal from '../../src/index.js';

describe('Main Entry Point', () => {
  describe('Factory Functions', () => {
    it('should export createLock', () => {
      expect(RedlockUniversal.createLock).toBeDefined();
      expect(typeof RedlockUniversal.createLock).toBe('function');
    });

    it('should export createLocks', () => {
      expect(RedlockUniversal.createLocks).toBeDefined();
      expect(typeof RedlockUniversal.createLocks).toBe('function');
    });

    it('should export createPrefixedLock', () => {
      expect(RedlockUniversal.createPrefixedLock).toBeDefined();
      expect(typeof RedlockUniversal.createPrefixedLock).toBe('function');
    });

    it('should export createRedlock', () => {
      expect(RedlockUniversal.createRedlock).toBeDefined();
      expect(typeof RedlockUniversal.createRedlock).toBe('function');
    });

    it('should export createRedlocks', () => {
      expect(RedlockUniversal.createRedlocks).toBeDefined();
      expect(typeof RedlockUniversal.createRedlocks).toBe('function');
    });
  });

  describe('Lock Classes', () => {
    it('should export SimpleLock', () => {
      expect(RedlockUniversal.SimpleLock).toBeDefined();
      expect(typeof RedlockUniversal.SimpleLock).toBe('function');
    });

    it('should export LeanSimpleLock', () => {
      expect(RedlockUniversal.LeanSimpleLock).toBeDefined();
      expect(typeof RedlockUniversal.LeanSimpleLock).toBe('function');
    });

    it('should export RedLock', () => {
      expect(RedlockUniversal.RedLock).toBeDefined();
      expect(typeof RedlockUniversal.RedLock).toBe('function');
    });
  });

  describe('Adapter Classes', () => {
    it('should export BaseAdapter', () => {
      expect(RedlockUniversal.BaseAdapter).toBeDefined();
      expect(typeof RedlockUniversal.BaseAdapter).toBe('function');
    });

    it('should export NodeRedisAdapter', () => {
      expect(RedlockUniversal.NodeRedisAdapter).toBeDefined();
      expect(typeof RedlockUniversal.NodeRedisAdapter).toBe('function');
    });

    it('should export IoredisAdapter', () => {
      expect(RedlockUniversal.IoredisAdapter).toBeDefined();
      expect(typeof RedlockUniversal.IoredisAdapter).toBe('function');
    });
  });

  describe('Manager Classes', () => {
    it('should export LockManager', () => {
      expect(RedlockUniversal.LockManager).toBeDefined();
      expect(typeof RedlockUniversal.LockManager).toBe('function');
    });
  });

  describe('Monitoring', () => {
    it('should export MetricsCollector', () => {
      expect(RedlockUniversal.MetricsCollector).toBeDefined();
      expect(typeof RedlockUniversal.MetricsCollector).toBe('function');
    });

    it('should export HealthChecker', () => {
      expect(RedlockUniversal.HealthChecker).toBeDefined();
      expect(typeof RedlockUniversal.HealthChecker).toBe('function');
    });

    it('should export Logger', () => {
      expect(RedlockUniversal.Logger).toBeDefined();
      expect(typeof RedlockUniversal.Logger).toBe('function');
    });

    it('should export LogLevel', () => {
      expect(RedlockUniversal.LogLevel).toBeDefined();
      expect(typeof RedlockUniversal.LogLevel).toBe('object');
    });

    it('should export logger instance', () => {
      expect(RedlockUniversal.logger).toBeDefined();
      expect(RedlockUniversal.logger).toBeInstanceOf(RedlockUniversal.Logger);
    });
  });

  describe('Utility Functions', () => {
    it('should export generateLockValue', () => {
      expect(RedlockUniversal.generateLockValue).toBeDefined();
      expect(typeof RedlockUniversal.generateLockValue).toBe('function');
    });

    it('should export generateLockId', () => {
      expect(RedlockUniversal.generateLockId).toBeDefined();
      expect(typeof RedlockUniversal.generateLockId).toBe('function');
    });

    it('should export safeCompare', () => {
      expect(RedlockUniversal.safeCompare).toBeDefined();
      expect(typeof RedlockUniversal.safeCompare).toBe('function');
    });

    it('should export createLockValueWithMetadata', () => {
      expect(RedlockUniversal.createLockValueWithMetadata).toBeDefined();
      expect(typeof RedlockUniversal.createLockValueWithMetadata).toBe('function');
    });

    it('should export parseLockValue', () => {
      expect(RedlockUniversal.parseLockValue).toBeDefined();
      expect(typeof RedlockUniversal.parseLockValue).toBe('function');
    });

    it('should export isValidLockValue', () => {
      expect(RedlockUniversal.isValidLockValue).toBeDefined();
      expect(typeof RedlockUniversal.isValidLockValue).toBe('function');
    });
  });

  describe('Error Classes', () => {
    it('should export RedlockError', () => {
      expect(RedlockUniversal.RedlockError).toBeDefined();
      expect(typeof RedlockUniversal.RedlockError).toBe('function');
    });

    it('should export LockAcquisitionError', () => {
      expect(RedlockUniversal.LockAcquisitionError).toBeDefined();
      expect(typeof RedlockUniversal.LockAcquisitionError).toBe('function');
    });

    it('should export LockReleaseError', () => {
      expect(RedlockUniversal.LockReleaseError).toBeDefined();
      expect(typeof RedlockUniversal.LockReleaseError).toBe('function');
    });

    it('should export LockExtensionError', () => {
      expect(RedlockUniversal.LockExtensionError).toBeDefined();
      expect(typeof RedlockUniversal.LockExtensionError).toBe('function');
    });

    it('should export AdapterError', () => {
      expect(RedlockUniversal.AdapterError).toBeDefined();
      expect(typeof RedlockUniversal.AdapterError).toBe('function');
    });

    it('should export ConfigurationError', () => {
      expect(RedlockUniversal.ConfigurationError).toBeDefined();
      expect(typeof RedlockUniversal.ConfigurationError).toBe('function');
    });
  });

  describe('Constants', () => {
    it('should export DEFAULTS', () => {
      expect(RedlockUniversal.DEFAULTS).toBeDefined();
      expect(typeof RedlockUniversal.DEFAULTS).toBe('object');
    });

    it('should export LUA_SCRIPTS', () => {
      expect(RedlockUniversal.LUA_SCRIPTS).toBeDefined();
      expect(typeof RedlockUniversal.LUA_SCRIPTS).toBe('object');
    });

    it('should export LIBRARY_INFO', () => {
      expect(RedlockUniversal.LIBRARY_INFO).toBeDefined();
      expect(typeof RedlockUniversal.LIBRARY_INFO).toBe('object');
    });
  });
});
