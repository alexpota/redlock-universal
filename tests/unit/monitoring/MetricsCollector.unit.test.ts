import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector, type LockMetrics } from '../../../src/monitoring/MetricsCollector.js';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector(10); // Keep last 10 operations
  });

  describe('constructor', () => {
    it('should create collector with default maxSize', () => {
      const defaultCollector = new MetricsCollector();
      expect(defaultCollector).toBeInstanceOf(MetricsCollector);
    });

    it('should create collector with custom maxSize', () => {
      const customCollector = new MetricsCollector(50);
      expect(customCollector).toBeInstanceOf(MetricsCollector);
    });
  });

  describe('recordLockOperation', () => {
    it('should record successful lock operation', () => {
      const metric: LockMetrics = {
        acquisitionTime: 150,
        attempts: 1,
        success: true,
        key: 'test-key',
        timestamp: Date.now(),
      };

      collector.recordLockOperation(metric);
      const summary = collector.getSummary();

      expect(summary.totalOperations).toBe(1);
      expect(summary.successfulOperations).toBe(1);
      expect(summary.failedOperations).toBe(0);
      expect(summary.successRate).toBe(1);
    });

    it('should record failed lock operation', () => {
      const metric: LockMetrics = {
        acquisitionTime: 200,
        attempts: 3,
        success: false,
        key: 'test-key',
        timestamp: Date.now(),
      };

      collector.recordLockOperation(metric);
      const summary = collector.getSummary();

      expect(summary.totalOperations).toBe(1);
      expect(summary.successfulOperations).toBe(0);
      expect(summary.failedOperations).toBe(1);
      expect(summary.successRate).toBe(0);
    });

    it('should maintain rolling window of operations', () => {
      // Record 15 operations (more than maxSize of 10)
      for (let i = 0; i < 15; i++) {
        collector.recordLockOperation({
          acquisitionTime: 100 + i,
          attempts: 1,
          success: true,
          key: `test-key-${i}`,
          timestamp: Date.now() + i,
        });
      }

      const summary = collector.getSummary();
      expect(summary.totalOperations).toBe(10); // Should only keep last 10
    });
  });

  describe('getSummary', () => {
    it('should return empty summary for no operations', () => {
      const summary = collector.getSummary();

      expect(summary.totalOperations).toBe(0);
      expect(summary.successfulOperations).toBe(0);
      expect(summary.failedOperations).toBe(0);
      expect(summary.successRate).toBe(0);
      expect(summary.averageAcquisitionTime).toBe(0);
      expect(summary.p95AcquisitionTime).toBe(0);
      expect(summary.p99AcquisitionTime).toBe(0);
    });

    it('should calculate correct averages and percentiles', () => {
      // Record operations with known acquisition times
      const times = [100, 150, 200, 250, 300, 400, 500, 600, 800, 1000];
      times.forEach((time, i) => {
        collector.recordLockOperation({
          acquisitionTime: time,
          attempts: 1,
          success: true,
          key: `test-key-${i}`,
          timestamp: Date.now() + i,
        });
      });

      const summary = collector.getSummary();
      expect(summary.totalOperations).toBe(10);
      expect(summary.averageAcquisitionTime).toBe(430); // Average of times array
      expect(summary.p95AcquisitionTime).toBeGreaterThan(800);
      expect(summary.p99AcquisitionTime).toBeGreaterThan(900);
    });

    it('should handle mixed success/failure operations', () => {
      // Record 6 successful, 4 failed operations
      for (let i = 0; i < 10; i++) {
        collector.recordLockOperation({
          acquisitionTime: 100,
          attempts: 1,
          success: i < 6, // First 6 are successful
          key: `test-key-${i}`,
          timestamp: Date.now() + i,
        });
      }

      const summary = collector.getSummary();
      expect(summary.totalOperations).toBe(10);
      expect(summary.successfulOperations).toBe(6);
      expect(summary.failedOperations).toBe(4);
      expect(summary.successRate).toBe(0.6);
    });
  });

  describe('getMetricsCount', () => {
    it('should return zero for no operations', () => {
      const count = collector.getMetricsCount();
      expect(count).toBe(0);
    });

    it('should return correct count of recorded operations', () => {
      const metrics = [
        {
          acquisitionTime: 100,
          attempts: 1,
          success: true,
          key: 'test-1',
          timestamp: Date.now(),
        },
        {
          acquisitionTime: 200,
          attempts: 2,
          success: false,
          key: 'test-2',
          timestamp: Date.now() + 1,
        },
      ];

      metrics.forEach(metric => collector.recordLockOperation(metric));
      const count = collector.getMetricsCount();

      expect(count).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all recorded operations', () => {
      // Record some operations
      for (let i = 0; i < 5; i++) {
        collector.recordLockOperation({
          acquisitionTime: 100,
          attempts: 1,
          success: true,
          key: `test-key-${i}`,
          timestamp: Date.now() + i,
        });
      }

      expect(collector.getSummary().totalOperations).toBe(5);

      collector.clear();

      expect(collector.getSummary().totalOperations).toBe(0);
      expect(collector.getMetricsCount()).toBe(0);
    });
  });
});
