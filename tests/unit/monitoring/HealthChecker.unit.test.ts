import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthChecker } from '../../../src/monitoring/HealthChecker.js';
import type { RedisAdapter, AtomicExtensionResult } from '../../../src/types/adapters.js';

describe('HealthChecker', () => {
  let healthChecker: HealthChecker;
  let mockAdapter: RedisAdapter;

  beforeEach(() => {
    healthChecker = new HealthChecker();

    // Create mock adapter
    mockAdapter = {
      setNX: vi.fn(),
      del: vi.fn(),
      get: vi.fn(),
      delIfMatch: vi.fn(),
      extendIfMatch: vi.fn(),
      atomicExtend: vi.fn().mockResolvedValue({
        resultCode: 1,
        actualTTL: 5000,
        message: 'Extended successfully',
      } as AtomicExtensionResult),
      ping: vi.fn(),
      isConnected: vi.fn(),
      disconnect: vi.fn(),
    };
  });

  describe('registerAdapter', () => {
    it('should register adapter successfully', () => {
      healthChecker.registerAdapter('test-adapter', mockAdapter);

      // Should not throw and should be registered
      expect(() => healthChecker.registerAdapter('test-adapter', mockAdapter)).not.toThrow();
    });

    it('should allow multiple adapters', () => {
      const adapter2 = { ...mockAdapter } as RedisAdapter;

      healthChecker.registerAdapter('adapter-1', mockAdapter);
      healthChecker.registerAdapter('adapter-2', adapter2);

      expect(() => healthChecker.registerAdapter('adapter-1', mockAdapter)).not.toThrow();
      expect(() => healthChecker.registerAdapter('adapter-2', adapter2)).not.toThrow();
    });
  });

  describe('checkAdapterHealth', () => {
    beforeEach(() => {
      healthChecker.registerAdapter('test-adapter', mockAdapter);
    });

    it('should return healthy status when setNX and get succeed', async () => {
      vi.mocked(mockAdapter.setNX).mockResolvedValue('OK');
      vi.mocked(mockAdapter.get).mockResolvedValue('ping');
      vi.mocked(mockAdapter.del).mockResolvedValue(1);

      const result = await healthChecker.checkAdapterHealth('test-adapter');

      expect(result.healthy).toBe(true);
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
      expect(mockAdapter.setNX).toHaveBeenCalled();
      expect(mockAdapter.get).toHaveBeenCalled();
    });

    it('should return unhealthy status when setNX fails', async () => {
      const error = new Error('Connection failed');
      vi.mocked(mockAdapter.setNX).mockRejectedValue(error);

      const result = await healthChecker.checkAdapterHealth('test-adapter');

      expect(result.healthy).toBe(false);
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
      expect(result.error).toBe('Connection failed');
    });

    it('should return unhealthy status for unregistered adapter', async () => {
      const result = await healthChecker.checkAdapterHealth('unknown-adapter');

      expect(result.healthy).toBe(false);
      expect(result.responseTime).toBe(0);
      expect(result.error).toBe("Adapter 'unknown-adapter' not registered");
    });

    it('should measure response time correctly', async () => {
      // Mock a slow response
      vi.mocked(mockAdapter.setNX).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('OK'), 50))
      );
      vi.mocked(mockAdapter.get).mockResolvedValue('ping');
      vi.mocked(mockAdapter.del).mockResolvedValue(1);

      const result = await healthChecker.checkAdapterHealth('test-adapter');

      expect(result.responseTime).toBeGreaterThanOrEqual(45); // Allow for timing variance in CI
      expect(result.healthy).toBe(true);
    });
  });

  describe('checkSystemHealth', () => {
    it('should return overall unhealthy when no adapters registered', async () => {
      const result = await healthChecker.checkSystemHealth();

      expect(result.overall).toBe(false); // Changed to false since no adapters means unhealthy system
      expect(result.adapters).toEqual([]);
    });

    it('should return overall healthy when all adapters healthy', async () => {
      const adapter2 = { ...mockAdapter } as RedisAdapter;

      healthChecker.registerAdapter('adapter-1', mockAdapter);
      healthChecker.registerAdapter('adapter-2', adapter2);

      vi.mocked(mockAdapter.setNX).mockResolvedValue('OK');
      vi.mocked(mockAdapter.get).mockResolvedValue('ping');
      vi.mocked(mockAdapter.del).mockResolvedValue(1);
      vi.mocked(adapter2.setNX).mockResolvedValue('OK');
      vi.mocked(adapter2.get).mockResolvedValue('ping');
      vi.mocked(adapter2.del).mockResolvedValue(1);

      const result = await healthChecker.checkSystemHealth();

      expect(result.overall).toBe(true);
      expect(result.adapters).toHaveLength(2);
      expect(result.adapters[0].status.healthy).toBe(true);
      expect(result.adapters[1].status.healthy).toBe(true);
    });

    it('should return overall unhealthy when any adapter fails', async () => {
      // Create completely separate mock adapters
      const adapter2: RedisAdapter = {
        setNX: vi.fn(),
        del: vi.fn(),
        get: vi.fn(),
        delIfMatch: vi.fn(),
        extendIfMatch: vi.fn(),
        atomicExtend: vi.fn().mockResolvedValue({
          resultCode: 1,
          actualTTL: 5000,
          message: 'Extended successfully',
        } as AtomicExtensionResult),
        ping: vi.fn(),
        isConnected: vi.fn(),
        disconnect: vi.fn(),
      };

      healthChecker.registerAdapter('adapter-1', mockAdapter);
      healthChecker.registerAdapter('adapter-2', adapter2);

      // Mock first adapter to succeed
      vi.mocked(mockAdapter.setNX).mockResolvedValue('OK');
      vi.mocked(mockAdapter.get).mockResolvedValue('ping');
      vi.mocked(mockAdapter.del).mockResolvedValue(1);

      // Mock second adapter to fail
      vi.mocked(adapter2.setNX).mockRejectedValue(new Error('Failed'));

      const result = await healthChecker.checkSystemHealth();

      expect(result.overall).toBe(false);
      expect(result.adapters).toHaveLength(2);
      // Check that we have one healthy and one unhealthy adapter
      const healthyCount = result.adapters.filter(a => a.status.healthy).length;
      const unhealthyCount = result.adapters.filter(a => !a.status.healthy).length;
      expect(healthyCount).toBe(1);
      expect(unhealthyCount).toBe(1);
    });
  });

  describe('getHealthStats', () => {
    beforeEach(() => {
      healthChecker.registerAdapter('test-adapter', mockAdapter);
    });

    it('should return initial stats for new adapter', () => {
      const stats = healthChecker.getHealthStats('test-adapter');

      expect(stats.total).toBe(0);
      expect(stats.healthy).toBe(0);
      expect(stats.unhealthy).toBe(0);
      expect(stats.uptime).toBe(0);
      expect(stats.averageResponseTime).toBe(0);
    });

    it('should track health check statistics', async () => {
      vi.mocked(mockAdapter.setNX).mockResolvedValue('OK');
      vi.mocked(mockAdapter.get).mockResolvedValue('ping');
      vi.mocked(mockAdapter.del).mockResolvedValue(1);

      // Perform 3 health checks
      await healthChecker.checkAdapterHealth('test-adapter');
      await healthChecker.checkAdapterHealth('test-adapter');
      await healthChecker.checkAdapterHealth('test-adapter');

      const stats = healthChecker.getHealthStats('test-adapter');

      expect(stats.total).toBe(3);
      expect(stats.healthy).toBe(3);
      expect(stats.unhealthy).toBe(0);
      expect(stats.uptime).toBe(1); // 100% uptime
      expect(stats.averageResponseTime).toBeGreaterThanOrEqual(0);
    });

    it('should track mixed health results', async () => {
      vi.mocked(mockAdapter.setNX)
        .mockResolvedValueOnce('OK')
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce('OK');
      vi.mocked(mockAdapter.get).mockResolvedValueOnce('ping').mockResolvedValueOnce('ping');
      vi.mocked(mockAdapter.del).mockResolvedValue(1);

      // Perform 3 health checks (2 success, 1 failure)
      await healthChecker.checkAdapterHealth('test-adapter');
      await healthChecker.checkAdapterHealth('test-adapter');
      await healthChecker.checkAdapterHealth('test-adapter');

      const stats = healthChecker.getHealthStats('test-adapter');

      expect(stats.total).toBe(3);
      expect(stats.healthy).toBe(2);
      expect(stats.unhealthy).toBe(1);
      expect(stats.uptime).toBeCloseTo(2 / 3); // 66.67% uptime
    });

    it('should return empty stats for unregistered adapter', () => {
      const stats = healthChecker.getHealthStats('unknown-adapter');
      expect(stats.total).toBe(0);
      expect(stats.healthy).toBe(0);
      expect(stats.unhealthy).toBe(0);
      expect(stats.uptime).toBe(0);
      expect(stats.averageResponseTime).toBe(0);
    });
  });

  describe('clearHistory', () => {
    beforeEach(() => {
      healthChecker.registerAdapter('test-adapter', mockAdapter);
    });

    it('should clear history for adapter', async () => {
      vi.mocked(mockAdapter.setNX).mockResolvedValue('OK');
      vi.mocked(mockAdapter.get).mockResolvedValue('ping');
      vi.mocked(mockAdapter.del).mockResolvedValue(1);

      // Perform some health checks
      await healthChecker.checkAdapterHealth('test-adapter');
      await healthChecker.checkAdapterHealth('test-adapter');

      expect(healthChecker.getHealthStats('test-adapter').total).toBe(2);

      healthChecker.clearHistory('test-adapter');

      const stats = healthChecker.getHealthStats('test-adapter');
      expect(stats.total).toBe(0);
      expect(stats.healthy).toBe(0);
      expect(stats.unhealthy).toBe(0);
      expect(stats.uptime).toBe(0);
      expect(stats.averageResponseTime).toBe(0);
    });
  });
});
