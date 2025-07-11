import { describe, it, expect, vi } from 'vitest';
import { LockManager } from '../../../src/manager/LockManager.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';

// Mock Redis adapter for testing
class MockRedisAdapter implements RedisAdapter {
  private storage = new Map<string, { value: string; expiry: number }>();

  constructor(public nodeId: string = 'mock-node') {}

  async ping(): Promise<string> {
    return 'PONG';
  }

  isConnected(): boolean {
    return true;
  }

  async setNX(key: string, value: string, ttl: number): Promise<'OK' | null> {
    const now = Date.now();
    if (this.storage.has(key)) {
      const item = this.storage.get(key)!;
      if (item.expiry > now) {
        return null; // Key exists and not expired
      }
    }

    this.storage.set(key, { value, expiry: now + ttl });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const item = this.storage.get(key);
    if (!item) return null;

    if (item.expiry <= Date.now()) {
      this.storage.delete(key);
      return null;
    }

    return item.value;
  }

  async del(key: string): Promise<number> {
    return this.storage.delete(key) ? 1 : 0;
  }

  async delIfMatch(key: string, value: string): Promise<boolean> {
    const item = this.storage.get(key);
    if (!item || item.value !== value) return false;

    this.storage.delete(key);
    return true;
  }

  async extendIfMatch(key: string, value: string, ttl: number): Promise<boolean> {
    const item = this.storage.get(key);
    if (!item || item.value !== value) return false;

    this.storage.set(key, { value, expiry: Date.now() + ttl });
    return true;
  }

  async disconnect(): Promise<void> {
    this.storage.clear();
  }
}

