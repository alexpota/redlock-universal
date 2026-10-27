import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import { IoredisAdapter, LockManager } from '../../../src/index.js';
import { generateTestKey, getRedisUrl } from '../../shared/constants.js';

const WARMUP_CYCLES = 10;
const CYCLES = 2_000;
const KEY_POOL_SIZE = 50;
/** Running totals gain a few digits; storing every sample would add thousands of characters */
const MAX_FOOTPRINT_GROWTH = 64;
const TEST_TIMEOUT_MS = 30_000;

describe('LockManager statistics', () => {
  let client: Redis;

  beforeAll(() => {
    client = new Redis(getRedisUrl());
  });

  afterAll(() => {
    client.disconnect();
  });

  it(
    'keeps a constant memory footprint across many locks',
    async () => {
      const manager = new LockManager({ nodes: [new IoredisAdapter(client)] });
      const keyPrefix = generateTestKey('manager:stats');
      const footprint = (): number =>
        JSON.stringify((manager as unknown as { stats: object }).stats).length;
      const cycle = async (index: number): Promise<void> => {
        const handle = await manager.acquireLock(`${keyPrefix}:${index % KEY_POOL_SIZE}`);
        await manager.releaseLock(handle);
      };

      for (let i = 0; i < WARMUP_CYCLES; i++) {
        await cycle(i);
      }
      const footprintBefore = footprint();

      for (let i = 0; i < CYCLES; i++) {
        await cycle(i);
      }

      expect(footprint() - footprintBefore).toBeLessThan(MAX_FOOTPRINT_GROWTH);

      const stats = manager.getStats();
      expect(stats.acquiredLocks).toBe(WARMUP_CYCLES + CYCLES);
      expect(Number.isFinite(stats.averageAcquisitionTime)).toBe(true);
      expect(Number.isFinite(stats.averageHoldTime)).toBe(true);
    },
    TEST_TIMEOUT_MS
  );

  describe('usingBatch', () => {
    const batchKeys = (scenario: string): string[] => [
      generateTestKey(`manager:using:${scenario}:a`),
      generateTestKey(`manager:using:${scenario}:b`),
    ];

    it('stops counting the locks as active once the routine returns', async () => {
      const manager = new LockManager({ nodes: [new IoredisAdapter(client)] });
      const keys = batchKeys('returns');
      let activeDuringRoutine = 0;

      await manager.usingBatch(keys, async () => {
        activeDuringRoutine = manager.getStats().activeLocks;
      });

      expect(activeDuringRoutine).toBe(keys.length);
      expect(manager.getStats().activeLocks).toBe(0);
      expect(manager.getActiveLocks()).toEqual([]);
    });

    it('stops counting the locks as active when the routine throws', async () => {
      const manager = new LockManager({ nodes: [new IoredisAdapter(client)] });

      await expect(
        manager.usingBatch(batchKeys('throws'), async () => {
          throw new Error('routine failed');
        })
      ).rejects.toThrow('routine failed');

      expect(manager.getStats().activeLocks).toBe(0);
      expect(manager.getActiveLocks()).toEqual([]);
    });
  });
});
