/**
 * Metrics collector for RedLock Universal operations
 */

export interface LockMetrics {
  readonly acquisitionTime: number;
  readonly attempts: number;
  readonly success: boolean;
  readonly key: string;
  readonly timestamp: number;
}

export interface RedLockMetrics extends LockMetrics {
  readonly nodesTotal: number;
  readonly nodesSuccessful: number;
  readonly quorum: number;
}

export interface MetricsSummary {
  readonly totalOperations: number;
  readonly successfulOperations: number;
  readonly failedOperations: number;
  readonly averageAcquisitionTime: number;
  readonly p95AcquisitionTime: number;
  readonly p99AcquisitionTime: number;
  readonly successRate: number;
}

export class MetricsCollector {
  private readonly lockMetrics: LockMetrics[] = [];
  private readonly maxMetrics: number;

  constructor(maxMetrics: number = 1000) {
    this.maxMetrics = maxMetrics;
  }

  /**
   * Record a lock operation metric
   */
  recordLockOperation(metrics: LockMetrics): void {
    this.lockMetrics.push(metrics);

    // Keep only the most recent metrics to prevent memory growth
    if (this.lockMetrics.length > this.maxMetrics) {
      this.lockMetrics.shift();
    }
  }

  /**
   * Get summary of all recorded metrics
   */
  getSummary(): MetricsSummary {
    if (this.lockMetrics.length === 0) {
      return {
        totalOperations: 0,
        successfulOperations: 0,
        failedOperations: 0,
        averageAcquisitionTime: 0,
        p95AcquisitionTime: 0,
        p99AcquisitionTime: 0,
        successRate: 0,
      };
    }

    const successful = this.lockMetrics.filter(m => m.success);
    const acquisitionTimes = successful.map(m => m.acquisitionTime).sort((a, b) => a - b);

    const p95Index = Math.floor(acquisitionTimes.length * 0.95);
    const p99Index = Math.floor(acquisitionTimes.length * 0.99);

    return {
      totalOperations: this.lockMetrics.length,
      successfulOperations: successful.length,
      failedOperations: this.lockMetrics.length - successful.length,
      averageAcquisitionTime:
        acquisitionTimes.length > 0
          ? acquisitionTimes.reduce((sum, time) => sum + time, 0) / acquisitionTimes.length
          : 0,
      p95AcquisitionTime: acquisitionTimes[p95Index] || 0,
      p99AcquisitionTime: acquisitionTimes[p99Index] || 0,
      successRate: this.lockMetrics.length > 0 ? successful.length / this.lockMetrics.length : 0,
    };
  }

  /**
   * Get metrics for a specific time window
   */
  getMetricsForWindow(windowMs: number): LockMetrics[] {
    const cutoff = Date.now() - windowMs;
    return this.lockMetrics.filter(m => m.timestamp >= cutoff);
  }

  /**
   * Get metrics grouped by key
   */
  getMetricsByKey(): Map<string, LockMetrics[]> {
    const byKey = new Map<string, LockMetrics[]>();

    for (const metric of this.lockMetrics) {
      const existing = byKey.get(metric.key) || [];
      existing.push(metric);
      byKey.set(metric.key, existing);
    }

    return byKey;
  }

  /**
   * Clear all recorded metrics
   */
  clear(): void {
    this.lockMetrics.length = 0;
  }

  /**
   * Get current metrics count
   */
  getMetricsCount(): number {
    return this.lockMetrics.length;
  }
}