describe('LockManager', () => {
  describe('constructor', () => {
    it('should create manager with single node', () => {
      const adapter = new MockRedisAdapter();
      const manager = new LockManager({ nodes: [adapter] });

      expect(manager).toBeDefined();
      expect(manager.getStats().totalLocks).toBe(0);
    });

    it('should create manager with multiple nodes', () => {
      const adapters = [
        new MockRedisAdapter('node1'),
        new MockRedisAdapter('node2'),
        new MockRedisAdapter('node3'),
      ];
      const manager = new LockManager({ nodes: adapters });

      expect(manager).toBeDefined();
    });

    it('should validate configuration', () => {
      expect(() => new LockManager({ nodes: [] })).toThrow('At least one Redis node is required');

      expect(
        () =>
          new LockManager({
            nodes: [new MockRedisAdapter()],
            defaultTTL: -1,
          })
      ).toThrow('Default TTL must be positive');
    });
  });

  describe('createSimpleLock', () => {
    it('should create simple lock with default settings', () => {
      const adapter = new MockRedisAdapter();
      const manager = new LockManager({ nodes: [adapter] });

      const lock = manager.createSimpleLock('test-key');
      expect(lock).toBeDefined();
    });

    it('should create simple lock with custom settings', () => {
      const adapter = new MockRedisAdapter();
      const manager = new LockManager({ nodes: [adapter] });

      const lock = manager.createSimpleLock('test-key', {
        ttl: 5000,
        retryAttempts: 3,
      });
      expect(lock).toBeDefined();
    });

    it('should validate node index', () => {
      const adapter = new MockRedisAdapter();
      const manager = new LockManager({ nodes: [adapter] });

      expect(() => manager.createSimpleLock('test-key', { nodeIndex: 1 })).toThrow(
        'Node index 1 is out of range'
      );
    });
  });

  describe('createRedLock', () => {
    it('should create RedLock with sufficient nodes', () => {
      const adapters = [
        new MockRedisAdapter('node1'),
        new MockRedisAdapter('node2'),
        new MockRedisAdapter('node3'),
      ];
      const manager = new LockManager({ nodes: adapters });

      const lock = manager.createRedLock('test-key');
      expect(lock).toBeDefined();
    });

    it('should require at least 3 nodes for RedLock', () => {
      const adapters = [new MockRedisAdapter('node1'), new MockRedisAdapter('node2')];
      const manager = new LockManager({ nodes: adapters });

      expect(() => manager.createRedLock('test-key')).toThrow(
        'RedLock requires at least 3 Redis nodes'
      );
    });
  });

  describe('acquireLock and releaseLock', () => {
    it('should acquire and release simple lock', async () => {
      const adapter = new MockRedisAdapter();
      const manager = new LockManager({ nodes: [adapter] });

      const handle = await manager.acquireLock('test-key');
      expect(handle).toBeDefined();
      expect(handle.key).toBe('test-key');

      const stats = manager.getStats();
      expect(stats.totalLocks).toBe(1);
      expect(stats.activeLocks).toBe(1);
      expect(stats.acquiredLocks).toBe(1);

      const released = await manager.releaseLock(handle);
      expect(released).toBe(true);

      const finalStats = manager.getStats();
      expect(finalStats.activeLocks).toBe(0);
    });

    it('should acquire and release RedLock', async () => {
      const adapters = [
        new MockRedisAdapter('node1'),
        new MockRedisAdapter('node2'),
        new MockRedisAdapter('node3'),
      ];
      const manager = new LockManager({ nodes: adapters });

      const handle = await manager.acquireLock('test-key', { useRedLock: true });
      expect(handle).toBeDefined();
      expect(handle.key).toBe('test-key');

      const released = await manager.releaseLock(handle);
      expect(released).toBe(true);
    });

    it('should track failed lock attempts', async () => {
      const adapter = new MockRedisAdapter();
      const manager = new LockManager({ nodes: [adapter] });

      // First lock succeeds
      const handle1 = await manager.acquireLock('test-key');

      // Second lock should fail (same key)
      await expect(manager.acquireLock('test-key', { retryAttempts: 0 })).rejects.toThrow();

      const stats = manager.getStats();
      expect(stats.failedLocks).toBe(1);
      expect(stats.acquiredLocks).toBe(1);

      await manager.releaseLock(handle1);
    });
  });

  describe('getActiveLocks', () => {
    it('should return list of active locks', async () => {
      const adapter = new MockRedisAdapter();
      const manager = new LockManager({ nodes: [adapter] });

      expect(manager.getActiveLocks()).toHaveLength(0);

      const handle1 = await manager.acquireLock('test-key-1');
      const handle2 = await manager.acquireLock('test-key-2');

      const activeLocks = manager.getActiveLocks();
      expect(activeLocks).toHaveLength(2);
      expect(activeLocks.map(h => h.key)).toContain('test-key-1');
      expect(activeLocks.map(h => h.key)).toContain('test-key-2');

      await manager.releaseLock(handle1);
      await manager.releaseLock(handle2);
    });
  });

  describe('checkHealth', () => {
    it('should check health of all nodes', async () => {
      const adapters = [
        new MockRedisAdapter('node1'),
        new MockRedisAdapter('node2'),
        new MockRedisAdapter('node3'),
      ];
      const manager = new LockManager({ nodes: adapters });

      const health = await manager.checkHealth();
      expect(health.healthy).toBe(true);
      expect(health.nodes).toHaveLength(3);
      expect(health.nodes.every(node => node.healthy)).toBe(true);
    });

    it('should detect unhealthy nodes', async () => {
      const healthyAdapter = new MockRedisAdapter('healthy');
      const unhealthyAdapter = new MockRedisAdapter('unhealthy');

      // Mock unhealthy adapter
      vi.spyOn(unhealthyAdapter, 'ping').mockRejectedValue(new Error('Connection failed'));

      const manager = new LockManager({ nodes: [healthyAdapter, unhealthyAdapter] });

      const health = await manager.checkHealth();
      expect(health.healthy).toBe(true); // Still healthy with 1/2 nodes
      expect(health.nodes).toHaveLength(2);
      expect(health.nodes[0].healthy).toBe(true);
      expect(health.nodes[1].healthy).toBe(false);
      expect(health.nodes[1].error).toBe('Connection failed');
    });
  });

  describe('cleanupExpiredLocks', () => {
    it('should clean up expired locks from tracking', async () => {
      const adapter = new MockRedisAdapter();
      const manager = new LockManager({ nodes: [adapter] });

      // Acquire a lock with very short TTL
      await manager.acquireLock('test-key', { ttl: 1 });

      expect(manager.getStats().activeLocks).toBe(1);

      // Wait for lock to expire
      await new Promise(resolve => setTimeout(resolve, 10));

      const cleaned = await manager.cleanupExpiredLocks();
      expect(cleaned).toBe(1);
      expect(manager.getStats().activeLocks).toBe(0);
    });
  });

  describe('getMetrics', () => {
    it('should return empty metrics when monitoring disabled', () => {
      const adapter = new MockRedisAdapter();
      const manager = new LockManager({ nodes: [adapter] });

      const metrics = manager.getMetrics();
      expect(metrics).toBe('');
    });

    it('should return Prometheus metrics when monitoring enabled', async () => {
      const adapter = new MockRedisAdapter();
      const manager = new LockManager({
        nodes: [adapter],
        monitoring: { enabled: true },
      });

      const handle = await manager.acquireLock('test-key');
      await manager.releaseLock(handle);

      const metrics = manager.getMetrics();
      expect(metrics).toContain('redlock_locks_total');
      expect(metrics).toContain('redlock_locks_active');
      expect(metrics).toContain('redlock_locks_acquired_total');
      expect(metrics).toContain('redlock_acquisition_duration_ms');
    });
  });
});
