/**
 * Health checker for Redis adapters and lock operations
 */

import type { RedisAdapter } from '../types/adapters.js';

export interface HealthStatus {
  readonly healthy: boolean;
  readonly timestamp: number;
  readonly responseTime: number;
  readonly error?: string;
}

export interface AdapterHealth {
  readonly adapter: string;
  readonly status: HealthStatus;
}

export interface SystemHealth {
  readonly overall: boolean;
  readonly adapters: AdapterHealth[];
  readonly timestamp: number;
}

export class HealthChecker {
  private readonly adapters: Map<string, RedisAdapter> = new Map();
  private readonly healthHistory: Map<string, HealthStatus[]> = new Map();
  private readonly maxHistorySize: number;

  constructor(maxHistorySize: number = 100) {
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * Register an adapter for health monitoring
   */
  registerAdapter(name: string, adapter: RedisAdapter): void {
    this.adapters.set(name, adapter);
    this.healthHistory.set(name, []);
  }

  /**
   * Unregister an adapter
   */
  unregisterAdapter(name: string): void {
    this.adapters.delete(name);
    this.healthHistory.delete(name);
  }

  /**
   * Check health of a specific adapter
   */
  async checkAdapterHealth(name: string): Promise<HealthStatus> {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      return {
        healthy: false,
        timestamp: Date.now(),
        responseTime: 0,
        error: `Adapter '${name}' not registered`,
      };
    }

    const startTime = Date.now();

    try {
      // Simple ping test using a temporary key
      const testKey = `health:check:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const testValue = 'ping';

      // Use setNX for health check (it's available in the adapter interface)
      const setResult = await adapter.setNX(testKey, testValue, 1000); // 1 second TTL
      const retrieved = await adapter.get(testKey);

      const responseTime = Date.now() - startTime;
      const healthy = setResult === 'OK' && retrieved === testValue;

      // Clean up test key
      try {
        await adapter.del(testKey);
      } catch {
        // Ignore cleanup errors
      }

      const status: HealthStatus = {
        healthy,
        timestamp: Date.now(),
        responseTime,
        ...(healthy ? {} : { error: 'Health check value mismatch' }),
      };

      this.recordHealthStatus(name, status);
      return status;
    } catch (error) {
      const status: HealthStatus = {
        healthy: false,
        timestamp: Date.now(),
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      this.recordHealthStatus(name, status);
      return status;
    }
  }

  /**
   * Check health of all registered adapters
   */
  async checkSystemHealth(): Promise<SystemHealth> {
    const adapterNames = Array.from(this.adapters.keys());
    const healthChecks = await Promise.allSettled(
      adapterNames.map(async name => ({
        adapter: name,
        status: await this.checkAdapterHealth(name),
      }))
    );

    const adapters: AdapterHealth[] = healthChecks.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          adapter: adapterNames[index]!,
          status: {
            healthy: false,
            timestamp: Date.now(),
            responseTime: 0,
            error: 'Health check failed',
          },
        };
      }
    });

    const overall = adapters.length > 0 && adapters.every(a => a.status.healthy);

    return {
      overall,
      adapters,
      timestamp: Date.now(),
    };
  }

  /**
   * Get health history for an adapter
   */
  getHealthHistory(name: string, count?: number): HealthStatus[] {
    const history = this.healthHistory.get(name) || [];
    return count ? history.slice(-count) : [...history];
  }

  /**
   * Get health statistics for an adapter
   */
  getHealthStats(
    name: string,
    windowMs?: number
  ): {
    total: number;
    healthy: number;
    unhealthy: number;
    averageResponseTime: number;
    uptime: number;
  } {
    let history = this.healthHistory.get(name) || [];

    if (windowMs) {
      const cutoff = Date.now() - windowMs;
      history = history.filter(h => h.timestamp >= cutoff);
    }

    if (history.length === 0) {
      return {
        total: 0,
        healthy: 0,
        unhealthy: 0,
        averageResponseTime: 0,
        uptime: 0,
      };
    }

    const healthy = history.filter(h => h.healthy);
    const responseTimes = history.map(h => h.responseTime);
    const averageResponseTime =
      responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;

    return {
      total: history.length,
      healthy: healthy.length,
      unhealthy: history.length - healthy.length,
      averageResponseTime,
      uptime: healthy.length / history.length,
    };
  }

  /**
   * Clear health history for an adapter
   */
  clearHistory(name: string): void {
    this.healthHistory.set(name, []);
  }

  /**
   * Clear all health history
   */
  clearAllHistory(): void {
    for (const name of this.healthHistory.keys()) {
      this.healthHistory.set(name, []);
    }
  }

  private recordHealthStatus(name: string, status: HealthStatus): void {
    const history = this.healthHistory.get(name) || [];
    history.push(status);

    // Keep only the most recent entries
    if (history.length > this.maxHistorySize) {
      history.shift();
    }

    this.healthHistory.set(name, history);
  }
}
