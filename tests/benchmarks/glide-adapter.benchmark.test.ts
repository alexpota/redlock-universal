import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import { GlideClient, GlideClientConfiguration } from '@valkey/valkey-glide';
import { IoredisAdapter, GlideAdapter } from '../../src/adapters/index.js';
import {
  generateTestKey,
  getRedisUrl,
  getValkeyHost,
  getValkeyPort,
  REDIS_CONFIG,
} from '../shared/constants.js';

// Benchmark configuration
const WARMUP_ITERATIONS = 50; // Increased for better JIT warmup
const BENCHMARK_ITERATIONS = 200;
const CONCURRENT_WORKERS = 10;
const THROUGHPUT_DURATION_MS = 5000;
const TTL = 2000;
const COOLDOWN_MS = 500; // Cooldown between test configurations

// Shared ioredis connection options for fair comparison
const IOREDIS_BENCHMARK_OPTIONS = {
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => Math.min(times * 50, 2000),
  connectTimeout: 5000,
  lazyConnect: true,
} as const;

/**
 * Performance statistics for benchmarking
 */
interface PerformanceStats {
  mean: number;
  stddev: number; // Standard deviation for reproducibility assessment
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  opsPerSec: number;
  totalOps: number;
}

/**
 * Throughput result for concurrent tests
 */
interface ThroughputResult {
  totalOps: number;
  durationMs: number;
  opsPerSec: number;
  successRate: number;
  meanLatency: number;
  p95Latency: number;
  p99Latency: number;
}

/**
 * Calculate performance statistics from timing data
 */
