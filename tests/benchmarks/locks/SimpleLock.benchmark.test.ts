import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient as createNodeRedisClient } from 'redis';
import { createLock } from '../../../src/index.js';
import { NodeRedisAdapter } from '../../../src/adapters/index.js';

describe('SimpleLock Performance Benchmarks', () => {
  let nodeRedisClient: any;
  let adapter: NodeRedisAdapter;

  beforeAll(async () => {
    nodeRedisClient = createNodeRedisClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    await nodeRedisClient.connect();
    adapter = new NodeRedisAdapter(nodeRedisClient);
  });

  afterAll(async () => {
    await nodeRedisClient?.disconnect();
  });

  // No need to flushDb since we use unique keys with process.pid
  const getTestKey = () =>
    `benchmark-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${process.pid}`;

  describe('Lock Acquisition Performance', () => {
    it('should acquire locks within performance targets', async () => {
      const iterations = 100;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const key = `${getTestKey()}-${i}`;
        const testLock = createLock({
          adapter,
          key,
          ttl: 10000,
        });

        const start = process.hrtime.bigint();
        const handle = await testLock.acquire();
        const end = process.hrtime.bigint();

        const durationMs = Number(end - start) / 1_000_000;
        times.push(durationMs);

        await testLock.release(handle);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const p99Time = times.sort((a, b) => a - b)[Math.floor(times.length * 0.99)];

      console.log(`Lock acquisition performance:`);
      console.log(`  Average: ${avgTime.toFixed(2)}ms`);
      console.log(`  99th percentile: ${p99Time.toFixed(2)}ms`);
      console.log(`  Min: ${Math.min(...times).toFixed(2)}ms`);
      console.log(`  Max: ${Math.max(...times).toFixed(2)}ms`);

      // Performance targets from CLAUDE.md
      expect(avgTime).toBeLessThan(10); // Average should be under 10ms
      expect(p99Time).toBeLessThan(100); // 99th percentile should be under 100ms
    });

    it('should handle concurrent acquisitions efficiently', async () => {
      const concurrency = 10;
      const iterations = 50;

      const promises = Array.from({ length: concurrency }, async (_, clientId) => {
        const times: number[] = [];

        for (let i = 0; i < iterations; i++) {
          const key = `${getTestKey()}-${clientId}-${i}`;
          const lock = createLock({
            adapter,
            key,
            ttl: 5000,
          });

          const start = process.hrtime.bigint();
          const handle = await lock.acquire();
          const end = process.hrtime.bigint();

          const durationMs = Number(end - start) / 1_000_000;
          times.push(durationMs);

          await lock.release(handle);
        }

        return times;
      });

      const results = await Promise.all(promises);
      const allTimes = results.flat();
      const avgTime = allTimes.reduce((a, b) => a + b, 0) / allTimes.length;
      const p99Time = allTimes.sort((a, b) => a - b)[Math.floor(allTimes.length * 0.99)];

      console.log(`Concurrent acquisition performance (${concurrency} clients):`);
      console.log(`  Average: ${avgTime.toFixed(2)}ms`);
      console.log(`  99th percentile: ${p99Time.toFixed(2)}ms`);

      expect(avgTime).toBeLessThan(20); // Slightly higher threshold for concurrent access
      expect(p99Time).toBeLessThan(200);
    });
  });

  describe('Lock Extension Performance', () => {
    it('should extend locks efficiently', async () => {
      const lock = createLock({
        adapter,
        key: getTestKey(),
        ttl: 10000,
      });

      const handle = await lock.acquire();
      const iterations = 50;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        const extended = await lock.extend(handle, 10000);
        const end = process.hrtime.bigint();

        expect(extended).toBe(true);
        const durationMs = Number(end - start) / 1_000_000;
        times.push(durationMs);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const p99Time = times.sort((a, b) => a - b)[Math.floor(times.length * 0.99)];

      console.log(`Lock extension performance:`);
      console.log(`  Average: ${avgTime.toFixed(2)}ms`);
      console.log(`  99th percentile: ${p99Time.toFixed(2)}ms`);

      expect(avgTime).toBeLessThan(5); // Extensions should be faster than acquisitions
      expect(p99Time).toBeLessThan(50);

      await lock.release(handle);
    });
  });

  describe('Memory Usage', () => {
    it('should not leak memory during repeated operations', async () => {
      const initialMemory = process.memoryUsage().heapUsed;
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        const lock = createLock({
          adapter,
          key: `${getTestKey()}-memory-${i}`,
          ttl: 1000,
        });

        const handle = await lock.acquire();
        await lock.extend(handle, 2000);
        await lock.release(handle);

        // Force garbage collection occasionally
        if (i % 100 === 0 && global.gc) {
          global.gc();
        }
      }

      // Force final garbage collection
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      const memoryIncreaseKB = memoryIncrease / 1024;

      console.log(`Memory usage after ${iterations} operations:`);
      console.log(`  Initial: ${(initialMemory / 1024 / 1024).toFixed(2)}MB`);
      console.log(`  Final: ${(finalMemory / 1024 / 1024).toFixed(2)}MB`);
      console.log(`  Increase: ${memoryIncreaseKB.toFixed(2)}KB`);

      // Memory increase should be minimal (less than 1MB for 1000 operations)
      expect(memoryIncreaseKB).toBeLessThan(1024);
    });
  });

  describe('Throughput Benchmarks', () => {
    it('should achieve target throughput for lock operations', async () => {
      const duration = 5000; // 5 seconds
      const startTime = Date.now();
      let operations = 0;

      while (Date.now() - startTime < duration) {
        const lock = createLock({
          adapter,
          key: `${getTestKey()}-throughput-${operations}`,
          ttl: 1000,
        });

        const handle = await lock.acquire();
        await lock.release(handle);
        operations++;
      }

      const actualDuration = Date.now() - startTime;
      const operationsPerSecond = (operations / actualDuration) * 1000;

      console.log(`Throughput benchmark:`);
      console.log(`  Operations: ${operations}`);
      console.log(`  Duration: ${actualDuration}ms`);
      console.log(`  Throughput: ${operationsPerSecond.toFixed(2)} ops/sec`);

      // Target: at least 100 operations per second
      expect(operationsPerSecond).toBeGreaterThan(100);
    });
  });
});
