import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient as createNodeRedisClient } from 'redis';
import { createLock as createRedlockUniversalLock } from '../../src/index.js';
import { NodeRedisAdapter } from '../../src/adapters/index.js';
import { generateTestKey, getRedisUrl } from '../shared/constants.js';

describe('RedLock Universal Performance Validation', () => {
  let nodeRedisClient: any;
  let universalAdapter: NodeRedisAdapter;

  beforeAll(async () => {
    nodeRedisClient = createNodeRedisClient({ url: getRedisUrl() });
    await nodeRedisClient.connect();
    universalAdapter = new NodeRedisAdapter(nodeRedisClient);
  });

  afterAll(async () => {
    await nodeRedisClient?.disconnect();
  });

  it('should validate performance across different modes', async () => {
    console.log('\n=== REDLOCK UNIVERSAL PERFORMANCE VALIDATION ===');
    console.log('Testing lock acquisition performance across different modes\n');

    const iterations = 100;
    const results = {
      'lean-mode': [] as number[],
      'standard-mode': [] as number[],
    };

    // Test lean mode performance
    console.log('Testing lean mode (optimized for speed)...');
    for (let i = 0; i < iterations; i++) {
      const key = `${generateTestKey('lean')}-${i}`;
      const lock = createRedlockUniversalLock({
        adapter: universalAdapter,
        key,
        ttl: 2000,
        retryAttempts: 0,
        performance: 'lean',
      });

      const start = process.hrtime.bigint();
      const handle = await lock.acquire();
      const end = process.hrtime.bigint();

      results['lean-mode'].push(Number(end - start) / 1_000_000);
      await lock.release(handle);
    }

    // Test standard mode performance
    console.log('Testing standard mode (production features)...');
    for (let i = 0; i < iterations; i++) {
      const key = `${generateTestKey('standard')}-${i}`;
      const lock = createRedlockUniversalLock({
        adapter: universalAdapter,
        key,
        ttl: 2000,
        retryAttempts: 0,
        performance: 'standard',
      });

      const start = process.hrtime.bigint();
      const handle = await lock.acquire();
      const end = process.hrtime.bigint();

      results['standard-mode'].push(Number(end - start) / 1_000_000);
      await lock.release(handle);
    }

    // Performance analysis
    console.log('\n=== PERFORMANCE RESULTS ===');

    Object.entries(results).forEach(([mode, times]) => {
      const sorted = times.sort((a, b) => a - b);
      const mean = times.reduce((a, b) => a + b) / times.length;
      const p50 = sorted[Math.floor(times.length * 0.5)];
      const p95 = sorted[Math.floor(times.length * 0.95)];
      const p99 = sorted[Math.floor(times.length * 0.99)];
      const min = Math.min(...times);
      const max = Math.max(...times);

      console.log(`\n${mode}:`);
      console.log(`  Mean: ${mean.toFixed(3)}ms`);
      console.log(`  P50:  ${p50.toFixed(3)}ms`);
      console.log(`  P95:  ${p95.toFixed(3)}ms`);
      console.log(`  P99:  ${p99.toFixed(3)}ms`);
      console.log(`  Range: ${min.toFixed(3)}ms - ${max.toFixed(3)}ms`);
    });

    // Performance validation
    const leanMean = results['lean-mode'].reduce((a, b) => a + b) / results['lean-mode'].length;
    const standardMean =
      results['standard-mode'].reduce((a, b) => a + b) / results['standard-mode'].length;

    console.log('\n=== PERFORMANCE VALIDATION ===');
    console.log(`✅ Lean mode: ${leanMean.toFixed(3)}ms mean latency`);
    console.log(`✅ Standard mode: ${standardMean.toFixed(3)}ms mean latency`);

    const improvement = ((standardMean - leanMean) / standardMean) * 100;
    console.log(`⚡ Lean mode optimization: ${improvement.toFixed(1)}% faster`);

    // Performance requirements
    expect(leanMean).toBeLessThan(1.0); // Sub-millisecond performance
    expect(standardMean).toBeLessThan(2.0); // Under 2ms even with full features
    expect(results['lean-mode'].every(t => t > 0)).toBe(true); // All successful
    expect(results['standard-mode'].every(t => t > 0)).toBe(true); // All successful
  }, 30000);

  it('should validate Redis adapter performance', async () => {
    console.log('\n=== REDIS ADAPTER PERFORMANCE VALIDATION ===');

    const iterations = 50;
    const rawTimes: number[] = [];
    const adapterTimes: number[] = [];

    // Test raw Redis performance
    for (let i = 0; i < iterations; i++) {
      const key = `${generateTestKey('raw')}-${i}`;
      const value = `test-value-${i}`;

      const start = process.hrtime.bigint();
      await nodeRedisClient.set(key, value, { NX: true, PX: 2000 });
      const end = process.hrtime.bigint();

      rawTimes.push(Number(end - start) / 1_000_000);
      await nodeRedisClient.del(key);
    }

    // Test adapter performance
    for (let i = 0; i < iterations; i++) {
      const key = `${generateTestKey('adapter')}-${i}`;
      const value = `test-value-${i}`;

      const start = process.hrtime.bigint();
      await universalAdapter.setNX(key, value, 2000);
      const end = process.hrtime.bigint();

      adapterTimes.push(Number(end - start) / 1_000_000);
      await universalAdapter.del(key);
    }

    const rawMean = rawTimes.reduce((a, b) => a + b) / rawTimes.length;
    const adapterMean = adapterTimes.reduce((a, b) => a + b) / adapterTimes.length;
    const overhead = adapterMean - rawMean;

    console.log(`Raw Redis SET NX: ${rawMean.toFixed(3)}ms`);
    console.log(
      `Adapter overhead: +${overhead.toFixed(3)}ms (${((overhead / rawMean) * 100).toFixed(1)}%)`
    );
    console.log(`Total adapter time: ${adapterMean.toFixed(3)}ms`);

    // Validate minimal overhead
    expect(overhead).toBeLessThan(0.5); // Less than 0.5ms overhead
    expect(adapterMean).toBeLessThan(1.5); // Total under 1.5ms
  }, 20000);
});