function calculateStats(times: number[]): PerformanceStats {
  if (times.length === 0) {
    return {
      mean: 0,
      stddev: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      min: 0,
      max: 0,
      opsPerSec: 0,
      totalOps: 0,
    };
  }

  const sorted = [...times].sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  const mean = sum / times.length;

  // Calculate standard deviation
  const squaredDiffs = times.map(t => Math.pow(t - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / times.length;
  const stddev = Math.sqrt(avgSquaredDiff);

  return {
    mean,
    stddev,
    p50: sorted[Math.floor(times.length * 0.5)],
    p95: sorted[Math.floor(times.length * 0.95)],
    p99: sorted[Math.floor(times.length * 0.99)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    opsPerSec: Math.round(1000 / mean),
    totalOps: times.length,
  };
}

/**
 * Format a number with fixed decimal places and padding for alignment
 */
function formatMs(value: number, decimals = 3): string {
  return value.toFixed(decimals).padStart(8);
}

/**
 * Print a formatted comparison table for latency benchmarks
 */
function printLatencyTable(title: string, results: Record<string, PerformanceStats>): void {
  console.log(`\n${'='.repeat(90)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(90)}`);
  console.log(
    `${'Configuration'.padEnd(22)} | ${'Mean'.padStart(8)} | ${'StdDev'.padStart(8)} | ${'P50'.padStart(8)} | ${'P95'.padStart(8)} | ${'Ops/s'.padStart(8)}`
  );
  console.log(
    `${'-'.repeat(22)}-+-${'-'.repeat(8)}-+-${'-'.repeat(8)}-+-${'-'.repeat(8)}-+-${'-'.repeat(8)}-+-${'-'.repeat(8)}`
  );

  for (const [name, stats] of Object.entries(results)) {
    console.log(
      `${name.padEnd(22)} | ${formatMs(stats.mean)}ms | ${formatMs(stats.stddev)}ms | ${formatMs(stats.p50)}ms | ${formatMs(stats.p95)}ms | ${String(stats.opsPerSec).padStart(8)}`
    );
  }

  // Add reproducibility assessment
  const stddevs = Object.values(results).map(s => s.stddev / s.mean); // Coefficient of variation
  const avgCV = stddevs.reduce((a, b) => a + b, 0) / stddevs.length;
  console.log(`${'-'.repeat(90)}`);
  console.log(
    `  Reproducibility: ${avgCV < 0.2 ? '✅ Good' : avgCV < 0.4 ? '⚠️  Moderate' : '❌ High variance'} (avg CV: ${(avgCV * 100).toFixed(1)}%)`
  );
  console.log(`${'='.repeat(90)}\n`);
}

/**
 * Print a formatted comparison table for throughput benchmarks
 */
function printThroughputTable(title: string, results: Record<string, ThroughputResult>): void {
  console.log(`\n${'='.repeat(90)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(90)}`);
  console.log(
    `${'Configuration'.padEnd(22)} | ${'Ops/sec'.padStart(10)} | ${'Total Ops'.padStart(10)} | ${'Mean'.padStart(8)} | ${'P95'.padStart(8)} | ${'Success'.padStart(8)}`
  );
  console.log(
    `${'-'.repeat(22)}-+-${'-'.repeat(10)}-+-${'-'.repeat(10)}-+-${'-'.repeat(8)}-+-${'-'.repeat(8)}-+-${'-'.repeat(8)}`
  );

  for (const [name, result] of Object.entries(results)) {
    console.log(
      `${name.padEnd(22)} | ${String(Math.round(result.opsPerSec)).padStart(10)} | ${String(result.totalOps).padStart(10)} | ${formatMs(result.meanLatency)}ms | ${formatMs(result.p95Latency)}ms | ${(result.successRate * 100).toFixed(1).padStart(7)}%`
    );
  }

  console.log(`${'='.repeat(90)}\n`);
}

/**
 * Print performance comparison summary
 */
function printComparisonSummary(
  redisResult: PerformanceStats | ThroughputResult,
  valkeyResult: PerformanceStats | ThroughputResult,
  glideResult?: PerformanceStats | ThroughputResult
): void {
  console.log('=== REDIS vs VALKEY COMPARISON ===\n');

  // Determine if these are latency or throughput results
  const isLatency = 'mean' in redisResult && !('durationMs' in redisResult);

  if (isLatency) {
    const redis = redisResult as PerformanceStats;
    const valkey = valkeyResult as PerformanceStats;
    const glide = glideResult as PerformanceStats | undefined;

    const latencyImprovement = ((redis.mean - valkey.mean) / redis.mean) * 100;
    const throughputImprovement = ((valkey.opsPerSec - redis.opsPerSec) / redis.opsPerSec) * 100;

    console.log(`ioredis + Redis:  ${redis.mean.toFixed(3)}ms mean, ${redis.opsPerSec} ops/s`);
    console.log(`ioredis + Valkey: ${valkey.mean.toFixed(3)}ms mean, ${valkey.opsPerSec} ops/s`);

    if (latencyImprovement > 0) {
      console.log(`\n  --> Valkey is ${latencyImprovement.toFixed(1)}% FASTER (latency)`);
      console.log(`  --> Valkey has ${throughputImprovement.toFixed(1)}% HIGHER throughput`);
    } else {
      console.log(`\n  --> Redis is ${(-latencyImprovement).toFixed(1)}% faster (latency)`);
    }

    if (glide) {
      const glideVsValkey = ((valkey.mean - glide.mean) / valkey.mean) * 100;
      console.log(`\nGLIDE + Valkey:   ${glide.mean.toFixed(3)}ms mean, ${glide.opsPerSec} ops/s`);
      if (glideVsValkey > 0) {
        console.log(`  --> GLIDE is ${glideVsValkey.toFixed(1)}% faster than ioredis on Valkey`);
      } else {
        console.log(`  --> ioredis is ${(-glideVsValkey).toFixed(1)}% faster than GLIDE on Valkey`);
      }
    }
  } else {
    const redis = redisResult as ThroughputResult;
    const valkey = valkeyResult as ThroughputResult;
    const glide = glideResult as ThroughputResult | undefined;

    const throughputImprovement = ((valkey.opsPerSec - redis.opsPerSec) / redis.opsPerSec) * 100;

    console.log(`ioredis + Redis:  ${Math.round(redis.opsPerSec)} ops/s`);
    console.log(`ioredis + Valkey: ${Math.round(valkey.opsPerSec)} ops/s`);

    if (throughputImprovement > 0) {
      console.log(`\n  --> Valkey has ${throughputImprovement.toFixed(1)}% HIGHER throughput`);
    } else {
      console.log(`\n  --> Redis has ${(-throughputImprovement).toFixed(1)}% higher throughput`);
    }

    if (glide) {
      const glideVsValkey = ((glide.opsPerSec - valkey.opsPerSec) / valkey.opsPerSec) * 100;
      console.log(`\nGLIDE + Valkey:   ${Math.round(glide.opsPerSec)} ops/s`);
      if (glideVsValkey > 0) {
        console.log(`  --> GLIDE is ${glideVsValkey.toFixed(1)}% faster than ioredis on Valkey`);
      } else {
        console.log(`  --> ioredis is ${(-glideVsValkey).toFixed(1)}% faster than GLIDE on Valkey`);
      }
    }
  }

  console.log('');
}

describe('Redis vs Valkey Performance Benchmark', () => {
  // Redis clients
  let ioredisRedis: Redis;
  let ioredisRedisAdapter: IoredisAdapter;

  // Valkey clients
  let ioredisValkey: Redis;
  let ioredisValkeyAdapter: IoredisAdapter;
  let glideClient: GlideClient;
  let glideAdapter: GlideAdapter;

  let glideAvailable = true;
  let valkeyAvailable = true;

  beforeAll(async () => {
    console.log('\n=== SETUP: Connecting to Redis and Valkey ===\n');
    console.log('Using identical connection settings for fair comparison.');

    // Parse Redis URL for host/port
    const redisUrl = getRedisUrl();
    const redisUrlParsed = new URL(redisUrl);
    const redisHost = redisUrlParsed.hostname;
    const redisPort = parseInt(redisUrlParsed.port || '6379', 10);

    // Connect ioredis to Redis with SAME settings as Valkey (fair comparison)
    console.log(`Connecting ioredis to Redis at ${redisHost}:${redisPort}...`);
    ioredisRedis = new Redis({
      host: redisHost,
      port: redisPort,
      ...IOREDIS_BENCHMARK_OPTIONS,
    });

    // Suppress error events during connection attempt
    ioredisRedis.on('error', () => {
      // Silently ignore connection errors during setup
    });

    await ioredisRedis.connect();
    await ioredisRedis.ping();
    ioredisRedisAdapter = new IoredisAdapter(ioredisRedis);
    console.log('ioredis connected to Redis successfully');

    // Connect ioredis to Valkey with SAME settings (fair comparison)
    const valkeyHost = getValkeyHost();
    const valkeyPort = getValkeyPort();
    const valkeyUrl = `redis://${valkeyHost}:${valkeyPort}`;

    try {
      console.log(`Connecting ioredis to Valkey at ${valkeyUrl}...`);
      ioredisValkey = new Redis({
        host: valkeyHost,
        port: valkeyPort,
        ...IOREDIS_BENCHMARK_OPTIONS,
      });

      // Suppress error events during connection attempt
      ioredisValkey.on('error', () => {
        // Silently ignore connection errors during setup
      });

      // Test connection with timeout
      await ioredisValkey.connect();
      await ioredisValkey.ping();
      ioredisValkeyAdapter = new IoredisAdapter(ioredisValkey);
      console.log('ioredis connected to Valkey successfully');
    } catch {
      valkeyAvailable = false;
      if (ioredisValkey) {
        ioredisValkey.disconnect();
      }
      console.warn(`\nWARNING: Valkey not available at ${valkeyUrl}`);
      console.warn('Valkey benchmarks will be skipped.\n');
    }

    // Connect GLIDE to Valkey
    if (valkeyAvailable) {
      try {
        console.log(`Connecting GLIDE to Valkey at ${valkeyHost}:${valkeyPort}...`);
        const glideConfig: GlideClientConfiguration = {
          addresses: [{ host: valkeyHost, port: valkeyPort }],
        };
        glideClient = await GlideClient.createClient(glideConfig);
        glideAdapter = new GlideAdapter(glideClient);
        console.log('GLIDE connected to Valkey successfully');
      } catch {
        glideAvailable = false;
        console.warn('\nWARNING: GLIDE client not available');
        console.warn('GLIDE benchmarks will be skipped.\n');
      }
    } else {
      glideAvailable = false;
    }

    // Verify server versions and store for labels
    console.log('\n--- Server Information ---');
    let redisVersion = 'unknown';
    let valkeyVersion = 'unknown';

    try {
      const redisInfo = await ioredisRedis.info('server');
      redisVersion = redisInfo.match(/redis_version:(\S+)/)?.[1] || 'unknown';
      const redisMajor = redisVersion.split('.')[0];
      console.log(`Redis version: ${redisVersion} (major: ${redisMajor})`);

      // Warn if version doesn't match expected
      if (redisMajor !== '7') {
        console.warn(`⚠️  WARNING: Expected Redis 7.x but got ${redisVersion}`);
        console.warn(`   Labels will use actual detected version.`);
      }
    } catch {
      console.log('Redis version: unable to determine');
    }

    if (valkeyAvailable) {
      try {
        const valkeyInfo = await ioredisValkey.info('server');
        valkeyVersion =
          valkeyInfo.match(/valkey_version:(\S+)/)?.[1] ||
          valkeyInfo.match(/redis_version:(\S+)/)?.[1] ||
          'unknown';
        const valkeyMajor = valkeyVersion.split('.')[0];
        console.log(`Valkey version: ${valkeyVersion} (major: ${valkeyMajor})`);
      } catch {
        console.log('Valkey version: unable to determine');
      }
    }

    console.log('\n');
  }, 30000); // 30 second timeout for setup

  afterAll(async () => {
    ioredisRedis?.disconnect();
    ioredisValkey?.disconnect();
    if (glideAvailable && glideAdapter) {
      await glideAdapter.disconnect();
    }
  });

  it('should compare single-operation latency (setNX)', async () => {
    if (!valkeyAvailable) {
      console.log('Skipping: Valkey not available');
      return;
    }

    const results: Record<string, number[]> = {
      'ioredis + Redis': [],
      'ioredis + Valkey': [],
    };

    if (glideAvailable) {
      results['GLIDE + Valkey'] = [];
    }

    type AdapterEntry = [string, IoredisAdapter | GlideAdapter];
    const adapters: AdapterEntry[] = [
      ['ioredis + Redis', ioredisRedisAdapter],
      ['ioredis + Valkey', ioredisValkeyAdapter],
    ];

    if (glideAvailable && glideAdapter) {
      adapters.push(['GLIDE + Valkey', glideAdapter]);
    }

    console.log('\n--- Single Operation Latency Benchmark (setNX) ---');
    console.log(`Warmup iterations: ${WARMUP_ITERATIONS}`);
    console.log(`Benchmark iterations: ${BENCHMARK_ITERATIONS}\n`);

    // Warmup phase
    console.log('Warming up...');
    for (const [, adapter] of adapters) {
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        const key = generateTestKey(`warmup-setnx-${i}`);
        await adapter.setNX(key, 'warmup-value', TTL);
        await adapter.del(key);
      }
    }

    // Benchmark each configuration with cooldown between them
    for (let adapterIdx = 0; adapterIdx < adapters.length; adapterIdx++) {
      const [name, adapter] = adapters[adapterIdx];

      // Cooldown between configurations (not before first)
      if (adapterIdx > 0) {
        console.log(`Cooling down for ${COOLDOWN_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, COOLDOWN_MS));
      }

      console.log(`Benchmarking ${name}...`);

      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        const key = generateTestKey(`bench-setnx-${name}-${i}`);
        const start = process.hrtime.bigint();
        await adapter.setNX(key, 'benchmark-value', TTL);
        const end = process.hrtime.bigint();

        results[name].push(Number(end - start) / 1_000_000);
        await adapter.del(key);
      }
    }

    // Calculate statistics
    const stats: Record<string, PerformanceStats> = {};
    for (const [name, times] of Object.entries(results)) {
      stats[name] = calculateStats(times);
    }

    printLatencyTable('setNX Single Operation Latency', stats);
    printComparisonSummary(
      stats['ioredis + Redis'],
      stats['ioredis + Valkey'],
      glideAvailable ? stats['GLIDE + Valkey'] : undefined
    );

    // Validation
    for (const [name, s] of Object.entries(stats)) {
      expect(s.mean, `${name} mean latency should be under 5ms`).toBeLessThan(5.0);
    }
  }, 120000);

  it('should compare full lock cycle latency (setNX + delIfMatch)', async () => {
    if (!valkeyAvailable) {
      console.log('Skipping: Valkey not available');
      return;
    }

    const results: Record<string, number[]> = {
      'ioredis + Redis': [],
      'ioredis + Valkey': [],
    };

    if (glideAvailable) {
      results['GLIDE + Valkey'] = [];
    }

    type AdapterEntry = [string, IoredisAdapter | GlideAdapter];
    const adapters: AdapterEntry[] = [
      ['ioredis + Redis', ioredisRedisAdapter],
      ['ioredis + Valkey', ioredisValkeyAdapter],
    ];

    if (glideAvailable && glideAdapter) {
      adapters.push(['GLIDE + Valkey', glideAdapter]);
    }

    console.log('\n--- Full Lock Cycle Latency Benchmark (setNX + delIfMatch) ---');
    console.log(`Warmup iterations: ${WARMUP_ITERATIONS}`);
    console.log(`Benchmark iterations: ${BENCHMARK_ITERATIONS}\n`);

    // Warmup phase (also warms up Lua script cache)
    console.log('Warming up (loading Lua scripts)...');
    for (const [, adapter] of adapters) {
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        const key = generateTestKey(`warmup-cycle-${i}`);
        const value = `warmup-value-${i}`;
        await adapter.setNX(key, value, TTL);
        await adapter.delIfMatch(key, value);
      }
    }

    // Benchmark each configuration with cooldown between them
    for (let adapterIdx = 0; adapterIdx < adapters.length; adapterIdx++) {
      const [name, adapter] = adapters[adapterIdx];

      // Cooldown between configurations (not before first)
      if (adapterIdx > 0) {
        console.log(`Cooling down for ${COOLDOWN_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, COOLDOWN_MS));
      }

      console.log(`Benchmarking ${name}...`);

      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        const key = generateTestKey(`bench-cycle-${name}-${i}`);
        const value = `benchmark-value-${i}`;

        const start = process.hrtime.bigint();
        await adapter.setNX(key, value, TTL);
        await adapter.delIfMatch(key, value);
        const end = process.hrtime.bigint();

        results[name].push(Number(end - start) / 1_000_000);
      }
    }

    // Calculate statistics
    const stats: Record<string, PerformanceStats> = {};
    for (const [name, times] of Object.entries(results)) {
      stats[name] = calculateStats(times);
    }

    printLatencyTable('Full Lock Cycle Latency (setNX + Lua script)', stats);
    printComparisonSummary(
      stats['ioredis + Redis'],
      stats['ioredis + Valkey'],
      glideAvailable ? stats['GLIDE + Valkey'] : undefined
    );

    // Validation
    for (const [name, s] of Object.entries(stats)) {
      expect(s.mean, `${name} mean latency should be under 10ms`).toBeLessThan(10.0);
    }
  }, 120000);

  it('should compare concurrent throughput (lock contention)', async () => {
    if (!valkeyAvailable) {
      console.log('Skipping: Valkey not available');
      return;
    }

    console.log('\n--- Concurrent Throughput Benchmark ---');
    console.log(`Concurrent workers: ${CONCURRENT_WORKERS}`);
    console.log(`Duration: ${THROUGHPUT_DURATION_MS}ms\n`);

    /**
     * Run throughput test for a given adapter
     */
    async function runThroughputTest(
      adapter: IoredisAdapter | GlideAdapter,
      keyPrefix: string
    ): Promise<ThroughputResult> {
      const latencies: number[] = [];
      let totalOps = 0;
      let successOps = 0;

      const startTime = Date.now();
      const endTime = startTime + THROUGHPUT_DURATION_MS;

      // Create worker promises
      const workers = Array.from({ length: CONCURRENT_WORKERS }, async (_, workerIdx) => {
        let opIdx = 0;

        while (Date.now() < endTime) {
          const key = generateTestKey(`${keyPrefix}-w${workerIdx}-op${opIdx}`);
          const value = `value-${workerIdx}-${opIdx}`;

          try {
            const opStart = process.hrtime.bigint();
            await adapter.setNX(key, value, TTL);
            await adapter.delIfMatch(key, value);
            const opEnd = process.hrtime.bigint();

            latencies.push(Number(opEnd - opStart) / 1_000_000);
            successOps++;
          } catch {
            // Count failed operations
          }

          totalOps++;
          opIdx++;
        }
      });

      await Promise.all(workers);

      const actualDuration = Date.now() - startTime;
      const sortedLatencies = [...latencies].sort((a, b) => a - b);

      return {
        totalOps,
        durationMs: actualDuration,
        opsPerSec: (successOps / actualDuration) * 1000,
        successRate: successOps / totalOps,
        meanLatency:
          latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
        p95Latency: sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0,
        p99Latency: sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || 0,
      };
    }

    // Warmup
    console.log('Warming up...');
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const key1 = generateTestKey(`warmup-tp-redis-${i}`);
      const key2 = generateTestKey(`warmup-tp-valkey-${i}`);
      await ioredisRedisAdapter.setNX(key1, 'warmup', TTL);
      await ioredisRedisAdapter.del(key1);
      await ioredisValkeyAdapter.setNX(key2, 'warmup', TTL);
      await ioredisValkeyAdapter.del(key2);
      if (glideAvailable) {
        const key3 = generateTestKey(`warmup-tp-glide-${i}`);
        await glideAdapter.setNX(key3, 'warmup', TTL);
        await glideAdapter.del(key3);
      }
    }

    const results: Record<string, ThroughputResult> = {};

    // Test ioredis + Redis
    console.log('Running ioredis + Redis...');
    results['ioredis + Redis'] = await runThroughputTest(ioredisRedisAdapter, 'tp-redis');

    // Cooldown between configurations
    console.log(`Cooling down for ${COOLDOWN_MS}ms...`);
    await new Promise(resolve => setTimeout(resolve, COOLDOWN_MS));

    // Test ioredis + Valkey
    console.log('Running ioredis + Valkey...');
    results['ioredis + Valkey'] = await runThroughputTest(ioredisValkeyAdapter, 'tp-valkey');

    // Test GLIDE + Valkey
    if (glideAvailable) {
      console.log(`Cooling down for ${COOLDOWN_MS}ms...`);
      await new Promise(resolve => setTimeout(resolve, COOLDOWN_MS));
      console.log('Running GLIDE + Valkey...');
      results['GLIDE + Valkey'] = await runThroughputTest(glideAdapter, 'tp-glide');
    }

    printThroughputTable(
      `Concurrent Throughput (${CONCURRENT_WORKERS} workers, ${THROUGHPUT_DURATION_MS}ms)`,
      results
    );
    printComparisonSummary(
      results['ioredis + Redis'],
      results['ioredis + Valkey'],
      glideAvailable ? results['GLIDE + Valkey'] : undefined
    );

    // Validation: at least 100 ops/s with concurrent load
    for (const [name, result] of Object.entries(results)) {
      expect(result.opsPerSec, `${name} should achieve at least 100 ops/s`).toBeGreaterThan(100);
      expect(result.successRate, `${name} should have >95% success rate`).toBeGreaterThan(0.95);
    }
  }, 60000);

  it('should produce final benchmark summary', async () => {
    if (!valkeyAvailable) {
      console.log('\n=== BENCHMARK SKIPPED ===');
      console.log('Valkey server not available. Start Valkey to run full benchmarks.');
      console.log(`Expected Valkey at: ${getValkeyHost()}:${getValkeyPort()}`);
      console.log(`Default port: ${REDIS_CONFIG.DEFAULT_PORT}\n`);
      return;
    }

    console.log(`\n${'='.repeat(78)}`);
    console.log('                    FINAL BENCHMARK SUMMARY');
    console.log('='.repeat(78));
    console.log('\nTest Configuration:');
    console.log(`  - Redis at: ${getRedisUrl()}`);
    console.log(`  - Valkey at: ${getValkeyHost()}:${getValkeyPort()}`);
    console.log(`  - GLIDE available: ${glideAvailable ? 'Yes' : 'No'}`);
    console.log(`  - Benchmark iterations: ${BENCHMARK_ITERATIONS}`);
    console.log(`  - Warmup iterations: ${WARMUP_ITERATIONS}`);
    console.log(`  - Cooldown between configs: ${COOLDOWN_MS}ms`);
    console.log(`  - Concurrent workers: ${CONCURRENT_WORKERS}`);
    console.log(`  - Throughput test duration: ${THROUGHPUT_DURATION_MS}ms`);
    console.log('\nConclusion:');
    console.log('  See individual test results above for detailed Redis vs Valkey comparison.');
    console.log('  GLIDE is the official Valkey client optimized for Valkey-specific features.');
    console.log('  StdDev values help assess benchmark reproducibility.\n');
    console.log(`${'='.repeat(78)}\n`);

    expect(true).toBe(true);
  }, 5000);
});
