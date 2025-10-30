import { describe, it, beforeAll, afterAll } from 'vitest';
import { createClient as createNodeRedisClient } from 'redis';
import { LockManager, NodeRedisAdapter } from '../../src/index.js';
import { generateTestKey, getRedisUrl } from '../shared/constants.js';

describe('Batch Lock Operations Performance', () => {
  let nodeRedisClient: any;
  let adapter: NodeRedisAdapter;
  let manager: LockManager;

  beforeAll(async () => {
    nodeRedisClient = createNodeRedisClient({ url: getRedisUrl() });
    await nodeRedisClient.connect();
    adapter = new NodeRedisAdapter(nodeRedisClient);
    manager = new LockManager({ nodes: [adapter], defaultTTL: 30000 });
  });

  afterAll(async () => {
    await nodeRedisClient?.disconnect();
  });

  it('should benchmark sequential vs batch acquisition', async () => {
    console.log('\n=== Batch Lock Performance Benchmark ===\n');

    const iterations = 50;
    const lockCounts = [3, 5, 10];

    for (const count of lockCounts) {
      const keys = Array.from({ length: count }, (_, i) => generateTestKey(`bench-${i}`));

      // Sequential acquisition
      const seqTimes: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        const handles: Awaited<ReturnType<typeof manager.acquireLock>>[] = [];
        for (const key of keys) {
          handles.push(await manager.acquireLock(key));
        }
        seqTimes.push(Date.now() - start);
        await Promise.all(handles.map(h => manager.releaseLock(h)));
      }

      // Batch acquisition
      const batchTimes: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        const handles = await manager.acquireBatch(keys);
        batchTimes.push(Date.now() - start);
        await manager.releaseBatch(handles);
      }

      // Calculate statistics
      const seqAvg = seqTimes.reduce((a, b) => a + b, 0) / seqTimes.length;
      const batchAvg = batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;
      const seqP95 = percentile(seqTimes, 95);
      const batchP95 = percentile(batchTimes, 95);
      const speedup = seqAvg / batchAvg;

      console.log(`${count} locks (${iterations} iterations):`);
      console.log(`  Sequential:  ${seqAvg.toFixed(2)}ms avg, ${seqP95.toFixed(2)}ms P95`);
      console.log(`  Batch:       ${batchAvg.toFixed(2)}ms avg, ${batchP95.toFixed(2)}ms P95`);
      console.log(`  Speedup:     ${speedup.toFixed(2)}x\n`);
    }
  });

  it('should benchmark batch with auto-extension overhead', async () => {
    console.log('=== Batch Auto-Extension Overhead ===\n');

    const keys = Array.from({ length: 5 }, (_, i) => generateTestKey(`ext-${i}`));
    const iterations = 20;

    // Basic batch (no auto-extension)
    const basicTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      const handles = await manager.acquireBatch(keys);
      await new Promise(resolve => setTimeout(resolve, 100));
      await manager.releaseBatch(handles);
      basicTimes.push(Date.now() - start);
    }

    // Batch with auto-extension
    const extTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await manager.usingBatch(keys, async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });
      extTimes.push(Date.now() - start);
    }

    const basicAvg = basicTimes.reduce((a, b) => a + b, 0) / basicTimes.length;
    const extAvg = extTimes.reduce((a, b) => a + b, 0) / extTimes.length;
    const overhead = ((extAvg - basicAvg) / basicAvg) * 100;

    console.log(`Basic batch:        ${basicAvg.toFixed(2)}ms avg`);
    console.log(`With auto-extend:   ${extAvg.toFixed(2)}ms avg`);
    console.log(`Overhead:           ${overhead.toFixed(1)}%\n`);
  });

  it('should measure batch throughput', async () => {
    console.log('=== Batch Throughput ===\n');

    const duration = 5000; // 5 seconds
    const keys = Array.from({ length: 3 }, (_, i) => generateTestKey(`thru-${i}`));

    let operations = 0;
    const start = Date.now();

    while (Date.now() - start < duration) {
      const handles = await manager.acquireBatch(keys);
      await manager.releaseBatch(handles);
      operations++;
    }

    const elapsed = (Date.now() - start) / 1000;
    const opsPerSec = operations / elapsed;

    console.log(`Duration:     ${elapsed.toFixed(2)}s`);
    console.log(`Operations:   ${operations}`);
    console.log(`Throughput:   ${opsPerSec.toFixed(0)} ops/sec\n`);
  });
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[index] ?? 0;
}
